export type VehicleEngineClass =
  | 'classic-muscle'
  | 'modern-muscle'
  | 'offroad'
  | 'police'
  | 'sports'
  | 'suv'
  | 'tuner';

export interface EngineLoopProfile {
  idleGain: number;
  idleRate: number;
  maxRate: number;
  reverseGain: number;
  speedGain: number;
  src: string;
  throttleGain: number;
}

const ENGINE_AUDIO_BASE_PATH = `${import.meta.env.BASE_URL}assets/audio/engines`;

const VEHICLE_CLASS_BY_ID: Record<string, VehicleEngineClass> = {
  '1970-chevrolet-camaro-z28': 'classic-muscle',
  '1970-chevrolet-chevelle-ss-454': 'classic-muscle',
  '1970-dodge-challenger-rt': 'classic-muscle',
  '1992-honda-nsx-r': 'sports',
  '1993-honda-civic-coupe-vis-racing-fast-furious': 'tuner',
  '2012-dodge-charger-rt-sedan-4d': 'modern-muscle',
  '2013-dodge-charger-srt8-patrol': 'police',
  '2013-jeep-grand-cherokee-srt8': 'suv',
  '2019-jeep-cherokee': 'suv',
  '2021-jeep-grand-commander-k8': 'suv',
  'free-porsche-911-carrera-4s': 'sports',
  'jeep-wrangler-adventure-rubicon-www-vecarz-com': 'offroad',
  'ringbrothers-1966-chevrolet-chevelle-recoil': 'classic-muscle',
};

const LOOP_PROFILE_BY_CLASS: Record<VehicleEngineClass, EngineLoopProfile> = {
  'classic-muscle': {
    idleGain: 0.2,
    idleRate: 0.88,
    maxRate: 1.22,
    reverseGain: 0.5,
    speedGain: 0.18,
    src: `${ENGINE_AUDIO_BASE_PATH}/gold_engine.ogg`,
    throttleGain: 0.54,
  },
  'modern-muscle': {
    idleGain: 0.18,
    idleRate: 0.92,
    maxRate: 1.28,
    reverseGain: 0.52,
    speedGain: 0.16,
    src: `${ENGINE_AUDIO_BASE_PATH}/iron_engine.ogg`,
    throttleGain: 0.48,
  },
  offroad: {
    idleGain: 0.24,
    idleRate: 0.8,
    maxRate: 1.08,
    reverseGain: 0.62,
    speedGain: 0.1,
    src: `${ENGINE_AUDIO_BASE_PATH}/stone_engine.ogg`,
    throttleGain: 0.36,
  },
  police: {
    idleGain: 0.17,
    idleRate: 0.96,
    maxRate: 1.32,
    reverseGain: 0.5,
    speedGain: 0.2,
    src: `${ENGINE_AUDIO_BASE_PATH}/diamond_engine.ogg`,
    throttleGain: 0.54,
  },
  sports: {
    idleGain: 0.15,
    idleRate: 1,
    maxRate: 1.42,
    reverseGain: 0.46,
    speedGain: 0.24,
    src: `${ENGINE_AUDIO_BASE_PATH}/creative_engine.ogg`,
    throttleGain: 0.5,
  },
  suv: {
    idleGain: 0.22,
    idleRate: 0.84,
    maxRate: 1.12,
    reverseGain: 0.58,
    speedGain: 0.12,
    src: `${ENGINE_AUDIO_BASE_PATH}/copper_engine.ogg`,
    throttleGain: 0.34,
  },
  tuner: {
    idleGain: 0.16,
    idleRate: 0.98,
    maxRate: 1.38,
    reverseGain: 0.48,
    speedGain: 0.22,
    src: `${ENGINE_AUDIO_BASE_PATH}/diamond_engine.ogg`,
    throttleGain: 0.46,
  },
};

export function getVehicleEngineClass(vehicleId: string): VehicleEngineClass {
  return VEHICLE_CLASS_BY_ID[vehicleId] ?? 'sports';
}

export function getEngineLoopProfile(vehicleId: string): EngineLoopProfile {
  return LOOP_PROFILE_BY_CLASS[getVehicleEngineClass(vehicleId)];
}
