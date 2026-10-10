import type { LocalPoint } from './route-types';

export interface SegmentProjection {
  distance: number;
  t: number;
  x: number;
  z: number;
}

export interface RoadSample extends LocalPoint {
  /** Unit direction of travel at this sample. */
  dirX: number;
  dirZ: number;
  /** True when this sample starts a new disconnected stretch (no strip across the previous sample). */
  legStart: boolean;
  /** Right-hand unit normal (scene frame: right-handed, y up). */
  rightX: number;
  rightZ: number;
  /** Arc length from the start of the route in metres. */
  s: number;
  /** Index of the original route segment this sample belongs to. */
  segmentIndex: number;
  /** True when the sample lies on a stretch that retraces an earlier part of the route. */
  shared: boolean;
}

export interface SmoothCenterlineOptions {
  /** Maximum fillet radius applied to corners, in metres. */
  cornerRadius: number;
  /** Maximum spacing between generated samples, in metres. */
  maxStep: number;
  /** Interior vertices closer than this to the previous kept vertex are skipped for meshing only. */
  minSpacing: number;
}

const EPSILON = 1e-6;

export function distanceBetween(a: LocalPoint, b: LocalPoint) {
  return Math.hypot(b.x - a.x, b.z - a.z);
}

export function projectOntoSegment(point: LocalPoint, a: LocalPoint, b: LocalPoint): SegmentProjection {
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const lengthSquared = dx * dx + dz * dz;
  const rawT = lengthSquared > EPSILON ? ((point.x - a.x) * dx + (point.z - a.z) * dz) / lengthSquared : 0;
  const t = Math.max(0, Math.min(1, rawT));
  const x = a.x + dx * t;
  const z = a.z + dz * t;

  return {
    distance: Math.hypot(point.x - x, point.z - z),
    t,
    x,
    z,
  };
}

export function computeCumulativeDistance(points: LocalPoint[]) {
  const cumulative = new Array<number>(points.length);
  let total = 0;

  for (let index = 0; index < points.length; index += 1) {
    if (index > 0) {
      total += distanceBetween(points[index - 1], points[index]);
    }

    cumulative[index] = total;
  }

  return cumulative;
}

/**
 * Snaps vertices that come within `mergeDistance` of an earlier, non-adjacent segment onto
 * that segment. A route that drives out along a street and later returns along the same
 * street therefore ends up with one carriageway instead of two slightly offset ribbons.
 * Vertex count and order are preserved; only snapped vertices move, by at most `mergeDistance`.
 */
export function mergeRevisitedVertices(
  points: LocalPoint[],
  gapSegments: boolean[],
  mergeDistance: number,
  minIndexGap = 3,
) {
  const merged = points.map((point) => ({ x: point.x, z: point.z }));
  const snapped = new Array<boolean>(points.length).fill(false);

  for (let index = 0; index < merged.length; index += 1) {
    let best: { distance: number; x: number; z: number } | null = null;

    for (let segment = 0; segment < index - minIndexGap; segment += 1) {
      if (gapSegments[segment]) {
        continue;
      }

      const projection = projectOntoSegment(merged[index], merged[segment], merged[segment + 1]);

      if (projection.distance <= mergeDistance && (!best || projection.distance < best.distance)) {
        best = { distance: projection.distance, x: projection.x, z: projection.z };
      }
    }

    if (best) {
      merged[index] = { x: best.x, z: best.z };
      snapped[index] = true;
    }
  }

  const sharedSegments = new Array<boolean>(Math.max(points.length - 1, 0)).fill(false);

  for (let segment = 0; segment < sharedSegments.length; segment += 1) {
    sharedSegments[segment] = !gapSegments[segment] && (snapped[segment] || snapped[segment + 1]);
  }

  return { points: merged, sharedSegments, snapped };
}

interface KeptVertex extends LocalPoint {
  segmentIndex: number;
}

function normalizeDirection(dx: number, dz: number) {
  const length = Math.hypot(dx, dz);

  if (length < EPSILON) {
    return { dx: 0, dz: 1 };
  }

  return { dx: dx / length, dz: dz / length };
}

