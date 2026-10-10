import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { Box3, Group, MathUtils, PerspectiveCamera, Quaternion, Raycaster, Vector3 } from 'three';
import { CarModel } from '../../../entities/car/CarModel';
import type { SpawnTransform } from '../../../entities/route/road-builder';
import type { LoadedRoute } from '../../../entities/route/route-types';
import { SIMULATOR_CONFIG } from '../config/simulator.config';
import { useDrivingInput } from '../hooks/use-driving-input';
import { createCameraRigState, updateCameraRig } from '../lib/camera-rig';
import {
  createTrackableRoute,
  createTrackerState,
  resetTrackerState,
  updateTracker,
} from '../lib/exam-tracker';
import {
  findGroundSurface,
  findSpawnTransform,
  isPathBlocked,
  isRoadAtPosition,
  sampleTerrainUnderVehicle,
} from '../lib/terrain';
import {
  createChassisQuaternion,
  createDriveState,
  gearLabelFromIndex,
  getShiftIntensity,
  isTopSpeedLocked,
  rpmFromDriveState,
  stepDriveState,
} from '../lib/vehicle-physics';
import { useExamStore } from '../state/exam.store';
import { useSimulatorStore } from '../state/simulator.store';

interface PlayerVehicleProps {
  /** Route being driven, or null for the free-roam city map. */
  route: LoadedRoute | null;
  /** Explicit spawn (route start). When null the spawn is searched on the terrain. */
  spawn: SpawnTransform | null;
  terrainRef: React.RefObject<Group>;
}

type ResetReason = 'exam-start' | 'restart' | null;

const COLLISION_EVENT_MIN_SPEED = 3;

