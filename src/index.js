/* eslint-disable radix */
/* eslint-disable no-param-reassign */
import PandaBridge from 'pandasuite-bridge';

let properties = null;

let API_2004 = null;
let API_11_12 = null;

let startTime = null;
let currentScore = 0;

/* API 2004 discover functions */

function scanFor2004API(win, nFindAPITries, maxTries) {
  while ((win.API_1484_11 == null) && (win.parent != null) && (win.parent !== win)) {
    nFindAPITries += 1;
    if (nFindAPITries > maxTries) {
      return null;
    }
    win = win.parent;
  }
  return win.API_1484_11;
}

function discoverScormAPI2004() {
  let api2004 = null;

  if ((window.parent != null) && (window.parent !== window)) {
    api2004 = scanFor2004API(window.parent, 0, 500);
    if ((api2004 == null) && (window.parent.opener != null)) {
      try {
        api2004 = scanFor2004API(window.parent.opener, 0, 500);
      // eslint-disable-next-line no-empty
      } catch (e) {}
    }
  }
  if ((api2004 == null) && (window.opener != null)) {
    try {
      api2004 = scanFor2004API(window.opener, 0, 500);
    // eslint-disable-next-line no-empty
    } catch (e) {}
  }
  return api2004;
}

/* API 1.1 1.2 discover functions */

function scanFor1112API(win, findAPITries, maxTries) {
  while ((win.API == null) && (win.parent != null) && (win.parent !== win)) {
    findAPITries += 1;

    if (findAPITries > maxTries) {
      return null;
    }
    win = win.parent;
  }
  return win.API;
}