function filterSpacing(leg: KeptVertex[], minSpacing: number) {
  if (leg.length <= 2) {
    return leg;
  }

  const kept: KeptVertex[] = [leg[0]];

  for (let index = 1; index < leg.length - 1; index += 1) {
    if (distanceBetween(kept[kept.length - 1], leg[index]) >= minSpacing) {
      kept.push(leg[index]);
    }
  }

  const last = leg[leg.length - 1];

  if (kept.length > 1 && distanceBetween(kept[kept.length - 1], last) < minSpacing) {
    kept[kept.length - 1] = { ...last, segmentIndex: kept[kept.length - 1].segmentIndex };
  } else {
    kept.push(last);
  }

  return kept;
}

function applyFillets(leg: KeptVertex[], cornerRadius: number) {
  if (leg.length < 3 || cornerRadius <= 0) {
    return leg;
  }

  const output: KeptVertex[] = [leg[0]];

  for (let index = 1; index < leg.length - 1; index += 1) {
    const previous = leg[index - 1];
    const corner = leg[index];
    const next = leg[index + 1];
    const length1 = distanceBetween(previous, corner);
    const length2 = distanceBetween(corner, next);

    if (length1 < EPSILON || length2 < EPSILON) {
      output.push(corner);
      continue;
    }

    const d1 = normalizeDirection(corner.x - previous.x, corner.z - previous.z);
    const d2 = normalizeDirection(next.x - corner.x, next.z - corner.z);
    const cosTurn = Math.max(-1, Math.min(1, d1.dx * d2.dx + d1.dz * d2.dz));
    const turnAngle = Math.acos(cosTurn);
    const turnDegrees = (turnAngle * 180) / Math.PI;

    if (turnDegrees < 2 || turnDegrees > 170) {
      output.push(corner);
      continue;
    }

    const tanHalf = Math.tan(turnAngle / 2);
    const maxTangent = 0.5 * Math.min(length1, length2);
    const radius = Math.min(cornerRadius, maxTangent / tanHalf);

    if (radius < 0.75) {
      output.push(corner);
      continue;
    }

    const tangent = radius * tanHalf;
    const start = { x: corner.x - d1.dx * tangent, z: corner.z - d1.dz * tangent };
    const end = { x: corner.x + d2.dx * tangent, z: corner.z + d2.dz * tangent };
    const cross = d1.dx * d2.dz - d1.dz * d2.dx;
    const insideSign = cross >= 0 ? 1 : -1;
    const centerX = start.x + -d1.dz * insideSign * radius;
    const centerZ = start.z + d1.dx * insideSign * radius;
    const startAngle = Math.atan2(start.z - centerZ, start.x - centerX);
    const endAngle = Math.atan2(end.z - centerZ, end.x - centerX);
    let sweep = endAngle - startAngle;

    while (sweep > Math.PI) {
      sweep -= Math.PI * 2;
    }

    while (sweep < -Math.PI) {
      sweep += Math.PI * 2;
    }

    const arcSteps = Math.max(6, Math.ceil((Math.abs(sweep) * radius) / 1.5));

    output.push({ ...start, segmentIndex: corner.segmentIndex });

    for (let step = 1; step < arcSteps; step += 1) {
      const angle = startAngle + (sweep * step) / arcSteps;
      output.push({
        segmentIndex: corner.segmentIndex,
        x: centerX + Math.cos(angle) * radius,
        z: centerZ + Math.sin(angle) * radius,
      });
    }

    output.push({ ...end, segmentIndex: corner.segmentIndex });
  }

  output.push(leg[leg.length - 1]);

  return output;
}

function densify(leg: KeptVertex[], maxStep: number) {
  const output: KeptVertex[] = [];

  for (let index = 0; index < leg.length; index += 1) {
    const current = leg[index];

    if (index > 0) {
      const previous = output[output.length - 1];
      const length = distanceBetween(previous, current);

      if (length < 0.01) {
        continue;
      }

      const steps = Math.max(1, Math.ceil(length / maxStep));

      for (let step = 1; step < steps; step += 1) {
        const t = step / steps;
        output.push({
          segmentIndex: previous.segmentIndex,
          x: previous.x + (current.x - previous.x) * t,
          z: previous.z + (current.z - previous.z) * t,
        });
      }
    }

    output.push(current);
  }

  return output;
}

