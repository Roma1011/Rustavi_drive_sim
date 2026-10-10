import { Box3, Intersection, Object3D, Raycaster, Vector3 } from 'three';

interface VehicleDimensions {
  trackWidth: number;
  wheelBase: number;
}

export interface TerrainProbe {
  center: number;
  front: number;
  back: number;
  left: number;
  right: number;
}

const DOWN = new Vector3(0, -1, 0);
const MIN_DRIVABLE_SURFACE_NORMAL_Y = 0.72;
const MAX_DRIVABLE_STEP_UP = 0.45;
const MAX_WALL_NORMAL_Y = 0.35;

export interface SurfaceHit {
  normal: Vector3;
  object: Object3D;
  point: Vector3;
}

const worldNormal = new Vector3();

function toSurfaceHit(hit: Intersection<Object3D>): SurfaceHit {
  worldNormal.copy(hit.face?.normal ?? DOWN).transformDirection(hit.object.matrixWorld);

  return {
    normal: worldNormal.clone(),
    object: hit.object,
    point: hit.point.clone(),
  };
}

function selectGroundHit(
  intersections: Array<Intersection<Object3D>>,
  expectedGroundY?: number,
): SurfaceHit | null {
  let fallbackHit: SurfaceHit | null = null;
  let bestMatch: SurfaceHit | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;

  for (const intersection of intersections) {
    const hit = toSurfaceHit(intersection);

    if (hit.normal.y < MIN_DRIVABLE_SURFACE_NORMAL_Y) {
      continue;
    }

    if (!fallbackHit) {
      fallbackHit = hit;
    }

    if (expectedGroundY == null) {
      return hit;
    }

    if (hit.point.y > expectedGroundY + MAX_DRIVABLE_STEP_UP) {
      continue;
    }

    const distance = Math.abs(hit.point.y - expectedGroundY);

    if (distance < bestDistance) {
      bestDistance = distance;
      bestMatch = hit;
    }
  }

  return bestMatch ?? fallbackHit;
}

function traceGroundHit(
  terrain: Object3D | null,
  raycaster: Raycaster,
  x: number,
  z: number,
  expectedGroundY?: number,
): SurfaceHit | null {
  if (!terrain) {
    return null;
  }

  raycaster.far = 1200;
  raycaster.set(new Vector3(x, 600, z), DOWN);

  return selectGroundHit(raycaster.intersectObject(terrain, true), expectedGroundY);
}

function traceGroundY(
  terrain: Object3D | null,
  raycaster: Raycaster,
  x: number,
  z: number,
  fallback: number,
  expectedGroundY?: number,
) {
  return traceGroundHit(terrain, raycaster, x, z, expectedGroundY)?.point.y ?? fallback;
}

export function isDrivableSurface(object: Object3D | null) {
  return Boolean(object);
}

export function findGroundSurface(
  terrain: Object3D | null,
  raycaster: Raycaster,
  x: number,
  z: number,
  expectedGroundY?: number,
) {
  return traceGroundHit(terrain, raycaster, x, z, expectedGroundY);
}

export function isRoadAtPosition(
  terrain: Object3D | null,
  raycaster: Raycaster,
  x: number,
  z: number,
  currentGroundY: number,
) {
  const sampleOffsets: Array<[number, number]> = [
    [0, 0],
    [0.9, 0],
    [-0.9, 0],
    [0, 0.9],
    [0, -0.9],
  ];

  let drivableHits = 0;

  for (const [offsetX, offsetZ] of sampleOffsets) {
    const hit = traceGroundHit(terrain, raycaster, x + offsetX, z + offsetZ, currentGroundY);

    if (
      hit &&
      hit.normal.y >= MIN_DRIVABLE_SURFACE_NORMAL_Y &&
      hit.point.y <= currentGroundY + MAX_DRIVABLE_STEP_UP
    ) {
      drivableHits += 1;
    }
  }

  return drivableHits >= 2;
}

