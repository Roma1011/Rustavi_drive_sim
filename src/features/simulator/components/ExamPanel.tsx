import { SIMULATOR_CONFIG } from '../config/simulator.config';
import { useExamStore, type ExamMistake } from '../state/exam.store';
import { useRouteStore } from '../state/route.store';
import { useSimulatorStore } from '../state/simulator.store';

function formatClock(totalSeconds: number) {
  const seconds = Math.max(0, Math.floor(totalSeconds));
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return `${String(minutes).padStart(2, '0')}:${String(remainder).padStart(2, '0')}`;
}

function formatKm(meters: number) {
  return (Math.max(0, meters) / 1000).toFixed(1);
}

function MistakeList({ mistakes }: { mistakes: ExamMistake[] }) {
  if (mistakes.length === 0) {
    return <p className="exam-summary__clean">No faults were recorded.</p>;
  }

  return (
    <ul className="exam-summary__list">
      {mistakes.map((mistake) => (
        <li key={mistake.id}>
          <span>{formatClock(mistake.atSeconds)}</span>
          <strong>{mistake.label}</strong>
          <small>at {formatKm(mistake.progressMeters)} km</small>
        </li>
      ))}
    </ul>
  );
}

function ExamSummary() {
  const result = useExamStore((state) => state.result);
  const setSummaryVisible = useExamStore((state) => state.setSummaryVisible);
  const beginExam = useExamStore((state) => state.beginExam);
  const abortToIdle = useExamStore((state) => state.abortToIdle);

  if (!result) {
    return null;
  }

  const completionRatio = result.routeLengthMeters > 0 ? Math.min(result.progressMeters / result.routeLengthMeters, 1) : 0;

  return (
    <div className="exam-summary" role="dialog" aria-modal="true" aria-labelledby="exam-summary-title">
      <div className="exam-summary__panel panel">
        <p className="eyebrow">{result.completed ? 'Route completed' : 'Session ended early'}</p>
        <h2 id="exam-summary-title">{result.routeName}</h2>

        <div className="exam-summary__stats">
          <div>
            <span>Time</span>
            <strong>{formatClock(result.elapsedSeconds)}</strong>
          </div>
          <div>
            <span>Distance</span>
            <strong>
              {formatKm(result.progressMeters)} / {formatKm(result.routeLengthMeters)} km
            </strong>
          </div>
          <div>
            <span>Completed</span>
            <strong>{Math.round(completionRatio * 100)}%</strong>
          </div>
          <div>
            <span>Faults</span>
            <strong>{result.mistakes.length}</strong>
          </div>
        </div>

        <MistakeList mistakes={result.mistakes} />

        <p className="exam-summary__note">
          Faults are simulator checks (route following, lane keeping, direction, speed limit, collisions). Official
          Georgian exam scoring, traffic lights and road signs are not modelled because the route file contains no
          such data.
        </p>

        <div className="exam-summary__actions">
          <button type="button" className="exam-panel__button exam-panel__button--primary" onClick={beginExam}>
            New attempt
          </button>
          <button type="button" className="exam-panel__button" onClick={abortToIdle}>
            Free drive
          </button>
          <button type="button" className="exam-panel__button" onClick={() => setSummaryVisible(false)}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

export function ExamPanel() {
  const worldMode = useRouteStore((state) => state.worldMode);
  const route = useRouteStore((state) => state.route);
  const routeStatus = useRouteStore((state) => state.routeStatus);
  const setRouteSelectorVisible = useRouteStore((state) => state.setRouteSelectorVisible);
  const status = useExamStore((state) => state.status);
  const elapsedSeconds = useExamStore((state) => state.elapsedSeconds);
  const progressMeters = useExamStore((state) => state.progressMeters);
  const routeLengthMeters = useExamStore((state) => state.routeLengthMeters);
  const distanceToRoute = useExamStore((state) => state.distanceToRoute);
  const mistakes = useExamStore((state) => state.mistakes);
  const speedLimitKph = useExamStore((state) => state.speedLimitKph);
  const summaryVisible = useExamStore((state) => state.summaryVisible);
  const result = useExamStore((state) => state.result);
  const beginExam = useExamStore((state) => state.beginExam);
  const endExam = useExamStore((state) => state.endExam);
  const setSummaryVisible = useExamStore((state) => state.setSummaryVisible);
  const speedKph = useSimulatorStore((state) => state.speedKph);
  const isReady = useSimulatorStore((state) => state.isReady);

  if (worldMode === 'city') {
    return (
      <section className="exam-panel panel exam-panel--idle" aria-label="Exam session">
        <div className="exam-panel__route">
          <p className="eyebrow">Free drive</p>
          <strong>Metropolis city</strong>
        </div>
        <button type="button" className="exam-panel__button" onClick={() => setRouteSelectorVisible(true)}>
          Choose route
        </button>
      </section>
    );
  }

  if (!route || routeStatus !== 'ready') {
    return null;
  }

  const progressRatio = routeLengthMeters > 0 ? Math.min(progressMeters / routeLengthMeters, 1) : 0;
  const isRunning = status === 'running';
  const isOffRoute = isRunning && distanceToRoute > SIMULATOR_CONFIG.exam.offRouteDistance;
  const isSpeeding = speedKph > speedLimitKph;
  const statusLabel = status === 'running' ? 'In progress' : status === 'finished' ? 'Finished' : 'Not started';

  return (
    <>
      <section className={`exam-panel panel${isRunning ? ' is-running' : ''}`} aria-label="Exam session">
        <div className="exam-panel__route">
          <p className="eyebrow">{route.name}</p>
          <strong>
            <span className={`exam-panel__status exam-panel__status--${status}`}>{statusLabel}</span>
            {route.pointFeatures.length === 0 ? (
              <span className="exam-panel__meta">No sign or signal data in route file</span>
            ) : (
              <span className="exam-panel__meta">{route.pointFeatures.length} point features</span>
            )}
          </strong>
        </div>

        <div className="exam-panel__metrics">
          <div className="exam-panel__metric">
            <span>Time</span>
            <strong>{status === 'idle' ? '--:--' : formatClock(elapsedSeconds)}</strong>
          </div>
          <div className="exam-panel__metric exam-panel__metric--progress">
            <span>Progress</span>
            <strong>
              {formatKm(progressMeters)} / {formatKm(routeLengthMeters)} km
            </strong>
            <div className="exam-panel__bar">
              <div className="exam-panel__bar-fill" style={{ width: `${progressRatio * 100}%` }} />
            </div>
          </div>
          <div className={`exam-panel__metric exam-panel__limit${isSpeeding ? ' is-over' : ''}`}>
            <span>Limit</span>
            <strong>{speedLimitKph}</strong>
          </div>
          <div className={`exam-panel__metric${mistakes.length > 0 ? ' has-faults' : ''}`}>
            <span>Faults</span>
            <strong>{mistakes.length}</strong>
          </div>
        </div>

        {isOffRoute ? <div className="exam-panel__warning">Off route: return to the marked road</div> : null}

        <div className="exam-panel__actions">
          {status === 'idle' ? (
            <button
              type="button"
              className="exam-panel__button exam-panel__button--primary"
              onClick={beginExam}
              disabled={!isReady}
            >
              Start exam
            </button>
          ) : null}
          {isRunning ? (
            <button type="button" className="exam-panel__button" onClick={() => endExam(false)}>
              End exam
            </button>
          ) : null}
          {status === 'finished' ? (
            <>
              <button type="button" className="exam-panel__button exam-panel__button--primary" onClick={beginExam}>
                New attempt
              </button>
              {result ? (
                <button type="button" className="exam-panel__button" onClick={() => setSummaryVisible(true)}>
                  Summary
                </button>
              ) : null}
            </>
          ) : null}
        </div>
      </section>

      {summaryVisible ? <ExamSummary /> : null}
    </>
  );
}