/**
 * Turns the (snapped) route polyline into a dense, smoothly-joined sample list that the
 * road builder can extrude. Corners receive circular fillets so the ribbon has no spikes,
 * long segments are subdivided, and every sample knows its direction and right-hand normal.
 */
export function buildSmoothCenterline(
  points: LocalPoint[],
  gapSegments: boolean[],
  sharedSegments: boolean[],
  options: SmoothCenterlineOptions,
): RoadSample[] {
  const samples: RoadSample[] = [];

  if (points.length < 2) {
    return samples;
  }

  const legs: KeptVertex[][] = [];
  let currentLeg: KeptVertex[] = [];

  for (let index = 0; index < points.length; index += 1) {
    currentLeg.push({ segmentIndex: Math.min(index, points.length - 2), x: points[index].x, z: points[index].z });

    if (index < points.length - 1 && gapSegments[index]) {
      legs.push(currentLeg);
      currentLeg = [];
    }
  }

  legs.push(currentLeg);

  let arcLength = 0;

  for (const leg of legs) {
    if (leg.length < 2) {
      continue;
    }

    const dense = densify(applyFillets(filterSpacing(leg, options.minSpacing), options.cornerRadius), options.maxStep);

    for (let index = 0; index < dense.length; index += 1) {
      const current = dense[index];
      const previous = dense[Math.max(index - 1, 0)];
      const next = dense[Math.min(index + 1, dense.length - 1)];
      const direction = normalizeDirection(next.x - previous.x, next.z - previous.z);

      if (index > 0) {
        arcLength += distanceBetween(previous, current);
      }

      samples.push({
        dirX: direction.dx,
        dirZ: direction.dz,
        legStart: index === 0,
        rightX: -direction.dz,
        rightZ: direction.dx,
        s: arcLength,
        segmentIndex: current.segmentIndex,
        shared: Boolean(sharedSegments[current.segmentIndex]),
        x: current.x,
        z: current.z,
      });
    }
  }

  return samples;
}

/**
 * Interpolates a sample at arc length `s` (clamped to the route) using binary search.
 */
export function sampleAtDistance(samples: RoadSample[], s: number): RoadSample {
  if (samples.length === 0) {
    throw new Error('Cannot sample an empty centreline.');
  }

  if (s <= samples[0].s) {
    return samples[0];
  }

  const last = samples[samples.length - 1];

  if (s >= last.s) {
    return last;
  }

  let low = 0;
  let high = samples.length - 1;

  while (high - low > 1) {
    const middle = (low + high) >> 1;

    if (samples[middle].s <= s) {
      low = middle;
    } else {
      high = middle;
    }
  }

  const a = samples[low];
  const b = samples[high];
  const span = b.s - a.s;
  const t = span > EPSILON ? (s - a.s) / span : 0;
  const direction = normalizeDirection(a.dirX + (b.dirX - a.dirX) * t, a.dirZ + (b.dirZ - a.dirZ) * t);

  return {
    dirX: direction.dx,
    dirZ: direction.dz,
    legStart: false,
    rightX: -direction.dz,
    rightZ: direction.dx,
    s,
    segmentIndex: a.segmentIndex,
    shared: a.shared,
    x: a.x + (b.x - a.x) * t,
    z: a.z + (b.z - a.z) * t,
  };
}

export function distanceToSamples(point: LocalPoint, samples: RoadSample[]) {
  let best = Number.POSITIVE_INFINITY;

  for (const sample of samples) {
    const dx = sample.x - point.x;
    const dz = sample.z - point.z;
    const distanceSquared = dx * dx + dz * dz;

    if (distanceSquared < best) {
      best = distanceSquared;
    }
  }

  return Math.sqrt(best);
}
