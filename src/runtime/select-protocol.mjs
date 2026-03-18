const REQUIRED_CMI5_PARAMS = [
  'endpoint',
  'fetch',
  'registration',
  'actor',
];

function appendQueryStringCandidate(candidates, value) {
  if (typeof value !== 'string' || value.length === 0) {
    return;
  }

  if (!candidates.includes(value)) {
    candidates.push(value);
  }
}

function getQueryStrings({
  queryString = '',
  queryStrings = [],
  locationSearch = '',
} = {}) {
  const candidates = [];

  appendQueryStringCandidate(candidates, queryString);

  if (Array.isArray(queryStrings)) {
    queryStrings.forEach((candidate) => {
      appendQueryStringCandidate(candidates, candidate);
    });
  }

  appendQueryStringCandidate(candidates, locationSearch);

  if (candidates.length > 0) {
    return candidates;
  }

  return [''];
}

function hasValue(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function parseActorJson(actorValue) {
  if (!hasValue(actorValue)) {
    return null;
  }

  try {
    return JSON.parse(actorValue);
  } catch (error) {
    return null;
  }
}

export function parseCmi5LaunchContext(queryString = '') {
  const searchParams = new URLSearchParams(queryString);
  const values = {};
  const activityId = searchParams.get('activityId') || searchParams.get('activityid');

  REQUIRED_CMI5_PARAMS.forEach((key) => {
    values[key] = searchParams.get(key);
  });

  const missingParams = REQUIRED_CMI5_PARAMS.filter((key) => !hasValue(values[key]));
  if (!hasValue(activityId)) {
    missingParams.push('activityId');
  }

  if (missingParams.length > 0) {
    return null;
  }

  const actorJson = parseActorJson(values.actor);
  if (actorJson == null) {
    return null;
  }

  return {
    endpoint: values.endpoint,
    fetch: values.fetch,
    registration: values.registration,
    activityId,
    activityid: activityId,
    actor: values.actor,
    actorJson,
  };
}

export function selectProtocol(options = {}) {
  const queryStrings = getQueryStrings(options);
  const hasScorm2004 = options.hasScorm2004 === true || !!options.scorm2004Api;
  const hasScorm12 = options.hasScorm12 === true || !!options.scorm12Api;
  let cmi5 = null;

  queryStrings.some((queryString) => {
    cmi5 = parseCmi5LaunchContext(queryString);
    return cmi5 != null;
  });

  if (cmi5 != null) {
    return {
      protocol: 'cmi5',
      context: {
        cmi5,
        hasScorm2004,
        hasScorm12,
      },
    };
  }

  if (hasScorm2004) {
    return {
      protocol: 'scorm2004',
      context: {
        cmi5: null,
        hasScorm2004,
        hasScorm12,
      },
    };
  }

  if (hasScorm12) {
    return {
      protocol: 'scorm12',
      context: {
        cmi5: null,
        hasScorm2004,
        hasScorm12,
      },
    };
  }

  return {
    protocol: 'local',
    context: {
      cmi5: null,
      hasScorm2004,
      hasScorm12,
    },
  };
}
