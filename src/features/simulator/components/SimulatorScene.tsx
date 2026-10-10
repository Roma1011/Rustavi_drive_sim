import { lazy, Suspense, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { Sky } from '@react-three/drei';
import { DirectionalLight, Group, Object3D } from 'three';
import { getRouteSpawn } from '../../../entities/route/road-builder';
import { RouteWorld } from '../../../entities/route/RouteWorld';
import { PlayerVehicle } from './PlayerVehicle';
import { SIMULATOR_CONFIG } from '../config/simulator.config';
import { useRouteStore } from '../state/route.store';
import { useSimulatorStore } from '../state/simulator.store';

// The city GLB is only fetched when the free-drive city world is actually selected.
const CityMap = lazy(() =>
  import('../../../entities/environment/CityMap').then((module) => ({ default: module.CityMap })),
);

/** Keeps the shadow-casting sun centred on the player so shadows work anywhere on a large map. */
function ShadowLightRig() {
  const lightRef = useRef<DirectionalLight>(null);
  const target = useMemo(() => new Object3D(), []);

  useFrame(() => {
    const light = lightRef.current;

    if (!light) {
      return;
    }

    const pose = useSimulatorStore.getState().playerPose;
    light.position.set(pose.x + 18, 26, pose.z + 12);
    target.position.set(pose.x, 0, pose.z);
    target.updateMatrixWorld();
  });

  return (
    <>
      <directionalLight
        ref={lightRef}
        castShadow
        intensity={2.1}
        position={[18, 26, 12]}
        target={target}
        shadow-bias={-0.0004}
        shadow-normalBias={0.03}
        shadow-mapSize-height={2048}
        shadow-mapSize-width={2048}
        shadow-camera-near={1}
        shadow-camera-far={120}
        shadow-camera-left={-40}
        shadow-camera-right={40}
        shadow-camera-top={40}
        shadow-camera-bottom={-40}
      />
      <primitive object={target} />
    </>
  );
}

export function SimulatorScene() {
  const terrainRef = useRef<Group>(null);
  const worldMode = useRouteStore((state) => state.worldMode);
  const route = useRouteStore((state) => state.route);
  const showCity = worldMode === 'city';
  const showRoute = worldMode === 'route' && route !== null;
  const worldConfig = showCity ? SIMULATOR_CONFIG.world : SIMULATOR_CONFIG.routeWorld;
  const spawn = useMemo(
    () => (showRoute && route ? getRouteSpawn(route, SIMULATOR_CONFIG.route.road.laneOffset) : null),
    [route, showRoute],
  );
  const worldKey = showCity ? 'city' : route ? `route:${route.id}` : 'none';

  return (
    <>
      <color attach="background" args={[worldConfig.background]} />
      <fog key={worldKey} attach="fog" args={[worldConfig.fogColor, worldConfig.fogNear, worldConfig.fogFar]} />
      <ambientLight intensity={0.75} />
      <hemisphereLight args={['#f4fbff', '#6a7f86', 1.1]} />
      <ShadowLightRig />
      <Sky distance={450000} sunPosition={[50, 12, 10]} inclination={0.48} azimuth={0.2} />
      <Suspense fallback={null}>
        {showCity ? <CityMap ref={terrainRef} /> : null}
        {showRoute && route ? <RouteWorld ref={terrainRef} route={route} /> : null}
        {showCity || showRoute ? (
          <PlayerVehicle key={worldKey} route={showRoute ? route : null} spawn={spawn} terrainRef={terrainRef} />
        ) : null}
      </Suspense>
    </>
  );
}
