import {
  Box3,
  BufferGeometry,
  Color,
  Group,
  Material,
  Mesh,
  Object3D,
  Object3DEventMap,
  Quaternion,
  Vector3,
} from 'three';
import { SIMULATOR_CONFIG } from '../../../features/simulator/config/simulator.config';
import { cloneScene, normalizeScene, prepareScene } from '../../../shared/lib/scene-utils';

type ColorableMaterial = Material & { color: Color };
type SceneMesh = Mesh<BufferGeometry, Material | Material[], Object3DEventMap>;
export interface SteerableWheelNode {
  baseQuaternion: Quaternion;
  node: Object3D;
}

export interface PreparedVehicleModel {
  root: Group;
  steerableWheelNodes: SteerableWheelNode[];
}

const MATERIAL_NAME_BLOCKLIST = [
  'glass',
  'window',
  'windshield',
  'tire',
  'tyre',
  'wheel',
  'rim',
  'chrome',
  'light',
  'lamp',
  'head',
  'tail',
  'disc',
  'interior',
  'seat',
  'steer',
  'dash',
  'grill',
  'grille',
  'mirror',
  'plate',
  'logo',
  'emblem',
  'exhaust',
  'engine',
] as const;
const WHEEL_NAME_KEYWORDS = ['wheel', 'tire', 'tyre', 'rim'] as const;
const WHEEL_NAME_BLOCKLIST = ['steering', 'cockpit', 'interior', 'mirror'] as const;
const FRONT_WHEEL_MARKER_PATTERN =
  /(?:^|[^a-z])(lf|rf|fl|fr)(?:[^a-z]|$)|(?:rotor|caliper)(lf|rf)/i;
const localPosition = new Vector3();
const steeringAxis = new Vector3(0, 1, 0);
const tempBounds = new Box3();
const tempRootBounds = new Box3();
const tempSize = new Vector3();

interface WheelCandidate {
  adjustedZ: number;
  center: Vector3;
  explicitFrontMarker: boolean;
  name: string;
  node: Object3D;
}

function cloneMaterials(node: Mesh) {
  if (Array.isArray(node.material)) {
    node.material = node.material.map((material) => material.clone());
    return;
  }

  node.material = node.material.clone();
}

function isSceneMesh(node: unknown): node is SceneMesh {
  return node instanceof Mesh;
}

function isColorableMaterial(material: Material): material is ColorableMaterial {
  return 'color' in material && material.color instanceof Color;
}

function shouldTintMaterial(meshName: string, material: Material) {
  if (!isColorableMaterial(material)) {
    return false;
  }

  const searchableName = `${meshName} ${material.name}`.toLowerCase();

  if (MATERIAL_NAME_BLOCKLIST.some((keyword) => searchableName.includes(keyword))) {
    return false;
  }

  const hsl = { h: 0, s: 0, l: 0 };
  material.color.getHSL(hsl);

  if (hsl.l < 0.08) {
    return false;
  }

  if (hsl.s < 0.06 && hsl.l < 0.22) {
    return false;
  }

  return true;
}

function tintMaterial(material: Material, meshName: string, paintColor: Color) {
  if (!shouldTintMaterial(meshName, material)) {
    return;
  }

  const colorableMaterial = material as ColorableMaterial;
  const baseColor = colorableMaterial.color.clone();
  const tintStrength = baseColor.getHSL({ h: 0, s: 0, l: 0 }).s < 0.1 ? 0.45 : 0.68;
  colorableMaterial.color.copy(baseColor.lerp(paintColor, tintStrength));
}

function isWheelKeywordMatch(value: string) {
  const normalizedValue = value.toLowerCase();
  return WHEEL_NAME_KEYWORDS.some((keyword) => normalizedValue.includes(keyword));
}

function isBlockedWheelName(value: string) {
  const normalizedValue = value.toLowerCase();
  return WHEEL_NAME_BLOCKLIST.some((keyword) => normalizedValue.includes(keyword));
}

function hasWheelAncestor(node: Object3D) {
  let current = node.parent;

  while (current) {
    if (isWheelKeywordMatch(current.name)) {
      return true;
    }

    current = current.parent;
  }

  return false;
}

function getWheelCandidate(root: Group, node: Object3D, frontDirectionSign: number, maxWheelCenterY: number) {
  if (!node.name || !isWheelKeywordMatch(node.name) || isBlockedWheelName(node.name) || hasWheelAncestor(node)) {
    return null;
  }

  const bounds = tempBounds.setFromObject(node);

  if (bounds.isEmpty()) {
    return null;
  }

  const center = bounds.getCenter(new Vector3());
  const size = bounds.getSize(tempSize);
  const maxDimension = Math.max(size.x, size.y, size.z);
  const minDimension = Math.min(size.x, size.y, size.z);

  if (center.y > maxWheelCenterY || maxDimension > 1.6 || minDimension < 0.08) {
    return null;
  }

  return {
    adjustedZ: center.z * frontDirectionSign,
    center,
    explicitFrontMarker: FRONT_WHEEL_MARKER_PATTERN.test(node.name),
    name: node.name,
    node,
  } satisfies WheelCandidate;
}

