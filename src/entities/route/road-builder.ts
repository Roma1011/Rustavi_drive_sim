import {
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  DoubleSide,
  FrontSide,
  Group,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshStandardMaterial,
  PlaneGeometry,
  Quaternion,
  Vector3,
} from 'three';
import type { RouteRoadConfig, RouteSceneryConfig } from '../../features/simulator/config/simulator.config';
import { createRouteTextures, createSeededRandom } from './road-textures';
import {
  buildSmoothCenterline,
  distanceToSamples,
  sampleAtDistance,
  type RoadSample,
} from './route-geometry';
import type { LoadedRoute, LocalPoint, RouteFeatureKind } from './route-types';

export interface SpawnTransform {
  heading: number;
  position: Vector3;
}

export interface BuiltRouteWorld {
  dispose: () => void;
  root: Group;
  samples: RoadSample[];
  spawn: SpawnTransform;
}

export interface RouteWorldBuildOptions {
  maxAnisotropy: number;
  road: RouteRoadConfig;
  scenery: RouteSceneryConfig;
}

const SURFACE_Y = {
  asphalt: 0.02,
  finish: 0.035,
  markings: 0.03,
  shoulder: 0.015,
} as const;

const RENDER_ORDER = {
  asphalt: 2,
  markings: 3,
  shoulder: 1,
} as const;

interface CrossSection {
  lx: number;
  lz: number;
  rx: number;
  rz: number;
  v: number;
}

/** Accumulates triangle strips and loose triangles into a single indexed geometry. */
class StripBuilder {
  private readonly indices: number[] = [];
  private readonly normals: number[] = [];
  private readonly positions: number[] = [];
  private readonly uvs: number[] = [];
  private vertexCount = 0;

  get isEmpty() {
    return this.indices.length === 0;
  }

  addStrip(sections: CrossSection[], y: number, uScale = 1) {
    if (sections.length < 2) {
      return;
    }

    const base = this.vertexCount;

    for (const section of sections) {
      this.pushVertex(section.lx, y, section.lz, 0, section.v);
      this.pushVertex(section.rx, y, section.rz, uScale, section.v);
    }

    for (let index = 0; index < sections.length - 1; index += 1) {
      const l0 = base + index * 2;
      const r0 = l0 + 1;
      const l1 = l0 + 2;
      const r1 = l0 + 3;
      this.indices.push(l0, r0, l1, r0, r1, l1);
    }
  }

  addTriangle(a: LocalPoint, b: LocalPoint, c: LocalPoint, y: number) {
    const cross = (b.x - a.x) * (c.z - a.z) - (b.z - a.z) * (c.x - a.x);
    const base = this.vertexCount;
    this.pushVertex(a.x, y, a.z, 0, 0);

    if (cross > 0) {
      this.pushVertex(c.x, y, c.z, 0, 0);
      this.pushVertex(b.x, y, b.z, 0, 0);
    } else {
      this.pushVertex(b.x, y, b.z, 0, 0);
      this.pushVertex(c.x, y, c.z, 0, 0);
    }

    this.indices.push(base, base + 1, base + 2);
  }

  toGeometry() {
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new BufferAttribute(new Float32Array(this.positions), 3));
    geometry.setAttribute('normal', new BufferAttribute(new Float32Array(this.normals), 3));
    geometry.setAttribute('uv', new BufferAttribute(new Float32Array(this.uvs), 2));
    geometry.setIndex(new BufferAttribute(new Uint32Array(this.indices), 1));
    geometry.computeBoundingSphere();
    geometry.computeBoundingBox();
    return geometry;
  }

  private pushVertex(x: number, y: number, z: number, u: number, v: number) {
    this.positions.push(x, y, z);
    this.normals.push(0, 1, 0);
    this.uvs.push(u, v);
    this.vertexCount += 1;
  }
}

interface OffsetStripOptions {
  /** Metres of road per texture repeat along the strip. */
  textureLength: number;
  /** Skip samples that retrace an earlier stretch (used for markings so lines are not drawn twice). */
  skipShared?: boolean;
  uScale?: number;
}

