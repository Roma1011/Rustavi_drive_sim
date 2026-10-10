import type { GeoPoint, LocalPoint } from './route-types';

export const EARTH_RADIUS_METERS = 6378137;
const DEG_TO_RAD = Math.PI / 180;
const RAD_TO_DEG = 180 / Math.PI;

export interface LocalProjection {
  origin: GeoPoint;
  toGeo: (x: number, z: number) => GeoPoint;
  toLocal: (lon: number, lat: number) => LocalPoint;
}

/** GeoJSON mandates WGS84 longitude/latitude; anything outside those ranges is not geographic. */
export function isGeographicCoordinate(lon: number, lat: number) {
  return Number.isFinite(lon) && Number.isFinite(lat) && Math.abs(lon) <= 180 && Math.abs(lat) <= 90;
}

/**
 * Equirectangular (local tangent plane) projection centred on `origin`.
 *
 * The simulator only needs metre-accurate geometry over a few kilometres, where the
 * scale error of this projection is well below 0.1 %. Output follows the scene
 * convention: `x` = east, `z` = south (north is negative `z`).
 */
export function createLocalProjection(origin: GeoPoint): LocalProjection {
  const cosOriginLat = Math.cos(origin.lat * DEG_TO_RAD);

  return {
    origin,
    toGeo: (x, z) => ({
      lat: origin.lat - (z / EARTH_RADIUS_METERS) * RAD_TO_DEG,
      lon: origin.lon + (x / (EARTH_RADIUS_METERS * cosOriginLat)) * RAD_TO_DEG,
    }),
    toLocal: (lon, lat) => ({
      x: EARTH_RADIUS_METERS * (lon - origin.lon) * DEG_TO_RAD * cosOriginLat,
      z: -EARTH_RADIUS_METERS * (lat - origin.lat) * DEG_TO_RAD,
    }),
  };
}

/**
 * Converts a compass bearing (degrees clockwise from north) into the simulator's
 * heading angle, where `forward = (sin(heading), 0, cos(heading))`.
 */
export function headingFromDirection(dx: number, dz: number) {
  return Math.atan2(dx, dz);
}