function createSteeringPivot(
  root: Group,
  wheelCandidates: WheelCandidate[],
  label: string,
): SteerableWheelNode | null {
  if (wheelCandidates.length === 0) {
    return null;
  }

  const pivot = new Group();
  const pivotWorldPosition = wheelCandidates.reduce(
    (sum, candidate) => sum.add(candidate.center),
    new Vector3(),
  );
  pivotWorldPosition.multiplyScalar(1 / wheelCandidates.length);
  pivot.name = `SteeringPivot_${label}`;
  pivot.position.copy(root.worldToLocal(localPosition.copy(pivotWorldPosition)));
  root.add(pivot);

  wheelCandidates.forEach(({ node }) => {
    pivot.attach(node);
  });

  return {
    baseQuaternion: pivot.quaternion.clone(),
    node: pivot,
  };
}

function findSteerableWheelNodes(root: Group, frontDirectionSign: number) {
  const wheelCandidates: WheelCandidate[] = [];
  const safeFrontDirectionSign = frontDirectionSign >= 0 ? 1 : -1;
  const rootBounds = tempRootBounds.setFromObject(root);
  const rootSize = rootBounds.getSize(new Vector3());
  const maxWheelCenterY = rootBounds.min.y + rootSize.y * 0.62;

  root.updateWorldMatrix(true, true);

  root.traverse((node) => {
    const candidate = getWheelCandidate(root, node, safeFrontDirectionSign, maxWheelCenterY);

    if (candidate) {
      wheelCandidates.push(candidate);
    }
  });

  if (wheelCandidates.length < 2) {
    return [];
  }

  const explicitFrontCandidates = wheelCandidates.filter((candidate) => candidate.explicitFrontMarker);
  const candidatePool = explicitFrontCandidates.length >= 2 ? explicitFrontCandidates : wheelCandidates;

  if (explicitFrontCandidates.length === 0 && candidatePool.length < 4) {
    return [];
  }

  const minAdjustedZ = Math.min(...candidatePool.map((candidate) => candidate.adjustedZ));
  const maxAdjustedZ = Math.max(...candidatePool.map((candidate) => candidate.adjustedZ));
  const midpoint = (minAdjustedZ + maxAdjustedZ) * 0.5;
  const frontWheels =
    explicitFrontCandidates.length >= 2
      ? explicitFrontCandidates
      : candidatePool.filter((candidate) => candidate.adjustedZ >= midpoint);

  if (frontWheels.length < 2) {
    return [];
  }

  const minX = Math.min(...frontWheels.map((candidate) => candidate.center.x));
  const maxX = Math.max(...frontWheels.map((candidate) => candidate.center.x));
  const xMidpoint = (minX + maxX) * 0.5;
  const leftFrontWheels = frontWheels.filter((candidate) => candidate.center.x <= xMidpoint);
  const rightFrontWheels = frontWheels.filter((candidate) => candidate.center.x > xMidpoint);

  return [
    createSteeringPivot(root, leftFrontWheels, 'left'),
    createSteeringPivot(root, rightFrontWheels, 'right'),
  ].filter((wheel): wheel is SteerableWheelNode => Boolean(wheel));
}

export function applyVehiclePaint(root: Group, paintHex: string) {
  const paintColor = new Color(paintHex);

  root.traverse((node) => {
    if (!isSceneMesh(node)) {
      return;
    }

    cloneMaterials(node);

    if (Array.isArray(node.material)) {
      node.material.forEach((material) => tintMaterial(material, node.name, paintColor));
      return;
    }

    tintMaterial(node.material, node.name, paintColor);
  });
}

export function applyWheelSteering(wheels: SteerableWheelNode[], steeringAngle: number) {
  const steeringQuaternion = new Quaternion().setFromAxisAngle(steeringAxis, -steeringAngle);

  wheels.forEach(({ baseQuaternion, node }) => {
    node.quaternion.copy(baseQuaternion).multiply(steeringQuaternion);
  });
}

export function prepareVehicleModel(scene: Group, paintHex: string, frontDirectionSign = 1): PreparedVehicleModel {
  const nextScene = cloneScene(scene) as Group;
  prepareScene(nextScene, { castShadow: true, receiveShadow: true });
  normalizeScene(nextScene, {
    alignBottom: true,
    centerXZ: true,
    targetFootprint: SIMULATOR_CONFIG.vehicle.visualFootprint,
  });
  applyVehiclePaint(nextScene, paintHex);

  return {
    root: nextScene,
    steerableWheelNodes: findSteerableWheelNodes(nextScene, frontDirectionSign),
  };
}
