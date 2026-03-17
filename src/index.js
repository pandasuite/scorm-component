/* eslint-disable radix */
/* eslint-disable no-param-reassign */
import PandaBridge from 'pandasuite-bridge';
import {
  createLogger,
  DEBUG_STORAGE_KEY,
  isDebugLoggingEnabled,
} from './logging';

let properties = null;

let API_2004 = null;
let API_11_12 = null;

let startTime = null;
let currentScore = 0;
let sessionStarted = false;
let sessionFinished = false;

const SCORE_MIN_KEY = 'score.min';
const SCORE_MAX_KEY = 'score.max';

function getStoredDebugFlag() {
  try {
    return window.localStorage.getItem(DEBUG_STORAGE_KEY);
  } catch (error) {
    return null;
  }
}

function isDebugEnabled() {
  return isDebugLoggingEnabled({
    properties,
    storageValue: getStoredDebugFlag(),
  });
}

const logger = createLogger({
  prefix: '[scorm-component]',
  isDebugEnabled: () => isDebugEnabled(),
});

let lastApiStateSignature = null;

function logDebug(message, details) {
  logger.debug(message, details);
}

function logInfo(message, details) {
  logger.info(message, details);
}

function logWarn(message, details) {
  logger.warn(message, details);
}

function logError(message, details) {
  logger.error(message, details);
}

function getActiveProtocol() {
  if (API_11_12) {
    return 'SCORM 1.2';
  }

  if (API_2004) {
    return 'SCORM 2004';
  }

  return null;
}

function getComponentConfigSummary() {
  return {
    unitId: properties && properties[PandaBridge.UNIQUE_ID],
    isLocalStorage: !!(properties && properties.isLocalStorage),
    scoreMin: properties && properties[SCORE_MIN_KEY],
    scoreMax: properties && properties[SCORE_MAX_KEY],
    debugEnabled: isDebugEnabled(),
  };
}

function getSessionState() {
  return {
    protocol: getActiveProtocol(),
    sessionStarted,
    sessionFinished,
    startTime,
  };
}

function formatError(error) {
  if (!error) {
    return null;
  }

  return {
    name: error.name,
    message: error.message,
  };
}

function getWindowDebugInfo(win, label) {
  const info = {
    label,
  };

  try {
    info.href = win.location && win.location.href;
    info.origin = win.location && win.location.origin;
  } catch (error) {
    info.locationError = formatError(error);
  }

  try {
    info.hasParent = !!win.parent;
    info.isTop = win.parent === win;
  } catch (error) {
    info.parentStateError = formatError(error);
  }

  try {
    info.hasOpener = !!win.opener;
  } catch (error) {
    info.openerStateError = formatError(error);
  }

  return info;
}

function logApiState() {
  let signature = 'missing';

  if (API_11_12) {
    signature = 'scorm12';
  } else if (API_2004) {
    signature = 'scorm2004';
  }

  if (signature === lastApiStateSignature) {
    return;
  }

  lastApiStateSignature = signature;

  if (signature === 'missing') {
    logError('No SCORM API available after discovery', {
      currentWindow: getWindowDebugInfo(window, 'ensureScormAPI'),
      referrer: document.referrer,
      ancestorOrigins: window.location.ancestorOrigins
        ? Array.from(window.location.ancestorOrigins)
        : [],
    });
    return;
  }

  logInfo('SCORM API ready', {
    protocol: getActiveProtocol(),
    scorm12: !!API_11_12,
    scorm2004: !!API_2004,
  });
}

function getScorm12ErrorDetails() {
  if (!API_11_12 || !API_11_12.LMSGetLastError) {
    return null;
  }

  const code = API_11_12.LMSGetLastError();
  return {
    code,
    errorString: API_11_12.LMSGetErrorString ? API_11_12.LMSGetErrorString(code) : null,
    diagnostic: API_11_12.LMSGetDiagnostic ? API_11_12.LMSGetDiagnostic(code) : null,
  };
}

