import { MathUtils, Matrix4, Quaternion, Vector3 } from 'three';
import { type SIMULATOR_CONFIG } from '../config/simulator.config';
import { type TerrainProbe } from './terrain';

type VehicleConfig = typeof SIMULATOR_CONFIG.vehicle;

export interface DrivingInput {
  brake: boolean;
  steer: number;
  throttle: number;
}

export interface DriveState {
  autoShiftHoldTimer: number;
  gearDwellTimer: number;
  gearIndex: number;
  heading: number;
  position: Vector3;
  shiftTimer: number;
  speed: number;
  steering: number;
}

type Gear = '1' | '2' | '3' | '4' | '5' | '6' | 'N' | 'R';

const FORWARD_GEAR_SPEED_RATIOS = [0.18, 0.3, 0.46, 0.62, 0.8, 1] as const;
const FORWARD_GEAR_TORQUE_MULTIPLIERS = [1.46, 1.3, 1.2, 1.1, 1, 0.92] as const;
const UPSHIFT_SPEED_TARGETS = [8, 15.5, 23, 31, 37.5, Number.POSITIVE_INFINITY] as const;
const DOWNSHIFT_SPEED_TARGETS = [0, 6, 12, 20, 29, 33] as const;
const MIN_UPSHIFT_DWELL_SECONDS = [1.15, 1.02, 0.94, 0.88, 0.68, 0] as const;
const MAX_FORWARD_GEAR = FORWARD_GEAR_SPEED_RATIOS.length;
const SHIFT_CUT_SECONDS = 0.17;
const AUTO_SHIFT_STOP_SPEED = 0.4;
const AUTO_SHIFT_HOLD_SECONDS = 0.34;
const TOP_SPEED_LOCK_RATIO = 0.94;
const IDLE_RPM = 900;
const REDLINE_RPM = 6800;

export function createDriveState(spawn = new Vector3(0, 1, 0)): DriveState {
  return {
    autoShiftHoldTimer: 0,
    gearDwellTimer: 0,
    gearIndex: 1,
    heading: 0,
    position: spawn.clone(),
    shiftTimer: 0,
    speed: 0,
    steering: 0,
  };
}

export function stepDriveState(
  state: DriveState,
  input: DrivingInput,
  delta: number,
  config: VehicleConfig,
) {
  // Steering authority shrinks smoothly with speed: full lock when crawling, half at
  // `steerSpeedSoftening` m/s, so the car is agile at junctions but stable on straights.
  const steerAuthority = 1 / (1 + Math.abs(state.speed) / config.steerSpeedSoftening);
  const targetSteer = input.steer * config.maxSteerAngle * steerAuthority;

  state.steering = MathUtils.damp(state.steering, targetSteer, config.steerResponse, delta);
  state.autoShiftHoldTimer = Math.max(0, state.autoShiftHoldTimer - delta);
  state.gearDwellTimer += delta;
  state.shiftTimer = Math.max(0, state.shiftTimer - delta);
  const speedAbs = Math.abs(state.speed);
  const throttleAmount = Math.abs(input.throttle);

  if (state.gearIndex > 0) {
    const gearTopSpeed = getGearTopSpeed(state.gearIndex, config);
    const gearRatio = MathUtils.clamp(speedAbs / Math.max(gearTopSpeed, 1e-3), 0, 1);
    const availableTorque =
      FORWARD_GEAR_TORQUE_MULTIPLIERS[state.gearIndex - 1] *
      MathUtils.lerp(1, 0.42, Math.pow(gearRatio, 1.15));

    if (input.throttle > 0) {
      if (state.speed < -0.15) {
        state.speed = moveToward(state.speed, 0, config.brakeStrength * 0.7 * delta);
      } else if (state.shiftTimer === 0) {
        state.speed += input.throttle * config.acceleration * Math.max(availableTorque, 0) * delta;
      }
    } else if (input.throttle < 0) {
      state.speed = moveToward(state.speed, 0, config.brakeStrength * 0.65 * throttleAmount * delta);
    }
  } else if (state.gearIndex < 0) {
    const reverseRatio = MathUtils.clamp(speedAbs / config.maxReverseSpeed, 0, 1);
    const reverseTorque = 0.78 * (1 - Math.pow(reverseRatio, 1.5));

    if (input.throttle < 0) {
      if (state.speed > 0.15) {
        state.speed = moveToward(state.speed, 0, config.brakeStrength * 0.7 * delta);
      } else if (state.shiftTimer === 0) {
        state.speed -= throttleAmount * config.reverseAcceleration * Math.max(reverseTorque, 0) * delta;
      }
    } else if (input.throttle > 0) {
      state.speed = moveToward(state.speed, 0, config.brakeStrength * 0.65 * throttleAmount * delta);
    }
  } else if (throttleAmount > 0) {
    state.speed = moveToward(state.speed, 0, config.brakeStrength * 0.22 * throttleAmount * delta);
  }

  if (input.brake) {
    state.speed = moveToward(state.speed, 0, config.brakeStrength * delta);
  }

  const resistance =
    (config.rollingResistance + config.aerodynamicDrag * state.speed * state.speed) * delta;
  state.speed = moveToward(state.speed, 0, resistance);
  state.speed = MathUtils.clamp(state.speed, -config.maxReverseSpeed, config.maxForwardSpeed);

  if (isTopSpeedLocked(state, input, config)) {
    state.speed = config.maxForwardSpeed;
  }

  if (Math.abs(state.speed) < 0.05 && input.throttle === 0 && !input.brake) {
    state.speed = 0;
  }

  updateAutomaticGear(state, input, config);

  // Positive steering (right) with forward speed must decrease the heading: heading is a
  // rotation about +Y, and forward = (sin(heading), 0, cos(heading)), so a decreasing
  // heading swings the nose towards -X, which is the right-hand side when facing +Z.
  // Reversing flips the sign automatically, matching real-car kinematics.
  let yawRate = state.steering * state.speed * config.turnGrip;
  const speedMagnitude = Math.abs(state.speed);

  if (speedMagnitude > 0.5) {
    const maxYawRate = config.maxLateralAcceleration / speedMagnitude;
    yawRate = MathUtils.clamp(yawRate, -maxYawRate, maxYawRate);
  }

  state.heading -= yawRate * delta;

  const forward = new Vector3(Math.sin(state.heading), 0, Math.cos(state.heading));
  state.position.addScaledVector(forward, state.speed * delta);
}