function sampleForwardDistance(
  terrain: Object3D | null,
  raycaster: Raycaster,
  position: Vector3,
  heading: number,
  maxDistance: number,
  stepDistance: number,
) {
  const direction = new Vector3(Math.sin(heading), 0, Math.cos(heading));
  let safeDistance = 0;

  for (let distance = stepDistance; distance <= maxDistance; distance += stepDistance) {
    const probe = position.clone().addScaledVector(direction, distance);
    const hit = traceGroundHit(terrain, raycaster, probe.x, probe.z, position.y);

    if (!hit || !isDrivableSurface(hit.object)) {
      break;
    }

    safeDistance = distance;
  }

  return safeDistance;
}

function scoreHeadingAtPoint(
  terrain: Object3D | null,
  raycaster: Raycaster,
  position: Vector3,
  heading: number,
  dimensions: VehicleDimensions,
) {
  if (!isPositionDrivable(terrain, raycaster, position, heading, dimensions)) {
    return Number.NEGATIVE_INFINITY;
  }

  const forwardDistance = sampleForwardDistance(terrain, raycaster, position, heading, 18, 1.4);
  const reverseDistance = sampleForwardDistance(
    terrain,
    raycaster,
    position,
    heading + Math.PI,
    8,
    1.4,
  );

  return forwardDistance * 2 + reverseDistance;
}

export function estimateHeadingAtPoint(
  terrain: Object3D | null,
  raycaster: Raycaster,
  position: Vector3,
  dimensions: VehicleDimensions,
) {
  let bestHeading = 0;
  let bestScore = Number.NEGATIVE_INFINITY;

  for (let index = 0; index < 24; index += 1) {
    const heading = (index / 24) * Math.PI * 2;
    const score = scoreHeadingAtPoint(terrain, raycaster, position, heading, dimensions);

    if (score > bestScore) {
      bestScore = score;
      bestHeading = heading;
    }
  }

  return bestHeading;
}

export function findSpawnTransform(
  terrain: Object3D | null,
  raycaster: Raycaster,
  dimensions: VehicleDimensions,
) {
  if (!terrain) {
    return {
      heading: 0,
      position: new Vector3(0, 0, 0),
    };
  }

  const box = new Box3().setFromObject(terrain);
  const size = box.getSize(new Vector3());
  const center = box.getCenter(new Vector3());
  const searchRadiusX = Math.max(size.x * 0.16, 10);
  const searchRadiusZ = Math.max(size.z * 0.16, 10);
  const fractions = [-0.28, -0.18, -0.1, 0, 0.1, 0.18, 0.28];
  let bestSpawn: { heading: number; position: Vector3; score: number } | null = null;

  for (const fractionX of fractions) {
    for (const fractionZ of fractions) {
      const x = center.x + searchRadiusX * fractionX;
      const z = center.z + searchRadiusZ * fractionZ;
      const hit = traceGroundHit(terrain, raycaster, x, z);

      if (!hit || !isDrivableSurface(hit.object)) {
        continue;
      }

      const position = hit.point.clone();
      const heading = estimateHeadingAtPoint(terrain, raycaster, position, dimensions);
      const score =
        scoreHeadingAtPoint(terrain, raycaster, position, heading, dimensions) -
        position.distanceTo(center) * 0.06;

      if (!bestSpawn || score > bestSpawn.score) {
        bestSpawn = {
          heading,
          position,
          score,
        };
      }
    }
  }

  if (bestSpawn) {
    return {
      heading: bestSpawn.heading,
      position: bestSpawn.position,
    };
  }

  const candidates: Array<[number, number]> = [
    [0, 0],
    [0, searchRadiusZ * 0.25],
    [searchRadiusX * 0.25, 0],
    [-searchRadiusX * 0.25, 0],
    [searchRadiusX * 0.18, searchRadiusZ * 0.18],
    [-searchRadiusX * 0.18, searchRadiusZ * 0.18],
    [0, -searchRadiusZ * 0.25],
  ];

  for (const [offsetX, offsetZ] of candidates) {
    const x = center.x + offsetX;
    const z = center.z + offsetZ;
    const hit = traceGroundHit(terrain, raycaster, x, z);

    if (hit && isDrivableSurface(hit.object)) {
      return {
        heading: estimateHeadingAtPoint(terrain, raycaster, hit.point, dimensions),
        position: hit.point,
      };
    }
  }

  for (const [offsetX, offsetZ] of candidates) {
    const x = center.x + offsetX;
    const z = center.z + offsetZ;
    const y = traceGroundY(terrain, raycaster, x, z, 0);

    if (Number.isFinite(y)) {
      return {
        heading: 0,
        position: new Vector3(x, y, z),
      };
    }
  }

  return {
    heading: 0,
    position: new Vector3(center.x, box.max.y, center.z),
  };
}

