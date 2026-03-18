/* eslint-disable import/extensions, import/no-unresolved */

import test from 'node:test';
import assert from 'node:assert/strict';

import { createCmi5Adapter } from '../../src/runtime/adapters/cmi5.mjs';

const ENDPOINT = 'https://lrs.example.com/xapi/';
const FETCH_URL = 'https://lms.example.com/cmi5/fetch-token';

function createLaunchContext() {
  return {
    endpoint: ENDPOINT,
    fetch: FETCH_URL,
    registration: 'reg-123',
    activityId: 'https://example.com/activity/1',
    activityid: 'https://example.com/activity/1',
    actor: JSON.stringify({
      objectType: 'Agent',
      account: {
        homePage: 'https://lms.example.com',
        name: 'learner-1',
      },
    }),
    actorJson: {
      objectType: 'Agent',
      account: {
        homePage: 'https://lms.example.com',
        name: 'learner-1',
      },
    },
  };
}

function createLogger() {
  return {
    debug() {},
    info() {},
    warn() {},
    error() {},
  };
}

function createJsonResponse(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() {
      return body;
    },
  };
}

function createFetchHarness({
  launchMode = 'Normal',
  moveOn = 'Completed',
  masteryScore = 0.75,
  learnerPreferences = {
    languagePreference: 'en-US',
    audioPreference: 'on',
  },
} = {}) {
  const requests = [];
  const statements = [];
  const launchData = {
    contextTemplate: {
      contextActivities: {
        grouping: [
          {
            id: 'https://example.com/publisher',
            objectType: 'Activity',
          },
        ],
      },
      extensions: {
        'https://w3id.org/xapi/cmi5/context/extensions/sessionid': 'session-123',
      },
    },
    launchMode,
    moveOn,
    masteryScore,
  };

  async function fetchFn(url, options = {}) {
    requests.push({
      url,
      method: options.method || 'GET',
      headers: options.headers || {},
      body: options.body || null,
    });

    if (url === FETCH_URL) {
      return createJsonResponse(200, {
        'auth-token': 'token-123',
      });
    }

    if (url.startsWith(`${ENDPOINT}activities/state`)) {
      return createJsonResponse(200, launchData);
    }

    if (url.startsWith(`${ENDPOINT}agents/profile`)) {
      if (learnerPreferences == null) {
        return createJsonResponse(404, {});
      }

      return createJsonResponse(200, learnerPreferences);
    }

    if (url === `${ENDPOINT}statements`) {
      statements.push(JSON.parse(options.body));
      return createJsonResponse(200, {});
    }

    throw new Error(`Unexpected fetch: ${url}`);
  }

  return {
    fetchFn,
    launchData,
    requests,
    statements,
  };
}

function getCategoryIds(statement) {
  return ((statement.context || {}).contextActivities || {}).category || [];
}

test('cmi5 start fetches token and launch documents before initialized', async () => {
  const harness = createFetchHarness();
  const adapter = createCmi5Adapter({
    launchContext: createLaunchContext(),
    fetchFn: harness.fetchFn,
    logger: createLogger(),
    createStatementId: () => 'statement-1',
    getNow: () => new Date('2026-03-17T12:00:00.000Z').getTime(),
  });

  assert.equal(await adapter.start({ elapsedMs: 0 }), true);
  assert.equal(harness.requests.length, 4);
  assert.equal(harness.requests[0].method, 'POST');
  assert.match(harness.requests[1].url, /activities\/state/);
  assert.match(harness.requests[2].url, /agents\/profile/);
  assert.equal(harness.requests[3].url, `${ENDPOINT}statements`);
  assert.equal(harness.statements.length, 1);
  assert.equal(harness.statements[0].verb.id, 'http://adlnet.gov/expapi/verbs/initialized');
  assert.equal(harness.statements[0].context.registration, 'reg-123');
  assert.equal(harness.statements[0].object.id, 'https://example.com/activity/1');
  assert.deepEqual(getCategoryIds(harness.statements[0]).map((item) => item.id), [
    'https://w3id.org/xapi/cmi5/context/categories/cmi5',
  ]);
});