export function createChassisQuaternion(
  heading: number,
  terrain: TerrainProbe,
  config: VehicleConfig,
) {
  const forward = new Vector3(Math.sin(heading), 0, Math.cos(heading));
  const right = new Vector3(forward.z, 0, -forward.x);

  const forwardTangent = new Vector3(
    forward.x,
    (terrain.front - terrain.back) / config.wheelBase,
    forward.z,
  ).normalize();

  const rightTangent = new Vector3(
    right.x,
    (terrain.right - terrain.left) / config.trackWidth,
    right.z,
  ).normalize();

  const up = new Vector3().crossVectors(forwardTangent, rightTangent).normalize();

  if (up.y < 0) {
    up.multiplyScalar(-1);
  }

  const correctedRight = new Vector3().crossVectors(up, forwardTangent).normalize();
  const correctedForward = new Vector3().crossVectors(correctedRight, up).normalize();
  const matrix = new Matrix4().makeBasis(correctedRight, up, correctedForward);

  return new Quaternion().setFromRotationMatrix(matrix);
}

export function gearLabelFromIndex(gearIndex: number): Gear {
  if (gearIndex < 0) {
    return 'R';
  }

  if (gearIndex === 0) {
    return 'N';
  }

  return `${Math.max(1, Math.min(gearIndex, MAX_FORWARD_GEAR))}` as Exclude<Gear, 'N' | 'R'>;
}

export function rpmFromDriveState(state: DriveState, config: VehicleConfig) {
  if (state.gearIndex === 0) {
    return IDLE_RPM;
  }

  const maxSpeedForGear =
    state.gearIndex < 0 ? config.maxReverseSpeed : getGearTopSpeed(state.gearIndex, config);
  const speedRatio = MathUtils.clamp(Math.abs(state.speed) / Math.max(maxSpeedForGear, 1e-3), 0, 1);
  const slipFloor = state.gearIndex === 1 && Math.abs(state.speed) > 0.5 ? 0.16 : 0;
  const effectiveRatio = Math.max(speedRatio, slipFloor);
  const baseRpm = IDLE_RPM + effectiveRatio * (REDLINE_RPM - IDLE_RPM);
  const shiftBlend = getShiftIntensity(state);

  return Math.round(MathUtils.lerp(baseRpm, Math.max(IDLE_RPM, baseRpm * 0.78), shiftBlend));
}

export function getShiftIntensity(state: DriveState) {
  return MathUtils.clamp(state.shiftTimer / SHIFT_CUT_SECONDS, 0, 1);
}

function moveToward(value: number, target: number, maxDelta: number) {
  if (Math.abs(target - value) <= maxDelta) {
    return target;
  }

  return value + Math.sign(target - value) * maxDelta;
}