export function sampleTerrainUnderVehicle(
  terrain: Object3D | null,
  raycaster: Raycaster,
  position: Vector3,
  heading: number,
  dimensions: VehicleDimensions,
): TerrainProbe {
  const forward = new Vector3(Math.sin(heading), 0, Math.cos(heading));
  const right = new Vector3(forward.z, 0, -forward.x);
  const halfWheelBase = dimensions.wheelBase * 0.5;
  const halfTrack = dimensions.trackWidth * 0.5;
  const fallback = position.y;

  const frontPosition = position.clone().addScaledVector(forward, halfWheelBase);
  const backPosition = position.clone().addScaledVector(forward, -halfWheelBase);
  const leftPosition = position.clone().addScaledVector(right, -halfTrack);
  const rightPosition = position.clone().addScaledVector(right, halfTrack);

  return {
    back: traceGroundY(terrain, raycaster, backPosition.x, backPosition.z, fallback, fallback),
    center: traceGroundY(terrain, raycaster, position.x, position.z, fallback, fallback),
    front: traceGroundY(terrain, raycaster, frontPosition.x, frontPosition.z, fallback, fallback),
    left: traceGroundY(terrain, raycaster, leftPosition.x, leftPosition.z, fallback, fallback),
    right: traceGroundY(terrain, raycaster, rightPosition.x, rightPosition.z, fallback, fallback),
  };
}

export function isPositionDrivable(
  terrain: Object3D | null,
  raycaster: Raycaster,
  position: Vector3,
  heading: number,
  dimensions: VehicleDimensions,
) {
  const forward = new Vector3(Math.sin(heading), 0, Math.cos(heading));
  const right = new Vector3(forward.z, 0, -forward.x);
  const checkpoints = [
    position.clone(),
    position.clone().addScaledVector(forward, dimensions.wheelBase * 0.42),
    position.clone().addScaledVector(forward, -dimensions.wheelBase * 0.24),
    position.clone().addScaledVector(right, dimensions.trackWidth * 0.28),
    position.clone().addScaledVector(right, -dimensions.trackWidth * 0.28),
  ];

  return checkpoints.every((checkpoint) => {
    const hit = traceGroundHit(terrain, raycaster, checkpoint.x, checkpoint.z, position.y);
    return Boolean(hit && isDrivableSurface(hit.object));
  });
}

export function isPathBlocked(
  terrain: Object3D | null,
  raycaster: Raycaster,
  origin: Vector3,
  target: Vector3,
  collisionRadius: number,
  collisionProbeHeight: number,
) {
  if (!terrain) {
    return false;
  }

  const travel = target.clone().sub(origin);
  travel.y = 0;

  const distance = travel.length();

  if (distance < 0.02) {
    return false;
  }

  const direction = travel.normalize();
  const right = new Vector3(direction.z, 0, -direction.x);
  const probeOffsets = [-collisionRadius, 0, collisionRadius];

  for (const offset of probeOffsets) {
    const probeOrigin = origin
      .clone()
      .addScaledVector(right, offset)
      .setY(origin.y + collisionProbeHeight);

    raycaster.far = distance + collisionRadius;
    raycaster.set(probeOrigin, direction);

    const intersections = raycaster.intersectObject(terrain, true);

    for (const intersection of intersections) {
      const hit = toSurfaceHit(intersection);

      if (hit.normal.y <= MAX_WALL_NORMAL_Y) {
        return true;
      }
    }
  }

  return false;
}
