import { useEffect } from 'react';
import { useRouteStore } from '../state/route.store';

export function RouteSelector() {
  const manifest = useRouteStore((state) => state.manifest);
  const manifestError = useRouteStore((state) => state.manifestError);
  const manifestStatus = useRouteStore((state) => state.manifestStatus);
  const routeSelectorVisible = useRouteStore((state) => state.routeSelectorVisible);
  const routeStatus = useRouteStore((state) => state.routeStatus);
  const selectedRouteId = useRouteStore((state) => state.selectedRouteId);
  const worldMode = useRouteStore((state) => state.worldMode);
  const initialize = useRouteStore((state) => state.initialize);
  const selectCity = useRouteStore((state) => state.selectCity);
  const selectRoute = useRouteStore((state) => state.selectRoute);
  const setRouteSelectorVisible = useRouteStore((state) => state.setRouteSelectorVisible);

  useEffect(() => {
    if (!routeSelectorVisible) {
      return;
    }

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setRouteSelectorVisible(false);
      }
    };

    window.addEventListener('keydown', handleEscape);

    return () => {
      window.removeEventListener('keydown', handleEscape);
    };
  }, [routeSelectorVisible, setRouteSelectorVisible]);

  if (!routeSelectorVisible) {
    return null;
  }

  return (
    <div className="route-selector" role="dialog" aria-modal="true" aria-labelledby="route-selector-title">
      <div className="route-selector__panel panel">
        <div className="route-selector__header">
          <div>
            <p className="eyebrow">Rustavi DriveSim</p>
            <h2 id="route-selector-title">Choose a route</h2>
            <span className="route-selector__hint">Routes are read from public/routes/routes.json</span>
          </div>
          <button type="button" className="settings-panel__close" onClick={() => setRouteSelectorVisible(false)}>
            Close
          </button>
        </div>

        {manifestStatus === 'loading' ? <p className="route-selector__status">Loading route list…</p> : null}

        {manifestStatus === 'error' ? (
          <div className="route-selector__error">
            <strong>Route list unavailable</strong>
            <span>{manifestError}</span>
            <button type="button" className="exam-panel__button" onClick={() => void initialize()}>
              Retry
            </button>
          </div>
        ) : null}

        <div className="route-selector__list">
          {manifest.map((entry) => {
            const isActive = worldMode === 'route' && entry.id === selectedRouteId;
            const isLoading = isActive && routeStatus === 'loading';

            return (
              <button
                key={entry.id}
                type="button"
                className={`route-card${isActive ? ' is-active' : ''}`}
                onClick={() => void selectRoute(entry.id)}
                disabled={isLoading}
              >
                <span className="route-card__eyebrow">{isLoading ? 'Loading…' : isActive ? 'Selected' : 'GeoJSON route'}</span>
                <strong>{entry.name}</strong>
                {entry.description ? <span className="route-card__description">{entry.description}</span> : null}
                <small>{entry.file}</small>
              </button>
            );
          })}

          <button
            type="button"
            className={`route-card route-card--city${worldMode === 'city' ? ' is-active' : ''}`}
            onClick={selectCity}
          >
            <span className="route-card__eyebrow">{worldMode === 'city' ? 'Selected' : 'Free drive'}</span>
            <strong>Metropolis city</strong>
            <span className="route-card__description">
              The original Downtown Driving 3D city map. No exam route, free roaming only.
            </span>
            <small>assets/map/nfs_undercover_ds_-_metropolis.glb</small>
          </button>
        </div>
      </div>
    </div>
  );
}
