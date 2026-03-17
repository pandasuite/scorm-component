/* eslint-disable import/prefer-default-export */

function millisecondsToTime(milliseconds) {
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

  return `${h}:${m}:${s}`;
}

function isSuccessfulResult(result) {
  return result === true || result === 'true';
}

function isFailureResult(result, errorDetails) {
  if (result === false || result === 'false') {
    return true;
  }

  if (!errorDetails || errorDetails.code == null) {
    return false;
  }

  return `${errorDetails.code}` !== '0';
}

export function createScorm12Adapter({
  api = null,
  logger = {},
} = {}) {
  function getErrorDetails() {
    if (!api || typeof api.LMSGetLastError !== 'function') {
      return null;
    }

    const code = api.LMSGetLastError();
    return {
      code,
      errorString: typeof api.LMSGetErrorString === 'function'
        ? api.LMSGetErrorString(code)
        : null,
      diagnostic: typeof api.LMSGetDiagnostic === 'function'
        ? api.LMSGetDiagnostic(code)
        : null,
    };
  }

  function log(level, message, details) {
    if (logger && typeof logger[level] === 'function') {
      logger[level](message, details);
    }
  }

  function call(method, ...args) {
    if (!api || typeof api[method] !== 'function') {
      return null;
    }

    const result = api[method](...args);
    const error = getErrorDetails();
    const payload = {
      protocol: 'SCORM 1.2',
      method,
      args,
      result,
      error,
    };

    if (isFailureResult(result, error)) {
      log('error', 'SCORM call failed', payload);
    } else {
      log('debug', 'SCORM call', payload);
    }

    return result;
  }

  return {
    protocol: 'SCORM 1.2',
    start({
      scoreMin,
      scoreMax,
    }) {
      const initResult = call('LMSInitialize', '');
      if (!isSuccessfulResult(initResult)) {
        return false;
      }

      call('LMSSetValue', 'cmi.core.lesson_status', 'incomplete');
      call('LMSSetValue', 'cmi.core.score.min', scoreMin);
      call('LMSSetValue', 'cmi.core.score.max', scoreMax);
      call('LMSCommit', '');
      return true;
    },
    setProgress({
      elapsedMs,
      progressPercent,
    }) {
      call('LMSSetValue', 'cmi.core.session_time', millisecondsToTime(elapsedMs));
      const progressResult = call(
        'LMSSetValue',
        'cmi.core.lesson_location',
        `${Math.round(progressPercent)}`,
      );
      const commitResult = call('LMSCommit', '');

      return isSuccessfulResult(progressResult) && isSuccessfulResult(commitResult);
    },
    setScore({
      elapsedMs,
      score,
    }) {
      call('LMSSetValue', 'cmi.core.session_time', millisecondsToTime(elapsedMs));
      const scoreResult = call('LMSSetValue', 'cmi.core.score.raw', score);
      const commitResult = call('LMSCommit', '');

      return isSuccessfulResult(scoreResult) && isSuccessfulResult(commitResult);
    },
    markIncomplete({
      elapsedMs,
    }) {
      const statusResult = call('LMSSetValue', 'cmi.core.lesson_status', 'incomplete');
      call('LMSSetValue', 'cmi.core.session_time', millisecondsToTime(elapsedMs));
      const commitResult = call('LMSCommit', '');

      return isSuccessfulResult(statusResult) && isSuccessfulResult(commitResult);
    },
    complete({
      elapsedMs,
    }) {
      call('LMSSetValue', 'cmi.core.session_time', millisecondsToTime(elapsedMs));
      const statusResult = call('LMSSetValue', 'cmi.core.lesson_status', 'completed');
      const commitResult = call('LMSCommit', '');
      const finishResult = call('LMSFinish', '');

      return (
        isSuccessfulResult(statusResult)
        && isSuccessfulResult(commitResult)
        && isSuccessfulResult(finishResult)
      );
    },
    timeout() {
      call('LMSSetValue', 'cmi.core.exit', 'time-out');
      const commitResult = call('LMSCommit', '');
      const finishResult = call('LMSFinish', '');

      return isSuccessfulResult(commitResult) && isSuccessfulResult(finishResult);
    },
  };
}