function miterScale(samples: RoadSample[], index: number) {
  const previous = samples[Math.max(index - 1, 0)];
  const next = samples[Math.min(index + 1, samples.length - 1)];

  if (previous === samples[index] || next === samples[index] || samples[index].legStart || next.legStart) {
    return 1;
  }

  const inX = samples[index].x - previous.x;
  const inZ = samples[index].z - previous.z;
  const outX = next.x - samples[index].x;
  const outZ = next.z - samples[index].z;
  const inLength = Math.hypot(inX, inZ);
  const outLength = Math.hypot(outX, outZ);

  if (inLength < 1e-6 || outLength < 1e-6) {
    return 1;
  }

  const cosTurn = Math.max(-1, Math.min(1, (inX * outX + inZ * outZ) / (inLength * outLength)));
  const halfTurn = Math.acos(cosTurn) / 2;
  const cosHalf = Math.cos(halfTurn);

  return cosHalf > 1e-3 ? Math.min(1 / cosHalf, 1.5) : 1.5;
}

/** Prevents the inner edge of a tight corner from folding back on itself. */
function collapseBackfolds(sections: CrossSection[], samples: RoadSample[], firstSampleIndex: number) {
  for (let index = 1; index < sections.length; index += 1) {
    const direction = samples[firstSampleIndex + index - 1];
    const previous = sections[index - 1];
    const current = sections[index];

    if ((current.lx - previous.lx) * direction.dirX + (current.lz - previous.lz) * direction.dirZ < 0) {
      current.lx = previous.lx;
      current.lz = previous.lz;
    }

    if ((current.rx - previous.rx) * direction.dirX + (current.rz - previous.rz) * direction.dirZ < 0) {
      current.rx = previous.rx;
      current.rz = previous.rz;
    }
  }
}

/**
 * Extrudes a strip between two signed lateral offsets (metres, positive = right of travel)
 * along the sampled centreline, breaking the strip at leg boundaries.
 */
function addOffsetStrips(
  builder: StripBuilder,
  samples: RoadSample[],
  innerOffset: number,
  outerOffset: number,
  y: number,
  options: OffsetStripOptions,
) {
  let sections: CrossSection[] = [];
  let firstSampleIndex = 0;

  const flush = () => {
    if (sections.length >= 2) {
      collapseBackfolds(sections, samples, firstSampleIndex);
      builder.addStrip(sections, y, options.uScale ?? 1);
    }

    sections = [];
  };

  for (let index = 0; index < samples.length; index += 1) {
    const sample = samples[index];

    if (sample.legStart || (options.skipShared && sample.shared)) {
      flush();

      if (options.skipShared && sample.shared) {
        continue;
      }
    }

    if (sections.length === 0) {
      firstSampleIndex = index;
    }

    const scale = miterScale(samples, index);
    sections.push({
      lx: sample.x + sample.rightX * innerOffset * scale,
      lz: sample.z + sample.rightZ * innerOffset * scale,
      rx: sample.x + sample.rightX * outerOffset * scale,
      rz: sample.z + sample.rightZ * outerOffset * scale,
      v: sample.s / options.textureLength,
    });
  }

  flush();
}

/** Adds a short strip between arc lengths `s0` and `s1`, following interior samples through curves. */
function addStripBetween(
  builder: StripBuilder,
  samples: RoadSample[],
  s0: number,
  s1: number,
  innerOffset: number,
  outerOffset: number,
  y: number,
  options: { requireUnshared?: boolean; uScale?: number } = {},
) {
  const start = sampleAtDistance(samples, s0);
  const end = sampleAtDistance(samples, s1);

  if (options.requireUnshared && (start.shared || end.shared)) {
    return false;
  }

  const points: RoadSample[] = [start];

  for (const sample of samples) {
    if (sample.s <= s0) {
      continue;
    }

    if (sample.s >= s1) {
      break;
    }

    if (sample.legStart || (options.requireUnshared && sample.shared)) {
      return false;
    }

    points.push(sample);
  }

  points.push(end);

  const sections = points.map((point, index) => ({
    lx: point.x + point.rightX * innerOffset,
    lz: point.z + point.rightZ * innerOffset,
    rx: point.x + point.rightX * outerOffset,
    rz: point.z + point.rightZ * outerOffset,
    v: points.length > 1 ? index / (points.length - 1) : 0,
  }));

  builder.addStrip(sections, y, options.uScale ?? 1);
  return true;
}

