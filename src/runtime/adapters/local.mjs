/* eslint-disable import/prefer-default-export */

function parseStoredNumber(value) {
  if (value == null) {
    return null;
  }

  const parsed = Number.parseFloat(value);
  return Number.isNaN(parsed) ? null : parsed;
}

function setStoredValue(storage, key, value) {
  if (!storage || typeof storage.setItem !== 'function') {
    return;
  }

  storage.setItem(key, value);
}

export function createLocalAdapter({
  enabled = false,
  unitId = null,
  storage = null,
  send = null,
} = {}) {
  function canPersist() {
    return enabled && unitId != null && storage != null;
  }

  function synchronize(eventName, payload) {
    if (typeof send === 'function') {
      send(eventName, payload);
    }
  }

  function setElapsedTime(elapsedMs) {
    if (!canPersist()) {
      return;
    }

    setStoredValue(storage, `${unitId}_total_time`, elapsedMs);
  }

  return {
    protocol: 'Local',
    restore() {
      if (!canPersist() || typeof storage.getItem !== 'function') {
        return null;
      }

      const elapsedMs = parseStoredNumber(storage.getItem(`${unitId}_total_time`));
      const progressRatio = parseStoredNumber(storage.getItem(`${unitId}_progress`));
      const score = parseStoredNumber(storage.getItem(`${unitId}_score`));

      if (elapsedMs == null && progressRatio == null && score == null) {
        return null;
      }

      return {
        elapsedMs,
        progressRatio,
        progressPercent: progressRatio == null ? null : progressRatio * 100,
        score,
      };
    },
    start() {
      return true;
    },
    setProgress({
      elapsedMs,
      progressRatio,
    }) {
      setElapsedTime(elapsedMs);

      if (canPersist()) {
        setStoredValue(storage, `${unitId}_progress`, progressRatio);
        synchronize('synchronize', [progressRatio, 'syncProgress', true]);
      }
      return true;
    },
    setScore({
      elapsedMs,
      score,
      scoreMin,
      scoreMax,
    }) {
      setElapsedTime(elapsedMs);

      if (canPersist()) {
        setStoredValue(storage, `${unitId}_score`, score);
        synchronize('synchronize', [
          (score * 100) / (scoreMax - scoreMin),
          'syncScore',
          true,
        ]);
      }
      return true;
    },
    markIncomplete({
      elapsedMs,
    }) {
      setElapsedTime(elapsedMs);
      return true;
    },
    complete({
      elapsedMs,
    }) {
      setElapsedTime(elapsedMs);
      return true;
    },
    timeout({
      elapsedMs,
    }) {
      setElapsedTime(elapsedMs);
      return true;
    },
  };
}
