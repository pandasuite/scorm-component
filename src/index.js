/* eslint-disable radix */
/* eslint-disable no-param-reassign */
import PandaBridge from 'pandasuite-bridge';
import {
  createLogger,
  DEBUG_STORAGE_KEY,
  isDebugLoggingEnabled,
} from './logging';
import { createLocalAdapter } from './runtime/adapters/local';
import { createCmi5Adapter } from './runtime/adapters/cmi5';
import { createScorm12Adapter } from './runtime/adapters/scorm12';
import { createScorm2004Adapter } from './runtime/adapters/scorm2004';
import { selectProtocol } from './runtime/select-protocol';
import { createTracker } from './runtime/tracker-core';

let properties = null;

let API_2004 = null;
let API_11_12 = null;
let runtimeSelection = {
  protocol: 'local',
  context: {
    cmi5: null,
    hasScorm2004: false,
    hasScorm12: false,
  },
};
let tracker = null;

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
let lastRuntimeSelectionSignature = null;

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
  if (runtimeSelection.protocol === 'cmi5') {
    return 'CMI5';
  }

  if (runtimeSelection.protocol === 'scorm2004' || API_2004) {
    return 'SCORM 2004';
  }

  if (runtimeSelection.protocol === 'scorm12' || API_11_12) {
    return 'SCORM 1.2';
  }

  if (runtimeSelection.protocol === 'local') {
    return 'Local';
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
    if (runtimeSelection.protocol === 'cmi5' || runtimeSelection.protocol === 'local') {
      return;
    }

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

function logRuntimeSelection() {
  const signature = [
    runtimeSelection.protocol,
    runtimeSelection.context.hasScorm2004,
    runtimeSelection.context.hasScorm12,
    runtimeSelection.context.cmi5 != null,
  ].join(':');

  if (signature === lastRuntimeSelectionSignature) {
    return;
  }

  lastRuntimeSelectionSignature = signature;

  logInfo('Protocol selected', {
    protocol: getActiveProtocol(),
    hasScorm2004: runtimeSelection.context.hasScorm2004,
    hasScorm12: runtimeSelection.context.hasScorm12,
    hasCmi5LaunchContext: runtimeSelection.context.cmi5 != null,
  });
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

function discoverScormAPI() {
  API_2004 = discoverScormAPI2004();
  API_11_12 = discoverScormAPI1112();
  runtimeSelection = selectProtocol({
    queryString: window.location && window.location.search,
    hasScorm2004: !!API_2004,
    hasScorm12: !!API_11_12,
  });
  logRuntimeSelection();
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

function getBrowserStorage() {
  try {
    return window.localStorage;
  } catch (error) {
    return null;
  }
}

function getRuntimeLogger() {
  return {
    debug: logDebug,
    info: logInfo,
    warn: logWarn,
    error: logError,
  };
}

function sendBridgeEvent(eventName, payload) {
  PandaBridge.send(eventName, payload);
}

function getLocalStorageKeyPrefix(unitId) {
  if (
    runtimeSelection.protocol === 'cmi5'
    && runtimeSelection.context.cmi5
    && unitId
  ) {
    return `${unitId}:cmi5:${runtimeSelection.context.cmi5.registration}`;
  }

  return unitId;
}

function createRuntimeTracker() {
  const runtimeLogger = getRuntimeLogger();
  const storage = getBrowserStorage();
  const isLocalStorage = !!(properties && properties.isLocalStorage);
  const unitId = properties && properties[PandaBridge.UNIQUE_ID];
  const localStorageKeyPrefix = getLocalStorageKeyPrefix(unitId);
  const companionAdapters = [];
  let adapter = null;

  if (runtimeSelection.protocol === 'scorm2004' && API_2004) {
    adapter = createScorm2004Adapter({
      api: API_2004,
      logger: runtimeLogger,
    });
  } else if (runtimeSelection.protocol === 'cmi5' && runtimeSelection.context.cmi5) {
    adapter = createCmi5Adapter({
      launchContext: runtimeSelection.context.cmi5,
      fetchFn: (...args) => window.fetch(...args),
      logger: runtimeLogger,
    });
  } else if (runtimeSelection.protocol === 'scorm12' && API_11_12) {
    adapter = createScorm12Adapter({
      api: API_11_12,
      logger: runtimeLogger,
    });
  } else if (runtimeSelection.protocol === 'local') {
    adapter = createLocalAdapter({
      enabled: isLocalStorage,
      unitId,
      storageKeyPrefix: localStorageKeyPrefix,
      storage,
      send: sendBridgeEvent,
    });
  }

  if (runtimeSelection.protocol !== 'local' && isLocalStorage) {
    companionAdapters.push(createLocalAdapter({
      enabled: true,
      unitId,
      storageKeyPrefix: localStorageKeyPrefix,
      storage,
      send: sendBridgeEvent,
    }));
  }

  return createTracker({
    adapter,
    companionAdapters,
    properties,
    logger: runtimeLogger,
  });
}

function refreshRuntimeTracker() {
  const currentState = tracker ? tracker.getState() : null;

  if (
    currentState
    && (currentState.sessionStarting || currentState.sessionStarted || currentState.sessionFinished)
  ) {
    return;
  }

  ensureScormAPI();
  tracker = createRuntimeTracker();
}

function getTracker(actionName) {
  refreshRuntimeTracker();

  if (tracker) {
    return tracker;
  }

  logWarn(`Ignoring "${actionName}" because the component is not ready yet`, {
    loaded: properties != null,
    protocol: getActiveProtocol(),
  });
  return null;
}

function runTrackerAction(actionName, handler) {
  const activeTracker = getTracker(actionName);
  if (!activeTracker) {
    return;
  }

  Promise.resolve(handler(activeTracker)).catch((error) => {
    logError(`Unexpected error during "${actionName}"`, formatError(error));
  });
}

PandaBridge.init(() => {
  PandaBridge.onLoad((pandaData) => {
    properties = pandaData.properties;
    logInfo('Component loaded', getComponentConfigSummary());
    ensureScormAPI();
    tracker = createRuntimeTracker();
  });

  PandaBridge.listen('start', () => {
    runTrackerAction('start', (activeTracker) => activeTracker.start());
  });

  PandaBridge.listen('incomplete', () => {
    runTrackerAction('incomplete', (activeTracker) => activeTracker.incomplete());
  });

  PandaBridge.listen('complete', () => {
    runTrackerAction('complete', (activeTracker) => activeTracker.complete());
  });

  PandaBridge.listen('timedout', () => {
    runTrackerAction('timedout', (activeTracker) => activeTracker.timedout());
  });

  PandaBridge.listen('progress', (args) => {
    const props = args[0] || {};
    runTrackerAction('progress', (activeTracker) => activeTracker.progress(parseFloat(props.value || 0)));
  });

  PandaBridge.listen('score', (args) => {
    const props = args[0] || {};
    runTrackerAction('score', (activeTracker) => activeTracker.score(parseInt(props.value || 0)));
  });

  PandaBridge.listen('incScore', (args) => {
    const props = args[0] || {};
    runTrackerAction('incScore', (activeTracker) => activeTracker.incScore(parseInt(props.value || 0)));
  });

  PandaBridge.listen('decScore', (args) => {
    const props = args[0] || {};
    runTrackerAction('decScore', (activeTracker) => activeTracker.decScore(parseInt(props.value || 0)));
  });
});
