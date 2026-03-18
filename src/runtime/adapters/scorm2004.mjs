/* eslint-disable import/prefer-default-export */

function millisecondsToTime2004(milliseconds) {
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

export function createScorm2004Adapter({
  api = null,
  logger = {},
} = {}) {
  function getErrorDetails() {
    if (!api || typeof api.GetLastError !== 'function') {
      return null;
    }

    const code = api.GetLastError();
    return {
      code,
      errorString: typeof api.GetErrorString === 'function'
        ? api.GetErrorString(code)
        : null,
      diagnostic: typeof api.GetDiagnostic === 'function'
        ? api.GetDiagnostic(code)
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
      protocol: 'SCORM 2004',
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
    protocol: 'SCORM 2004',
    start({
      scoreMin,
      scoreMax,
    }) {
      const initResult = call('Initialize', '');
      if (!isSuccessfulResult(initResult)) {
        return false;
      }

      call('SetValue', 'cmi.score.min', scoreMin);
      call('SetValue', 'cmi.score.max', scoreMax);
      call('Commit', '');
      return true;
    },
    setProgress({
      elapsedMs,
      progressRatio,
    }) {
      call('SetValue', 'cmi.session_time', millisecondsToTime2004(elapsedMs));
      const progressResult = call('SetValue', 'cmi.progress_measure', progressRatio);
      const commitResult = call('Commit', '');

      return isSuccessfulResult(progressResult) && isSuccessfulResult(commitResult);
    },
    setScore({
      elapsedMs,
      score,
      scoreMax,
    }) {
      call('SetValue', 'cmi.session_time', millisecondsToTime2004(elapsedMs));
      const rawResult = call('SetValue', 'cmi.score.raw', score);
      const scaledResult = call('SetValue', 'cmi.score.scaled', score / parseInt(scoreMax, 10));
      const commitResult = call('Commit', '');

      return (
        isSuccessfulResult(rawResult)
        && isSuccessfulResult(scaledResult)
        && isSuccessfulResult(commitResult)
      );
    },
    markIncomplete({
      elapsedMs,
    }) {
      const statusResult = call('SetValue', 'cmi.completion_status', 'incomplete');
      call('SetValue', 'cmi.session_time', millisecondsToTime2004(elapsedMs));
      const commitResult = call('Commit', '');

      return isSuccessfulResult(statusResult) && isSuccessfulResult(commitResult);
    },
    complete({
      elapsedMs,
    }) {
      call('SetValue', 'cmi.session_time', millisecondsToTime2004(elapsedMs));
      const statusResult = call('SetValue', 'cmi.completion_status', 'completed');
      const commitResult = call('Commit', '');
      const terminateResult = call('Terminate', '');

      return (
        isSuccessfulResult(statusResult)
        && isSuccessfulResult(commitResult)
        && isSuccessfulResult(terminateResult)
      );
    },
    timeout() {
      call('SetValue', 'cmi.core.exit', 'time-out');
      call('SetValue', 'cmi.exit', 'time-out');
      const commitResult = call('Commit', '');
      const terminateResult = call('Terminate', '');

      return isSuccessfulResult(commitResult) && isSuccessfulResult(terminateResult);
    },
  };
}
