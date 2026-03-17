/* eslint-disable no-console */

export const DEBUG_STORAGE_KEY = 'scorm-component:debug';

function isTruthyFlag(value) {
  if (typeof value === 'boolean') {
    return value;
  }

  if (typeof value !== 'string') {
    return false;
  }

  return /^(1|true|yes|on)$/i.test(value.trim());
}

export function isDebugLoggingEnabled({
  properties = null,
  storageValue = null,
} = {}) {
  if (properties && properties.debugLogs === true) {
    return true;
  }

  return isTruthyFlag(storageValue);
}

function getConsoleMethod(level) {
  if (level === 'warn' && typeof console.warn === 'function') {
    return 'warn';
  }

  if (level === 'error' && typeof console.error === 'function') {
    return 'error';
  }

  if (level === 'info' && typeof console.info === 'function') {
    return 'info';
  }

  return 'log';
}

export function createLogger({
  prefix = '[scorm-component]',
  isDebugEnabled = false,
} = {}) {
  function debugEnabled() {
    if (typeof isDebugEnabled === 'function') {
      return isDebugEnabled();
    }

    return !!isDebugEnabled;
  }

  function emit(level, message, details) {
    if (level === 'debug' && !debugEnabled()) {
      return;
    }

    const method = getConsoleMethod(level);
    if (details === undefined) {
      console[method](prefix, message);
      return;
    }

    console[method](prefix, message, details);
  }

  return {
    debug: (message, details) => emit('debug', message, details),
    info: (message, details) => emit('info', message, details),
    warn: (message, details) => emit('warn', message, details),
    error: (message, details) => emit('error', message, details),
  };
}
