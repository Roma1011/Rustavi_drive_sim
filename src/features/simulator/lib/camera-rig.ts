import { MathUtils, Object3D, PerspectiveCamera, Vector3 } from 'three';
import {
  SIMULATOR_CONFIG,
  type ActiveCameraMode,
} from '../config/simulator.config';

type CameraVector = readonly [number, number, number];
interface CameraPreset {
  accelerationPositionOffset: CameraVector;
  baseFov: number;
  followDamping: number;
  localLookOffset: CameraVector;
  localPositionOffset: CameraVector;
  speedPositionOffset: CameraVector;
}

type AdjustableCameraMode = Extract<ActiveCameraMode, 'bonnet' | 'driver'>;

interface CameraRigState {
  localAcceleration: number;
  localAngle: number;
  localHeight: number;
  localRadius: number;
  lookAt: Vector3;
  localLookAt: Vector3;
  position: Vector3;
}

interface UpdateCameraOptions {
  acceleration: number;
  camera: PerspectiveCamera;
  cameraMode: ActiveCameraMode;
  delta: number;
  speed: number;
  vehicleId: string;
  vehicleRoot: Object3D;
  rigState: CameraRigState;
}

const desiredPosition = new Vector3();
const desiredLookAt = new Vector3();
const desiredWorldPosition = new Vector3();
const desiredWorldLookAt = new Vector3();
const temporaryPreset: CameraPreset = {
  accelerationPositionOffset: [0, 0, 0],
  baseFov: 56,
  followDamping: 7.2,
  localLookOffset: [0, 1.05, 4.9],
  localPositionOffset: [0, 2.45, -6.6],
  speedPositionOffset: [0, 0.45, -3.2],
};

const FIRST_PERSON_CAMERA_OVERRIDES: Partial<
  Record<string, Partial<Record<AdjustableCameraMode, Partial<CameraPreset>>>>
> = {
  '1970-chevrolet-camaro-z28': {
    bonnet: {
      localLookOffset: [0, 0.92, 14],
      localPositionOffset: [0, 0.96, 1.9],
    },
    driver: {
      localLookOffset: [0.24, 1.08, 14],
      localPositionOffset: [0.24, 1.08, 0.18],
    },
  },
  '1970-chevrolet-chevelle-ss-454': {
    bonnet: {
      localLookOffset: [0, 0.94, 14],
      localPositionOffset: [0, 0.98, 1.94],
    },
    driver: {
      localLookOffset: [0.24, 1.08, 14],
      localPositionOffset: [0.24, 1.08, 0.18],
    },
  },
  '1970-dodge-challenger-rt': {
    bonnet: {
      localLookOffset: [0, 0.95, 14],
      localPositionOffset: [0, 0.99, 1.96],
    },
    driver: {
      localLookOffset: [0.24, 1.09, 14],
      localPositionOffset: [0.24, 1.09, 0.18],
    },
  },
  '1992-honda-nsx-r': {
    bonnet: {
      localLookOffset: [0, 0.82, 14],
      localPositionOffset: [0, 0.84, 1.74],
    },
    driver: {
      localLookOffset: [-0.18, 0.99, 14],
      localPositionOffset: [-0.18, 0.98, 0.12],
    },
  },
  '1993-honda-civic-coupe-vis-racing-fast-furious': {
    bonnet: {
      localLookOffset: [0, 0.86, 14],
      localPositionOffset: [0, 0.89, 1.84],
    },
    driver: {
      localLookOffset: [0.22, 1.01, 14],
      localPositionOffset: [0.22, 1.01, 0.16],
    },
  },
  '2012-dodge-charger-rt-sedan-4d': {
    bonnet: {
      localLookOffset: [0, 0.99, 14],
      localPositionOffset: [0, 1.02, 2.06],
    },
    driver: {
      localLookOffset: [0.26, 1.14, 14],
      localPositionOffset: [0.26, 1.14, 0.23],
    },
  },
  '2013-dodge-charger-srt8-patrol': {
    bonnet: {
      localLookOffset: [0, 1.01, 14],
      localPositionOffset: [0, 1.04, 2.1],
    },
    driver: {
      localLookOffset: [0.26, 1.16, 14],
      localPositionOffset: [0.26, 1.16, 0.24],
    },
  },
  '2013-jeep-grand-cherokee-srt8': {
    bonnet: {
      localLookOffset: [0, 1.08, 14],
      localPositionOffset: [0, 1.1, 2.06],
    },
    driver: {
      localLookOffset: [0.1, 1.18, 14],
      localPositionOffset: [0.34, 1.28, 0.42],
    },
  },
  '2019-jeep-cherokee': {
    bonnet: {
      localLookOffset: [0, 1.24, 14],
      localPositionOffset: [0, 1.28, 2.26],
    },
    driver: {
      localLookOffset: [0.18, 1.18, 14],
      localPositionOffset: [0.46, 1.34, 0.46],
    },
  },
  '2021-jeep-grand-commander-k8': {
    bonnet: {
      localLookOffset: [0, 1.1, 14],
      localPositionOffset: [0, 1.12, 2.12],
    },
    driver: {
      localLookOffset: [0.29, 1.25, 14],
      localPositionOffset: [0.29, 1.25, 0.27],
    },
  },
  'free-porsche-911-carrera-4s': {
    bonnet: {
      localLookOffset: [0, 0.84, 14],
      localPositionOffset: [0, 0.86, 1.76],
    },
    driver: {
      localLookOffset: [0.22, 1, 14],
      localPositionOffset: [0.22, 0.99, 0.14],
    },
  },
  'jeep-wrangler-adventure-rubicon-www-vecarz-com': {
    bonnet: {
      localLookOffset: [0, 1.13, 14],
      localPositionOffset: [0, 1.16, 2.04],
    },
    driver: {
      localLookOffset: [0.12, 1.24, 14],
      localPositionOffset: [0.38, 1.36, 0.44],
    },
  },
  'ringbrothers-1966-chevrolet-chevelle-recoil': {
    bonnet: {
      localLookOffset: [0, 0.93, 14],
      localPositionOffset: [0, 0.97, 1.92],
    },
    driver: {
      localLookOffset: [0.24, 1.07, 14],
      localPositionOffset: [0.24, 1.07, 0.18],
    },
  },
};

