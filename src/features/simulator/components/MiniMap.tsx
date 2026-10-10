import { lazy, Suspense, useMemo } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { MathUtils, OrthographicCamera } from 'three';
import { useSimulatorStore } from '../state/simulator.store';

// Loaded lazily so the city GLB is only fetched when the city world is in use.
const CityMap = lazy(() =>
  import('../../../entities/environment/CityMap').then((module) => ({ default: module.CityMap })),
);

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(value, max));
}

function lerp(start: number, end: number, alpha: number) {
  return start + (end - start) * alpha;
}

function MiniMapCameraRig({ viewSpan }: { viewSpan: number }) {
  const camera = useThree((state) => state.camera);
  const playerPose = useSimulatorStore((state) => state.playerPose);

  useFrame((_, delta) => {
    const miniMapCamera = camera as OrthographicCamera;

    miniMapCamera.up.set(0, 0, -1);
    miniMapCamera.position.x = MathUtils.damp(miniMapCamera.position.x, playerPose.x, 10, delta);
    miniMapCamera.position.y = MathUtils.damp(miniMapCamera.position.y, 220, 8, delta);
    miniMapCamera.position.z = MathUtils.damp(miniMapCamera.position.z, playerPose.z, 10, delta);
    miniMapCamera.zoom = MathUtils.damp(miniMapCamera.zoom, 210 / viewSpan, 8, delta);
    miniMapCamera.lookAt(playerPose.x, 0, playerPose.z);
    miniMapCamera.updateProjectionMatrix();
  });

  return null;
}

export function MiniMap() {
  const debugInput = useSimulatorStore((state) => state.debugInput);
  const mapBounds = useSimulatorStore((state) => state.mapBounds);
  const playerPose = useSimulatorStore((state) => state.playerPose);
  const speedKph = useSimulatorStore((state) => state.speedKph);

  const { scaleLabel, zoomLabel, viewSpan } = useMemo(() => {
    const worldSpan = mapBounds
      ? Math.max(mapBounds.maxX - mapBounds.minX, mapBounds.maxZ - mapBounds.minZ)
      : 240;
    const zoomRatio = clamp(speedKph / 170 + Math.abs(debugInput.throttle) * 0.28, 0, 1);
    const baseSpan = clamp(worldSpan * 0.38, 180, 280);
    const maxSpan = clamp(worldSpan * 0.62, 260, 420);
    const nextViewSpan = lerp(baseSpan, maxSpan, zoomRatio);

    return {
      scaleLabel: mapBounds ? `${Math.round(nextViewSpan)}m view` : 'Calibrating',
      viewSpan: nextViewSpan,
      zoomLabel: mapBounds ? `zoom ${Math.round((nextViewSpan / worldSpan) * 100)}%` : 'loading',
    };
  }, [debugInput.throttle, mapBounds, speedKph]);

  return (
    <section className="mini-map panel" aria-label="Driving minimap">
      <div className="mini-map__topline">
        <p className="eyebrow">Route Map</p>
        <span>{scaleLabel}</span>
      </div>

      <div className="mini-map__frame">
        <Canvas
          orthographic
          className="mini-map__canvas"
          camera={{ far: 700, near: 0.1, position: [0, 220, 0], zoom: 4 }}
          dpr={[1, 1.5]}
          gl={{ antialias: true, alpha: true, powerPreference: 'low-power' }}
        >
          <color attach="background" args={['#08131d']} />
          <ambientLight intensity={1.25} />
          <hemisphereLight args={['#dff5ff', '#1b3342', 1.2]} />
          <directionalLight intensity={1.1} position={[120, 220, 80]} />
          <Suspense fallback={null}>
            <CityMap />
          </Suspense>
          <MiniMapCameraRig viewSpan={viewSpan} />
        </Canvas>

        <div className="mini-map__overlay" aria-hidden="true">
          <div className="mini-map__north">N</div>
          <div className="mini-map__crosshair" />
          <div className="mini-map__player">
            <div className="mini-map__hub" />
          </div>
        </div>
      </div>

      <div className="mini-map__footer">
        <strong>{speedKph} km/h</strong>
        <span>{zoomLabel}</span>
      </div>
    </section>
  );
}
