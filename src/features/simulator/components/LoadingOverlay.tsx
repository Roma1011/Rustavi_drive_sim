import { useEffect, useMemo } from 'react';
import { useProgress } from '@react-three/drei';
import { ASSET_PATHS } from '../../../shared/config/assets';
import { DowntownDrivingLogo } from '../../../shared/components/DowntownDrivingLogo';
import { useRouteStore } from '../state/route.store';
import { useSimulatorStore } from '../state/simulator.store';

const SEGMENT_COUNT = 10;

export function LoadingOverlay() {
  const { active, progress } = useProgress();
  const isReady = useSimulatorStore((state) => state.isReady);
  const settingsVisible = useSimulatorStore((state) => state.settingsVisible);
  const transitionLoadingLabel = useSimulatorStore((state) => state.transitionLoadingLabel);
  const transitionLoadingVisible = useSimulatorStore((state) => state.transitionLoadingVisible);
  const manifestStatus = useRouteStore((state) => state.manifestStatus);
  const routeStatus = useRouteStore((state) => state.routeStatus);
  const worldMode = useRouteStore((state) => state.worldMode);
  const manifest = useRouteStore((state) => state.manifest);
  const selectedRouteId = useRouteStore((state) => state.selectedRouteId);

  const routeFailed = manifestStatus === 'error' || (worldMode === 'route' && routeStatus === 'error');
  const routeLoading = manifestStatus === 'loading' || (worldMode === 'route' && routeStatus === 'loading');
  const overlayVisible = !routeFailed && (transitionLoadingVisible || active || routeLoading || !isReady);
  const isTransitionScreen = transitionLoadingVisible && !active;
  const clampedProgress = Math.max(0, Math.min(isTransitionScreen ? 82 : routeLoading && !active ? 35 : progress, 100));
  const isVisible = overlayVisible || (settingsVisible && !routeFailed);
  const activeSegments = Math.max(
    1,
    Math.min(SEGMENT_COUNT, Math.round((clampedProgress / 100) * SEGMENT_COUNT)),
  );
  const loadingAudio = useMemo(() => {
    const audio = new Audio(ASSET_PATHS.audio.loading);
    audio.loop = true;
    audio.preload = 'auto';
    audio.volume = 0.34;
    return audio;
  }, []);

  const routeName = manifest.find((entry) => entry.id === selectedRouteId)?.name;
  const statusLabel = transitionLoadingVisible
    ? transitionLoadingLabel
    : routeLoading
      ? manifestStatus === 'loading'
        ? 'Reading route list'
        : `Loading route${routeName ? `: ${routeName}` : ''}`
      : worldMode === 'route'
        ? 'Building road and placing the car'
        : 'Loading city map';

  useEffect(() => {
    if (!isVisible) {
      loadingAudio.pause();
      loadingAudio.currentTime = 0;
      return;
    }

    const tryPlay = async () => {
      try {
        await loadingAudio.play();
      } catch {
        // Autoplay can be blocked until the browser receives a user gesture.
      }
    };

    void tryPlay();
    const retryInterval = window.setInterval(() => {
      if (loadingAudio.paused) {
        void tryPlay();
      }
    }, 600);
    window.addEventListener('pointerdown', tryPlay, { passive: true });
    window.addEventListener('keydown', tryPlay);
    window.addEventListener('touchstart', tryPlay, { passive: true });

    return () => {
      window.clearInterval(retryInterval);
      window.removeEventListener('pointerdown', tryPlay);
      window.removeEventListener('keydown', tryPlay);
      window.removeEventListener('touchstart', tryPlay);
      loadingAudio.pause();
      loadingAudio.currentTime = 0;
    };
  }, [isVisible, loadingAudio]);

  useEffect(() => {
    return () => {
      loadingAudio.pause();
      loadingAudio.currentTime = 0;
    };
  }, [loadingAudio]);

  if (!overlayVisible) {
    return null;
  }

  return (
    <div className="loading-screen">
      <div className="loading-screen__grid" aria-hidden="true" />

      <div className="loading-screen__content">
        <DowntownDrivingLogo variant="loading" className="loading-screen__brand" />

        <div
          className="loading-screen__bar-shell"
          style={{ ['--loading-progress' as string]: `${clampedProgress}%` }}
        >
          <div className="loading-screen__bar-track">
            {Array.from({ length: SEGMENT_COUNT }, (_, index) => (
              <span
                key={index}
                className={`loading-screen__bar-segment${index < activeSegments ? ' is-active' : ''}`}
              />
            ))}
          </div>
        </div>

        <div className="loading-screen__headline">
          <div className="loading-screen__wordmark">LOADING......</div>
          <strong className="loading-screen__progress-value">{Math.round(clampedProgress)}%</strong>
        </div>

        <div className="loading-screen__readout">{statusLabel}</div>
      </div>
    </div>
  );
}
