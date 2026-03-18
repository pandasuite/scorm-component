/* eslint-disable import/extensions, import/no-unresolved */

import test from 'node:test';
import assert from 'node:assert/strict';

import { createLocalAdapter } from '../../src/runtime/adapters/local.mjs';
import { createScorm12Adapter } from '../../src/runtime/adapters/scorm12.mjs';
import { createScorm2004Adapter } from '../../src/runtime/adapters/scorm2004.mjs';

function createLogger() {
  return {
    debug() {},
    error() {},
  };
}

function createScorm12Api() {
  const calls = [];

  return {
    calls,
    LMSInitialize(...args) {
      calls.push(['LMSInitialize', args]);
      return 'true';
    },
    LMSSetValue(...args) {
      calls.push(['LMSSetValue', args]);
      return 'true';
    },
    LMSCommit(...args) {
      calls.push(['LMSCommit', args]);
      return 'true';
    },
    LMSFinish(...args) {
      calls.push(['LMSFinish', args]);
      return 'true';
    },
    LMSGetLastError() {
      return '0';
    },
    LMSGetErrorString() {
      return 'No Error';
    },
    LMSGetDiagnostic() {
      return 'Successful operation';
    },
  };
}

function createScorm2004Api() {
  const calls = [];

  return {
    calls,
    Initialize(...args) {
      calls.push(['Initialize', args]);
      return 'true';
    },
    SetValue(...args) {
      calls.push(['SetValue', args]);
      return 'true';
    },
    Commit(...args) {
      calls.push(['Commit', args]);
      return 'true';
    },
    Terminate(...args) {
      calls.push(['Terminate', args]);
      return 'true';
    },
    GetLastError() {
      return '0';
    },
    GetErrorString() {
      return 'No Error';
    },
    GetDiagnostic() {
      return 'Successful operation';
    },
  };
}

function createStorage(seed = {}) {
  const state = new Map(Object.entries(seed));

  return {
    getItem(key) {
      return state.has(key) ? state.get(key) : null;
    },
    setItem(key, value) {
      state.set(key, `${value}`);
    },
    dump() {
      return Object.fromEntries(state.entries());
    },
  };
}

test('scorm12 adapter uses lesson_location for progress', () => {
  const api = createScorm12Api();
  const adapter = createScorm12Adapter({
    api,
    logger: createLogger(),
  });

  assert.equal(adapter.start({ scoreMin: 0, scoreMax: 100 }), true);
  assert.equal(adapter.setProgress({ elapsedMs: 25000, progressPercent: 25 }), true);

  assert.deepEqual(api.calls[1], ['LMSSetValue', ['cmi.core.lesson_status', 'incomplete']]);
  assert.deepEqual(api.calls[5], ['LMSSetValue', ['cmi.core.session_time', '00:00:25']]);
  assert.deepEqual(api.calls[6], ['LMSSetValue', ['cmi.core.lesson_location', '25']]);
});

test('scorm2004 adapter uses progress_measure for progress', () => {
  const api = createScorm2004Api();
  const adapter = createScorm2004Adapter({
    api,
    logger: createLogger(),
  });

  assert.equal(adapter.start({ scoreMin: 0, scoreMax: 100 }), true);
  assert.equal(adapter.setProgress({ elapsedMs: 25000, progressRatio: 0.25 }), true);

  assert.deepEqual(api.calls[1], ['SetValue', ['cmi.score.min', 0]]);
  assert.deepEqual(api.calls[4], ['SetValue', ['cmi.session_time', 'PT00H00M25S']]);
  assert.deepEqual(api.calls[5], ['SetValue', ['cmi.progress_measure', 0.25]]);
});

test('local adapter restores and syncs persisted state', () => {
  const events = [];
  const storage = createStorage({
    unit_total_time: '3000',
    unit_progress: '0.25',
    unit_score: '42',
  });
  const adapter = createLocalAdapter({
    enabled: true,
    unitId: 'unit',
    storage,
    send(eventName, payload) {
      events.push([eventName, payload]);
    },
  });

  assert.deepEqual(adapter.restore(), {
    elapsedMs: 3000,
    progressPercent: 25,
    progressRatio: 0.25,
    score: 42,
  });

  assert.equal(adapter.setProgress({ elapsedMs: 5000, progressRatio: 0.5 }), true);
  assert.equal(adapter.setScore({
    elapsedMs: 5000,
    score: 50,
    scoreMin: 0,
    scoreMax: 100,
  }), true);

  assert.deepEqual(storage.dump(), {
    unit_progress: '0.5',
    unit_score: '50',
    unit_total_time: '5000',
  });
  assert.deepEqual(events, [
    ['synchronize', [0.5, 'syncProgress', true]],
    ['synchronize', [50, 'syncScore', true]],
  ]);
});

test('local adapter supports a custom storage namespace', () => {
  const storage = createStorage({
    'unit:cmi5:reg-1_total_time': '3000',
    'unit:cmi5:reg-1_progress': '0.25',
    'unit:cmi5:reg-1_score': '42',
    unit_total_time: '9999',
  });
  const adapter = createLocalAdapter({
    enabled: true,
    unitId: 'unit',
    storageKeyPrefix: 'unit:cmi5:reg-1',
    storage,
  });

  assert.deepEqual(adapter.restore(), {
    elapsedMs: 3000,
    progressPercent: 25,
    progressRatio: 0.25,
    score: 42,
  });
});
