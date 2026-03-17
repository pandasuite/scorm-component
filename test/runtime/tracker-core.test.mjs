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

test('start initializes once', () => {
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

  assert.equal(tracker.start(), true);
  assert.equal(tracker.start(), true);
  assert.equal(adapter.calls.start.length, 1);
});

test('progress before start is ignored', () => {
  const adapter = createAdapter();
  const tracker = createTracker({
    adapter,
    properties: {
      'score.min': 0,
      'score.max': 100,
    },
    logger: createLogger(),
  });

  assert.equal(tracker.progress(25), false);
  assert.equal(adapter.calls.setProgress.length, 0);
});

test('score after start delegates normalized values', () => {
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

  tracker.start();
  now = 6000;

  assert.equal(tracker.score(42), true);
  assert.equal(adapter.calls.setScore.length, 1);
  assert.equal(adapter.calls.setScore[0].score, 42);
  assert.equal(adapter.calls.setScore[0].scoreMin, 0);
  assert.equal(adapter.calls.setScore[0].scoreMax, 100);
  assert.equal(adapter.calls.setScore[0].elapsedMs, 5000);
});

test('complete keeps session open when adapter complete fails', () => {
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

  tracker.start();

  assert.equal(tracker.complete(), false);
  assert.equal(tracker.getState().sessionFinished, false);
  assert.equal(tracker.getState().sessionStarted, true);
});

test('timedout keeps session open when adapter timeout fails', () => {
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

  tracker.start();

  assert.equal(tracker.timedout(), false);
  assert.equal(tracker.getState().sessionFinished, false);
  assert.equal(tracker.getState().sessionStarted, true);
});