function discoverScormAPI1112() {
  let api1112 = scanFor1112API(window, 0, 500);

  if ((api1112 == null) && (window.parent != null) && window.parent.opener) {
    try {
      api1112 = scanFor1112API(window.parent.opener, 0, 500);
    // eslint-disable-next-line no-empty
    } catch (e) {}
  }
  if ((api1112 == null) && (window.opener != null) && (typeof (window.opener) !== 'undefined')) {
    try {
      api1112 = scanFor1112API(window.opener, 0, 500);
    // eslint-disable-next-line no-empty
    } catch (e) {}
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
}

function setScormProgress(progress) {
  const tt = (new Date()).getTime() - startTime;
  // eslint-disable-next-line no-console
  console.log('scorm progress', tt, startTime, millisecondsToTime2004(tt));

  if (API_11_12 && API_11_12.LMSSetValue) {
    API_11_12.LMSSetValue('cmi.core.session_time',
      millisecondsToTime(tt));

    API_11_12.LMSSetValue('cmi.progress_measure', progress);
    API_11_12.LMSCommit('');
  }
  if (API_2004 && API_2004.Terminate) {
    const timefull = millisecondsToTime2004(tt);
    API_2004.SetValue('cmi.session_time', timefull);

    API_2004.SetValue('cmi.progress_measure', progress);
    API_2004.Commit('');
  }
  if (properties.isLocalStorage) {
    localStorage.setItem(`${properties.id}_total_time`, tt);
    localStorage.setItem(`${properties.id}_progress`, progress);
    PandaBridge.send('synchronize', [progress, 'syncProgress', true]);
  }
}

function setScormScore(score) {
  const tt = (new Date()).getTime() - startTime;
  // eslint-disable-next-line no-console
  console.log('scorm score', tt, startTime, millisecondsToTime2004(tt));

  if (API_11_12 && API_11_12.LMSSetValue) {
    API_11_12.LMSSetValue('cmi.core.session_time',
      millisecondsToTime(tt));

    API_11_12.LMSSetValue('cmi.core.score.raw', score);
    API_11_12.LMSCommit('');
  }
  if (API_2004 && API_2004.Terminate) {
    const timefull = millisecondsToTime2004(tt);
    API_2004.SetValue('cmi.session_time', timefull);

    API_2004.SetValue('cmi.score.raw', score);
    API_2004.SetValue('cmi.score.scaled', score / parseInt(properties['score.max']));
    API_2004.Commit('');
  }
  if (properties.isLocalStorage) {
    localStorage.setItem(`${properties.id}_total_time`, tt);
    localStorage.setItem(`${properties.id}_score`, score);
    PandaBridge.send('synchronize', [
      (score * 100) / (properties['score.max'] - properties['score.min']),
      'syncScore',
      true,
    ]);
  }
}

function reloadState() {
  if (properties.isLocalStorage) {
    const progress = localStorage.getItem(`${properties.id}_progress`);
    if (progress != null) {
      setScormProgress(parseFloat(progress));
    }
    const score = localStorage.getItem(`${properties.id}_score`);
    if (score != null) {
      currentScore = parseFloat(score);
      setScormScore(currentScore);
    }
    const tt = localStorage.getItem(`${properties.id}_total_time`);
    if (tt != null) {
      startTime = (new Date()).getTime() - parseInt(tt);
    }
  }
  if (startTime == null) {
    startTime = (new Date()).getTime();
  }
}

function startSession() {
  reloadState();

  if (API_11_12 && API_11_12.LMSInitialize) {
    API_11_12.LMSInitialize('');
    API_11_12.LMSSetValue('cmi.core.lesson_status', 'browsed');
    API_11_12.LMSSetValue('cmi.core.score.min', properties['score.min']);
    API_11_12.LMSSetValue('cmi.core.score.max', properties['score.max']);
    API_11_12.LMSCommit('');
  }
  if (API_2004 && API_2004.Initialize) {
    API_2004.Initialize('');
    API_2004.SetValue('cmi.score.min', properties['score.min']);
    API_2004.SetValue('cmi.score.max', properties['score.max']);
    API_2004.Commit('');
  }
}

function initSession() {
  if (API_2004 == null && API_11_12 == null) {
    try {
      discoverScormAPI();
    // eslint-disable-next-line no-empty
    } catch (e) {}
  }

  if (startTime == null) {
    startSession();
  }
}

PandaBridge.init(() => {
  PandaBridge.onLoad((pandaData) => {
    properties = pandaData.properties;

    initSession();
  });

  PandaBridge.listen('start', () => {
    startSession();
  });

  PandaBridge.listen('incomplete', () => {
    const tt = (new Date()).getTime() - startTime;

    if (API_11_12 && API_11_12.LMSSetValue) {
      API_11_12.LMSSetValue('cmi.core.lesson_status', 'incomplete');
      API_11_12.LMSSetValue('cmi.core.session_time',
        millisecondsToTime(tt));
      API_11_12.LMSCommit('');
    }
    if (API_2004 && API_2004.SetValue) {
      const timefull = millisecondsToTime2004(tt);
      API_2004.SetValue('cmi.completion_status', 'incomplete');
      API_2004.SetValue('cmi.session_time', timefull);
      API_2004.Commit('');
    }
    if (properties.isLocalStorage) {
      localStorage.setItem(`${properties.id}_total_time`, tt);
    }
  });

  PandaBridge.listen('complete', () => {
    const tt = (new Date()).getTime() - startTime;

    if (API_11_12 && API_11_12.LMSSetValue) {
      API_11_12.LMSSetValue('cmi.core.session_time',
        millisecondsToTime(tt));
      API_11_12.LMSSetValue('cmi.core.lesson_status', 'completed');
      API_11_12.LMSCommit('');
      API_11_12.LMSFinish('');
    }
    if (API_2004 && API_2004.Terminate) {
      const timefull = millisecondsToTime2004(tt);
      API_2004.SetValue('cmi.session_time', timefull);
      API_2004.SetValue('cmi.completion_status', 'completed');
      API_2004.Commit('');
      API_2004.Terminate('');
    }
    if (properties.isLocalStorage) {
      localStorage.setItem(`${properties.id}_total_time`, tt);
    }
  });

  PandaBridge.listen('timedout', () => {
    if (API_11_12 && API_11_12.LMSSetValue) {
      API_11_12.LMSSetValue('cmi.core.exit', 'time-out');
      API_11_12.LMSCommit('');
      API_11_12.LMSFinish('');
    }
    if (API_2004 && API_2004.Terminate) {
      API_2004.SetValue('cmi.core.exit', 'time-out');
      API_2004.SetValue('cmi.exit', 'time-out');
      API_2004.Commit('');
      API_2004.Terminate('');
    }
  });

  PandaBridge.listen('progress', (args) => {
    const props = args[0] || {};
    const progress = parseFloat(props.value || 0) / 100;

    initSession();
    setScormProgress(progress);
  });

  PandaBridge.listen('score', (args) => {
    const props = args[0] || {};
    currentScore = parseInt(props.value || 0);

    initSession();
    setScormScore(currentScore);
  });

  PandaBridge.listen('incScore', (args) => {
    const props = args[0] || {};
    const value = parseInt(props.value || 0);

    initSession();
    currentScore += value;
    setScormScore(currentScore);
  });

  PandaBridge.listen('decScore', (args) => {
    const props = args[0] || {};
    const value = parseInt(props.value || 0);

    initSession();
    currentScore -= value;
    setScormScore(currentScore);
  });
});