function getScorm2004ErrorDetails() {
  if (!API_2004 || !API_2004.GetLastError) {
    return null;
  }

  const code = API_2004.GetLastError();
  return {
    code,
    errorString: API_2004.GetErrorString ? API_2004.GetErrorString(code) : null,
    diagnostic: API_2004.GetDiagnostic ? API_2004.GetDiagnostic(code) : null,
  };
}

function isScormCallFailure(result, errorDetails) {
  if (result === false || result === 'false') {
    return true;
  }

  if (!errorDetails || errorDetails.code == null) {
    return false;
  }

  return `${errorDetails.code}` !== '0';
}

function isSuccessfulScormResult(result) {
  return result === true || result === 'true';
}

function logScormCall(protocol, method, args, result, errorDetails) {
  const payload = {
    protocol,
    method,
    args,
    result,
    error: errorDetails,
  };

  if (isScormCallFailure(result, errorDetails)) {
    logError('SCORM call failed', payload);
    return;
  }

  logDebug('SCORM call', payload);
}

function callScorm12(method, ...args) {
  if (!API_11_12 || typeof API_11_12[method] !== 'function') {
    return null;
  }

  const result = API_11_12[method](...args);
  logScormCall('SCORM 1.2', method, args, result, getScorm12ErrorDetails());
  return result;
}

function callScorm2004(method, ...args) {
  if (!API_2004 || typeof API_2004[method] !== 'function') {
    return null;
  }

  const result = API_2004[method](...args);
  logScormCall('SCORM 2004', method, args, result, getScorm2004ErrorDetails());
  return result;
}

/* API 2004 discover functions */

function scanFor2004API(win, nFindAPITries, maxTries) {
  while (win) {
    try {
      if (win.API_1484_11 != null) {
        return win.API_1484_11;
      }
    } catch (error) {
      logDebug('SCORM 2004 scan blocked while reading API', {
        window: getWindowDebugInfo(win, 'scanFor2004API'),
        error: formatError(error),
      });
      return null;
    }

    let parentWin = null;
    try {
      parentWin = win.parent;
      if (parentWin == null || parentWin === win) {
        return null;
      }
    } catch (error) {
      logDebug('SCORM 2004 scan blocked while reading parent', {
        window: getWindowDebugInfo(win, 'scanFor2004API'),
        error: formatError(error),
      });
      return null;
    }

    nFindAPITries += 1;
    if (nFindAPITries > maxTries) {
      return null;
    }
    win = parentWin;
  }

  return null;
}

function discoverScormAPI2004() {
  let api2004 = null;
  logDebug('Starting SCORM 2004 discovery', getWindowDebugInfo(window, 'current-window'));

  if ((window.parent != null) && (window.parent !== window)) {
    api2004 = scanFor2004API(window.parent, 0, 500);
    if ((api2004 == null) && (window.parent.opener != null)) {
      try {
        api2004 = scanFor2004API(window.parent.opener, 0, 500);
      } catch (e) {
        logDebug('SCORM 2004 discovery failed via parent.opener', formatError(e));
      }
    }
  }
  if ((api2004 == null) && (window.opener != null)) {
    try {
      api2004 = scanFor2004API(window.opener, 0, 500);
    } catch (e) {
      logDebug('SCORM 2004 discovery failed via opener', formatError(e));
    }
  }
  return api2004;
}

/* API 1.1 1.2 discover functions */

function scanFor1112API(win, findAPITries, maxTries) {
  while (win) {
    try {
      if (win.API != null) {
        return win.API;
      }
    } catch (error) {
      logDebug('SCORM 1.2 scan blocked while reading API', {
        window: getWindowDebugInfo(win, 'scanFor1112API'),
        error: formatError(error),
      });
      return null;
    }

    let parentWin = null;
    try {
      parentWin = win.parent;
      if (parentWin == null || parentWin === win) {
        return null;
      }
    } catch (error) {
      logDebug('SCORM 1.2 scan blocked while reading parent', {
        window: getWindowDebugInfo(win, 'scanFor1112API'),
        error: formatError(error),
      });
      return null;
    }

    findAPITries += 1;

    if (findAPITries > maxTries) {
      return null;
    }
    win = parentWin;
  }

  return null;
}