test('cmi5 progress emits progressed statements and ignores 0 and 100', async () => {
  const harness = createFetchHarness();
  const adapter = createCmi5Adapter({
    launchContext: createLaunchContext(),
    fetchFn: harness.fetchFn,
    logger: createLogger(),
    createStatementId: (() => {
      let index = 0;
      return () => {
        index += 1;
        return `statement-${index}`;
      };
    })(),
    getNow: () => new Date('2026-03-17T12:00:05.000Z').getTime(),
  });

  await adapter.start({ elapsedMs: 0 });

  assert.equal(await adapter.setProgress({ progressPercent: 25, elapsedMs: 5000 }), true);
  assert.deepEqual(await adapter.setProgress({ progressPercent: 0, elapsedMs: 5000 }), {
    ok: true,
    ignored: true,
  });
  assert.deepEqual(await adapter.setProgress({ progressPercent: 100, elapsedMs: 5000 }), {
    ok: true,
    ignored: true,
  });
  assert.equal(harness.statements.length, 2);
  assert.equal(harness.statements[1].verb.id, 'http://adlnet.gov/expapi/verbs/progressed');
  assert.equal(
    harness.statements[1].result.extensions['https://w3id.org/xapi/cmi5/result/extensions/progress'],
    25,
  );
});

test('cmi5 complete emits passed, completed, and terminated for CompletedAndPassed', async () => {
  const harness = createFetchHarness({
    moveOn: 'CompletedAndPassed',
    masteryScore: 0.75,
  });
  const adapter = createCmi5Adapter({
    launchContext: createLaunchContext(),
    fetchFn: harness.fetchFn,
    logger: createLogger(),
    createStatementId: (() => {
      let index = 0;
      return () => {
        index += 1;
        return `statement-${index}`;
      };
    })(),
    getNow: () => new Date('2026-03-17T12:00:10.000Z').getTime(),
  });

  await adapter.start({ elapsedMs: 0 });
  assert.deepEqual(await adapter.setScore({
    score: 80,
    scoreMin: 0,
    scoreMax: 100,
    elapsedMs: 10000,
  }), {
    ok: true,
    ignored: true,
  });
  assert.equal(harness.statements.length, 1);

  assert.equal(await adapter.complete({
    currentScore: 80,
    scoreMin: 0,
    scoreMax: 100,
    elapsedMs: 10000,
  }), true);
  assert.equal(harness.statements.length, 4);
  assert.equal(harness.statements[1].verb.id, 'http://adlnet.gov/expapi/verbs/passed');
  assert.equal(harness.statements[1].result.score.raw, 80);
  assert.equal(harness.statements[1].result.score.scaled, 0.8);
  assert.equal(harness.statements[1].result.success, true);
  assert.equal(harness.statements[2].verb.id, 'http://adlnet.gov/expapi/verbs/completed');
  assert.equal(harness.statements[2].result.completion, true);
  assert.equal(harness.statements[3].verb.id, 'http://adlnet.gov/expapi/verbs/terminated');
  assert.deepEqual(getCategoryIds(harness.statements[1]).map((item) => item.id), [
    'https://w3id.org/xapi/cmi5/context/categories/cmi5',
    'https://w3id.org/xapi/cmi5/context/categories/moveon',
  ]);
  assert.deepEqual(getCategoryIds(harness.statements[2]).map((item) => item.id), [
    'https://w3id.org/xapi/cmi5/context/categories/cmi5',
    'https://w3id.org/xapi/cmi5/context/categories/moveon',
  ]);
  assert.deepEqual(getCategoryIds(harness.statements[3]).map((item) => item.id), [
    'https://w3id.org/xapi/cmi5/context/categories/cmi5',
  ]);
});

test('cmi5 Passed moveOn emits failed and terminated without completed when learner fails', async () => {
  const harness = createFetchHarness({
    moveOn: 'Passed',
    masteryScore: 0.75,
  });
  const adapter = createCmi5Adapter({
    launchContext: createLaunchContext(),
    fetchFn: harness.fetchFn,
    logger: createLogger(),
    createStatementId: (() => {
      let index = 0;
      return () => {
        index += 1;
        return `statement-${index}`;
      };
    })(),
    getNow: () => new Date('2026-03-17T12:00:12.000Z').getTime(),
  });

  await adapter.start({ elapsedMs: 0 });
  await adapter.setScore({
    score: 50,
    scoreMin: 0,
    scoreMax: 100,
    elapsedMs: 12000,
  });

  assert.equal(await adapter.complete({
    currentScore: 50,
    scoreMin: 0,
    scoreMax: 100,
    elapsedMs: 12000,
  }), true);
  assert.deepEqual(harness.statements.map((statement) => statement.verb.id), [
    'http://adlnet.gov/expapi/verbs/initialized',
    'http://adlnet.gov/expapi/verbs/failed',
    'http://adlnet.gov/expapi/verbs/terminated',
  ]);
});

