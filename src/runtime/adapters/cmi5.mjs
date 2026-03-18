/* eslint-disable import/prefer-default-export */

const XAPI_VERSION = '1.0.3';
const LAUNCH_DATA_STATE_ID = 'LMS.LaunchData';
const LEARNER_PREFERENCES_PROFILE_ID = 'cmi5LearnerPreferences';
const PROGRESS_EXTENSION_ID = 'https://w3id.org/xapi/cmi5/result/extensions/progress';
const CMI5_CATEGORY_ID = 'https://w3id.org/xapi/cmi5/context/categories/cmi5';
const MOVEON_CATEGORY_ID = 'https://w3id.org/xapi/cmi5/context/categories/moveon';
const MASTERY_SCORE_EXTENSION_ID = 'https://w3id.org/xapi/cmi5/context/extensions/masteryscore';

const MOVE_ON = {
  Completed: 'Completed',
  Passed: 'Passed',
  CompletedAndPassed: 'CompletedAndPassed',
  CompletedOrPassed: 'CompletedOrPassed',
};

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

function ensureCategoryActivity(context, categoryId) {
  if (!categoryId) {
    return;
  }

  if (!context.contextActivities) {
    context.contextActivities = {};
  }

  if (!Array.isArray(context.contextActivities.category)) {
    context.contextActivities.category = [];
  }

  const hasCategory = context.contextActivities.category.some(
    (activity) => activity && activity.id === categoryId,
  );
  if (!hasCategory) {
    context.contextActivities.category.push({
      objectType: 'Activity',
      id: categoryId,
    });
  }
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
  let resolvedMoveOn = null;

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

  function getMoveOn() {
    if (resolvedMoveOn != null) {
      return resolvedMoveOn;
    }

    switch (launchData && launchData.moveOn) {
      case MOVE_ON.Passed:
      case MOVE_ON.CompletedAndPassed:
      case MOVE_ON.CompletedOrPassed:
      case MOVE_ON.Completed:
        resolvedMoveOn = launchData.moveOn;
        break;
      default:
        runtimeLogger.warn('Unknown CMI5 moveOn, falling back to Completed', {
          moveOn: launchData && launchData.moveOn,
        });
        resolvedMoveOn = MOVE_ON.Completed;
        break;
    }

    return resolvedMoveOn;
  }

  function buildContext({
    includeCmi5Category = false,
    includeMoveOnCategory = false,
    masteryScore = null,
  } = {}) {
    const context = cloneJson(launchData.contextTemplate);

    context.registration = launchContext.registration;
    context.extensions = context.extensions || {};

    if (includeCmi5Category) {
      ensureCategoryActivity(context, CMI5_CATEGORY_ID);
    }

    if (includeMoveOnCategory) {
      ensureCategoryActivity(context, MOVEON_CATEGORY_ID);
    }

    if (masteryScore != null) {
      context.extensions[MASTERY_SCORE_EXTENSION_ID] = masteryScore;
    }

    return context;
  }

  function buildStatement({
    verb,
    result = null,
    includeCmi5Category = false,
    includeMoveOnCategory = false,
    masteryScore = null,
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
        includeCmi5Category,
        includeMoveOnCategory,
        masteryScore,
      }),
      timestamp: new Date(getNow()).toISOString(),
      ...(result ? { result } : {}),
    };
  }

  async function postStatement({
    verb,
    result = null,
    includeCmi5Category = false,
    includeMoveOnCategory = false,
    masteryScore = null,
  }) {
    const statement = buildStatement({
      verb,
      result,
      includeCmi5Category,
      includeMoveOnCategory,
      masteryScore,
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

  function getSuccessEvaluation(payload = {}) {
    const score = latestScore || buildLatestScore(payload);
    const masteryScore = normalizeNumber(launchData.masteryScore);

    if (!score || masteryScore == null) {
      return null;
    }

    return {
      score,
      passed: score.scaled >= masteryScore,
    };
  }

  async function postCmi5DefinedStatement({
    verb,
    result = null,
    includeMoveOnCategory = false,
    masteryScore = null,
  }) {
    return postStatement({
      verb,
      result,
      includeCmi5Category: true,
      includeMoveOnCategory,
      masteryScore,
    });
  }

  async function postPassFailStatement(successEvaluation, elapsedMs) {
    const masteryScore = normalizeNumber(launchData.masteryScore);

    return postCmi5DefinedStatement({
      verb: successEvaluation.passed ? VERBS.passed : VERBS.failed,
      includeMoveOnCategory: true,
      masteryScore,
      result: {
        score: {
          raw: successEvaluation.score.raw,
          min: successEvaluation.score.min,
          max: successEvaluation.score.max,
          scaled: successEvaluation.score.scaled,
        },
        success: successEvaluation.passed,
        ...createDurationResult(elapsedMs),
      },
    });
  }

  async function postCompletedStatement(elapsedMs) {
    return postCmi5DefinedStatement({
      verb: VERBS.completed,
      includeMoveOnCategory: true,
      result: {
        completion: true,
        ...createDurationResult(elapsedMs),
      },
    });
  }

  async function terminate(elapsedMs) {
    if (terminated) {
      return true;
    }

    await postCmi5DefinedStatement({
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
        includeCmi5Category: true,
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

      const moveOn = getMoveOn();
      const successEvaluation = getSuccessEvaluation(payload);

      if (moveOn === MOVE_ON.Passed || moveOn === MOVE_ON.CompletedAndPassed) {
        if (!successEvaluation) {
          runtimeLogger.warn('CMI5 complete requires a pass/fail decision, but success cannot be determined', {
            moveOn,
            score: latestScore ? latestScore.raw : null,
            masteryScore: launchData.masteryScore,
          });
          return false;
        }
      }

      if (moveOn === MOVE_ON.Passed) {
        await postPassFailStatement(successEvaluation, payload.elapsedMs);
        return terminate(payload.elapsedMs);
      }

      if (moveOn === MOVE_ON.CompletedAndPassed) {
        await postPassFailStatement(successEvaluation, payload.elapsedMs);
        await postCompletedStatement(payload.elapsedMs);
        return terminate(payload.elapsedMs);
      }

      await postCompletedStatement(payload.elapsedMs);
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