export function PlayerVehicle({ route, spawn, terrainRef }: PlayerVehicleProps) {
  const vehicleRef = useRef<Group>(null);
  const modelRef = useRef<Group>(null);
  const telemetryTimerRef = useRef(0);
  const raycaster = useMemo(() => new Raycaster(), []);
  const motionRef = useRef(createDriveState(new Vector3(0, SIMULATOR_CONFIG.vehicle.rideHeight, 0)));
  const spawnReadyRef = useRef(false);
  const cameraRigStateRef = useRef(createCameraRigState());
  const targetQuaternionRef = useRef(new Quaternion());
  const resetVehicleRef = useRef(false);
  const resetReasonRef = useRef<ResetReason>(null);
  const previousPositionRef = useRef(new Vector3());
  const steeringAngleRef = useRef(0);
  const trackerRef = useRef(createTrackerState());
  const trackable = useMemo(() => (route ? createTrackableRoute(route) : null), [route]);

  const cameraMode = useSimulatorStore((state) => state.cameraMode);
  const cycleCamera = useSimulatorStore((state) => state.cycleCamera);
  const pauseMenuVisible = useSimulatorStore((state) => state.pauseMenuVisible);
  const restartToken = useSimulatorStore((state) => state.restartToken);
  const selectedVehicleId = useSimulatorStore((state) => state.selectedVehicleId);
  const settingsVisible = useSimulatorStore((state) => state.settingsVisible);
  const toggleInstructions = useSimulatorStore((state) => state.toggleInstructions);
  const transitionLoadingVisible = useSimulatorStore((state) => state.transitionLoadingVisible);
  const setMapBounds = useSimulatorStore((state) => state.setMapBounds);
  const setMovementBlocked = useSimulatorStore((state) => state.setMovementBlocked);
  const setPlayerPose = useSimulatorStore((state) => state.setPlayerPose);
  const setTelemetry = useSimulatorStore((state) => state.setTelemetry);
  const setReady = useSimulatorStore((state) => state.setReady);
  const setTransitionLoadingVisible = useSimulatorStore((state) => state.setTransitionLoadingVisible);
  const examStartToken = useExamStore((state) => state.startToken);
  const camera = useThree((state) => state.camera);
  const mapBoundsReadyRef = useRef(false);

  const syncTelemetry = () => {
    const motion = motionRef.current;
    const topSpeedLocked = isTopSpeedLocked(motion, inputRef.current, SIMULATOR_CONFIG.vehicle);

    setTelemetry({
      gear: gearLabelFromIndex(motion.gearIndex),
      isReversing: motion.speed < -0.2 || motion.gearIndex < 0,
      rpm: rpmFromDriveState(motion, SIMULATOR_CONFIG.vehicle),
      shiftIntensity: getShiftIntensity(motion),
      speedKph: Math.round(
        (topSpeedLocked ? SIMULATOR_CONFIG.vehicle.maxForwardSpeed : Math.abs(motion.speed)) * 3.6,
      ),
    });

    if (trackable) {
      const tracker = trackerRef.current;
      useExamStore.getState().updateLive({
        distanceToRoute: tracker.distanceToRoute,
        elapsedSeconds: tracker.elapsedSeconds,
        lateralMeters: tracker.lateralMeters,
        progressMeters: tracker.progressMeters,
      });
    }
  };

  const inputRef = useDrivingInput({
    onCycleCamera: cycleCamera,
    onReset: () => {
      resetVehicleRef.current = true;
      resetReasonRef.current = 'restart';
    },
    onToggleInstructions: toggleInstructions,
  });

  useEffect(() => {
    return () => {
      setReady(false);
    };
  }, [setReady]);

  useEffect(() => {
    if (restartToken === 0) {
      return;
    }

    resetVehicleRef.current = true;
    resetReasonRef.current = 'restart';
  }, [restartToken]);

  useEffect(() => {
    if (examStartToken === 0) {
      return;
    }

    resetTrackerState(trackerRef.current);
    resetVehicleRef.current = true;
    resetReasonRef.current = 'exam-start';
  }, [examStartToken]);

  useFrame((state, rawDelta) => {
    const vehicle = vehicleRef.current;
    const terrain = terrainRef.current;
    const visual = modelRef.current;

    if (!vehicle) {
      return;
    }

    const delta = Math.min(rawDelta, 1 / 30);
    const motion = motionRef.current;
    const previousPosition = previousPositionRef.current;
    const previousSpeed = motion.speed;

    if (terrain && !mapBoundsReadyRef.current) {
      const terrainBounds = new Box3().setFromObject(terrain);

      if (!terrainBounds.isEmpty()) {
        setMapBounds({
          maxX: terrainBounds.max.x,
          maxZ: terrainBounds.max.z,
          minX: terrainBounds.min.x,
          minZ: terrainBounds.min.z,
        });
        mapBoundsReadyRef.current = true;
      }
    }

    if ((!spawnReadyRef.current || resetVehicleRef.current) && terrain) {
      const shouldDismissTransition = resetVehicleRef.current && transitionLoadingVisible;
      const spawnTransform = spawn ?? findSpawnTransform(terrain, raycaster, SIMULATOR_CONFIG.vehicle);
      motion.position.copy(spawnTransform.position);
      motion.position.y += SIMULATOR_CONFIG.vehicle.rideHeight;
      motion.heading = spawnTransform.heading;
      motion.gearDwellTimer = 0;
      motion.gearIndex = 1;
      motion.shiftTimer = 0;
      motion.speed = 0;
      motion.steering = 0;
      steeringAngleRef.current = 0;
      vehicle.position.copy(motion.position);
      targetQuaternionRef.current.copy(
        createChassisQuaternion(
          motion.heading,
          {
            back: motion.position.y - SIMULATOR_CONFIG.vehicle.rideHeight,
            center: motion.position.y - SIMULATOR_CONFIG.vehicle.rideHeight,
            front: motion.position.y - SIMULATOR_CONFIG.vehicle.rideHeight,
            left: motion.position.y - SIMULATOR_CONFIG.vehicle.rideHeight,
            right: motion.position.y - SIMULATOR_CONFIG.vehicle.rideHeight,
          },
          SIMULATOR_CONFIG.vehicle,
        ),
      );
      vehicle.quaternion.copy(targetQuaternionRef.current);
      resetTrackerState(trackerRef.current);

      if (resetReasonRef.current === 'restart' && useExamStore.getState().status === 'running') {
        useExamStore.getState().abortToIdle();
      }

      resetReasonRef.current = null;
      spawnReadyRef.current = true;
      resetVehicleRef.current = false;
      setReady(true);
      setPlayerPose({ heading: motion.heading, x: motion.position.x, z: motion.position.z });
      syncTelemetry();

      if (shouldDismissTransition) {
        setTransitionLoadingVisible(false);
      }
    }

    if (pauseMenuVisible || settingsVisible || transitionLoadingVisible) {
      setMovementBlocked(false);
      updateCameraRig({
        acceleration: 0,
        camera: camera as PerspectiveCamera,
        cameraMode,
        delta,
        rigState: cameraRigStateRef.current,
        speed: motion.speed,
        vehicleId: selectedVehicleId,
        vehicleRoot: vehicle,
      });
      return;
    }

    previousPosition.copy(motion.position);
    const previousHeading = motion.heading;
    const previousSteering = motion.steering;

    stepDriveState(motion, inputRef.current, delta, SIMULATOR_CONFIG.vehicle);

    const previousGroundY = previousPosition.y - SIMULATOR_CONFIG.vehicle.rideHeight;
    const candidateSurface = findGroundSurface(
      terrain,
      raycaster,
      motion.position.x,
      motion.position.z,
      previousGroundY,
    );
    const candidateIsDrivable =
      Boolean(candidateSurface) &&
      isRoadAtPosition(terrain, raycaster, motion.position.x, motion.position.z, previousGroundY);
    const hitBarrier = isPathBlocked(
      terrain,
      raycaster,
      previousPosition,
      motion.position,
      SIMULATOR_CONFIG.vehicle.collisionRadius,
      SIMULATOR_CONFIG.vehicle.collisionProbeHeight,
    );

    setMovementBlocked(!candidateIsDrivable || hitBarrier);

    if (!candidateIsDrivable || hitBarrier) {
      motion.position.copy(previousPosition);
      motion.heading = previousHeading;
      motion.speed = 0;
      motion.steering = MathUtils.damp(previousSteering, 0, 10, delta);
    }

    steeringAngleRef.current = motion.steering;

    const terrainProbe = sampleTerrainUnderVehicle(
      terrain,
      raycaster,
      motion.position,
      motion.heading,
      SIMULATOR_CONFIG.vehicle,
    );

    motion.position.y = MathUtils.damp(
      motion.position.y,
      terrainProbe.center + SIMULATOR_CONFIG.vehicle.rideHeight,
      11,
      delta,
    );

    vehicle.position.copy(motion.position);
    targetQuaternionRef.current.copy(
      createChassisQuaternion(motion.heading, terrainProbe, SIMULATOR_CONFIG.vehicle),
    );
    vehicle.quaternion.slerp(
      targetQuaternionRef.current,
      1 - Math.exp(-SIMULATOR_CONFIG.vehicle.orientationLerp * delta),
    );

    if (visual) {
      visual.rotation.z = MathUtils.damp(
        visual.rotation.z,
        -motion.steering * SIMULATOR_CONFIG.vehicle.bodyLean,
        8,
        delta,
      );
    }

    setPlayerPose({
      heading: motion.heading,
      x: motion.position.x,
      z: motion.position.z,
    });

    if (trackable) {
      const collided = (hitBarrier || !candidateIsDrivable) && Math.abs(previousSpeed) > COLLISION_EVENT_MIN_SPEED;
      const events = updateTracker(
        trackerRef.current,
        trackable,
        {
          collided,
          delta,
          heading: motion.heading,
          speedMps: motion.speed,
          x: motion.position.x,
          z: motion.position.z,
        },
        SIMULATOR_CONFIG.exam,
      );

      if (events.length > 0) {
        const exam = useExamStore.getState();

        if (exam.status === 'running') {
          for (const event of events) {
            if (event === 'completed') {
              syncTelemetry();
              exam.endExam(true);
              break;
            }

            exam.recordMistake(event, trackerRef.current.elapsedSeconds, trackerRef.current.progressMeters);
          }
        }
      }
    }

    updateCameraRig({
      acceleration: (motion.speed - previousSpeed) / Math.max(delta, 1e-3),
      camera: camera as PerspectiveCamera,
      cameraMode: motion.speed < -0.4 ? 'reverse' : cameraMode,
      delta,
      rigState: cameraRigStateRef.current,
      speed: motion.speed,
      vehicleId: selectedVehicleId,
      vehicleRoot: vehicle,
    });

    telemetryTimerRef.current += delta;

    if (telemetryTimerRef.current >= 0.08) {
      telemetryTimerRef.current = 0;
      syncTelemetry();
    }
  });

  return (
    <group ref={vehicleRef}>
      <group ref={modelRef}>
        <CarModel bodyLean={0} steeringAngleRef={steeringAngleRef} />
      </group>
    </group>
  );
}
