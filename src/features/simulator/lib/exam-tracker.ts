import { projectOntoSegment } from '../../../entities/route/route-geometry';
import type { LoadedRoute, LocalPoint } from '../../../entities/route/route-types';
import type { ExamConfig } from '../config/simulator.config';

export type TrackerEventKind = 'collision' | 'completed' | 'off_route' | 'speeding' | 'wrong_lane' | 'wrong_way';

export interface TrackableRoute {
  cumulative: number[];
  gapSegments: boolean[];
  lengthMeters: number;
  points: LocalPoint[];
}

export interface TrackerInput {
  /** True on frames where the vehicle hit a solid obstacle while moving. */
  collided: boolean;
  delta: number;
  heading: number;
  speedMps: number;
  x: number;
  z: number;
}

export interface TrackerState {
  /** Cosine of the angle between the vehicle heading and the route direction. */
  alongDirection: number;
  distanceToRoute: number;
  elapsedSeconds: number;
  lastCollisionAt: number;
  /** Signed lateral offset from the centreline in metres; positive is right of travel. */
  lateralMeters: number;
  offRouteFlagged: boolean;
  offRouteTimer: number;
  progressMeters: number;
  segmentIndex: number;
  speedingFlagged: boolean;
  speedingTimer: number;
  wrongLaneFlagged: boolean;
  wrongLaneTimer: number;
  wrongWayFlagged: boolean;
  wrongWayTimer: number;
}

const LOST_DISTANCE_METERS = 30;
const REJOIN_DISTANCE_METERS = 10;

export function createTrackerState(): TrackerState {
  return {
    alongDirection: 1,
    distanceToRoute: 0,
    elapsedSeconds: 0,
    lastCollisionAt: Number.NEGATIVE_INFINITY,
    lateralMeters: 0,
    offRouteFlagged: false,
    offRouteTimer: 0,
    progressMeters: 0,
    segmentIndex: 0,
    speedingFlagged: false,
    speedingTimer: 0,
    wrongLaneFlagged: false,
    wrongLaneTimer: 0,
    wrongWayFlagged: false,
    wrongWayTimer: 0,
  };
}

export function resetTrackerState(state: TrackerState) {
  Object.assign(state, createTrackerState());
}

export function createTrackableRoute(route: LoadedRoute): TrackableRoute {
  return {
    cumulative: route.cumulativeDistance,
    gapSegments: route.gapSegments,
    lengthMeters: route.lengthMeters,
    points: route.roadLine,
  };
}

interface SegmentMatch {
  distance: number;
  score: number;
  segment: number;
  t: number;
  x: number;
  z: number;
}

function matchSegments(route: TrackableRoute, point: LocalPoint, from: number, to: number, currentSegment: number) {
  let best: SegmentMatch | null = null;

  for (let segment = from; segment <= to; segment += 1) {
    if (route.gapSegments[segment]) {
      continue;
    }

    const projection = projectOntoSegment(point, route.points[segment], route.points[segment + 1]);
    // Slight bias against sliding back onto a previous segment when distances tie.
    const score = projection.distance + (segment < currentSegment ? 0.5 : 0);

    if (!best || score < best.score) {
      best = { distance: projection.distance, score, segment, t: projection.t, x: projection.x, z: projection.z };
    }
  }

  return best;
}

/**
 * Projects the vehicle onto the route using a sliding window of segments, so a route that
 * revisits the same street keeps tracking the pass the driver is actually on.
 */
function locateOnRoute(state: TrackerState, route: TrackableRoute, point: LocalPoint, config: ExamConfig) {
  const segmentCount = route.points.length - 1;

  if (segmentCount < 1) {
    return null;
  }

  const current = Math.min(state.segmentIndex, segmentCount - 1);
  const from = Math.max(0, current - 2);
  let to = Math.min(segmentCount - 1, current + 3);

  while (to < segmentCount - 1 && route.cumulative[to] - route.cumulative[current] < config.trackerLookaheadMeters) {
    to += 1;
  }

  let match = matchSegments(route, point, from, to, current);

  if (match && match.distance > LOST_DISTANCE_METERS && to < segmentCount - 1) {
    const rejoin = matchSegments(route, point, to + 1, segmentCount - 1, current);

    if (rejoin && rejoin.distance <= REJOIN_DISTANCE_METERS) {
      match = rejoin;
    }
  }

  return match;
}

