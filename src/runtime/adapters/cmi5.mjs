/* eslint-disable import/prefer-default-export */

const XAPI_VERSION = '1.0.3';
const LAUNCH_DATA_STATE_ID = 'LMS.LaunchData';
const LEARNER_PREFERENCES_PROFILE_ID = 'cmi5LearnerPreferences';
const PROGRESS_EXTENSION_ID = 'https://w3id.org/xapi/cmi5/result/extensions/progress';
const MASTERY_SCORE_EXTENSION_ID = 'https://w3id.org/xapi/cmi5/context/extensions/masteryscore';

const VERBS = {
  initialized: {
    id: 'http://adlnet.gov/expapi/verbs/initialized',
    display: 'initialized',
  },
  progressed: {
    id: 'http://adlnet.gov/expapi/verbs/progressed',
    display: 'progressed',
  },
  completed: {
    id: 'http://adlnet.gov/expapi/verbs/completed',
    display: 'completed',
  },
  passed: {
    id: 'http://adlnet.gov/expapi/verbs/passed',
    display: 'passed',
  },
  failed: {
    id: 'http://adlnet.gov/expapi/verbs/failed',
    display: 'failed',
  },
  terminated: {
    id: 'http://adlnet.gov/expapi/verbs/terminated',
    display: 'terminated',
  },
};

function ensureTrailingSlash(value) {
  return value.endsWith('/') ? value : `${value}/`;
}

function buildUrl(endpoint, pathname, params = {}) {
  const url = new URL(pathname, ensureTrailingSlash(endpoint));
  const searchParams = new URLSearchParams();

  Object.entries(params).forEach(([key, value]) => {
    if (value != null) {
      searchParams.set(key, value);
    }
  });

  url.search = searchParams.toString();
  return url.toString();
}

function cloneJson(value) {
  if (value == null) {
    return {};
  }

  return JSON.parse(JSON.stringify(value));
}

function defaultStatementId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }

  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (character) => {
    const randomValue = Math.floor(Math.random() * 16);
    const resolved = character === 'x'
      ? randomValue
      : [8, 9, 10, 11][Math.floor(Math.random() * 4)];

    return resolved.toString(16);
  });
}

function millisecondsToDuration(milliseconds) {
  let seconds = Math.round(milliseconds / 1000);

  let s = seconds % 60;
  seconds -= s;
  if (s < 10) {
    s = `0${s}`;
  }

  let m = (seconds / 60) % 60;
  if (m < 10) {
    m = `0${m}`;
  }

  let h = Math.floor(seconds / 3600);
  if (h < 10) {
    h = `0${h}`;
  }

  return `PT${h}H${m}M${s}S`;
}

function normalizeNumber(value) {
  const parsed = Number.parseFloat(value);
  return Number.isNaN(parsed) ? null : parsed;
}

function normalizeScaledScore(score, scoreMin, scoreMax) {
  const rawScore = normalizeNumber(score);
  const minScore = normalizeNumber(scoreMin);
  const maxScore = normalizeNumber(scoreMax);

  if (rawScore == null || minScore == null || maxScore == null) {
    return null;
  }

  const span = maxScore - minScore;
  if (span <= 0) {
    return null;
  }

  return Number(((rawScore - minScore) / span).toFixed(4));
}

function createNoopLogger(logger = {}) {
  return {
    debug: typeof logger.debug === 'function' ? logger.debug : () => {},
    info: typeof logger.info === 'function' ? logger.info : () => {},
    warn: typeof logger.warn === 'function' ? logger.warn : () => {},
    error: typeof logger.error === 'function' ? logger.error : () => {},
  };
}