function getGearTopSpeed(gearIndex: number, config: VehicleConfig) {
  const clampedIndex = Math.max(1, Math.min(gearIndex, MAX_FORWARD_GEAR));
  return config.maxForwardSpeed * FORWARD_GEAR_SPEED_RATIOS[clampedIndex - 1];
}

function updateAutomaticGear(state: DriveState, input: DrivingInput, config: VehicleConfig) {
  if (state.shiftTimer > 0 || state.autoShiftHoldTimer > 0) {
    return;
  }

  const speedAbs = Math.abs(state.speed);
  const throttleLoad = Math.max(0, input.throttle);

  if (speedAbs <= AUTO_SHIFT_STOP_SPEED) {
    if (input.throttle < -0.08) {
      setGearIndex(state, -1);
      return;
    }

    if (input.throttle > 0.05) {
      setGearIndex(state, 1);
      return;
    }
  }

  if (state.gearIndex <= 0) {
    return;
  }

  if (isTopSpeedLocked(state, input, config)) {
    return;
  }

  const upshiftSpeed = getUpshiftSpeed(state.gearIndex, config, throttleLoad);
  const downshiftSpeed = getDownshiftSpeed(state.gearIndex, config, throttleLoad);

  const dwellSatisfied =
    state.gearIndex < 1 ||
    state.gearDwellTimer >= MIN_UPSHIFT_DWELL_SECONDS[Math.min(state.gearIndex - 1, MAX_FORWARD_GEAR - 1)];

  const shouldForceTopGearUpshift =
    state.gearIndex === MAX_FORWARD_GEAR - 1 &&
    throttleLoad > 0.45 &&
    speedAbs >= getGearTopSpeed(state.gearIndex, config) * 0.56;

  if (
    state.gearIndex < MAX_FORWARD_GEAR &&
    dwellSatisfied &&
    (speedAbs >= upshiftSpeed || shouldForceTopGearUpshift)
  ) {
    setGearIndex(state, state.gearIndex + 1);
    return;
  }

  const shouldKickDown =
    state.gearIndex > 1 &&
    throttleLoad >= 0.78 &&
    speedAbs <= getGearTopSpeed(state.gearIndex - 1, config) * 0.82;
  const shouldDownshift = state.gearIndex > 1 && speedAbs <= downshiftSpeed;

  if (state.gearIndex === MAX_FORWARD_GEAR && throttleLoad > 0.35 && speedAbs >= downshiftSpeed + 4) {
    return;
  }

  if (shouldKickDown || shouldDownshift) {
    setGearIndex(state, state.gearIndex - 1);
  }
}

function setGearIndex(state: DriveState, nextGearIndex: number) {
  if (nextGearIndex === state.gearIndex) {
    return;
  }

  state.gearIndex = Math.max(-1, Math.min(MAX_FORWARD_GEAR, nextGearIndex));
  state.autoShiftHoldTimer = AUTO_SHIFT_HOLD_SECONDS;
  state.gearDwellTimer = 0;
  state.shiftTimer = SHIFT_CUT_SECONDS;
}

function getUpshiftSpeed(gearIndex: number, config: VehicleConfig, throttleLoad: number) {
  const gearSlot = Math.max(1, Math.min(gearIndex, MAX_FORWARD_GEAR)) - 1;
  const currentTopSpeed = getGearTopSpeed(gearIndex, config);
  const baseTarget = UPSHIFT_SPEED_TARGETS[gearSlot];
  const throttleBonus = MathUtils.lerp(-1.5, 1.5, throttleLoad);
  return Math.min(currentTopSpeed * 0.88, Math.max(0, baseTarget + throttleBonus));
}

function getDownshiftSpeed(gearIndex: number, config: VehicleConfig, throttleLoad: number) {
  const gearSlot = Math.max(1, Math.min(gearIndex, MAX_FORWARD_GEAR)) - 1;
  const previousTopSpeed = getGearTopSpeed(gearIndex - 1, config);
  const baseTarget = DOWNSHIFT_SPEED_TARGETS[gearSlot];
  const throttleBias = MathUtils.lerp(-1.2, 1.2, throttleLoad);
  return Math.min(previousTopSpeed * 0.82, Math.max(0, baseTarget + throttleBias));
}

export function isTopSpeedLocked(
  state: Pick<DriveState, 'gearIndex' | 'speed'>,
  input: Pick<DrivingInput, 'throttle'>,
  config: VehicleConfig,
) {
  return (
    state.gearIndex === MAX_FORWARD_GEAR &&
    input.throttle > 0.7 &&
    state.speed >= config.maxForwardSpeed * TOP_SPEED_LOCK_RATIO
  );
}
