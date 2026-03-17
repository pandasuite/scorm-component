const REQUIRED_CMI5_PARAMS = [
  'endpoint',
  'fetch',
  'registration',
  'activityid',
  'actor',
];

function getQueryString({
  queryString = '',
  locationSearch = '',
} = {}) {
  if (typeof queryString === 'string' && queryString.length > 0) {
    return queryString;
  }

  if (typeof locationSearch === 'string' && locationSearch.length > 0) {
    return locationSearch;
  }

  return '';
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

  REQUIRED_CMI5_PARAMS.forEach((key) => {
    values[key] = searchParams.get(key);
  });

  const missingParams = REQUIRED_CMI5_PARAMS.filter((key) => !hasValue(values[key]));
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
    activityId: values.activityid,
    activityid: values.activityid,
    actor: values.actor,
    actorJson,
  };
}

export function selectProtocol(options = {}) {
  const queryString = getQueryString(options);
  const hasScorm2004 = options.hasScorm2004 === true || !!options.scorm2004Api;
  const hasScorm12 = options.hasScorm12 === true || !!options.scorm12Api;
  const cmi5 = parseCmi5LaunchContext(queryString);

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