export function createCmi5Adapter({
  launchContext,
  fetchFn = (...args) => fetch(...args),
  logger = {},
  getNow = () => Date.now(),
  createStatementId = defaultStatementId,
} = {}) {
  const runtimeLogger = createNoopLogger(logger);

  let authToken = null;
  let launchData = null;
  let learnerPreferences = null;
  let bootPromise = null;
  let initialized = false;
  let terminated = false;
  let latestScore = null;

  function getActorString() {
    if (typeof launchContext.actor === 'string' && launchContext.actor.length > 0) {
      return launchContext.actor;
    }

    return JSON.stringify(launchContext.actorJson);
  }

  function createHeaders({
    includeContentType = false,
  } = {}) {
    return {
      Authorization: `Basic ${authToken}`,
      'X-Experience-API-Version': XAPI_VERSION,
      ...(includeContentType ? { 'Content-Type': 'application/json' } : {}),
    };
  }

  async function readJsonResponse(response, {
    allowNotFound = false,
  } = {}) {
    if (allowNotFound && response.status === 404) {
      return null;
    }

    if (response.status === 204) {
      return null;
    }

    const body = await response.json();
    if (!response.ok) {
      throw new Error(body['error-text'] || `CMI5 request failed with status ${response.status}`);
    }

    return body;
  }

  async function fetchToken() {
    const response = await fetchFn(launchContext.fetch, {
      method: 'POST',
    });
    const body = await readJsonResponse(response);
    if (body['error-code']) {
      throw new Error(body['error-text'] || `CMI5 token fetch error ${body['error-code']}`);
    }
    const token = body['auth-token'];

    if (!token) {
      throw new Error('CMI5 token fetch did not return "auth-token"');
    }

    return token;
  }

  async function fetchLaunchData() {
    const response = await fetchFn(buildUrl(launchContext.endpoint, 'activities/state', {
      activityId: launchContext.activityId,
      agent: getActorString(),
      registration: launchContext.registration,
      stateId: LAUNCH_DATA_STATE_ID,
    }), {
      headers: createHeaders(),
    });
    const data = await readJsonResponse(response);

    if (!data || !data.contextTemplate || !data.launchMode) {
      throw new Error('CMI5 launch data is missing required fields');
    }

    return data;
  }

  async function fetchLearnerPreferences() {
    const response = await fetchFn(buildUrl(launchContext.endpoint, 'agents/profile', {
      agent: getActorString(),
      profileId: LEARNER_PREFERENCES_PROFILE_ID,
    }), {
      headers: createHeaders(),
    });

    return readJsonResponse(response, {
      allowNotFound: true,
    });
  }

  async function ensureBootstrapped() {
    if (bootPromise) {
      return bootPromise;
    }

    bootPromise = (async () => {
      authToken = await fetchToken();
      launchData = await fetchLaunchData();
      learnerPreferences = await fetchLearnerPreferences();

      runtimeLogger.info('CMI5 launch data ready', {
        launchMode: launchData.launchMode,
        masteryScore: launchData.masteryScore,
        hasLearnerPreferences: learnerPreferences != null,
      });

      return {
        authToken,
        launchData,
        learnerPreferences,
      };
    })().catch((error) => {
      bootPromise = null;
      throw error;
    });

    return bootPromise;
  }

  function buildContext({
    includeMasteryScore = false,
  } = {}) {
    const context = cloneJson(launchData.contextTemplate);
    const extensions = context.extensions || {};

    context.registration = launchContext.registration;
    context.extensions = extensions;

    if (
      includeMasteryScore
      && launchData.masteryScore != null
      && context.extensions[MASTERY_SCORE_EXTENSION_ID] == null
    ) {
      context.extensions[MASTERY_SCORE_EXTENSION_ID] = launchData.masteryScore;
    }

    return context;
  }

  function buildStatement({
    verb,
    result = null,
    includeMasteryScore = false,
  }) {
    return {
      id: createStatementId(),
      actor: launchContext.actorJson,
      verb: {
        id: verb.id,
        display: {
          'en-US': verb.display,
        },
      },
      object: {
        id: launchContext.activityId,
        objectType: 'Activity',
      },
      context: buildContext({
        includeMasteryScore,
      }),
      timestamp: new Date(getNow()).toISOString(),
      ...(result ? { result } : {}),
    };
  }

  async function postStatement({
    verb,
    result = null,
    includeMasteryScore = false,
  }) {
    const statement = buildStatement({
      verb,
      result,
      includeMasteryScore,
    });
    const response = await fetchFn(buildUrl(launchContext.endpoint, 'statements'), {
      method: 'POST',
      headers: createHeaders({
        includeContentType: true,
      }),
      body: JSON.stringify(statement),
    });

    await readJsonResponse(response);
    return statement;
  }

  function isNormalLaunchMode() {
    return launchData && launchData.launchMode === 'Normal';
  }

  function createDurationResult(elapsedMs) {
    if (elapsedMs == null) {
      return {};
    }

    return {
      duration: millisecondsToDuration(elapsedMs),
    };
  }

  function buildLatestScore(payload = {}) {
    const raw = normalizeNumber(
      payload.score != null
        ? payload.score
        : payload.currentScore,
    );
    const min = normalizeNumber(payload.scoreMin);
    const max = normalizeNumber(payload.scoreMax);
    const scaled = normalizeScaledScore(raw, min, max);

    if (raw == null || min == null || max == null || scaled == null) {
      return null;
    }

    return {
      raw,
      min,
      max,
      scaled,
    };
  }

  async function terminate(elapsedMs) {
    if (terminated) {
      return true;
    }

    await postStatement({
      verb: VERBS.terminated,
      result: createDurationResult(elapsedMs),
    });
    terminated = true;

    if (
      launchData
      && launchData.returnURL
      && typeof window !== 'undefined'
      && window.location
      && typeof window.location.assign === 'function'
    ) {
      window.location.assign(launchData.returnURL);
    }

    return true;
  }

  function createIgnoredResult() {
    return {
      ok: true,
      ignored: true,
    };
  }

  return {
    protocol: 'CMI5',
    async start() {
      await ensureBootstrapped();

      if (initialized) {
        return true;
      }

      await postStatement({
        verb: VERBS.initialized,
      });
      initialized = true;
      return true;
    },
    async setProgress({
      progressPercent,
    }) {
      await ensureBootstrapped();

      if (!initialized || terminated) {
        return createIgnoredResult();
      }

      if (!isNormalLaunchMode()) {
        runtimeLogger.warn('Ignoring CMI5 progress outside Normal launch mode', {
          launchMode: launchData.launchMode,
        });
        return createIgnoredResult();
      }

      const percent = Math.round(normalizeNumber(progressPercent) || 0);
      if (percent <= 0 || percent >= 100) {
        runtimeLogger.debug('Ignoring CMI5 progress outside 1-99 range', {
          progressPercent: percent,
        });
        return createIgnoredResult();
      }

      await postStatement({
        verb: VERBS.progressed,
        result: {
          extensions: {
            [PROGRESS_EXTENSION_ID]: percent,
          },
        },
      });
      return true;
    },
    async setScore(payload) {
      await ensureBootstrapped();

      if (!initialized || terminated) {
        return createIgnoredResult();
      }

      if (!isNormalLaunchMode()) {
        runtimeLogger.warn('Ignoring CMI5 score outside Normal launch mode', {
          launchMode: launchData.launchMode,
        });
        return createIgnoredResult();
      }

      latestScore = buildLatestScore(payload);
      runtimeLogger.info('CMI5 score cached', {
        score: latestScore ? latestScore.raw : null,
      });
      return createIgnoredResult();
    },
    async markIncomplete() {
      await ensureBootstrapped();

      if (!initialized || terminated) {
        return createIgnoredResult();
      }

      if (!isNormalLaunchMode()) {
        runtimeLogger.warn('Ignoring CMI5 incomplete outside Normal launch mode', {
          launchMode: launchData.launchMode,
        });
        return createIgnoredResult();
      }

      runtimeLogger.info('CMI5 incomplete cached', {
        launchMode: launchData.launchMode,
      });
      return createIgnoredResult();
    },
    async complete(payload = {}) {
      await ensureBootstrapped();

      if (!initialized) {
        return false;
      }

      if (!isNormalLaunchMode()) {
        runtimeLogger.warn('CMI5 complete is terminating without satisfaction statements', {
          launchMode: launchData.launchMode,
        });
        return terminate(payload.elapsedMs);
      }

      await postStatement({
        verb: VERBS.completed,
        result: {
          completion: true,
          ...createDurationResult(payload.elapsedMs),
        },
      });

      const score = latestScore || buildLatestScore(payload);
      if (score && launchData.masteryScore != null) {
        const passed = score.scaled >= launchData.masteryScore;

        await postStatement({
          verb: passed ? VERBS.passed : VERBS.failed,
          includeMasteryScore: true,
          result: {
            score: {
              raw: score.raw,
              min: score.min,
              max: score.max,
              scaled: score.scaled,
            },
            success: passed,
            ...createDurationResult(payload.elapsedMs),
          },
        });
      } else if (score) {
        runtimeLogger.warn('CMI5 mastery score missing, skipping passed/failed', {
          score: score.raw,
        });
      }
      return terminate(payload.elapsedMs);
    },
    async timeout(payload = {}) {
      await ensureBootstrapped();

      if (!initialized) {
        return false;
      }
      return terminate(payload.elapsedMs);
    },
  };
}
