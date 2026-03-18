/* eslint-disable import/prefer-default-export */

const SCORE_MIN_KEY = 'score.min';
const SCORE_MAX_KEY = 'score.max';

function normalizeProgressPercent(value) {
  const parsed = Number.parseFloat(value);
  return Number.isNaN(parsed) ? 0 : parsed;
}

function normalizeScore(value) {
  const parsed = Number.parseInt(value, 10);
  return Number.isNaN(parsed) ? 0 : parsed;
}

function createNoopLogger(logger = {}) {
  return {
    debug: typeof logger.debug === 'function' ? logger.debug : () => {},
    info: typeof logger.info === 'function' ? logger.info : () => {},
    warn: typeof logger.warn === 'function' ? logger.warn : () => {},
    error: typeof logger.error === 'function' ? logger.error : () => {},
  };
}

function normalizeActionResult(result) {
  if (result && typeof result === 'object') {
    return {
      ok: result.ok === true,
      ignored: result.ignored === true,
    };
  }

  return {
    ok: result === true,
    ignored: false,
  };
}

export function createTracker({
  adapter = null,
  companionAdapters = [],
  properties = {},
  logger = {},
  getNow = () => Date.now(),
} = {}) {
  const runtimeLogger = createNoopLogger(logger);

  let startTime = null;
  let currentScore = 0;
  let sessionStarting = false;
  let sessionStarted = false;
  let sessionFinished = false;
  let startPromise = null;

  function getProtocol() {
    return adapter && adapter.protocol ? adapter.protocol : null;
  }

  function getState() {
    return {
      protocol: getProtocol(),
      sessionStarting,
      sessionStarted,
      sessionFinished,
      startTime,
      currentScore,
    };
  }

  function getBasePayload(extra = {}) {
    const scoreMin = properties[SCORE_MIN_KEY];
    const scoreMax = properties[SCORE_MAX_KEY];

    return {
      ...extra,
      properties,
      protocol: getProtocol(),
      scoreMin,
      scoreMax,
      currentScore,
      startTime,
      elapsedMs: startTime == null ? 0 : getNow() - startTime,
    };
  }

  async function runCompanionAdapters(methodName, payload) {
    await Promise.all(companionAdapters.map((companionAdapter) => {
      if (!companionAdapter || typeof companionAdapter[methodName] !== 'function') {
        return null;
      }

      return companionAdapter[methodName](payload);
    }));
  }

  async function restoreState() {
    const adapters = [adapter, ...companionAdapters];
    const restored = {};

    const restoredStates = await Promise.all(adapters.map((currentAdapter) => {
      if (!currentAdapter || typeof currentAdapter.restore !== 'function') {
        return null;
      }

      return currentAdapter.restore();
    }));

    restoredStates.forEach((nextState) => {
      if (!nextState) {
        return;
      }

      if (restored.elapsedMs == null && nextState.elapsedMs != null) {
        restored.elapsedMs = nextState.elapsedMs;
      }

      if (restored.progressRatio == null && nextState.progressRatio != null) {
        restored.progressRatio = nextState.progressRatio;
      }

      if (restored.progressPercent == null && nextState.progressPercent != null) {
        restored.progressPercent = nextState.progressPercent;
      }

      if (restored.score == null && nextState.score != null) {
        restored.score = nextState.score;
      }
    });

    if (restored.progressPercent == null && restored.progressRatio != null) {
      restored.progressPercent = restored.progressRatio * 100;
    }

    if (restored.progressRatio == null && restored.progressPercent != null) {
      restored.progressRatio = restored.progressPercent / 100;
    }

    return restored;
  }

  function ensureSessionStarted(actionName) {
    if (sessionFinished) {
      runtimeLogger.warn(`Ignoring "${actionName}" because the session is already finished`, getState());
      return false;
    }

    if (!sessionStarted || startTime == null) {
      runtimeLogger.warn(`Ignoring "${actionName}" because the session has not been started yet`, getState());
      return false;
    }

    return true;
  }

  async function waitForPendingStart(actionName) {
    if (!sessionStarting || !startPromise) {
      return true;
    }

    const didStart = await startPromise;
    if (!didStart) {
      runtimeLogger.warn(`Ignoring "${actionName}" because the session failed to start`, getState());
      return false;
    }

    return true;
  }

  return {
    getState,
    async start() {
      const {
        scoreMin,
        scoreMax,
      } = getBasePayload();

      if (!adapter || typeof adapter.start !== 'function') {
        runtimeLogger.error('Session start failed', {
          protocol: getProtocol(),
          scoreMin,
          scoreMax,
        });
        return false;
      }

      if (sessionFinished) {
        runtimeLogger.warn('Ignoring start because the session is already finished', getState());
        return false;
      }

      if (sessionStarted) {
        runtimeLogger.warn('Ignoring start because the session is already started', getState());
        return true;
      }

      if (sessionStarting && startPromise) {
        return startPromise;
      }

      sessionStarting = true;
      const currentStartPromise = (async () => {
        try {
          const restored = await restoreState();
          startTime = restored.elapsedMs == null ? getNow() : getNow() - restored.elapsedMs;

          const { ok: didStart } = normalizeActionResult(await adapter.start(getBasePayload()));
          if (!didStart) {
            sessionStarting = false;
            startTime = null;
            runtimeLogger.error('Session start failed', {
              protocol: getProtocol(),
              scoreMin,
              scoreMax,
            });
            return false;
          }

          sessionStarting = false;
          sessionStarted = true;
          sessionFinished = false;

          if (restored.progressPercent != null) {
            await this.progress(restored.progressPercent);
          }

          if (restored.score != null) {
            currentScore = normalizeScore(restored.score);
            await this.score(currentScore);
          }

          runtimeLogger.info('Session started', {
            protocol: getProtocol(),
            scoreMin,
            scoreMax,
            startTime,
            restoredProgress: restored.progressRatio,
            restoredScore: restored.score,
          });
          return true;
        } catch (error) {
          sessionStarting = false;
          startTime = null;
          throw error;
        } finally {
          if (startPromise === currentStartPromise) {
            startPromise = null;
          }
        }
      })();

      startPromise = currentStartPromise;
      return currentStartPromise;
    },
    async progress(value) {
      const progressPercent = normalizeProgressPercent(value);
      const progressRatio = progressPercent / 100;

      if (!(await waitForPendingStart('progress'))) {
        return false;
      }

      if (!ensureSessionStarted('progress')) {
        return false;
      }

      const payload = getBasePayload({
        progressPercent,
        progressRatio,
      });
      const outcome = adapter && typeof adapter.setProgress === 'function'
        ? normalizeActionResult(await adapter.setProgress(payload))
        : normalizeActionResult(false);

      await runCompanionAdapters('setProgress', payload);

      if (outcome.ignored) {
        return outcome.ok;
      }

      if (outcome.ok) {
        runtimeLogger.info('Progress synced', {
          protocol: getProtocol(),
          progressPercent,
          progressRatio,
          elapsedMs: payload.elapsedMs,
        });
      } else {
        runtimeLogger.warn('Progress update completed with runtime warnings', {
          protocol: getProtocol(),
          progressPercent,
          progressRatio,
          elapsedMs: payload.elapsedMs,
        });
      }

      return outcome.ok;
    },
    async score(value) {
      if (!(await waitForPendingStart('score'))) {
        return false;
      }

      if (!ensureSessionStarted('score')) {
        return false;
      }

      currentScore = normalizeScore(value);

      const payload = getBasePayload({
        score: currentScore,
      });
      const outcome = adapter && typeof adapter.setScore === 'function'
        ? normalizeActionResult(await adapter.setScore(payload))
        : normalizeActionResult(false);

      await runCompanionAdapters('setScore', payload);

      if (outcome.ignored) {
        return outcome.ok;
      }

      if (outcome.ok) {
        runtimeLogger.info('Score synced', {
          protocol: getProtocol(),
          score: currentScore,
          scoreMin: payload.scoreMin,
          scoreMax: payload.scoreMax,
          elapsedMs: payload.elapsedMs,
        });
      } else {
        runtimeLogger.warn('Score update completed with runtime warnings', {
          protocol: getProtocol(),
          score: currentScore,
          scoreMin: payload.scoreMin,
          scoreMax: payload.scoreMax,
          elapsedMs: payload.elapsedMs,
        });
      }

      return outcome.ok;
    },
    async incScore(value) {
      if (!(await waitForPendingStart('incScore'))) {
        return false;
      }

      if (!ensureSessionStarted('incScore')) {
        return false;
      }

      currentScore += normalizeScore(value);
      return this.score(currentScore);
    },
    async decScore(value) {
      if (!(await waitForPendingStart('decScore'))) {
        return false;
      }

      if (!ensureSessionStarted('decScore')) {
        return false;
      }

      currentScore -= normalizeScore(value);
      return this.score(currentScore);
    },
    async incomplete() {
      if (!(await waitForPendingStart('incomplete'))) {
        return false;
      }

      if (!ensureSessionStarted('incomplete')) {
        return false;
      }

      const payload = getBasePayload();
      const outcome = adapter && typeof adapter.markIncomplete === 'function'
        ? normalizeActionResult(await adapter.markIncomplete(payload))
        : normalizeActionResult(false);

      await runCompanionAdapters('markIncomplete', payload);

      if (outcome.ignored) {
        return outcome.ok;
      }

      if (outcome.ok) {
        runtimeLogger.info('Session marked incomplete', {
          protocol: getProtocol(),
          elapsedMs: payload.elapsedMs,
        });
      } else {
        runtimeLogger.warn('Incomplete status update completed with runtime warnings', {
          protocol: getProtocol(),
          elapsedMs: payload.elapsedMs,
        });
      }

      return outcome.ok;
    },
    async complete() {
      if (!(await waitForPendingStart('complete'))) {
        return false;
      }

      if (!ensureSessionStarted('complete')) {
        return false;
      }

      const payload = getBasePayload();
      const { ok: didComplete } = adapter && typeof adapter.complete === 'function'
        ? normalizeActionResult(await adapter.complete(payload))
        : normalizeActionResult(false);

      if (didComplete) {
        await runCompanionAdapters('complete', payload);
        sessionStarted = false;
        sessionFinished = true;
        runtimeLogger.info('Session completed', {
          protocol: getProtocol(),
          elapsedMs: payload.elapsedMs,
        });
        return true;
      }

      runtimeLogger.warn('Session completion completed with runtime warnings', {
        protocol: getProtocol(),
        elapsedMs: payload.elapsedMs,
      });
      return false;
    },
    async timedout() {
      if (!(await waitForPendingStart('timedout'))) {
        return false;
      }

      if (!ensureSessionStarted('timedout')) {
        return false;
      }

      const payload = getBasePayload();
      const { ok: didTimeout } = adapter && typeof adapter.timeout === 'function'
        ? normalizeActionResult(await adapter.timeout(payload))
        : normalizeActionResult(false);

      if (didTimeout) {
        await runCompanionAdapters('timeout', payload);
        sessionStarted = false;
        sessionFinished = true;
        runtimeLogger.warn('Session timed out', {
          protocol: getProtocol(),
          elapsedMs: payload.elapsedMs,
        });
        return true;
      }

      runtimeLogger.warn('Session timeout completed with runtime warnings', {
        protocol: getProtocol(),
        elapsedMs: payload.elapsedMs,
      });
      return false;
    },
  };
}
