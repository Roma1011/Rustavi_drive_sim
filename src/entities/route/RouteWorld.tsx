import { forwardRef, useEffect, useMemo } from 'react';
import { useThree } from '@react-three/fiber';
import { Group } from 'three';
import { SIMULATOR_CONFIG } from '../../features/simulator/config/simulator.config';
import { buildRouteWorld } from './road-builder';
import type { LoadedRoute } from './route-types';

interface RouteWorldProps {
  route: LoadedRoute;
}

/**
 * Renders a loaded GeoJSON route as a drivable world: grass ground, asphalt road with
 * shoulders and markings, roadside scenery, and any point features the file contains.
 * The forwarded ref is the terrain group the vehicle raycasts against.
 */
export const RouteWorld = forwardRef<Group, RouteWorldProps>(function RouteWorld({ route }, forwardedRef) {
  const gl = useThree((state) => state.gl);
  const world = useMemo(
    () =>
      buildRouteWorld(route, {
        maxAnisotropy: gl.capabilities.getMaxAnisotropy(),
        road: SIMULATOR_CONFIG.route.road,
        scenery: SIMULATOR_CONFIG.route.scenery,
      }),
    [gl, route],
  );

  useEffect(() => {
    return () => {
      world.dispose();
    };
  }, [world]);

  return (
    <group ref={forwardedRef}>
      <primitive object={world.root} />
    </group>
  );
});
