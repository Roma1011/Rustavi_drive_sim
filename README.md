# Rustavi DriveSim

Browser-based 3D driving simulator for practising B-category practical exam routes in
Rustavi, built on top of the Downtown Driving 3D (Metropolis Drive Simulator) project.

Routes are GeoJSON files in `public/routes`. The app projects the WGS84 coordinates into a
local metre grid, extrudes a textured asphalt road with shoulders and markings along the
route, places the car at the route start, and tracks an exam session (timer, progress,
faults, summary) while you drive. The original city free-drive map is still available.

## Stack

- React 18, Vite 5, TypeScript
- three.js, @react-three/fiber, @react-three/drei
- zustand

No new runtime dependencies were added for the route features.

## Run

```bash
npm install
npm run dev
```


Production build (type check + bundle):

```bash
npm run build
```

There is no lint or unit-test script in this project.

## Route files

```text
public/routes/
  routes.json              # manifest: which route files the app offers
  rustavi-route-1.geojson  # route geometry (source of truth)
```

`routes.json` lists the routes because a browser cannot list a directory:

```json
{
  "routes": [
    {
      "id": "rustavi-route-1",
      "file": "rustavi-route-1.geojson",
      "name": "Rustavi route 1",
      "description": "Optional text shown in the route selector."
    }
  ]
}
```

Each route file must be GeoJSON (FeatureCollection, Feature or bare geometry) with at least
one `LineString` or `MultiLineString` in WGS84 `[longitude, latitude]` order. Empty
LineStrings are skipped and counted. Several non-empty lines are treated as legs in file
order; no road is drawn across the gap between legs.

Optional `Point` features are read as route point features. Their `properties.kind`
(or `type`) is mapped to `traffic_light`, `stop_line`, `sign`, `checkpoint` or `other`;
`properties.name` becomes the label. Signs and lights are rendered as simple pole markers
and stop lines as a transverse marking on the road. They are listed in the HUD but no
traffic-light or stop-line rules are enforced (see Limitations).

If the manifest or a route cannot be fetched or parsed, the app shows an error panel with
the reason. It never falls back to a generated or placeholder route.

### How the route becomes a road

1. Coordinates are projected with an equirectangular local tangent plane centred on the
   route bounding box (`x` = east, `z` = south, `y` = up). Scale error over a few kilometres
   is well under 0.1 %.
2. Vertices that come within 6 m of an earlier, non-adjacent part of the route are snapped
   onto that segment, so a street driven out and back is one carriageway instead of two
   overlapping ribbons. Vertex count and order never change; the original projected
   points are kept for the minimap.
3. Corners get circular fillets (max 8 m radius, limited by the adjacent segment lengths),
   long segments are subdivided to 8 m, and a 7 m asphalt ribbon, 8.3 m shoulder ribbon,
   solid edge lines, a dashed centre line, lane direction arrows, a start line and a
   chequered finish line are extruded along it. Markings are suppressed on retraced
   stretches so they are not drawn twice.
4. Grass ground, roadside trees and lamp posts are generated deterministically from a seed.
   Trees and poles are part of the collision terrain.

All of these parameters live in `src/features/simulator/config/simulator.config.ts`
under `route` and `exam`.

## Controls

- `W / Arrow Up`: accelerate (brakes first when rolling backwards)
- `S / Arrow Down`: brake, then reverse once stopped
- `A / D / Arrow Left / Arrow Right`: steer left / right
- `Space`: brake
- `C`: switch camera (chase, bonnet, driver, rear, overview)
- `R`: reset to the route start (aborts a running exam)
- `H`: toggle controls panel
- `F`: horn
- `Esc`: close menus

Steering convention: positive steering turns the heading clockwise (seen from above), which
is the right-hand side of the car and the right-hand side of the chase camera view. Steering
authority decreases with speed and the yaw rate is capped by a lateral-acceleration limit.
When reversing, the camera stays behind the car so left and right are never mirrored.

## Exam session

- **Routes** button or the pause menu opens the route selector (GeoJSON routes plus the
  city free-drive map).
- **Start exam** resets the car to the route start in the right-hand lane and starts the
  timer. **End exam** stops early. Stopping on the finish line completes the route.
- The HUD shows time, progress along the route, the speed limit (default 60 km/h,
  configurable), fault count and an off-route warning. The minimap draws the imported
  route, the completed portion, start/finish markers and the car heading, with a
  follow / overview toggle.
- Faults recorded: left the route, drove in the oncoming lane, drove against the route
  direction, exceeded the speed limit, collision with an obstacle. The summary lists them
  with time stamps and distance.

## Limitations

- The route file contains only a centreline. The real road network, lane counts, widths,
  junction layouts, kerbs, buildings, traffic lights, road signs and stop lines are not in
  the data and are not fabricated. Supplying `Point` features (see above) or a separate
  road-network GeoJSON would be needed for junction geometry and signal/sign logic.
- Fault thresholds are simulator tolerances, not the official Georgian exam scoring; the
  app reports a fault count, not a pass/fail verdict.
- The road is flat (no elevation data in the file).
- A route that passes within 6 m of itself is merged into one carriageway; parallel
  carriageways further apart are drawn as separate roads.

## Structure

```text
public/
  assets/            audio, city map, car model
  routes/            GeoJSON routes + routes.json manifest
src/
  app/
  entities/
    car/
    environment/     city GLB map (free drive)
    route/           GeoJSON loader, projection, geometry, road builder, RouteWorld
  features/simulator/
    components/      scene, vehicle, HUD, exam panel, route selector, minimaps, overlays
    config/          simulator, route and exam settings
    hooks/           keyboard input
    lib/             physics, camera rig, terrain probes, exam tracker
    state/           simulator, route and exam stores
  shared/
```

