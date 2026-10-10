import {
  AmbientLight,
  Box3,
  BufferGeometry,
  DirectionalLight,
  Group,
  HemisphereLight,
  MathUtils,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  PerspectiveCamera,
  Scene,
  Sphere,
  Vector3,
  WebGLRenderer,
} from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { getVehicleOptionById } from '../../../shared/config/assets';
import { prepareVehicleModel } from '../../../entities/car/lib/vehicle-scene';

const THUMBNAIL_WIDTH = 320;
const THUMBNAIL_HEIGHT = 180;
const THUMBNAIL_KEY_SEPARATOR = '::';

let renderer: WebGLRenderer | null = null;
const loader = new GLTFLoader();
const baseSceneCache = new Map<string, Promise<Group>>();
const thumbnailCache = new Map<string, Promise<string | null>>();
let thumbnailRenderQueue = Promise.resolve();

interface MeshBoundsEntry {
  bounds: Box3;
  center: Vector3;
  diagonal: number;
}

function getRenderer() {
  if (renderer) {
    return renderer;
  }

  renderer = new WebGLRenderer({
    alpha: true,
    antialias: true,
    powerPreference: 'low-power',
    preserveDrawingBuffer: true,
  });
  renderer.setClearColor(0x000000, 0);
  renderer.setPixelRatio(1);
  renderer.setSize(THUMBNAIL_WIDTH, THUMBNAIL_HEIGHT, false);
  renderer.outputColorSpace = 'srgb';
  return renderer;
}

async function loadBaseScene(vehicleId: string) {
  const cachedScene = baseSceneCache.get(vehicleId);

  if (cachedScene) {
    return cachedScene;
  }

  const vehicle = getVehicleOptionById(vehicleId);

  if (!vehicle) {
    return Promise.resolve(new Group());
  }

  const scenePromise = loader.loadAsync(vehicle.assetPath).then((gltf) => gltf.scene as Group);
  baseSceneCache.set(vehicleId, scenePromise);
  return scenePromise;
}

function createFloorGlow() {
  const floor = new Mesh(new PlaneGeometry(10, 10), new MeshBasicMaterial({ color: '#16334a', transparent: true, opacity: 0.32 }));
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -0.92;
  floor.scale.set(0.9, 0.34, 1);
  return floor;
}

function isSceneMesh(node: unknown): node is Mesh {
  return node instanceof Mesh;
}

function getMedian(values: number[]) {
  if (values.length === 0) {
    return 0;
  }

  const sortedValues = [...values].sort((a, b) => a - b);
  const middleIndex = Math.floor(sortedValues.length / 2);

  if (sortedValues.length % 2 === 0) {
    return (sortedValues[middleIndex - 1] + sortedValues[middleIndex]) * 0.5;
  }

  return sortedValues[middleIndex];
}

function isRenderableGeometry(geometry: BufferGeometry | undefined) {
  return Boolean(geometry?.attributes.position && geometry.attributes.position.count > 0);
}

function isLikelyBackdropMesh(size: Vector3) {
  const dimensions = [size.x, size.y, size.z].filter((value) => value > 0.001);

  if (dimensions.length === 0) {
    return true;
  }

  const smallestDimension = Math.min(...dimensions);
  const largestDimension = Math.max(...dimensions);

  return smallestDimension < 0.03 && largestDimension > 6;
}

function getVehicleBounds(root: Group) {
  const fullBounds = new Box3().setFromObject(root);

  if (fullBounds.isEmpty()) {
    return fullBounds;
  }

  const meshBoundsEntries: MeshBoundsEntry[] = [];

  root.updateWorldMatrix(true, true);
  root.traverse((node) => {
    if (!isSceneMesh(node) || !node.visible || !isRenderableGeometry(node.geometry)) {
      return;
    }

    if (!node.geometry.boundingBox) {
      node.geometry.computeBoundingBox();
    }

    const localBounds = node.geometry.boundingBox;

    if (!localBounds || localBounds.isEmpty()) {
      return;
    }

    const worldBounds = localBounds.clone().applyMatrix4(node.matrixWorld);
    const size = worldBounds.getSize(new Vector3());

    if (size.length() < 0.04 || isLikelyBackdropMesh(size)) {
      return;
    }

    meshBoundsEntries.push({
      bounds: worldBounds,
      center: worldBounds.getCenter(new Vector3()),
      diagonal: size.length(),
    });
  });

  if (meshBoundsEntries.length === 0) {
    return fullBounds;
  }

  const medianCenter = new Vector3(
    getMedian(meshBoundsEntries.map((entry) => entry.center.x)),
    getMedian(meshBoundsEntries.map((entry) => entry.center.y)),
    getMedian(meshBoundsEntries.map((entry) => entry.center.z)),
  );
  const medianDistance = getMedian(meshBoundsEntries.map((entry) => entry.center.distanceTo(medianCenter)));
  const medianDiagonal = getMedian(meshBoundsEntries.map((entry) => entry.diagonal));
  const inclusionRadius = Math.max(medianDistance * 2.8 + medianDiagonal * 1.5, 1.75);
  const clusteredEntries = meshBoundsEntries.filter(
    (entry) => entry.center.distanceTo(medianCenter) <= inclusionRadius,
  );

  if (clusteredEntries.length === 0) {
    return fullBounds;
  }

  const clusteredBounds = new Box3();
  clusteredEntries.forEach((entry) => {
    clusteredBounds.union(entry.bounds);
  });

  return clusteredBounds.isEmpty() ? fullBounds : clusteredBounds;
}