function addDirectionArrow(builder: StripBuilder, base: RoadSample, lateral: number, y: number) {
  const toWorld = (u: number, r: number): LocalPoint => ({
    x: base.x + base.dirX * u + base.rightX * (lateral + r),
    z: base.z + base.dirZ * u + base.rightZ * (lateral + r),
  });
  const shaftHalf = 0.16;
  const shaftLength = 1.7;
  const headLength = 1.3;
  const headHalf = 0.62;

  builder.addTriangle(toWorld(0, -shaftHalf), toWorld(shaftLength, -shaftHalf), toWorld(shaftLength, shaftHalf), y);
  builder.addTriangle(toWorld(0, -shaftHalf), toWorld(shaftLength, shaftHalf), toWorld(0, shaftHalf), y);
  builder.addTriangle(
    toWorld(shaftLength, -headHalf),
    toWorld(shaftLength + headLength, 0),
    toWorld(shaftLength, headHalf),
    y,
  );
}

function createSurfaceMaterial(options: {
  color?: string;
  depthWrite?: boolean;
  emissive?: string;
  map?: MeshStandardMaterial['map'];
  polygonOffsetFactor: number;
  roughness: number;
}) {
  return new MeshStandardMaterial({
    color: options.color ?? '#ffffff',
    depthWrite: options.depthWrite ?? false,
    emissive: options.emissive ?? '#000000',
    map: options.map ?? null,
    metalness: 0,
    polygonOffset: true,
    polygonOffsetFactor: options.polygonOffsetFactor,
    polygonOffsetUnits: options.polygonOffsetFactor,
    roughness: options.roughness,
    side: DoubleSide,
  });
}

function createSurfaceMesh(geometry: BufferGeometry, material: MeshStandardMaterial, renderOrder: number, name: string) {
  const mesh = new Mesh(geometry, material);
  mesh.name = name;
  mesh.renderOrder = renderOrder;
  mesh.receiveShadow = true;
  mesh.castShadow = false;
  mesh.frustumCulled = false;
  // Road surfaces are flat decals over the ground; the ground plane alone answers raycasts.
  mesh.raycast = () => undefined;
  return mesh;
}

const POINT_FEATURE_COLORS: Record<RouteFeatureKind, string> = {
  checkpoint: '#ffca67',
  other: '#9aa5b1',
  sign: '#1d5fd1',
  stop_line: '#e4e4dc',
  traffic_light: '#1f1f22',
};

function nearestSample(samples: RoadSample[], point: LocalPoint) {
  let best = samples[0];
  let bestDistance = Number.POSITIVE_INFINITY;

  for (const sample of samples) {
    const distance = Math.hypot(sample.x - point.x, sample.z - point.z);

    if (distance < bestDistance) {
      bestDistance = distance;
      best = sample;
    }
  }

  return { distance: bestDistance, sample: best };
}

export function getRouteSpawn(route: LoadedRoute, laneOffset: number): SpawnTransform {
  const first = route.roadLine[0];
  const second = route.roadLine[Math.min(1, route.roadLine.length - 1)];
  let dx = second.x - first.x;
  let dz = second.z - first.z;
  const length = Math.hypot(dx, dz);

  if (length < 1e-6) {
    dx = 0;
    dz = 1;
  } else {
    dx /= length;
    dz /= length;
  }

  const rightX = -dz;
  const rightZ = dx;

  return {
    heading: Math.atan2(dx, dz),
    position: new Vector3(first.x + rightX * laneOffset, 0, first.z + rightZ * laneOffset),
  };
}

