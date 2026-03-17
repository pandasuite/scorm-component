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
  let sessionStarted = false;
  let sessionFinished = false;

  function getProtocol() {
    return adapter && adapter.protocol ? adapter.protocol : null;
  }

  function getState() {
    return {
      protocol: getProtocol(),
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

  function runCompanionAdapters(methodName, payload) {
    companionAdapters.forEach((companionAdapter) => {
      if (!companionAdapter || typeof companionAdapter[methodName] !== 'function') {
        return;
      }

      companionAdapter[methodName](payload);
    });
  }

  function restoreState() {
    const adapters = [adapter, ...companionAdapters];
    const restored = {};

    adapters.forEach((currentAdapter) => {
      if (!currentAdapter || typeof currentAdapter.restore !== 'function') {
        return;
      }

      const nextState = currentAdapter.restore() || {};

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

  return {
    getState,
    start() {
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

      const restored = restoreState();
      startTime = restored.elapsedMs == null ? getNow() : getNow() - restored.elapsedMs;

      const didStart = adapter.start(getBasePayload());
      if (!didStart) {
        runtimeLogger.error('Session start failed', {
          protocol: getProtocol(),
          scoreMin,
          scoreMax,
        });
        return false;
      }

      sessionStarted = true;
      sessionFinished = false;

      if (restored.progressPercent != null) {
        this.progress(restored.progressPercent);
      }

      if (restored.score != null) {
        currentScore = normalizeScore(restored.score);
        this.score(currentScore);
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
    },
    progress(value) {
      const progressPercent = normalizeProgressPercent(value);
      const progressRatio = progressPercent / 100;

      if (!ensureSessionStarted('progress')) {
        return false;
      }

      const payload = getBasePayload({
        progressPercent,
        progressRatio,
      });
      const didSync = adapter && typeof adapter.setProgress === 'function'
        ? adapter.setProgress(payload)
        : false;

      runCompanionAdapters('setProgress', payload);

      if (didSync) {
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

      return didSync;
    },
    score(value) {
      currentScore = normalizeScore(value);

      if (!ensureSessionStarted('score')) {
        return false;
      }

      const payload = getBasePayload({
        score: currentScore,
      });
      const didSync = adapter && typeof adapter.setScore === 'function'
        ? adapter.setScore(payload)
        : false;

      runCompanionAdapters('setScore', payload);

      if (didSync) {
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

      return didSync;
    },
    incScore(value) {
      currentScore += normalizeScore(value);
      return this.score(currentScore);
    },
    decScore(value) {
      currentScore -= normalizeScore(value);
      return this.score(currentScore);
    },
    incomplete() {
      if (!ensureSessionStarted('incomplete')) {
        return false;
      }

      const payload = getBasePayload();
      const didSync = adapter && typeof adapter.markIncomplete === 'function'
        ? adapter.markIncomplete(payload)
        : false;

      runCompanionAdapters('markIncomplete', payload);

      if (didSync) {
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

      return didSync;
    },
    complete() {
      if (!ensureSessionStarted('complete')) {
        return false;
      }

      const payload = getBasePayload();
      const didComplete = adapter && typeof adapter.complete === 'function'
        ? adapter.complete(payload)
        : false;

      if (didComplete) {
        runCompanionAdapters('complete', payload);
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
    timedout() {
      if (!ensureSessionStarted('timedout')) {
        return false;
      }

      const payload = getBasePayload();
      const didTimeout = adapter && typeof adapter.timeout === 'function'
        ? adapter.timeout(payload)
        : false;

      if (didTimeout) {
        runCompanionAdapters('timeout', payload);
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