function resolveCameraPreset(cameraMode: ActiveCameraMode, vehicleId: string) {
  const basePreset = SIMULATOR_CONFIG.camera[cameraMode] as CameraPreset;

  if (cameraMode !== 'bonnet' && cameraMode !== 'driver') {
    return basePreset;
  }

  const override = FIRST_PERSON_CAMERA_OVERRIDES[vehicleId]?.[cameraMode];

  if (!override) {
    return basePreset;
  }

  temporaryPreset.accelerationPositionOffset = override.accelerationPositionOffset ?? basePreset.accelerationPositionOffset;
  temporaryPreset.baseFov = override.baseFov ?? basePreset.baseFov;
  temporaryPreset.followDamping = override.followDamping ?? basePreset.followDamping;
  temporaryPreset.localLookOffset = override.localLookOffset ?? basePreset.localLookOffset;
  temporaryPreset.localPositionOffset = override.localPositionOffset ?? basePreset.localPositionOffset;
  temporaryPreset.speedPositionOffset = override.speedPositionOffset ?? basePreset.speedPositionOffset;

  return temporaryPreset;
}

export function createCameraRigState() {
  const initialPosition = SIMULATOR_CONFIG.camera.chase.localPositionOffset;
  const initialLookAt = SIMULATOR_CONFIG.camera.chase.localLookOffset;

  return {
    localAcceleration: 0,
    localAngle: Math.atan2(initialPosition[0], initialPosition[2]),
    localHeight: initialPosition[1],
    localRadius: Math.hypot(initialPosition[0], initialPosition[2]),
    localLookAt: new Vector3(initialLookAt[0], initialLookAt[1], initialLookAt[2]),
    lookAt: new Vector3(0, 1, 0),
    position: new Vector3(initialPosition[0], initialPosition[1], initialPosition[2]),
  };
}

export function updateCameraRig({
  acceleration,
  camera,
  cameraMode,
  delta,
  speed,
  vehicleId,
  vehicleRoot,
  rigState,
}: UpdateCameraOptions) {
  const preset = resolveCameraPreset(cameraMode, vehicleId);
  const speedRatio = Math.min(Math.abs(speed) / SIMULATOR_CONFIG.vehicle.maxForwardSpeed, 1);
  const accelerationRatio = MathUtils.clamp(
    acceleration /
      (acceleration >= 0
        ? SIMULATOR_CONFIG.vehicle.acceleration
        : SIMULATOR_CONFIG.vehicle.brakeStrength),
    -1,
    1,
  );
  rigState.localAcceleration = MathUtils.damp(
    rigState.localAcceleration,
    accelerationRatio,
    preset.followDamping * 1.35,
    delta,
  );

  desiredPosition.set(
    preset.localPositionOffset[0] +
      preset.speedPositionOffset[0] * speedRatio +
      preset.accelerationPositionOffset[0] * rigState.localAcceleration,
    preset.localPositionOffset[1] +
      preset.speedPositionOffset[1] * speedRatio +
      preset.accelerationPositionOffset[1] * rigState.localAcceleration,
    preset.localPositionOffset[2] +
      preset.speedPositionOffset[2] * speedRatio +
      preset.accelerationPositionOffset[2] * rigState.localAcceleration,
  );
  desiredLookAt.set(
    preset.localLookOffset[0],
    preset.localLookOffset[1],
    preset.localLookOffset[2],
  );

  const targetAngle = Math.atan2(desiredPosition.x, desiredPosition.z);
  const targetRadius = Math.hypot(desiredPosition.x, desiredPosition.z);

  rigState.localAngle = dampAngle(
    rigState.localAngle,
    targetAngle,
    preset.followDamping,
    delta,
  );
  rigState.localRadius = MathUtils.damp(
    rigState.localRadius,
    targetRadius,
    preset.followDamping,
    delta,
  );
  rigState.localHeight = MathUtils.damp(
    rigState.localHeight,
    desiredPosition.y,
    preset.followDamping,
    delta,
  );
  rigState.localLookAt.lerp(desiredLookAt, 1 - Math.exp(-preset.followDamping * delta));

  desiredPosition.set(
    Math.sin(rigState.localAngle) * rigState.localRadius,
    rigState.localHeight,
    Math.cos(rigState.localAngle) * rigState.localRadius,
  );

  desiredWorldPosition.copy(desiredPosition);
  desiredWorldLookAt.copy(rigState.localLookAt);
  vehicleRoot.localToWorld(desiredWorldPosition);
  vehicleRoot.localToWorld(desiredWorldLookAt);

  rigState.position.copy(desiredWorldPosition);
  rigState.lookAt.copy(desiredWorldLookAt);

  camera.position.copy(rigState.position);
  camera.lookAt(rigState.lookAt);
  camera.fov = MathUtils.damp(camera.fov, preset.baseFov + speedRatio * 6, 7, delta);
  camera.updateProjectionMatrix();
}

function dampAngle(current: number, target: number, smoothing: number, delta: number) {
  const deltaAngle = Math.atan2(Math.sin(target - current), Math.cos(target - current));
  return MathUtils.damp(current, current + deltaAngle, smoothing, delta);
}
