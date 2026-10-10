/**
 * Shared types for routes loaded from `public/routes`.
 *
 * Local coordinates follow the three.js convention used by the simulator:
 * `x` grows towards east, `z` grows towards south (north is `-z`) and `y` is up.
 */

export type RouteFeatureKind = 'traffic_light' | 'stop_line' | 'sign' | 'checkpoint' | 'other';

export interface RouteManifestEntry {
  description?: string;
  file: string;
  id: string;
  name: string;
}

export interface GeoPoint {
  lat: number;
  lon: number;
}

export interface LocalPoint {
  x: number;
  z: number;
}

export interface RouteVertex extends LocalPoint {
  lat: number;
  lon: number;
}

export interface RouteLeg {
  /** Index of the source feature inside the GeoJSON `features` array. */
  featureIndex: number;
  /** Exclusive end index into `centerline`. */
  endIndex: number;
  /** Inclusive start index into `centerline`. */
  startIndex: number;
}

export interface RoutePointFeature {
  kind: RouteFeatureKind;
  label: string;
  position: RouteVertex;
  properties: Record<string, unknown>;
}

export interface RouteBounds {
  maxX: number;
  maxZ: number;
  minX: number;
  minZ: number;
}

export interface RouteParseSummary {
  emptyLineFeatures: number;
  ignoredFeatures: number;
  lineFeatures: number;
  pointFeatures: number;
  totalFeatures: number;
}

export interface LoadedRoute {
  bounds: RouteBounds;
  /** Original route vertices projected to local metres. Point order is preserved. */
  centerline: RouteVertex[];
  /** Cumulative distance (metres) along `roadLine`, one entry per vertex. */
  cumulativeDistance: number[];
  description?: string;
  file: string;
  /** `gapSegments[i]` is true when segment `i -> i + 1` joins two separate legs. */
  gapSegments: boolean[];
  id: string;
  legs: RouteLeg[];
  /** Sum of all non-gap segment lengths in metres. */
  lengthMeters: number;
  name: string;
  origin: GeoPoint;
  pointFeatures: RoutePointFeature[];
  /**
   * Drivable centreline used for the road mesh and route tracking. Same length and
   * order as `centerline`; vertices that retrace an earlier part of the route are
   * snapped onto that earlier segment so both passes share one carriageway.
   */
  roadLine: LocalPoint[];
  /** `sharedSegments[i]` is true when segment `i -> i + 1` retraces an earlier segment. */
  sharedSegments: boolean[];
  summary: RouteParseSummary;
  url: string;
}
