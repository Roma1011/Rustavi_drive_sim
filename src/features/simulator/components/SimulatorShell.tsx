import { useEffect } from 'react';
import { Canvas } from '@react-three/fiber';
import { AudioManager } from './AudioManager';
import { HudOverlay } from './HudOverlay';
import { LoadingOverlay } from './LoadingOverlay';
import { RouteErrorOverlay } from './RouteErrorOverlay';
import { RouteSelector } from './RouteSelector';
import { SimulatorScene } from './SimulatorScene';
import { useExamStore } from '../state/exam.store';
import { useRouteStore } from '../state/route.store';

export function SimulatorShell() {
  const route = useRouteStore((state) => state.route);
  const worldMode = useRouteStore((state) => state.worldMode);
  const setRouteContext = useExamStore((state) => state.setRouteContext);

  useEffect(() => {
    void useRouteStore.getState().initialize();
  }, []);

  useEffect(() => {
    if (worldMode === 'route' && route) {
      setRouteContext(route.name, route.lengthMeters);
      return;
    }

    setRouteContext('', 0);
  }, [route, setRouteContext, worldMode]);

  return (
    <main className="simulator-shell">
      <div className="simulator-shell__backdrop" />
      <Canvas
        camera={{ far: 900, fov: 58, near: 0.1, position: [0, 3, -7] }}
        dpr={[1, 2]}
        gl={{ antialias: true, powerPreference: 'high-performance' }}
        shadows
      >
        <SimulatorScene />
      </Canvas>

      <AudioManager />
      <HudOverlay />
      <RouteSelector />
      <RouteErrorOverlay />
      <LoadingOverlay />
    </main>
  );
}