function discoverScormAPI1112() {
  let api1112 = null;
  logDebug('Starting SCORM 1.2 discovery', getWindowDebugInfo(window, 'current-window'));

  try {
    api1112 = scanFor1112API(window, 0, 500);
  } catch (error) {
    logDebug('SCORM 1.2 discovery failed on current window scan', formatError(error));
  }

  if ((api1112 == null) && (window.parent != null) && window.parent.opener) {
    try {
      api1112 = scanFor1112API(window.parent.opener, 0, 500);
    } catch (e) {
      logDebug('SCORM 1.2 discovery failed via parent.opener', formatError(e));
    }
  }
  if ((api1112 == null) && (window.opener != null) && (typeof (window.opener) !== 'undefined')) {
    try {
      api1112 = scanFor1112API(window.opener, 0, 500);
    } catch (e) {
      logDebug('SCORM 1.2 discovery failed via opener', formatError(e));
    }
  }
  return api1112;
}

/* SCORM utils */

function millisecondsToTime(seconds) {
  seconds = Math.round(seconds / 1000);

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

function millisecondsToTime2004(seconds) {
  seconds = Math.round(seconds / 1000);

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

function discoverScormAPI() {
  API_2004 = discoverScormAPI2004();
  API_11_12 = discoverScormAPI1112();
  logApiState();
}

function ensureScormAPI() {
  if (API_2004 == null && API_11_12 == null) {
    try {
      discoverScormAPI();
    } catch (e) {
      logError('Unexpected error during SCORM API discovery', formatError(e));
    }
  }

  logApiState();

  return API_2004 != null || API_11_12 != null;
}

function ensureSessionStarted(actionName) {
  ensureScormAPI();

  if (sessionFinished) {
    logWarn(`Ignoring "${actionName}" because the session is already finished`, getSessionState());
    return false;
  }

  if (!sessionStarted || startTime == null) {
    logWarn(`Ignoring "${actionName}" because the session has not been started yet`, getSessionState());
    return false;
  }

  return true;
}

function setScormProgress(progress) {
  const {
    isLocalStorage,
    [PandaBridge.UNIQUE_ID]: unitId,
  } = properties;
  const progressBookmark = `${Math.round(progress * 100)}`;

  const tt = (new Date()).getTime() - startTime;

  if (API_11_12 && API_11_12.LMSSetValue) {
    callScorm12('LMSSetValue', 'cmi.core.session_time', millisecondsToTime(tt));
    const locationResult = callScorm12('LMSSetValue', 'cmi.core.lesson_location', progressBookmark);
    const commitResult = callScorm12('LMSCommit', '');
    const details = {
      protocol: 'SCORM 1.2',
      progress,
      progressBookmark,
      target: 'cmi.core.lesson_location',
      elapsedMs: tt,
    };

    if (isSuccessfulScormResult(locationResult) && isSuccessfulScormResult(commitResult)) {
      logInfo('Progress synced', details);
    } else {
      logWarn('Progress update completed with SCORM warnings', details);
    }
  }
  if (API_2004 && API_2004.Terminate) {
    const timefull = millisecondsToTime2004(tt);
    callScorm2004('SetValue', 'cmi.session_time', timefull);
    const progressResult = callScorm2004('SetValue', 'cmi.progress_measure', progress);
    const commitResult = callScorm2004('Commit', '');
    const details = {
      protocol: 'SCORM 2004',
      progress,
      target: 'cmi.progress_measure',
      elapsedMs: tt,
    };

    if (isSuccessfulScormResult(progressResult) && isSuccessfulScormResult(commitResult)) {
      logInfo('Progress synced', details);
    } else {
      logWarn('Progress update completed with SCORM warnings', details);
    }
  }
  if (isLocalStorage) {
    localStorage.setItem(`${unitId}_total_time`, tt);
    localStorage.setItem(`${unitId}_progress`, progress);
    PandaBridge.send('synchronize', [progress, 'syncProgress', true]);
  }
}

function setScormScore(score) {
  const {
    isLocalStorage,
    [PandaBridge.UNIQUE_ID]: unitId,
    [SCORE_MIN_KEY]: scoreMin,
    [SCORE_MAX_KEY]: scoreMax,
  } = properties;

  const tt = (new Date()).getTime() - startTime;

  if (API_11_12 && API_11_12.LMSSetValue) {
    callScorm12('LMSSetValue', 'cmi.core.session_time', millisecondsToTime(tt));
    const scoreResult = callScorm12('LMSSetValue', 'cmi.core.score.raw', score);
    const commitResult = callScorm12('LMSCommit', '');
    const details = {
      protocol: 'SCORM 1.2',
      score,
      scoreMin,
      scoreMax,
      target: 'cmi.core.score.raw',
      elapsedMs: tt,
    };

    if (isSuccessfulScormResult(scoreResult) && isSuccessfulScormResult(commitResult)) {
      logInfo('Score synced', details);
    } else {
      logWarn('Score update completed with SCORM warnings', details);
    }
  }
  if (API_2004 && API_2004.Terminate) {
    const timefull = millisecondsToTime2004(tt);
    callScorm2004('SetValue', 'cmi.session_time', timefull);
    const scoreRawResult = callScorm2004('SetValue', 'cmi.score.raw', score);
    const scoreScaledResult = callScorm2004('SetValue', 'cmi.score.scaled', score / parseInt(scoreMax));
    const commitResult = callScorm2004('Commit', '');
    const details = {
      protocol: 'SCORM 2004',
      score,
      scoreMin,
      scoreMax,
      targets: ['cmi.score.raw', 'cmi.score.scaled'],
      elapsedMs: tt,
    };

    if (
      isSuccessfulScormResult(scoreRawResult)
      && isSuccessfulScormResult(scoreScaledResult)
      && isSuccessfulScormResult(commitResult)
    ) {
      logInfo('Score synced', details);
    } else {
      logWarn('Score update completed with SCORM warnings', details);
    }
  }
  if (isLocalStorage) {
    localStorage.setItem(`${unitId}_total_time`, tt);
    localStorage.setItem(`${unitId}_score`, score);
    PandaBridge.send('synchronize', [
      (score * 100) / (scoreMax - scoreMin),
      'syncScore',
      true,
    ]);
  }
}

function reloadState() {
  const {
    isLocalStorage,
    [PandaBridge.UNIQUE_ID]: unitId,
  } = properties;
  let restoredProgress = null;
  let restoredScore = null;

  if (isLocalStorage) {
    const progress = localStorage.getItem(`${unitId}_progress`);
    if (progress != null) {
      restoredProgress = parseFloat(progress);
      logDebug('Restoring progress from localStorage', { restoredProgress });
    }
    const score = localStorage.getItem(`${unitId}_score`);
    if (score != null) {
      currentScore = parseFloat(score);
      restoredScore = currentScore;
      logDebug('Restoring score from localStorage', { restoredScore });
    }
    const tt = localStorage.getItem(`${unitId}_total_time`);
    if (tt != null) {
      startTime = (new Date()).getTime() - parseInt(tt);
    }
  }
  if (startTime == null) {
    startTime = (new Date()).getTime();
  }

  return {
    restoredProgress,
    restoredScore,
  };
}

function startSession() {
  const {
    [SCORE_MIN_KEY]: scoreMin,
    [SCORE_MAX_KEY]: scoreMax,
  } = properties || {};

  if (!ensureScormAPI()) {
    logError('No SCORM API found, cannot start session');
    return false;
  }

  if (sessionFinished) {
    logWarn('Ignoring start because the session is already finished', getSessionState());
    return false;
  }

  if (sessionStarted) {
    logWarn('Ignoring start because the session is already started', getSessionState());
    return true;
  }

  const {
    restoredProgress,
    restoredScore,
  } = reloadState();

  let didStart = false;
  if (API_11_12 && API_11_12.LMSInitialize) {
    const initResult = callScorm12('LMSInitialize', '');
    if (initResult === 'true') {
      didStart = true;
      callScorm12('LMSSetValue', 'cmi.core.lesson_status', 'incomplete');
      callScorm12('LMSSetValue', 'cmi.core.score.min', scoreMin);
      callScorm12('LMSSetValue', 'cmi.core.score.max', scoreMax);
      callScorm12('LMSCommit', '');
    }
  }
  if (API_2004 && API_2004.Initialize) {
    const initResult = callScorm2004('Initialize', '');
    if (initResult === 'true') {
      didStart = true;
      callScorm2004('SetValue', 'cmi.score.min', scoreMin);
      callScorm2004('SetValue', 'cmi.score.max', scoreMax);
      callScorm2004('Commit', '');
    }
  }

  sessionStarted = didStart;
  sessionFinished = false;

  if (sessionStarted) {
    if (restoredProgress != null) {
      setScormProgress(restoredProgress);
    }
    if (restoredScore != null) {
      setScormScore(restoredScore);
    }
  }

  if (!didStart) {
    logError('Session start failed', {
      protocol: getActiveProtocol(),
      scoreMin,
      scoreMax,
    });
    return didStart;
  }

  logInfo('Session started', {
    protocol: getActiveProtocol(),
    scoreMin,
    scoreMax,
    startTime,
    restoredProgress,
    restoredScore,
  });

  return didStart;
}

PandaBridge.init(() => {
  PandaBridge.onLoad((pandaData) => {
    properties = pandaData.properties;
    logInfo('Component loaded', getComponentConfigSummary());
    ensureScormAPI();
  });

  PandaBridge.listen('start', () => {
    startSession();
  });

  PandaBridge.listen('incomplete', () => {
    const {
      isLocalStorage,
      [PandaBridge.UNIQUE_ID]: unitId,
    } = properties;

    if (!ensureSessionStarted('incomplete')) {
      return;
    }

    const tt = (new Date()).getTime() - startTime;

    if (API_11_12 && API_11_12.LMSSetValue) {
      const statusResult = callScorm12('LMSSetValue', 'cmi.core.lesson_status', 'incomplete');
      callScorm12('LMSSetValue', 'cmi.core.session_time', millisecondsToTime(tt));
      const commitResult = callScorm12('LMSCommit', '');

      if (isSuccessfulScormResult(statusResult) && isSuccessfulScormResult(commitResult)) {
        logInfo('Session marked incomplete', {
          protocol: getActiveProtocol(),
          elapsedMs: tt,
        });
      } else {
        logWarn('Incomplete status update completed with SCORM warnings', {
          protocol: getActiveProtocol(),
          elapsedMs: tt,
        });
      }
    }
    if (API_2004 && API_2004.SetValue) {
      const timefull = millisecondsToTime2004(tt);
      const statusResult = callScorm2004('SetValue', 'cmi.completion_status', 'incomplete');
      callScorm2004('SetValue', 'cmi.session_time', timefull);
      const commitResult = callScorm2004('Commit', '');

      if (isSuccessfulScormResult(statusResult) && isSuccessfulScormResult(commitResult)) {
        logInfo('Session marked incomplete', {
          protocol: getActiveProtocol(),
          elapsedMs: tt,
        });
      } else {
        logWarn('Incomplete status update completed with SCORM warnings', {
          protocol: getActiveProtocol(),
          elapsedMs: tt,
        });
      }
    }
    if (isLocalStorage) {
      localStorage.setItem(`${unitId}_total_time`, tt);
    }
  });

  PandaBridge.listen('complete', () => {
    const {
      isLocalStorage,
      [PandaBridge.UNIQUE_ID]: unitId,
    } = properties;

    if (!ensureSessionStarted('complete')) {
      return;
    }

    const tt = (new Date()).getTime() - startTime;

    if (API_11_12 && API_11_12.LMSSetValue) {
      callScorm12('LMSSetValue', 'cmi.core.session_time', millisecondsToTime(tt));
      const statusResult = callScorm12('LMSSetValue', 'cmi.core.lesson_status', 'completed');
      const commitResult = callScorm12('LMSCommit', '');
      const finishResult = callScorm12('LMSFinish', '');

      if (
        isSuccessfulScormResult(statusResult)
        && isSuccessfulScormResult(commitResult)
        && isSuccessfulScormResult(finishResult)
      ) {
        logInfo('Session completed', {
          protocol: getActiveProtocol(),
          elapsedMs: tt,
        });
      } else {
        logWarn('Session completion completed with SCORM warnings', {
          protocol: getActiveProtocol(),
          elapsedMs: tt,
        });
      }
    }
    if (API_2004 && API_2004.Terminate) {
      const timefull = millisecondsToTime2004(tt);
      callScorm2004('SetValue', 'cmi.session_time', timefull);
      const statusResult = callScorm2004('SetValue', 'cmi.completion_status', 'completed');
      const commitResult = callScorm2004('Commit', '');
      const terminateResult = callScorm2004('Terminate', '');

      if (
        isSuccessfulScormResult(statusResult)
        && isSuccessfulScormResult(commitResult)
        && isSuccessfulScormResult(terminateResult)
      ) {
        logInfo('Session completed', {
          protocol: getActiveProtocol(),
          elapsedMs: tt,
        });
      } else {
        logWarn('Session completion completed with SCORM warnings', {
          protocol: getActiveProtocol(),
          elapsedMs: tt,
        });
      }
    }
    if (isLocalStorage) {
      localStorage.setItem(`${unitId}_total_time`, tt);
    }

    sessionStarted = false;
    sessionFinished = true;
  });

  PandaBridge.listen('timedout', () => {
    if (!ensureSessionStarted('timedout')) {
      return;
    }

    if (API_11_12 && API_11_12.LMSSetValue) {
      callScorm12('LMSSetValue', 'cmi.core.exit', 'time-out');
      callScorm12('LMSCommit', '');
      callScorm12('LMSFinish', '');
    }
    if (API_2004 && API_2004.Terminate) {
      callScorm2004('SetValue', 'cmi.core.exit', 'time-out');
      callScorm2004('SetValue', 'cmi.exit', 'time-out');
      callScorm2004('Commit', '');
      callScorm2004('Terminate', '');
    }

    sessionStarted = false;
    sessionFinished = true;
    logWarn('Session timed out', {
      protocol: getActiveProtocol(),
    });
  });

  PandaBridge.listen('progress', (args) => {
    const props = args[0] || {};
    const progress = parseFloat(props.value || 0) / 100;

    if (!ensureSessionStarted('progress')) {
      return;
    }

    setScormProgress(progress);
  });

  PandaBridge.listen('score', (args) => {
    const props = args[0] || {};
    currentScore = parseInt(props.value || 0);

    if (!ensureSessionStarted('score')) {
      return;
    }

    setScormScore(currentScore);
  });

  PandaBridge.listen('incScore', (args) => {
    const props = args[0] || {};
    const value = parseInt(props.value || 0);

    if (!ensureSessionStarted('incScore')) {
      return;
    }

    currentScore += value;
    setScormScore(currentScore);
  });

  PandaBridge.listen('decScore', (args) => {
    const props = args[0] || {};
    const value = parseInt(props.value || 0);

    if (!ensureSessionStarted('decScore')) {
      return;
    }

    currentScore -= value;
    setScormScore(currentScore);
  });
});
