import { useEffect, useRef, useState } from 'react';
import type { LoadedRoute, RouteFeatureKind } from '../../../entities/route/route-types';
import { useExamStore } from '../state/exam.store';
import { useRouteStore } from '../state/route.store';
import { useSimulatorStore } from '../state/simulator.store';

const MAP_SIZE = 174;
const FOLLOW_SPAN_METERS = 360;
const OVERVIEW_PADDING = 16;

interface MapTransform {
  centerX: number;
  centerZ: number;
  scale: number;
}

const POINT_COLORS: Record<RouteFeatureKind, string> = {
  checkpoint: '#ffca67',
  other: '#9aa5b1',
  sign: '#4f8dff',
  stop_line: '#f4f4ee',
  traffic_light: '#ff5a5a',
};

function computeTransform(route: LoadedRoute, overview: boolean, playerX: number, playerZ: number): MapTransform {
  if (!overview) {
    return { centerX: playerX, centerZ: playerZ, scale: MAP_SIZE / FOLLOW_SPAN_METERS };
  }

  const width = Math.max(route.bounds.maxX - route.bounds.minX, 1);
  const depth = Math.max(route.bounds.maxZ - route.bounds.minZ, 1);
  const scale = (MAP_SIZE - OVERVIEW_PADDING * 2) / Math.max(width, depth);

  return {
    centerX: (route.bounds.minX + route.bounds.maxX) / 2,
    centerZ: (route.bounds.minZ + route.bounds.maxZ) / 2,
    scale,
  };
}

function toCanvas(transform: MapTransform, x: number, z: number): [number, number] {
  // North is -z in the scene, so smaller z must be drawn higher up (smaller canvas y).
  return [MAP_SIZE / 2 + (x - transform.centerX) * transform.scale, MAP_SIZE / 2 + (z - transform.centerZ) * transform.scale];
}

function strokeRoute(
  context: CanvasRenderingContext2D,
  route: LoadedRoute,
  transform: MapTransform,
  untilMeters: number | null,
) {
  context.beginPath();

  for (let index = 0; index < route.centerline.length; index += 1) {
    const vertex = route.centerline[index];
    const [px, py] = toCanvas(transform, vertex.x, vertex.z);

    if (index === 0 || route.gapSegments[index - 1]) {
      context.moveTo(px, py);
      continue;
    }

    if (untilMeters !== null && route.cumulativeDistance[index] > untilMeters) {
      const previous = route.centerline[index - 1];
      const segmentLength = route.cumulativeDistance[index] - route.cumulativeDistance[index - 1];
      const t = segmentLength > 0 ? (untilMeters - route.cumulativeDistance[index - 1]) / segmentLength : 0;
      const [ex, ey] = toCanvas(
        transform,
        previous.x + (vertex.x - previous.x) * Math.max(0, Math.min(1, t)),
        previous.z + (vertex.z - previous.z) * Math.max(0, Math.min(1, t)),
      );
      context.lineTo(ex, ey);
      break;
    }

    context.lineTo(px, py);
  }

  context.stroke();
}

function drawMarker(context: CanvasRenderingContext2D, x: number, y: number, fill: string, stroke: string, radius: number) {
  context.beginPath();
  context.arc(x, y, radius, 0, Math.PI * 2);
  context.fillStyle = fill;
  context.fill();
  context.lineWidth = 1.5;
  context.strokeStyle = stroke;
  context.stroke();
}

