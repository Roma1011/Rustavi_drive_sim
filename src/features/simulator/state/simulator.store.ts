import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { CAMERA_MODES, type CameraMode } from '../config/simulator.config';
import { DEFAULT_VEHICLE_ID } from '../../../shared/config/assets';

type Gear = '1' | '2' | '3' | '4' | '5' | '6' | 'N' | 'R';
type AudioChannel = 'ambienceVolume' | 'effectsVolume' | 'engineVolume' | 'masterVolume';

interface MapBounds {
  maxX: number;
  maxZ: number;
  minX: number;
  minZ: number;
}

interface PlayerPose {
  heading: number;
  x: number;
  z: number;
}

interface SimulatorState {
  ambienceVolume: number;
  cameraMode: CameraMode;
  cycleCamera: () => void;
  dashboardVisible: boolean;
  debugBlocked: boolean;
  debugInput: {
    brake: boolean;
    steer: number;
    throttle: number;
  };
  instructionsVisible: boolean;
  isReversing: boolean;
  isReady: boolean;
  mapBounds: MapBounds | null;
  masterVolume: number;
  miniMapVisible: boolean;
  pauseMenuVisible: boolean;
  playerPose: PlayerPose;
  requestRestart: () => void;
  restartToken: number;
  rpm: number;
  selectedVehicleId: string;
  shiftIntensity: number;
  setTransitionLoadingLabel: (value: string) => void;
  setTransitionLoadingVisible: (value: boolean) => void;
  setAudioChannel: (channel: AudioChannel, value: number) => void;
  setCameraMode: (mode: CameraMode) => void;
  setDashboardVisible: (value: boolean) => void;
  setDebugInput: (payload: SimulatorState['debugInput']) => void;
  setMapBounds: (payload: MapBounds) => void;
  setMiniMapVisible: (value: boolean) => void;
  setMovementBlocked: (value: boolean) => void;
  setPauseMenuVisible: (value: boolean) => void;
  setPlayerPose: (payload: PlayerPose) => void;
  setReady: (value: boolean) => void;
  setSelectedVehicleId: (vehicleId: string) => void;
  setInstructionsVisible: (value: boolean) => void;
  setSettingsVisible: (value: boolean) => void;
  setTelemetry: (
    payload: Partial<Pick<SimulatorState, 'rpm' | 'speedKph' | 'gear' | 'shiftIntensity' | 'isReversing'>>,
  ) => void;
  setVehicleColor: (value: string) => void;
  speedKph: number;
  effectsVolume: number;
  engineVolume: number;
  gear: Gear;
  settingsVisible: boolean;
  toggleInstructions: () => void;
  toggleSettings: () => void;
  transitionLoadingLabel: string;
  transitionLoadingVisible: boolean;
  vehicleColor: string;
}

export const useSimulatorStore = create<SimulatorState>()(
  persist(
    (set) => ({
      ambienceVolume: 0.55,
      cameraMode: 'chase',
      cycleCamera: () =>
        set((state) => {
          const currentIndex = CAMERA_MODES.indexOf(state.cameraMode);
          return {
            cameraMode: CAMERA_MODES[(currentIndex + 1) % CAMERA_MODES.length],
          };
        }),
      dashboardVisible: true,
      debugBlocked: false,
      debugInput: {
        brake: false,
        steer: 0,
        throttle: 0,
      },
      effectsVolume: 0.8,
      engineVolume: 0.72,
      gear: '1',
      instructionsVisible: false,
      isReversing: false,
      isReady: false,
      mapBounds: null,
      masterVolume: 0.9,
      miniMapVisible: true,
      pauseMenuVisible: false,
      playerPose: {
        heading: 0,
        x: 0,
        z: 0,
      },
      requestRestart: () =>
        set((state) => ({
          restartToken: state.restartToken + 1,
        })),
      restartToken: 0,
      rpm: 900,
      selectedVehicleId: DEFAULT_VEHICLE_ID,
      shiftIntensity: 0,
      setTransitionLoadingLabel: (value) => set({ transitionLoadingLabel: value }),
      setTransitionLoadingVisible: (value) => set({ transitionLoadingVisible: value }),
      setAudioChannel: (channel, value) =>
        set({
          [channel]: Math.max(0, Math.min(value, 1)),
        } as Pick<SimulatorState, AudioChannel>),
      setCameraMode: (mode) => set({ cameraMode: mode }),
      setDashboardVisible: (value) => set({ dashboardVisible: value }),
      setDebugInput: (payload) => set({ debugInput: payload }),
      setInstructionsVisible: (value) => set({ instructionsVisible: value }),
      setMapBounds: (payload) => set({ mapBounds: payload }),
      setMiniMapVisible: (value) => set({ miniMapVisible: value }),
      setMovementBlocked: (value) => set({ debugBlocked: value }),
      setPauseMenuVisible: (value) => set({ pauseMenuVisible: value }),
      setPlayerPose: (payload) => set({ playerPose: payload }),
      setReady: (value) => set({ isReady: value }),
      setSelectedVehicleId: (vehicleId) => set({ selectedVehicleId: vehicleId }),
      setSettingsVisible: (value) => set({ settingsVisible: value }),
      setTelemetry: (payload) => set(payload),
      setVehicleColor: (value) => set({ vehicleColor: value }),
      settingsVisible: false,
      speedKph: 0,
      toggleInstructions: () =>
        set((state) => ({
          instructionsVisible: !state.instructionsVisible,
        })),
      toggleSettings: () =>
        set((state) => ({
          settingsVisible: !state.settingsVisible,
        })),
      transitionLoadingLabel: 'Preparing simulator',
      transitionLoadingVisible: false,
      vehicleColor: '#1b6fff',
    }),
    {
      name: 'open-city-driver-simulator',
      partialize: (state) => ({
        ambienceVolume: state.ambienceVolume,
        cameraMode: state.cameraMode,
        dashboardVisible: state.dashboardVisible,
        effectsVolume: state.effectsVolume,
        engineVolume: state.engineVolume,
        instructionsVisible: state.instructionsVisible,
        masterVolume: state.masterVolume,
        miniMapVisible: state.miniMapVisible,
        selectedVehicleId: state.selectedVehicleId,
        vehicleColor: state.vehicleColor,
      }),
      storage: createJSONStorage(() => localStorage),
    },
  ),
);
