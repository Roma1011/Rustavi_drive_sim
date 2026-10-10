import { forwardRef, useImperativeHandle, useMemo, useRef } from 'react';
import { Group } from 'three';
import { useGLTF } from '@react-three/drei';
import { ASSET_PATHS } from '../../shared/config/assets';
import {
  cloneScene,
  normalizeScene,
  prepareScene,
  setVisibilityByNamePattern,
} from '../../shared/lib/scene-utils';

const ROAD_BLOCKER_PATTERN =
  /^DC_met_(?:A|B|C|SA|SB)\d+(?:\.\d+)?_/i;

export const CityMap = forwardRef<Group>(function CityMap(_, forwardedRef) {
  const groupRef = useRef<Group>(null);
  const { scene } = useGLTF(ASSET_PATHS.map);

  const model = useMemo(() => {
    const nextScene = cloneScene(scene);
    prepareScene(nextScene, { castShadow: false, receiveShadow: true });
    setVisibilityByNamePattern(nextScene, ROAD_BLOCKER_PATTERN, false);
    normalizeScene(nextScene, { alignBottom: true, centerXZ: true });
    return nextScene;
  }, [scene]);

  useImperativeHandle(forwardedRef, () => groupRef.current as Group, []);

  return (
    <group ref={groupRef}>
      <primitive object={model} />
    </group>
  );
});

useGLTF.preload(ASSET_PATHS.map);
