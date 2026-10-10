import { createLocalProjection, isGeographicCoordinate } from './geo-projection';
import { computeCumulativeDistance, mergeRevisitedVertices } from './route-geometry';
import type {
  LoadedRoute,
  RouteBounds,
  RouteFeatureKind,
  RouteLeg,
  RouteManifestEntry,
  RouteParseSummary,
  RoutePointFeature,
  RouteVertex,
} from './route-types';

export const ROUTES_DIRECTORY = 'routes';
export const ROUTE_MANIFEST_FILE = 'routes.json';

export interface RouteParseOptions {
  /** Vertices closer than this (metres) to an earlier part of the route share its carriageway. */
  mergeDistance: number;
}

export class RouteLoadError extends Error {
  readonly cause?: unknown;

  constructor(message: string, cause?: unknown) {
    super(message);
    this.name = 'RouteLoadError';
    this.cause = cause;
  }
}

type JsonRecord = Record<string, unknown>;

interface ParsedLine {
  featureIndex: number;
  vertices: RouteVertex[];
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function resolveRouteUrl(fileName: string) {
  return `${import.meta.env.BASE_URL}${ROUTES_DIRECTORY}/${fileName}`;
}

export function describeError(error: unknown) {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}

async function fetchJson(url: string, label: string): Promise<unknown> {
  let response: Response;

  try {
    response = await fetch(url, { cache: 'no-cache' });
  } catch (error) {
    throw new RouteLoadError(`${label} could not be fetched from ${url}: ${describeError(error)}`, error);
  }

  if (!response.ok) {
    throw new RouteLoadError(`${label} request to ${url} failed with HTTP ${response.status}.`);
  }

  // Dev servers and static hosts often answer a missing file with the app's index.html.
  const contentType = response.headers.get('content-type') ?? '';

  if (contentType.includes('text/html')) {
    throw new RouteLoadError(
      `${label} was not found at ${url} (the server returned an HTML page instead of JSON). Check the file name in public/${ROUTES_DIRECTORY}/${ROUTE_MANIFEST_FILE}.`,
    );
  }

  try {
    return await response.json();
  } catch (error) {
    throw new RouteLoadError(`${label} at ${url} is not valid JSON: ${describeError(error)}`, error);
  }
}

function slugify(value: string) {
  return value
    .replace(/\.(geo)?json$/i, '')
    .replace(/[^a-z0-9]+/gi, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase();
}

function labelFromFileName(fileName: string) {
  return fileName
    .replace(/\.(geo)?json$/i, '')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

function normalizeManifestEntry(raw: unknown, index: number): RouteManifestEntry {
  if (typeof raw === 'string') {
    return { file: raw, id: slugify(raw), name: labelFromFileName(raw) };
  }

  if (!isRecord(raw) || typeof raw.file !== 'string' || raw.file.trim() === '') {
    throw new RouteLoadError(`Route manifest entry #${index + 1} must be a file name or an object with a "file" field.`);
  }

  const file = raw.file.trim();

  if (file.includes('/') || file.includes('\\') || file.includes('..')) {
    throw new RouteLoadError(`Route manifest entry "${file}" must be a plain file name inside public/${ROUTES_DIRECTORY}.`);
  }

  return {
    description: typeof raw.description === 'string' ? raw.description : undefined,
    file,
    id: typeof raw.id === 'string' && raw.id.trim() !== '' ? raw.id.trim() : slugify(file),
    name: typeof raw.name === 'string' && raw.name.trim() !== '' ? raw.name.trim() : labelFromFileName(file),
  };
}

/**
 * Reads `public/routes/routes.json`. Browsers cannot list a directory, so the manifest is the
 * list of route files the app offers for selection.
 */
export async function loadRouteManifest(): Promise<RouteManifestEntry[]> {
  const url = resolveRouteUrl(ROUTE_MANIFEST_FILE);
  const json = await fetchJson(url, 'Route manifest');
  const rawEntries = Array.isArray(json) ? json : isRecord(json) && Array.isArray(json.routes) ? json.routes : null;

  if (!rawEntries) {
    throw new RouteLoadError(`Route manifest at ${url} must be an array or an object with a "routes" array.`);
  }

  const entries = rawEntries.map(normalizeManifestEntry);
  const seen = new Set<string>();

  for (const entry of entries) {
    if (seen.has(entry.id)) {
      throw new RouteLoadError(`Route manifest contains duplicate route id "${entry.id}".`);
    }

    seen.add(entry.id);
  }

  if (entries.length === 0) {
    throw new RouteLoadError(`Route manifest at ${url} lists no routes.`);
  }

  return entries;
}

function readPosition(raw: unknown, context: string): [number, number] {
  if (!Array.isArray(raw) || raw.length < 2 || typeof raw[0] !== 'number' || typeof raw[1] !== 'number') {
    throw new RouteLoadError(`${context}: each coordinate must be a [longitude, latitude] number pair.`);
  }

  const lon = raw[0];
  const lat = raw[1];

  if (!isGeographicCoordinate(lon, lat)) {
    throw new RouteLoadError(
      `${context}: coordinate [${lon}, ${lat}] is outside WGS84 longitude/latitude ranges. Only geographic GeoJSON is supported.`,
    );
  }

  return [lon, lat];
}

function readLineCoordinates(raw: unknown, context: string): Array<[number, number]> {
  if (!Array.isArray(raw)) {
    throw new RouteLoadError(`${context}: LineString coordinates must be an array.`);
  }

  return raw.map((position, index) => readPosition(position, `${context} point ${index + 1}`));
}

const POINT_KIND_ALIASES: Record<string, RouteFeatureKind> = {
  checkpoint: 'checkpoint',
  light: 'traffic_light',
  sign: 'sign',
  signal: 'traffic_light',
  stop: 'stop_line',
  'stop-line': 'stop_line',
  stop_line: 'stop_line',
  stopline: 'stop_line',
  'traffic-light': 'traffic_light',
  traffic_light: 'traffic_light',
  traffic_signals: 'traffic_light',
  trafficlight: 'traffic_light',
};

function readPointKind(properties: JsonRecord): RouteFeatureKind {
  const candidates = [properties.kind, properties.type, properties.highway, properties.category];

  for (const candidate of candidates) {
    if (typeof candidate === 'string') {
      const normalized = candidate.trim().toLowerCase();

      if (normalized in POINT_KIND_ALIASES) {
        return POINT_KIND_ALIASES[normalized];
      }
    }
  }

  return 'other';
}

function readPointLabel(properties: JsonRecord, fallback: string) {
  const candidates = [properties.name, properties.label, properties.title, properties.ref];

  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.trim() !== '') {
      return candidate.trim();
    }
  }

  return fallback;
}

interface RawGeometryEntry {
  featureIndex: number;
  geometry: JsonRecord;
  properties: JsonRecord;
}

function collectGeometries(json: unknown): RawGeometryEntry[] {
  if (!isRecord(json) || typeof json.type !== 'string') {
    throw new RouteLoadError('Route file is not a GeoJSON object (missing "type").');
  }

  if (json.type === 'FeatureCollection') {
    if (!Array.isArray(json.features)) {
      throw new RouteLoadError('GeoJSON FeatureCollection has no "features" array.');
    }

    return json.features.map((feature, featureIndex) => {
      if (!isRecord(feature) || feature.type !== 'Feature') {
        throw new RouteLoadError(`Feature #${featureIndex + 1} is not a GeoJSON Feature.`);
      }

      const geometry = isRecord(feature.geometry) ? feature.geometry : { type: 'Empty' };
      const properties = isRecord(feature.properties) ? feature.properties : {};

      return { featureIndex, geometry, properties };
    });
  }

  if (json.type === 'Feature') {
    const geometry = isRecord(json.geometry) ? json.geometry : { type: 'Empty' };
    const properties = isRecord(json.properties) ? json.properties : {};
    return [{ featureIndex: 0, geometry, properties }];
  }

  return [{ featureIndex: 0, geometry: json, properties: {} }];
}

/**
 * Parses a GeoJSON document into a {@link LoadedRoute}. Pure and synchronous so it can be
 * exercised without a browser.
 */
export function parseRouteGeoJson(
  entry: RouteManifestEntry,
  url: string,
  json: unknown,
  options: RouteParseOptions,
): LoadedRoute {
  const geometries = collectGeometries(json);
  const rawLines: Array<{ coordinates: Array<[number, number]>; featureIndex: number }> = [];
  const rawPoints: Array<{ featureIndex: number; position: [number, number]; properties: JsonRecord }> = [];
  const summary: RouteParseSummary = {
    emptyLineFeatures: 0,
    ignoredFeatures: 0,
    lineFeatures: 0,
    pointFeatures: 0,
    totalFeatures: geometries.length,
  };

  for (const { featureIndex, geometry, properties } of geometries) {
    const context = `Feature #${featureIndex + 1}`;

    switch (geometry.type) {
      case 'LineString': {
        const coordinates = readLineCoordinates(geometry.coordinates, context);

        if (coordinates.length < 2) {
          summary.emptyLineFeatures += 1;
          break;
        }

        summary.lineFeatures += 1;
        rawLines.push({ coordinates, featureIndex });
        break;
      }
      case 'MultiLineString': {
        if (!Array.isArray(geometry.coordinates)) {
          throw new RouteLoadError(`${context}: MultiLineString coordinates must be an array.`);
        }

        let addedAny = false;

        geometry.coordinates.forEach((line, lineIndex) => {
          const coordinates = readLineCoordinates(line, `${context} line ${lineIndex + 1}`);

          if (coordinates.length >= 2) {
            addedAny = true;
            rawLines.push({ coordinates, featureIndex });
          }
        });

        if (addedAny) {
          summary.lineFeatures += 1;
        } else {
          summary.emptyLineFeatures += 1;
        }

        break;
      }
      case 'Point': {
        summary.pointFeatures += 1;
        rawPoints.push({ featureIndex, position: readPosition(geometry.coordinates, context), properties });
        break;
      }
      default:
        summary.ignoredFeatures += 1;
        break;
    }
  }

  if (rawLines.length === 0) {
    throw new RouteLoadError(
      `${entry.file} contains no LineString with at least two points (${summary.totalFeatures} features, ${summary.emptyLineFeatures} empty).`,
    );
  }

  let minLon = Number.POSITIVE_INFINITY;
  let maxLon = Number.NEGATIVE_INFINITY;
  let minLat = Number.POSITIVE_INFINITY;
  let maxLat = Number.NEGATIVE_INFINITY;

  for (const line of rawLines) {
    for (const [lon, lat] of line.coordinates) {
      minLon = Math.min(minLon, lon);
      maxLon = Math.max(maxLon, lon);
      minLat = Math.min(minLat, lat);
      maxLat = Math.max(maxLat, lat);
    }
  }

  const origin = { lat: (minLat + maxLat) / 2, lon: (minLon + maxLon) / 2 };
  const projection = createLocalProjection(origin);
  const toVertex = ([lon, lat]: [number, number]): RouteVertex => ({ ...projection.toLocal(lon, lat), lat, lon });

  const parsedLines: ParsedLine[] = rawLines.map((line) => ({
    featureIndex: line.featureIndex,
    vertices: line.coordinates.map(toVertex),
  }));

  const centerline: RouteVertex[] = [];
  const legs: RouteLeg[] = [];

  for (const line of parsedLines) {
    const startIndex = centerline.length;

    for (const vertex of line.vertices) {
      const previous = centerline[centerline.length - 1];

      if (previous && centerline.length > startIndex && Math.hypot(previous.x - vertex.x, previous.z - vertex.z) < 0.01) {
        continue;
      }

      centerline.push(vertex);
    }

    if (centerline.length - startIndex < 2) {
      centerline.length = startIndex;
      continue;
    }

    legs.push({ endIndex: centerline.length, featureIndex: line.featureIndex, startIndex });
  }

  if (centerline.length < 2) {
    throw new RouteLoadError(`${entry.file} has no usable route geometry after removing duplicate points.`);
  }

  const gapSegments = new Array<boolean>(centerline.length - 1).fill(false);

  for (const leg of legs) {
    if (leg.startIndex > 0) {
      gapSegments[leg.startIndex - 1] = true;
    }
  }

  const merged = mergeRevisitedVertices(centerline, gapSegments, options.mergeDistance);
  const cumulativeDistance = computeCumulativeDistance(merged.points);
  let lengthMeters = 0;

  for (let segment = 0; segment < gapSegments.length; segment += 1) {
    if (!gapSegments[segment]) {
      lengthMeters += cumulativeDistance[segment + 1] - cumulativeDistance[segment];
    }
  }

  const bounds: RouteBounds = {
    maxX: Number.NEGATIVE_INFINITY,
    maxZ: Number.NEGATIVE_INFINITY,
    minX: Number.POSITIVE_INFINITY,
    minZ: Number.POSITIVE_INFINITY,
  };

  for (const vertex of centerline) {
    bounds.minX = Math.min(bounds.minX, vertex.x);
    bounds.maxX = Math.max(bounds.maxX, vertex.x);
    bounds.minZ = Math.min(bounds.minZ, vertex.z);
    bounds.maxZ = Math.max(bounds.maxZ, vertex.z);
  }

  const pointFeatures: RoutePointFeature[] = rawPoints.map((point) => {
    const kind = readPointKind(point.properties);

    return {
      kind,
      label: readPointLabel(point.properties, kind.replace('_', ' ')),
      position: toVertex(point.position),
      properties: point.properties,
    };
  });

  return {
    bounds,
    centerline,
    cumulativeDistance,
    description: entry.description,
    file: entry.file,
    gapSegments,
    id: entry.id,
    legs,
    lengthMeters,
    name: entry.name,
    origin,
    pointFeatures,
    roadLine: merged.points,
    sharedSegments: merged.sharedSegments,
    summary,
    url,
  };
}

export async function loadRoute(entry: RouteManifestEntry, options: RouteParseOptions): Promise<LoadedRoute> {
  const url = resolveRouteUrl(entry.file);
  const json = await fetchJson(url, `Route "${entry.name}"`);

  try {
    return parseRouteGeoJson(entry, url, json, options);
  } catch (error) {
    if (error instanceof RouteLoadError) {
      throw error;
    }

    throw new RouteLoadError(`Route "${entry.name}" could not be parsed: ${describeError(error)}`, error);
  }
}
