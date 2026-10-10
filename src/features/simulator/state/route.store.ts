import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { describeError, loadRoute, loadRouteManifest } from '../../../entities/route/route-loader';
import type { LoadedRoute, RouteManifestEntry } from '../../../entities/route/route-types';
import { SIMULATOR_CONFIG } from '../config/simulator.config';

export type WorldMode = 'city' | 'route';
export type LoadStatus = 'error' | 'idle' | 'loading' | 'ready';

interface RouteState {
  initialize: () => Promise<void>;
  manifest: RouteManifestEntry[];
  manifestError: string | null;
  manifestStatus: LoadStatus;
  retry: () => Promise<void>;
  route: LoadedRoute | null;
  routeError: string | null;
  routeSelectorVisible: boolean;
  routeStatus: LoadStatus;
  selectCity: () => void;
  selectRoute: (routeId: string) => Promise<void>;
  selectedRouteId: string | null;
  setRouteSelectorVisible: (value: boolean) => void;
  worldMode: WorldMode;
}

let loadToken = 0;

export const useRouteStore = create<RouteState>()(
  persist(
    (set, get) => ({
      initialize: async () => {
        if (get().manifestStatus === 'loading') {
          return;
        }

        set({ manifestError: null, manifestStatus: 'loading' });

        let manifest: RouteManifestEntry[];

        try {
          manifest = await loadRouteManifest();
        } catch (error) {
          set({ manifest: [], manifestError: describeError(error), manifestStatus: 'error' });
          return;
        }

        set({ manifest, manifestStatus: 'ready' });

        if (get().worldMode === 'city') {
          return;
        }

        const persistedId = get().selectedRouteId;
        const target = manifest.find((entry) => entry.id === persistedId) ?? manifest[0];
        await get().selectRoute(target.id);
      },
      manifest: [],
      manifestError: null,
      manifestStatus: 'idle',
      retry: async () => {
        const state = get();

        if (state.manifestStatus !== 'ready') {
          await state.initialize();
          return;
        }

        if (state.worldMode === 'route') {
          await state.selectRoute(state.selectedRouteId ?? state.manifest[0]?.id ?? '');
        }
      },
      route: null,
      routeError: null,
      routeSelectorVisible: false,
      routeStatus: 'idle',
      selectCity: () => {
        loadToken += 1;
        set({
          route: null,
          routeError: null,
          routeSelectorVisible: false,
          routeStatus: 'idle',
          worldMode: 'city',
        });
      },
      selectRoute: async (routeId) => {
        const entry = get().manifest.find((candidate) => candidate.id === routeId);
        loadToken += 1;
        const token = loadToken;

        if (!entry) {
          set({
            route: null,
            routeError: `Route "${routeId}" is not listed in public/routes/routes.json.`,
            routeSelectorVisible: false,
            routeStatus: 'error',
            selectedRouteId: routeId,
            worldMode: 'route',
          });
          return;
        }

        set({
          route: null,
          routeError: null,
          routeSelectorVisible: false,
          routeStatus: 'loading',
          selectedRouteId: routeId,
          worldMode: 'route',
        });

        try {
          const route = await loadRoute(entry, { mergeDistance: SIMULATOR_CONFIG.route.mergeDistance });

          if (token !== loadToken) {
            return;
          }

          set({ route, routeStatus: 'ready' });
        } catch (error) {
          if (token !== loadToken) {
            return;
          }

          set({ route: null, routeError: describeError(error), routeStatus: 'error' });
        }
      },
      selectedRouteId: null,
      setRouteSelectorVisible: (value) => set({ routeSelectorVisible: value }),
      worldMode: 'route',
    }),
    {
      name: 'rustavi-drivesim-route',
      partialize: (state) => ({
        selectedRouteId: state.selectedRouteId,
        worldMode: state.worldMode,
      }),
      storage: createJSONStorage(() => localStorage),
    },
  ),
);