function drawMap(context: CanvasRenderingContext2D, route: LoadedRoute, overview: boolean) {
  const { playerPose } = useSimulatorStore.getState();
  const { progressMeters } = useExamStore.getState();
  const transform = computeTransform(route, overview, playerPose.x, playerPose.z);

  context.clearRect(0, 0, MAP_SIZE, MAP_SIZE);

  context.lineCap = 'round';
  context.lineJoin = 'round';
  context.lineWidth = overview ? 2.2 : 3.4;
  context.strokeStyle = '#ffca67';
  strokeRoute(context, route, transform, null);

  if (progressMeters > 0) {
    context.strokeStyle = '#6fa6d6';
    strokeRoute(context, route, transform, progressMeters);
  }

  for (const feature of route.pointFeatures) {
    const [px, py] = toCanvas(transform, feature.position.x, feature.position.z);
    context.fillStyle = POINT_COLORS[feature.kind];
    context.fillRect(px - 2.5, py - 2.5, 5, 5);
  }

  const start = route.centerline[0];
  const finish = route.centerline[route.centerline.length - 1];
  const [sx, sy] = toCanvas(transform, start.x, start.z);
  const [fx, fy] = toCanvas(transform, finish.x, finish.z);
  drawMarker(context, sx, sy, '#2cb67d', '#0b1620', overview ? 3.2 : 4.2);
  drawMarker(context, fx, fy, '#f4f4ee', '#d8383f', overview ? 3.2 : 4.2);

  const [px, py] = toCanvas(transform, playerPose.x, playerPose.z);
  // forward = (sin(heading), cos(heading)) in (x, z); canvas y grows with z, so the angle maps directly.
  const angle = Math.atan2(Math.cos(playerPose.heading), Math.sin(playerPose.heading));
  context.save();
  context.translate(px, py);
  context.rotate(angle);
  context.beginPath();
  context.moveTo(9, 0);
  context.lineTo(-6, 5.5);
  context.lineTo(-3.5, 0);
  context.lineTo(-6, -5.5);
  context.closePath();
  context.fillStyle = '#ffffff';
  context.fill();
  context.lineWidth = 1.5;
  context.strokeStyle = '#58beff';
  context.stroke();
  context.restore();

  if (!overview) {
    const barLength = 100 * transform.scale;
    context.strokeStyle = 'rgba(255, 255, 255, 0.7)';
    context.lineWidth = 2;
    context.beginPath();
    context.moveTo(10, MAP_SIZE - 10);
    context.lineTo(10 + barLength, MAP_SIZE - 10);
    context.stroke();
    context.fillStyle = 'rgba(255, 255, 255, 0.7)';
    context.font = '9px sans-serif';
    context.fillText('100 m', 12, MAP_SIZE - 14);
  }
}

export function RouteMiniMap() {
  const route = useRouteStore((state) => state.route);
  const progressMeters = useExamStore((state) => state.progressMeters);
  const routeLengthMeters = useExamStore((state) => state.routeLengthMeters);
  const [overview, setOverview] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;

    if (!canvas || !route) {
      return;
    }

    const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = MAP_SIZE * pixelRatio;
    canvas.height = MAP_SIZE * pixelRatio;
    const context = canvas.getContext('2d');

    if (!context) {
      return;
    }

    let frame = 0;

    const render = () => {
      context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
      drawMap(context, route, overview);
      frame = window.requestAnimationFrame(render);
    };

    frame = window.requestAnimationFrame(render);

    return () => {
      window.cancelAnimationFrame(frame);
    };
  }, [overview, route]);

  if (!route) {
    return null;
  }

  const lengthKm = (routeLengthMeters / 1000).toFixed(1);
  const progressKm = (Math.min(progressMeters, routeLengthMeters) / 1000).toFixed(1);

  return (
    <section className="mini-map panel" aria-label="Route minimap">
      <div className="mini-map__topline">
        <p className="eyebrow">Route Map</p>
        <span>{overview ? 'Overview' : `${FOLLOW_SPAN_METERS}m view`}</span>
      </div>

      <div className="mini-map__frame route-mini-map__frame">
        <canvas ref={canvasRef} className="route-mini-map__canvas" />
        <div className="mini-map__overlay" aria-hidden="true">
          <div className="mini-map__north">N</div>
        </div>
      </div>

      <div className="mini-map__footer">
        <strong>
          {progressKm} / {lengthKm} km
        </strong>
        <button
          type="button"
          className="route-mini-map__toggle"
          onClick={() => setOverview((value) => !value)}
          aria-pressed={overview}
        >
          {overview ? 'Follow' : 'Overview'}
        </button>
      </div>
    </section>
  );
}
