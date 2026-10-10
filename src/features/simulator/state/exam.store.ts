import { create } from 'zustand';
import { SIMULATOR_CONFIG } from '../config/simulator.config';
import type { TrackerEventKind } from '../lib/exam-tracker';

export type ExamStatus = 'finished' | 'idle' | 'running';

export interface ExamMistake {
  atSeconds: number;
  id: number;
  kind: TrackerEventKind;
  label: string;
  progressMeters: number;
}

export interface ExamResult {
  completed: boolean;
  elapsedSeconds: number;
  mistakes: ExamMistake[];
  progressMeters: number;
  routeLengthMeters: number;
  routeName: string;
}

export interface ExamLiveStats {
  distanceToRoute: number;
  elapsedSeconds: number;
  lateralMeters: number;
  progressMeters: number;
}

interface ExamState extends ExamLiveStats {
  abortToIdle: () => void;
  beginExam: () => void;
  endExam: (completed: boolean) => void;
  mistakes: ExamMistake[];
  recordMistake: (kind: TrackerEventKind, atSeconds: number, progressMeters: number) => void;
  result: ExamResult | null;
  routeLengthMeters: number;
  routeName: string;
  setRouteContext: (routeName: string, routeLengthMeters: number) => void;
  setSummaryVisible: (value: boolean) => void;
  speedLimitKph: number;
  /** Incremented every time an exam starts so the vehicle resets to the route start. */
  startToken: number;
  status: ExamStatus;
  summaryVisible: boolean;
  updateLive: (stats: ExamLiveStats) => void;
}

export const MISTAKE_LABELS: Record<TrackerEventKind, string> = {
  collision: 'Collision with an obstacle',
  completed: 'Route completed',
  off_route: 'Left the route',
  speeding: 'Exceeded the speed limit',
  wrong_lane: 'Drove in the oncoming lane',
  wrong_way: 'Drove against the route direction',
};

let mistakeId = 0;

const INITIAL_LIVE_STATS: ExamLiveStats = {
  distanceToRoute: 0,
  elapsedSeconds: 0,
  lateralMeters: 0,
  progressMeters: 0,
};

export const useExamStore = create<ExamState>()((set, get) => ({
  ...INITIAL_LIVE_STATS,
  abortToIdle: () =>
    set({
      ...INITIAL_LIVE_STATS,
      mistakes: [],
      status: 'idle',
      summaryVisible: false,
    }),
  beginExam: () =>
    set((state) => ({
      ...INITIAL_LIVE_STATS,
      mistakes: [],
      result: null,
      startToken: state.startToken + 1,
      status: 'running',
      summaryVisible: false,
    })),
  endExam: (completed) => {
    const state = get();

    if (state.status !== 'running') {
      return;
    }

    set({
      result: {
        completed,
        elapsedSeconds: state.elapsedSeconds,
        mistakes: state.mistakes,
        progressMeters: state.progressMeters,
        routeLengthMeters: state.routeLengthMeters,
        routeName: state.routeName,
      },
      status: 'finished',
      summaryVisible: true,
    });
  },
  mistakes: [],
  recordMistake: (kind, atSeconds, progressMeters) =>
    set((state) => {
      if (state.status !== 'running') {
        return state;
      }

      mistakeId += 1;

      return {
        mistakes: [
          ...state.mistakes,
          { atSeconds, id: mistakeId, kind, label: MISTAKE_LABELS[kind], progressMeters },
        ],
      };
    }),
  result: null,
  routeLengthMeters: 0,
  routeName: '',
  setRouteContext: (routeName, routeLengthMeters) =>
    set({
      ...INITIAL_LIVE_STATS,
      mistakes: [],
      result: null,
      routeLengthMeters,
      routeName,
      status: 'idle',
      summaryVisible: false,
    }),
  setSummaryVisible: (value) => set({ summaryVisible: value }),
  speedLimitKph: SIMULATOR_CONFIG.exam.speedLimitKph,
  startToken: 0,
  status: 'idle',
  summaryVisible: false,
  updateLive: (stats) => set(stats),
}));