function updateEpisode(
  active: boolean,
  timer: number,
  flagged: boolean,
  delta: number,
  threshold: number,
): { fire: boolean; flagged: boolean; timer: number } {
  if (!active) {
    return { fire: false, flagged: false, timer: 0 };
  }

  const nextTimer = timer + delta;

  if (!flagged && nextTimer >= threshold) {
    return { fire: true, flagged: true, timer: nextTimer };
  }

  return { fire: false, flagged, timer: nextTimer };
}

export function updateTracker(
  state: TrackerState,
  route: TrackableRoute,
  input: TrackerInput,
  config: ExamConfig,
): TrackerEventKind[] {
  const events: TrackerEventKind[] = [];
  state.elapsedSeconds += input.delta;

  const match = locateOnRoute(state, route, input, config);

  if (!match) {
    return events;
  }

  const a = route.points[match.segment];
  const b = route.points[match.segment + 1];
  const segmentLength = Math.hypot(b.x - a.x, b.z - a.z);
  const dirX = segmentLength > 1e-6 ? (b.x - a.x) / segmentLength : 0;
  const dirZ = segmentLength > 1e-6 ? (b.z - a.z) / segmentLength : 1;
  const rightX = -dirZ;
  const rightZ = dirX;
  const forwardX = Math.sin(input.heading);
  const forwardZ = Math.cos(input.heading);

  state.segmentIndex = match.segment;
  state.distanceToRoute = match.distance;
  state.lateralMeters = (input.x - match.x) * rightX + (input.z - match.z) * rightZ;
  state.alongDirection = forwardX * dirX + forwardZ * dirZ;

  const onRoute = match.distance <= config.offRouteDistance;

  if (onRoute) {
    state.progressMeters = Math.max(state.progressMeters, route.cumulative[match.segment] + match.t * segmentLength);
  }

  const speedKph = Math.abs(input.speedMps) * 3.6;
  const movingForward = input.speedMps > 1;

  const offRoute = updateEpisode(
    match.distance > config.offRouteDistance,
    state.offRouteTimer,
    state.offRouteFlagged,
    input.delta,
    config.offRouteSeconds,
  );
  state.offRouteTimer = offRoute.timer;
  state.offRouteFlagged = offRoute.flagged && match.distance > config.offRouteDistance * 0.6;

  if (offRoute.fire) {
    events.push('off_route');
  }

  const speeding = updateEpisode(
    speedKph > config.speedLimitKph + config.speedingToleranceKph,
    state.speedingTimer,
    state.speedingFlagged,
    input.delta,
    config.speedingSeconds,
  );
  state.speedingTimer = speeding.timer;
  state.speedingFlagged = speeding.flagged && speedKph > config.speedLimitKph;

  if (speeding.fire) {
    events.push('speeding');
  }

  const wrongLane = updateEpisode(
    onRoute && movingForward && state.alongDirection > 0.3 && state.lateralMeters < -config.wrongLaneOffset,
    state.wrongLaneTimer,
    state.wrongLaneFlagged,
    input.delta,
    config.wrongLaneSeconds,
  );
  state.wrongLaneTimer = wrongLane.timer;
  state.wrongLaneFlagged = wrongLane.flagged && state.lateralMeters < -0.3;

  if (wrongLane.fire) {
    events.push('wrong_lane');
  }

  const wrongWay = updateEpisode(
    onRoute && movingForward && state.alongDirection < -0.5,
    state.wrongWayTimer,
    state.wrongWayFlagged,
    input.delta,
    config.wrongWaySeconds,
  );
  state.wrongWayTimer = wrongWay.timer;
  state.wrongWayFlagged = wrongWay.flagged && state.alongDirection < 0;

  if (wrongWay.fire) {
    events.push('wrong_way');
  }

  if (input.collided && state.elapsedSeconds - state.lastCollisionAt > config.collisionCooldownSeconds) {
    state.lastCollisionAt = state.elapsedSeconds;
    events.push('collision');
  }

  if (
    onRoute &&
    state.progressMeters >= route.lengthMeters - config.finishDistance &&
    speedKph <= config.finishSpeedKph
  ) {
    events.push('completed');
  }

  return events;
}
