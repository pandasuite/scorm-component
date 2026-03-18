/* eslint-disable import/extensions, import/no-unresolved */

import test from 'node:test';
import assert from 'node:assert/strict';

import { selectProtocol } from '../../src/runtime/select-protocol.mjs';

function buildCmi5QueryString(overrides = {}) {
  const actor = {
    name: 'Learner',
    mbox: 'mailto:learner@example.com',
    objectType: 'Agent',
  };

  const params = {
    endpoint: 'https://lrs.example.com/xapi/',
    fetch: 'https://example.com/cmi5/fetch',
    registration: 'reg-123',
    activityId: 'act-456',
    actor: JSON.stringify(actor),
    ...overrides,
  };

  const searchParams = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value != null) {
      searchParams.set(key, value);
    }
  });

  return {
    queryString: `?${searchParams.toString()}`,
    actor,
  };
}

test('selectProtocol prefers cmi5 when all launch params exist', () => {
  const { queryString, actor } = buildCmi5QueryString();

  const result = selectProtocol({
    queryString,
    hasScorm2004: true,
    hasScorm12: true,
  });

  assert.equal(result.protocol, 'cmi5');
  assert.equal(result.context.cmi5.endpoint, 'https://lrs.example.com/xapi/');
  assert.equal(result.context.cmi5.activityId, 'act-456');
  assert.deepEqual(result.context.cmi5.actorJson, actor);
});

test('selectProtocol still accepts legacy lowercase activityid launch params', () => {
  const { queryString } = buildCmi5QueryString({
    activityId: null,
    activityid: 'act-legacy',
  });

  const result = selectProtocol({
    queryString,
    hasScorm2004: true,
    hasScorm12: true,
  });

  assert.equal(result.protocol, 'cmi5');
  assert.equal(result.context.cmi5.activityId, 'act-legacy');
  assert.equal(result.context.cmi5.activityid, 'act-legacy');
});

test('selectProtocol falls back to scorm2004 when cmi5 params are incomplete', () => {
  const { queryString } = buildCmi5QueryString({
    actor: null,
  });

  const result = selectProtocol({
    queryString,
    hasScorm2004: true,
    hasScorm12: true,
  });

  assert.equal(result.protocol, 'scorm2004');
});

test('selectProtocol falls back to scorm12 when only scorm12 is available', () => {
  const result = selectProtocol({
    queryString: '',
    hasScorm2004: false,
    hasScorm12: true,
  });

  assert.equal(result.protocol, 'scorm12');
});

test('selectProtocol falls back to local when no scorm API is available', () => {
  const result = selectProtocol({
    queryString: '',
    hasScorm2004: false,
    hasScorm12: false,
  });

  assert.equal(result.protocol, 'local');
});