test('cmi5 Passed moveOn fails cleanly when success cannot be evaluated', async () => {
  const harness = createFetchHarness({
    moveOn: 'Passed',
    masteryScore: null,
  });
  const adapter = createCmi5Adapter({
    launchContext: createLaunchContext(),
    fetchFn: harness.fetchFn,
    logger: createLogger(),
    createStatementId: (() => {
      let index = 0;
      return () => {
        index += 1;
        return `statement-${index}`;
      };
    })(),
    getNow: () => new Date('2026-03-17T12:00:14.000Z').getTime(),
  });

  await adapter.start({ elapsedMs: 0 });

  assert.equal(await adapter.complete({
    currentScore: 80,
    scoreMin: 0,
    scoreMax: 100,
    elapsedMs: 14000,
  }), false);
  assert.equal(harness.statements.length, 1);
});

test('cmi5 CompletedOrPassed moveOn keeps completion path minimal', async () => {
  const harness = createFetchHarness({
    moveOn: 'CompletedOrPassed',
    masteryScore: 0.75,
  });
  const adapter = createCmi5Adapter({
    launchContext: createLaunchContext(),
    fetchFn: harness.fetchFn,
    logger: createLogger(),
    createStatementId: (() => {
      let index = 0;
      return () => {
        index += 1;
        return `statement-${index}`;
      };
    })(),
    getNow: () => new Date('2026-03-17T12:00:16.000Z').getTime(),
  });

  await adapter.start({ elapsedMs: 0 });
  await adapter.setScore({
    score: 80,
    scoreMin: 0,
    scoreMax: 100,
    elapsedMs: 16000,
  });

  assert.equal(await adapter.complete({
    currentScore: 80,
    scoreMin: 0,
    scoreMax: 100,
    elapsedMs: 16000,
  }), true);
  assert.deepEqual(harness.statements.map((statement) => statement.verb.id), [
    'http://adlnet.gov/expapi/verbs/initialized',
    'http://adlnet.gov/expapi/verbs/completed',
    'http://adlnet.gov/expapi/verbs/terminated',
  ]);
});

test('cmi5 browse mode only sends initialized and terminated', async () => {
  const harness = createFetchHarness({
    launchMode: 'Browse',
  });
  const adapter = createCmi5Adapter({
    launchContext: createLaunchContext(),
    fetchFn: harness.fetchFn,
    logger: createLogger(),
    createStatementId: (() => {
      let index = 0;
      return () => {
        index += 1;
        return `statement-${index}`;
      };
    })(),
    getNow: () => new Date('2026-03-17T12:00:15.000Z').getTime(),
  });

  await adapter.start({ elapsedMs: 0 });
  assert.deepEqual(await adapter.setProgress({ progressPercent: 25, elapsedMs: 5000 }), {
    ok: true,
    ignored: true,
  });
  assert.deepEqual(await adapter.setScore({
    score: 50,
    scoreMin: 0,
    scoreMax: 100,
    elapsedMs: 5000,
  }), {
    ok: true,
    ignored: true,
  });
  assert.deepEqual(await adapter.markIncomplete({ elapsedMs: 5000 }), {
    ok: true,
    ignored: true,
  });
  assert.equal(await adapter.complete({
    currentScore: 50,
    scoreMin: 0,
    scoreMax: 100,
    elapsedMs: 5000,
  }), true);
  assert.equal(harness.statements.length, 2);
  assert.equal(harness.statements[0].verb.id, 'http://adlnet.gov/expapi/verbs/initialized');
  assert.equal(harness.statements[1].verb.id, 'http://adlnet.gov/expapi/verbs/terminated');
});

test('cmi5 timedout emits terminated only', async () => {
  const harness = createFetchHarness();
  const adapter = createCmi5Adapter({
    launchContext: createLaunchContext(),
    fetchFn: harness.fetchFn,
    logger: createLogger(),
    createStatementId: (() => {
      let index = 0;
      return () => {
        index += 1;
        return `statement-${index}`;
      };
    })(),
    getNow: () => new Date('2026-03-17T12:00:20.000Z').getTime(),
  });

  await adapter.start({ elapsedMs: 0 });
  assert.equal(await adapter.timeout({ elapsedMs: 20000 }), true);
  assert.equal(harness.statements.length, 2);
  assert.equal(harness.statements[1].verb.id, 'http://adlnet.gov/expapi/verbs/terminated');
});
