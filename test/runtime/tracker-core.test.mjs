/* eslint-disable import/extensions, import/no-unresolved */

import test from 'node:test';
import assert from 'node:assert/strict';

import { createTracker } from '../../src/runtime/tracker-core.mjs';

function createLogger() {
  return {
    debug() {},
    info() {},
    warn() {},
    error() {},
  };
}

function createAdapter(overrides = {}) {
  const calls = {
    start: [],
    setProgress: [],
    setScore: [],
    markIncomplete: [],
    complete: [],
    timeout: [],
  };

  return {
    calls,
    protocol: 'Test',
    start(payload) {
      calls.start.push(payload);
      return true;
    },
    setProgress(payload) {
      calls.setProgress.push(payload);
      return true;
    },
    setScore(payload) {
      calls.setScore.push(payload);
      return true;
    },
    markIncomplete(payload) {
      calls.markIncomplete.push(payload);
      return true;
    },
    complete(payload) {
      calls.complete.push(payload);
      return true;
    },
    timeout(payload) {
      calls.timeout.push(payload);
      return true;
    },
    ...overrides,
  };
}

function createDeferred() {
  let resolve;
  const promise = new Promise((nextResolve) => {
    resolve = nextResolve;
  });

  return {
    promise,
    resolve,
  };
}

test('start initializes once', async () => {
  const adapter = createAdapter();
  const tracker = createTracker({
    adapter,
    properties: {
      'score.min': 0,
      'score.max': 100,
    },
    logger: createLogger(),
    getNow: () => 1000,
  });

  assert.equal(await tracker.start(), true);
  assert.equal(await tracker.start(), true);
  assert.equal(adapter.calls.start.length, 1);
});

test('progress waits for a pending start instead of being dropped', async () => {
  const deferred = createDeferred();
  const adapter = createAdapter({
    start(payload) {
      this.calls.start.push(payload);
      return deferred.promise;
    },
  });
  const tracker = createTracker({
    adapter,
    properties: {
      'score.min': 0,
      'score.max': 100,
    },
    logger: createLogger(),
    getNow: () => 1000,
  });

  const startPromise = tracker.start();
  const progressPromise = tracker.progress(25);

  assert.equal(adapter.calls.setProgress.length, 0);

  deferred.resolve(true);

  assert.equal(await startPromise, true);
  assert.equal(await progressPromise, true);
  assert.equal(adapter.calls.start.length, 1);
  assert.equal(adapter.calls.setProgress.length, 1);
  assert.equal(tracker.getState().sessionStarted, true);
});

test('progress before start is ignored', async () => {
  const adapter = createAdapter();
  const tracker = createTracker({
    adapter,
    properties: {
      'score.min': 0,
      'score.max': 100,
    },
    logger: createLogger(),
  });

  assert.equal(await tracker.progress(25), false);
  assert.equal(adapter.calls.setProgress.length, 0);
});

test('score after start delegates normalized values', async () => {
  let now = 1000;
  const adapter = createAdapter();
  const tracker = createTracker({
    adapter,
    properties: {
      'score.min': 0,
      'score.max': 100,
    },
    logger: createLogger(),
    getNow: () => now,
  });

  await tracker.start();
  now = 6000;

  assert.equal(await tracker.score(42), true);
  assert.equal(adapter.calls.setScore.length, 1);
  assert.equal(adapter.calls.setScore[0].score, 42);
  assert.equal(adapter.calls.setScore[0].scoreMin, 0);
  assert.equal(adapter.calls.setScore[0].scoreMax, 100);
  assert.equal(adapter.calls.setScore[0].elapsedMs, 5000);
});

test('incScore and decScore before start do not mutate score state', async () => {
  const tracker = createTracker({
    adapter: createAdapter(),
    properties: {
      'score.min': 0,
      'score.max': 100,
    },
    logger: createLogger(),
  });

  assert.equal(await tracker.incScore(5), false);
  assert.equal(await tracker.decScore(2), false);
  assert.equal(tracker.getState().currentScore, 0);
});

test('complete keeps session open when adapter complete fails', async () => {
  const adapter = createAdapter({
    complete(payload) {
      this.calls.complete.push(payload);
      return false;
    },
  });
  const tracker = createTracker({
    adapter,
    properties: {
      'score.min': 0,
      'score.max': 100,
    },
    logger: createLogger(),
    getNow: () => 1000,
  });

  await tracker.start();

  assert.equal(await tracker.complete(), false);
  assert.equal(tracker.getState().sessionFinished, false);
  assert.equal(tracker.getState().sessionStarted, true);
});

test('timedout keeps session open when adapter timeout fails', async () => {
  const adapter = createAdapter({
    timeout(payload) {
      this.calls.timeout.push(payload);
      return false;
    },
  });
  const tracker = createTracker({
    adapter,
    properties: {
      'score.min': 0,
      'score.max': 100,
    },
    logger: createLogger(),
    getNow: () => 1000,
  });

  await tracker.start();

  assert.equal(await tracker.timedout(), false);
  assert.equal(tracker.getState().sessionFinished, false);
  assert.equal(tracker.getState().sessionStarted, true);
});

test('start replays restored state through companion adapters after primary start', async () => {
  const adapter = createAdapter();
  const companionCalls = {
    restore: 0,
    setProgress: [],
    setScore: [],
  };
  const tracker = createTracker({
    adapter,
    companionAdapters: [{
      restore() {
        companionCalls.restore += 1;
        return {
          elapsedMs: 3000,
          progressPercent: 25,
          score: 12,
        };
      },
      setProgress(payload) {
        companionCalls.setProgress.push(payload);
        return true;
      },
      setScore(payload) {
        companionCalls.setScore.push(payload);
        return true;
      },
    }],
    properties: {
      'score.min': 0,
      'score.max': 100,
    },
    logger: createLogger(),
    getNow: () => 5000,
  });

  assert.equal(await tracker.start(), true);
  assert.equal(companionCalls.restore, 1);
  assert.equal(adapter.calls.setProgress.length, 1);
  assert.equal(adapter.calls.setScore.length, 1);
  assert.equal(companionCalls.setProgress.length, 1);
  assert.equal(companionCalls.setScore.length, 1);
});

test('complete preserves restored companion score and elapsed time after a relaunch', async () => {
  let now = 5000;
  const completeCalls = [];
  const tracker = createTracker({
    adapter: createAdapter({
      complete(payload) {
        completeCalls.push(payload);
        return true;
      },
    }),
    companionAdapters: [{
      restore() {
        return {
          elapsedMs: 3000,
          score: 80,
        };
      },
      setScore() {
        return true;
      },
    }],
    properties: {
      'score.min': 0,
      'score.max': 100,
    },
    logger: createLogger(),
    getNow: () => now,
  });

  assert.equal(await tracker.start(), true);

  now = 7000;

  assert.equal(await tracker.complete(), true);
  assert.equal(completeCalls.length, 1);
  assert.equal(completeCalls[0].currentScore, 80);
  assert.equal(completeCalls[0].elapsedMs, 5000);
});
