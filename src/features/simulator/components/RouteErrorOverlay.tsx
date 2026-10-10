import { useRouteStore } from '../state/route.store';

/**
 * Full-screen error panel shown when the route manifest or the selected route file cannot be
 * loaded or parsed. The simulator never substitutes a fake route; the user picks another
 * route, retries, or falls back to the city free-drive map.
 */
export function RouteErrorOverlay() {
  const manifestError = useRouteStore((state) => state.manifestError);
  const manifestStatus = useRouteStore((state) => state.manifestStatus);
  const routeError = useRouteStore((state) => state.routeError);
  const routeStatus = useRouteStore((state) => state.routeStatus);
  const selectedRouteId = useRouteStore((state) => state.selectedRouteId);
  const worldMode = useRouteStore((state) => state.worldMode);
  const retry = useRouteStore((state) => state.retry);
  const selectCity = useRouteStore((state) => state.selectCity);
  const setRouteSelectorVisible = useRouteStore((state) => state.setRouteSelectorVisible);
  const routeSelectorVisible = useRouteStore((state) => state.routeSelectorVisible);

  const manifestFailed = manifestStatus === 'error';
  const routeFailed = worldMode === 'route' && routeStatus === 'error';

  if ((!manifestFailed && !routeFailed) || routeSelectorVisible) {
    return null;
  }

  return (
    <div className="route-error" role="alertdialog" aria-labelledby="route-error-title">
      <div className="route-error__panel panel">
        <p className="eyebrow">Route unavailable</p>
        <h2 id="route-error-title">{manifestFailed ? 'The route list could not be loaded' : 'The route could not be loaded'}</h2>
        {!manifestFailed && selectedRouteId ? <span className="route-error__route">Route id: {selectedRouteId}</span> : null}
        <pre className="route-error__message">{manifestFailed ? manifestError : routeError}</pre>
        <p className="route-error__hint">
          Route files live in <code>public/routes</code> and are listed in <code>public/routes/routes.json</code>. Each
          file must be GeoJSON with at least one LineString in WGS84 longitude/latitude.
        </p>
        <div className="route-error__actions">
          <button type="button" className="exam-panel__button exam-panel__button--primary" onClick={() => void retry()}>
            Retry
          </button>
          {!manifestFailed ? (
            <button type="button" className="exam-panel__button" onClick={() => setRouteSelectorVisible(true)}>
              Choose another route
            </button>
          ) : null}
          <button type="button" className="exam-panel__button" onClick={selectCity}>
            Free drive in city
          </button>
        </div>
      </div>
    </div>
  );
}
