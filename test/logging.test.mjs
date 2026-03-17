/* eslint-disable import/extensions, import/no-unresolved */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  DEBUG_STORAGE_KEY,
  isDebugLoggingEnabled,
} from '../src/logging.mjs';

test('isDebugLoggingEnabled is false by default', () => {
  assert.equal(isDebugLoggingEnabled(), false);
});

test('isDebugLoggingEnabled reads local storage', () => {
  assert.equal(
    isDebugLoggingEnabled({
      storageValue: 'true',
    }),
    true,
  );
});

test('isDebugLoggingEnabled accepts the storage key constant', () => {
  assert.equal(DEBUG_STORAGE_KEY, 'scorm-component:debug');
});

test('isDebugLoggingEnabled accepts component properties', () => {
  assert.equal(
    isDebugLoggingEnabled({
      properties: {
        debugLogs: true,
      },
    }),
    true,
  );
});