export function buildRouteWorld(route: LoadedRoute, options: RouteWorldBuildOptions): BuiltRouteWorld {
  const { road, scenery } = options;
  const samples = buildSmoothCenterline(route.roadLine, route.gapSegments, route.sharedSegments, {
    cornerRadius: road.cornerRadius,
    maxStep: road.sampleStep,
    minSpacing: road.minVertexSpacing,
  });

  if (samples.length < 2) {
    throw new Error(`Route "${route.name}" produced no drivable centreline.`);
  }

  const textures = createRouteTextures(options.maxAnisotropy, scenery.seed);
  const root = new Group();
  root.name = `RouteWorld:${route.id}`;
  const disposables: Array<{ dispose: () => void }> = [textures];
  const totalLength = samples[samples.length - 1].s;

  // --- Ground -------------------------------------------------------------------------
  const groundWidth = route.bounds.maxX - route.bounds.minX + scenery.groundMargin * 2;
  const groundDepth = route.bounds.maxZ - route.bounds.minZ + scenery.groundMargin * 2;
  const groundCenterX = (route.bounds.minX + route.bounds.maxX) / 2;
  const groundCenterZ = (route.bounds.minZ + route.bounds.maxZ) / 2;
  textures.grass.repeat.set(groundWidth / 18, groundDepth / 18);
  const groundGeometry = new PlaneGeometry(groundWidth, groundDepth);
  const groundMaterial = new MeshStandardMaterial({ map: textures.grass, metalness: 0, roughness: 1, side: FrontSide });
  const ground = new Mesh(groundGeometry, groundMaterial);
  ground.name = 'RouteGround';
  ground.rotation.x = -Math.PI / 2;
  ground.position.set(groundCenterX, 0, groundCenterZ);
  ground.receiveShadow = true;
  root.add(ground);
  disposables.push(groundGeometry, groundMaterial);

  // --- Road surfaces ---------------------------------------------------------------------
  const shoulderBuilder = new StripBuilder();
  addOffsetStrips(shoulderBuilder, samples, -road.shoulderHalfWidth, road.shoulderHalfWidth, SURFACE_Y.shoulder, {
    textureLength: 10,
  });
  const shoulderMaterial = createSurfaceMaterial({ color: '#a3a39c', polygonOffsetFactor: -1, roughness: 0.96 });
  const shoulder = createSurfaceMesh(shoulderBuilder.toGeometry(), shoulderMaterial, RENDER_ORDER.shoulder, 'RouteShoulder');
  root.add(shoulder);
  disposables.push(shoulder.geometry, shoulderMaterial);

  const asphaltBuilder = new StripBuilder();
  addOffsetStrips(asphaltBuilder, samples, -road.asphaltHalfWidth, road.asphaltHalfWidth, SURFACE_Y.asphalt, {
    textureLength: 6,
  });
  const asphaltMaterial = createSurfaceMaterial({ map: textures.asphalt, polygonOffsetFactor: -2, roughness: 0.92 });
  const asphalt = createSurfaceMesh(asphaltBuilder.toGeometry(), asphaltMaterial, RENDER_ORDER.asphalt, 'RouteAsphalt');
  root.add(asphalt);
  disposables.push(asphalt.geometry, asphaltMaterial);

  // --- Markings ------------------------------------------------------------------------
  const markingsBuilder = new StripBuilder();
  const halfLine = road.lineWidth / 2;
  addOffsetStrips(markingsBuilder, samples, -road.edgeLineOffset - halfLine, -road.edgeLineOffset + halfLine, SURFACE_Y.markings, {
    skipShared: true,
    textureLength: 10,
  });
  addOffsetStrips(markingsBuilder, samples, road.edgeLineOffset - halfLine, road.edgeLineOffset + halfLine, SURFACE_Y.markings, {
    skipShared: true,
    textureLength: 10,
  });

  const dashPeriod = road.dashLength + road.dashGap;

  for (let s = road.dashGap; s + road.dashLength < totalLength - 2; s += dashPeriod) {
    addStripBetween(markingsBuilder, samples, s, s + road.dashLength, -halfLine, halfLine, SURFACE_Y.markings, {
      requireUnshared: true,
    });
  }

  for (let s = road.arrowSpacing * 0.5; s < totalLength - 6; s += road.arrowSpacing) {
    const base = sampleAtDistance(samples, s);
    const ahead = sampleAtDistance(samples, s + 3.2);

    if (base.shared || ahead.shared || ahead.legStart) {
      continue;
    }

    addDirectionArrow(markingsBuilder, base, road.laneOffset, SURFACE_Y.markings);
  }

  addStripBetween(markingsBuilder, samples, 0.4, 1.0, -road.asphaltHalfWidth, road.asphaltHalfWidth, SURFACE_Y.markings);

  const stopLineFeatures = route.pointFeatures.filter((feature) => feature.kind === 'stop_line');

  for (const feature of stopLineFeatures) {
    const nearest = nearestSample(samples, feature.position);

    if (nearest.distance <= road.shoulderHalfWidth * 2) {
      addStripBetween(
        markingsBuilder,
        samples,
        nearest.sample.s - 0.2,
        nearest.sample.s + 0.2,
        -road.asphaltHalfWidth,
        road.asphaltHalfWidth,
        SURFACE_Y.markings,
      );
    }
  }

  const markingsMaterial = createSurfaceMaterial({ color: '#f1f1e8', polygonOffsetFactor: -3, roughness: 0.55 });
  const markings = createSurfaceMesh(markingsBuilder.toGeometry(), markingsMaterial, RENDER_ORDER.markings, 'RouteMarkings');
  root.add(markings);
  disposables.push(markings.geometry, markingsMaterial);

  const finishBuilder = new StripBuilder();
  addStripBetween(
    finishBuilder,
    samples,
    Math.max(totalLength - 1.8, 0),
    Math.max(totalLength - 0.4, 0.1),
    -road.asphaltHalfWidth,
    road.asphaltHalfWidth,
    SURFACE_Y.finish,
    { uScale: 7 },
  );
  const finishMaterial = createSurfaceMaterial({ map: textures.checker, polygonOffsetFactor: -3, roughness: 0.55 });
  const finish = createSurfaceMesh(finishBuilder.toGeometry(), finishMaterial, RENDER_ORDER.markings, 'RouteFinishLine');
  root.add(finish);
  disposables.push(finish.geometry, finishMaterial);

  // --- Scenery -------------------------------------------------------------------------
  const random = createSeededRandom(scenery.seed);
  const treePositions: Array<{ scale: number; x: number; yaw: number; z: number }> = [];
  const treeClearance = scenery.treeClearance;

  const tryAddTree = (x: number, z: number) => {
    if (distanceToSamples({ x, z }, samples) < treeClearance) {
      return;
    }

    treePositions.push({ scale: 0.75 + random() * 0.6, x, yaw: random() * Math.PI * 2, z });
  };

  for (let s = scenery.roadsideTreeSpacing * 0.5; s < totalLength; s += scenery.roadsideTreeSpacing) {
    const sample = sampleAtDistance(samples, s + (random() - 0.5) * scenery.roadsideTreeSpacing * 0.6);
    const side = random() < 0.5 ? -1 : 1;
    const lateral = side * (treeClearance + 1 + random() * 26);
    tryAddTree(sample.x + sample.rightX * lateral, sample.z + sample.rightZ * lateral);
  }

  const backgroundMargin = scenery.groundMargin * 0.5;

  for (let index = 0; index < scenery.backgroundTreeCount; index += 1) {
    const x = route.bounds.minX - backgroundMargin + random() * (groundWidth - scenery.groundMargin * 2 + backgroundMargin * 2);
    const z = route.bounds.minZ - backgroundMargin + random() * (groundDepth - scenery.groundMargin * 2 + backgroundMargin * 2);
    tryAddTree(x, z);
  }

  if (treePositions.length > 0) {
    const trunkGeometry = new CylinderGeometry(0.2, 0.3, 2.4, 6);
    const canopyGeometry = new ConeGeometry(2.3, 5.2, 7);
    const trunkMaterial = new MeshStandardMaterial({ color: '#5b3d26', roughness: 0.95 });
    const canopyMaterial = new MeshStandardMaterial({ color: '#ffffff', roughness: 0.9 });
    const trunks = new InstancedMesh(trunkGeometry, trunkMaterial, treePositions.length);
    const canopies = new InstancedMesh(canopyGeometry, canopyMaterial, treePositions.length);
    const matrix = new Matrix4();
    const position = new Vector3();
    const rotation = new Quaternion();
    const scale = new Vector3();
    const canopyColor = new Color();
    const up = new Vector3(0, 1, 0);

    treePositions.forEach((tree, index) => {
      rotation.setFromAxisAngle(up, tree.yaw);
      scale.setScalar(tree.scale);
      position.set(tree.x, 1.2 * tree.scale, tree.z);
      matrix.compose(position, rotation, scale);
      trunks.setMatrixAt(index, matrix);
      position.set(tree.x, (2.4 + 2.6) * tree.scale, tree.z);
      matrix.compose(position, rotation, scale);
      canopies.setMatrixAt(index, matrix);
      canopyColor.setHSL(0.27 + random() * 0.05, 0.42 + random() * 0.2, 0.26 + random() * 0.1);
      canopies.setColorAt(index, canopyColor);
    });

    trunks.name = 'RouteTreeTrunks';
    canopies.name = 'RouteTreeCanopies';
    trunks.castShadow = true;
    canopies.castShadow = true;
    trunks.receiveShadow = true;
    canopies.receiveShadow = true;
    trunks.instanceMatrix.needsUpdate = true;
    canopies.instanceMatrix.needsUpdate = true;

    if (canopies.instanceColor) {
      canopies.instanceColor.needsUpdate = true;
    }

    root.add(trunks, canopies);
    disposables.push(trunkGeometry, canopyGeometry, trunkMaterial, canopyMaterial, trunks, canopies);
  }

  const lampPositions: Array<{ side: number; sample: RoadSample }> = [];
  let lampSide = 1;

  for (let s = scenery.lampSpacing * 0.5; s < totalLength - 10; s += scenery.lampSpacing) {
    const sample = sampleAtDistance(samples, s);
    lampSide *= -1;

    if (sample.shared) {
      continue;
    }

    lampPositions.push({ sample, side: lampSide });
  }

  if (lampPositions.length > 0) {
    const poleGeometry = new CylinderGeometry(0.07, 0.1, 6.4, 6);
    const headGeometry = new BoxGeometry(0.62, 0.16, 0.3);
    const poleMaterial = new MeshStandardMaterial({ color: '#8a8f94', metalness: 0.35, roughness: 0.6 });
    const headMaterial = new MeshStandardMaterial({ color: '#f7e9bd', emissive: '#f2c56b', emissiveIntensity: 0.55, roughness: 0.5 });
    const poles = new InstancedMesh(poleGeometry, poleMaterial, lampPositions.length);
    const heads = new InstancedMesh(headGeometry, headMaterial, lampPositions.length);
    const matrix = new Matrix4();
    const position = new Vector3();
    const rotation = new Quaternion();
    const scale = new Vector3(1, 1, 1);
    const up = new Vector3(0, 1, 0);

    lampPositions.forEach(({ sample, side }, index) => {
      const x = sample.x + sample.rightX * side * scenery.lampOffset;
      const z = sample.z + sample.rightZ * side * scenery.lampOffset;
      const yaw = Math.atan2(sample.rightX, sample.rightZ);
      rotation.setFromAxisAngle(up, yaw);
      position.set(x, 3.2, z);
      matrix.compose(position, rotation, scale);
      poles.setMatrixAt(index, matrix);
      position.set(x - sample.rightX * side * 0.5, 6.4, z - sample.rightZ * side * 0.5);
      matrix.compose(position, rotation, scale);
      heads.setMatrixAt(index, matrix);
    });

    poles.name = 'RouteLampPoles';
    heads.name = 'RouteLampHeads';
    poles.castShadow = true;
    poles.instanceMatrix.needsUpdate = true;
    heads.instanceMatrix.needsUpdate = true;
    heads.raycast = () => undefined;
    root.add(poles, heads);
    disposables.push(poleGeometry, headGeometry, poleMaterial, headMaterial, poles, heads);
  }

  // --- Point features (signs, lights, checkpoints) ----------------------------------------
  const pointFeatures = route.pointFeatures.filter((feature) => feature.kind !== 'stop_line');

  if (pointFeatures.length > 0) {
    const poleGeometry = new CylinderGeometry(0.05, 0.05, 3, 6);
    const headGeometry = new BoxGeometry(0.5, 0.5, 0.14);
    const lightGeometry = new BoxGeometry(0.32, 0.9, 0.3);
    const poleMaterial = new MeshStandardMaterial({ color: '#6c7076', metalness: 0.3, roughness: 0.6 });
    disposables.push(poleGeometry, headGeometry, lightGeometry, poleMaterial);

    for (const feature of pointFeatures) {
      const holder = new Group();
      holder.name = `RoutePoint:${feature.kind}:${feature.label}`;
      const pole = new Mesh(poleGeometry, poleMaterial);
      pole.position.set(feature.position.x, 1.5, feature.position.z);
      pole.castShadow = true;
      holder.add(pole);

      const headMaterial = new MeshStandardMaterial({
        color: POINT_FEATURE_COLORS[feature.kind],
        emissive: feature.kind === 'traffic_light' ? '#3b0d0d' : '#000000',
        roughness: 0.5,
      });
      disposables.push(headMaterial);
      const head = new Mesh(feature.kind === 'traffic_light' ? lightGeometry : headGeometry, headMaterial);
      head.position.set(feature.position.x, feature.kind === 'traffic_light' ? 3.3 : 3.1, feature.position.z);
      head.castShadow = true;
      head.raycast = () => undefined;

      const nearest = nearestSample(samples, feature.position);
      head.rotation.y = Math.atan2(nearest.sample.dirX, nearest.sample.dirZ) + Math.PI;
      holder.add(head);
      root.add(holder);
    }
  }

  const spawn = getRouteSpawn(route, road.laneOffset);

  return {
    dispose: () => {
      for (const disposable of disposables) {
        disposable.dispose();
      }
    },
    root,
    samples,
    spawn,
  };
}