function disposeThumbnailMaterials(root: Group) {
  root.traverse((node) => {
    if (!isSceneMesh(node)) {
      return;
    }

    if (Array.isArray(node.material)) {
      node.material.forEach((material) => material.dispose());
      return;
    }

    node.material.dispose();
  });
}

async function renderThumbnail(vehicleId: string, paintColor: string) {
  try {
    const baseScene = await loadBaseScene(vehicleId);
    const preparedVehicle = prepareVehicleModel(baseScene, paintColor);
    const vehicleRoot = preparedVehicle.root;
    const scene = new Scene();
    const camera = new PerspectiveCamera(28, THUMBNAIL_WIDTH / THUMBNAIL_HEIGHT, 0.1, 30);
    const nextRenderer = getRenderer();
    const bounds = new Box3();
    const center = new Vector3();
    const size = new Vector3();
    const sphere = new Sphere();
    const cameraDirection = new Vector3(0.92, 0.3, 1).normalize();

    vehicleRoot.position.set(0.65, -1.02, 0);
    vehicleRoot.rotation.set(-0.04, -0.76, 0);
    vehicleRoot.scale.setScalar(1.18);

    bounds.copy(getVehicleBounds(vehicleRoot));
    bounds.getCenter(center);
    bounds.getSize(size);
    bounds.getBoundingSphere(sphere);

    const target = new Vector3(
      center.x + MathUtils.clamp(size.x * 0.08, 0.06, 0.38),
      center.y + size.y * 0.08,
      center.z,
    );
    const distance = Math.max(sphere.radius * 2.5, 4.4);

    camera.position.copy(target).addScaledVector(cameraDirection, distance);
    camera.far = Math.max(40, distance * 8);
    camera.updateProjectionMatrix();
    camera.lookAt(target);

    const floor = createFloorGlow();
    floor.position.set(center.x + size.x * 0.04, bounds.min.y + 0.03, center.z);
    floor.scale.set(
      Math.max(size.x * 0.34, sphere.radius * 0.46, 1.4),
      Math.max(size.z * 0.16, sphere.radius * 0.2, 0.8),
      1,
    );

    scene.add(new AmbientLight('#edf8ff', 1));
    scene.add(new HemisphereLight('#f3fbff', '#1b3650', 1.35));

    const keyLight = new DirectionalLight('#ffffff', 1.65);
    keyLight.position.set(5, 6, 6);
    scene.add(keyLight);

    const fillLight = new DirectionalLight('#bceeff', 0.95);
    fillLight.position.set(-4, 4, 5);
    scene.add(fillLight);

    const rimLight = new DirectionalLight('#76dbff', 0.8);
    rimLight.position.set(-3, 4, -2);
    scene.add(rimLight);

    scene.add(floor);
    scene.add(vehicleRoot);

    nextRenderer.clear(true, true, true);
    nextRenderer.render(scene, camera);
    const dataUrl = nextRenderer.domElement.toDataURL('image/png');

    scene.remove(vehicleRoot);
    disposeThumbnailMaterials(vehicleRoot);

    return dataUrl;
  } catch {
    return null;
  }
}

export function getVehicleThumbnail(vehicleId: string, paintColor: string) {
  const key = `${vehicleId}${THUMBNAIL_KEY_SEPARATOR}${paintColor}`;
  const cachedThumbnail = thumbnailCache.get(key);

  if (cachedThumbnail) {
    return cachedThumbnail;
  }

  const thumbnailPromise = thumbnailRenderQueue.then(() => renderThumbnail(vehicleId, paintColor)).then((result) => {
    if (!result) {
      thumbnailCache.delete(key);
    }

    return result;
  });
  thumbnailRenderQueue = thumbnailPromise.then(
    () => undefined,
    () => undefined,
  );
  thumbnailCache.set(key, thumbnailPromise);
  return thumbnailPromise;
}
