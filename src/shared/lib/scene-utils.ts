import { Box3, Object3D, Vector3 } from 'three';
import { clone } from 'three/examples/jsm/utils/SkeletonUtils.js';

interface NormalizeOptions {
  alignBottom?: boolean;
  castShadow?: boolean;
  centerXZ?: boolean;
  receiveShadow?: boolean;
  targetFootprint?: number;
}

export function cloneScene<T extends Object3D>(scene: T): T {
  return clone(scene) as T;
}

export function prepareScene(root: Object3D, options: NormalizeOptions = {}) {
  root.traverse((node) => {
    if ('isMesh' in node && node.isMesh) {
      node.castShadow = options.castShadow ?? true;
      node.receiveShadow = options.receiveShadow ?? true;
      node.frustumCulled = true;
    }
  });
}

export function setVisibilityByNamePattern(root: Object3D, pattern: RegExp, visible: boolean) {
  root.traverse((node) => {
    if (pattern.test(node.name)) {
      node.visible = visible;

       if (!visible && 'isMesh' in node && node.isMesh) {
        node.raycast = () => null;
      }
    }
  });
}

export function normalizeScene(root: Object3D, options: NormalizeOptions = {}) {
  const initialBox = new Box3().setFromObject(root);

  if (initialBox.isEmpty()) {
    return;
  }

  if (options.targetFootprint) {
    const size = initialBox.getSize(new Vector3());
    const footprint = Math.max(size.x, size.z);

    if (footprint > 0) {
      const scalar = options.targetFootprint / footprint;
      root.scale.multiplyScalar(scalar);
    }
  }

  const adjustedBox = new Box3().setFromObject(root);
  const center = adjustedBox.getCenter(new Vector3());

  if (options.centerXZ) {
    root.position.x -= center.x;
    root.position.z -= center.z;
  }

  if (options.alignBottom) {
    root.position.y -= adjustedBox.min.y;
  }
}
