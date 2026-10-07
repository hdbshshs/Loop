'use strict';

const DEFAULTS = Object.freeze({
  cutoffHour: 16,
  milesPerTransitDay: 500,
  minimumTransitDays: 1,
  fallbackTransitDays: 4,
  nonDeliveryDays: [0], // Sunday; use [0, 6] if the carrier skips weekends.
});

/**
 * Estimate a package delivery date.
 *
 * For real routing and weather data, call createDefaultProviders() and pass its
 * return value in options. You can also pass your own provider functions.
 *
 * routingProvider({ sellerZip, buyerZip, orderDate, signal }) must return
 * { distanceMiles, routeCoordinates? }. weatherProvider receives the same
 * fields plus `route` and returns { hasSevereAlerts: boolean }.
 *
 * @param {string} sellerZip US ZIP code or ZIP+4 for the origin.
 * @param {string} buyerZip US ZIP code or ZIP+4 for the destination.
 * @param {object} [options]
 * @param {Function} [options.routingProvider]
 * @param {Function} [options.weatherProvider]
 * @param {Date|Function} [options.now]
 * @param {number|false} [options.cutoffHour=16] Local hour after which handling adds a day; false disables the cutoff.
 * @param {number} [options.milesPerTransitDay=500]
 * @param {number} [options.minimumTransitDays=1]
 * @param {number} [options.fallbackTransitDays=4]
 * @param {number[]} [options.nonDeliveryDays=[0]] Sunday=0 through Saturday=6.
 * @param {AbortSignal} [options.signal]
 * @param {Function} [options.onIssue] Receives { stage, error } for degraded estimates.
 * @returns {Promise<Date>}
 */
async function calculateRealDeliveryDate(sellerZip, buyerZip, options = {}) {
  const originZip = normalizeZip(sellerZip, 'sellerZip');
  const destinationZip = normalizeZip(buyerZip, 'buyerZip');
  const settings = normalizeOptions(options);
  const orderDate = readNow(settings.now);
  const providerContext = route => ({
    sellerZip: originZip,
    buyerZip: destinationZip,
    orderDate: new Date(orderDate.getTime()),
    ...(route === undefined ? {} : { route }),
    signal: settings.signal,
  });

  if (typeof settings.routingProvider !== 'function') {
    reportIssue(settings.onIssue, 'routing', new Error('A routingProvider is required for a route-based estimate.'));
    return addDeliveryDays(orderDate, settings.fallbackTransitDays, settings.nonDeliveryDays);
  }

  let route;
  let distanceMiles;
  try {
    route = await settings.routingProvider(providerContext());
    distanceMiles = readDistanceMiles(route);
  } catch (error) {
    reportIssue(settings.onIssue, 'routing', asError(error));
    return addDeliveryDays(orderDate, settings.fallbackTransitDays, settings.nonDeliveryDays);
  }

  let transitDays = Math.max(
    settings.minimumTransitDays,
    Math.ceil(distanceMiles / settings.milesPerTransitDay),
  );
  if (settings.cutoffHour !== null && orderDate.getHours() >= settings.cutoffHour) transitDays += 1;

  if (typeof settings.weatherProvider === 'function') {
    try {
      const weather = await settings.weatherProvider(providerContext(route));
      const severe = readSevereWeatherFlag(weather);
      if (severe === true) transitDays += 1;
      if (severe === null) {
        reportIssue(settings.onIssue, 'weather', new Error('Weather provider returned no recognized severe-alert flag.'));
      }
    } catch (error) {
      // A weather outage does not erase a valid route estimate.
      reportIssue(settings.onIssue, 'weather', asError(error));
    }
  }

  return addDeliveryDays(orderDate, transitDays, settings.nonDeliveryDays);
}

/**
 * Create usable HTTP providers for U.S. routes.
 *
 * Routing: OpenRouteService (requires ORS_API_KEY).
 * ZIP geocoding: Open-Meteo (OPEN_METEO_API_KEY may be needed for commercial use).
 * Weather: National Weather Service alerts. Set NWS_USER_AGENT to identify
 * your app, ideally with a contact address. Requires Node.js 18+ or a supplied
 * fetchImpl. Keep keys on a server; do not expose them in browser code.
 *
 * @param {object} [config]
 * @param {string} [config.orsApiKey=process.env.ORS_API_KEY]
 * @param {string} [config.openMeteoApiKey=process.env.OPEN_METEO_API_KEY]
 * @param {string} [config.nwsUserAgent=process.env.NWS_USER_AGENT]
 * @param {string} [config.routingProfile='driving-car']
 * @param {number} [config.maxWeatherPoints=8]
 * @param {number} [config.requestTimeoutMs=12000]
 * @param {Function} [config.fetchImpl=globalThis.fetch]
 * @returns {{routingProvider: Function, weatherProvider: Function}}
 */
function createDefaultProviders(config = {}) {
  if (config === null || typeof config !== 'object' || Array.isArray(config)) {
    throw new TypeError('Provider config must be an object.');
  }

  const orsApiKey = config.orsApiKey ?? readEnvironment('ORS_API_KEY');
  const openMeteoApiKey = config.openMeteoApiKey ?? readEnvironment('OPEN_METEO_API_KEY');
  const nwsUserAgent = config.nwsUserAgent ?? readEnvironment('NWS_USER_AGENT') ?? 'delivery-calculator/1.0';
  const routingProfile = config.routingProfile ?? 'driving-car';
  const maxWeatherPoints = config.maxWeatherPoints ?? 8;
  const requestTimeoutMs = config.requestTimeoutMs ?? 12000;
  const fetchImpl = config.fetchImpl ?? globalThis.fetch;

  if (typeof orsApiKey !== 'string' || orsApiKey.trim() === '') {
    throw new Error('Set ORS_API_KEY or pass { orsApiKey } to createDefaultProviders().');
  }
  if (typeof nwsUserAgent !== 'string' || nwsUserAgent.trim() === '') {
    throw new TypeError('nwsUserAgent must be a non-empty string.');
  }
  if (typeof routingProfile !== 'string' || !/^[a-z-]+$/.test(routingProfile)) {
    throw new TypeError('routingProfile must be a valid OpenRouteService profile name.');
  }
  if (!Number.isInteger(maxWeatherPoints) || maxWeatherPoints < 2 || maxWeatherPoints > 20) {
    throw new RangeError('maxWeatherPoints must be an integer from 2 through 20.');
  }
  if (!Number.isFinite(requestTimeoutMs) || requestTimeoutMs <= 0) {
    throw new RangeError('requestTimeoutMs must be a positive number.');
  }
  if (typeof fetchImpl !== 'function') {
    throw new Error('A fetch implementation is required (Node.js 18+ provides global fetch).');
  }

  const geocodeCache = new Map();
  const alertCache = new Map();

  async function geocodeZip(zip, signal) {
    const postalCode = zip.slice(0, 5);
    if (geocodeCache.has(postalCode)) return geocodeCache.get(postalCode);

    const lookup = (async () => {
      const url = new URL('https://geocoding-api.open-meteo.com/v1/search');
      url.searchParams.set('name', postalCode);
      url.searchParams.set('countryCode', 'US');
      url.searchParams.set('count', '10');
      if (openMeteoApiKey) url.searchParams.set('apikey', openMeteoApiKey);

      const data = await requestJson(fetchImpl, url, {
        headers: { Accept: 'application/json' },
      }, { signal, timeoutMs: requestTimeoutMs });
      const results = Array.isArray(data.results) ? data.results : [];
      const match = results.find(result =>
        String(result.country_code ?? '').toUpperCase() === 'US' &&
        (result.postcodes?.includes(postalCode) || result.name === postalCode) &&
        Number.isFinite(result.latitude) && Number.isFinite(result.longitude));

      if (!match) throw new Error(`Could not find coordinates for U.S. ZIP code ${postalCode}.`);
      return { latitude: match.latitude, longitude: match.longitude };
    })();

    geocodeCache.set(postalCode, lookup);
    try {
      return await lookup;
    } catch (error) {
      geocodeCache.delete(postalCode);
      throw error;
    }
  }

  const routingProvider = async ({ sellerZip, buyerZip, signal }) => {
    const [origin, destination] = await Promise.all([
      geocodeZip(sellerZip, signal),
      geocodeZip(buyerZip, signal),
    ]);
    const url = `https://api.openrouteservice.org/v2/directions/${routingProfile}/geojson`;
    const data = await requestJson(fetchImpl, url, {
      method: 'POST',
      headers: {
        Authorization: orsApiKey,
        'Content-Type': 'application/json',
        Accept: 'application/geo+json, application/json',
      },
      body: JSON.stringify({
        coordinates: [
          [origin.longitude, origin.latitude],
          [destination.longitude, destination.latitude],
        ],
      }),
    }, { signal, timeoutMs: requestTimeoutMs });

    const feature = data.features?.[0];
    const meters = feature?.properties?.summary?.distance;
    const routeCoordinates = feature?.geometry?.coordinates;
    if (!Number.isFinite(meters) || meters < 0 || !Array.isArray(routeCoordinates) || routeCoordinates.length < 2) {
      throw new Error('OpenRouteService returned an incomplete route.');
    }
    return { distanceMiles: meters / 1609.344, routeCoordinates };
  };

  const weatherProvider = async ({ sellerZip, buyerZip, route, signal }) => {
    let coordinates = route?.routeCoordinates;
    if (!Array.isArray(coordinates) || coordinates.length < 2) {
      const [origin, destination] = await Promise.all([
        geocodeZip(sellerZip, signal),
        geocodeZip(buyerZip, signal),
      ]);
      coordinates = [
        [origin.longitude, origin.latitude],
        [destination.longitude, destination.latitude],
      ];
    }

    const points = sampleRouteCoordinates(coordinates, maxWeatherPoints);
    const alerts = [];
    // Sequential requests avoid sending a burst to the public NWS API.
    for (const [longitude, latitude] of points) {
      const cacheKey = `${latitude.toFixed(2)},${longitude.toFixed(2)}`;
      let cached = alertCache.get(cacheKey);
      if (!cached || cached.expiresAt <= Date.now()) {
        const url = new URL('https://api.weather.gov/alerts/active');
        url.searchParams.set('point', `${latitude},${longitude}`);
        const data = await requestJson(fetchImpl, url, {
          headers: {
            'User-Agent': nwsUserAgent,
            Accept: 'application/geo+json',
          },
        }, { signal, timeoutMs: requestTimeoutMs });
        cached = { expiresAt: Date.now() + 30000, features: data.features ?? [] };
        alertCache.set(cacheKey, cached);
      }
      alerts.push(...cached.features);
    }

    const uniqueAlerts = [...new Map(alerts.map(alert => [alert.id ?? JSON.stringify(alert), alert])).values()];
    return {
      hasSevereAlerts: uniqueAlerts.some(isSevereNwsAlert),
      alerts: uniqueAlerts,
    };
  };

  return { routingProvider, weatherProvider };
}

function sampleRouteCoordinates(coordinates, maxPoints) {
  const valid = coordinates.filter(point =>
    Array.isArray(point) && Number.isFinite(point[0]) && Number.isFinite(point[1]));
  if (valid.length < 2) throw new Error('Route geometry did not contain usable coordinates.');

  const cumulativeMiles = [0];
  for (let i = 1; i < valid.length; i += 1) {
    cumulativeMiles.push(cumulativeMiles[i - 1] + haversineMiles(valid[i - 1], valid[i]));
  }
  const totalMiles = cumulativeMiles[cumulativeMiles.length - 1];
  if (totalMiles === 0) return [valid[0]];

  const count = Math.min(maxPoints, Math.max(2, Math.ceil(totalMiles / 150) + 1));
  const samples = [];
  let segment = 1;
  for (let i = 0; i < count; i += 1) {
    const target = totalMiles * i / (count - 1);
    while (segment < cumulativeMiles.length - 1 && cumulativeMiles[segment] < target) segment += 1;
    const before = cumulativeMiles[segment - 1];
    const span = cumulativeMiles[segment] - before;
    const ratio = span === 0 ? 0 : (target - before) / span;
    const a = valid[segment - 1];
    const b = valid[segment];
    samples.push([
      a[0] + (b[0] - a[0]) * ratio,
      a[1] + (b[1] - a[1]) * ratio,
    ]);
  }
  return [...new Map(samples.map(point => [`${point[0].toFixed(3)},${point[1].toFixed(3)}`, point])).values()];
}

function haversineMiles(a, b) {
  const radians = degrees => degrees * Math.PI / 180;
  const lat1 = radians(a[1]);
  const lat2 = radians(b[1]);
  const dLat = lat2 - lat1;
  const dLon = radians(b[0] - a[0]);
  const h = Math.min(1, Math.max(0,
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2));
  return 3958.7613 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

function isSevereNwsAlert(alert) {
  const properties = alert?.properties ?? {};
  const severity = String(properties.severity ?? '').toLowerCase();
  const event = String(properties.event ?? '').toLowerCase();
  return severity === 'severe' || severity === 'extreme' ||
    /blizzard|hurricane|tropical storm|flash flood|tornado|severe thunderstorm|ice storm|winter storm|high wind warning|flood warning/.test(event);
}

async function requestJson(fetchImpl, url, init, { signal, timeoutMs }) {
  const controller = new AbortController();
  const forwardAbort = () => controller.abort(signal?.reason);
  if (signal?.aborted) forwardAbort();
  else signal?.addEventListener('abort', forwardAbort, { once: true });
  const timeout = setTimeout(() => controller.abort(new Error('Request timed out.')), timeoutMs);

  try {
    const response = await fetchImpl(url, { ...init, signal: controller.signal });
    if (!response.ok) {
      throw new Error(`Request failed with HTTP ${response.status} (${new URL(url).host}).`);
    }
    return await response.json();
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener('abort', forwardAbort);
  }
}

function normalizeZip(value, name) {
  if (typeof value !== 'string' || !/^\d{5}(?:-\d{4})?$/.test(value.trim())) {
    throw new TypeError(`${name} must be a 5-digit U.S. ZIP code or ZIP+4.`);
  }
  return value.trim();
}

function normalizeOptions(options) {
  if (options === null || typeof options !== 'object' || Array.isArray(options)) {
    throw new TypeError('options must be an object.');
  }

  const cutoffHour = options.cutoffHour === false ? null : options.cutoffHour ?? DEFAULTS.cutoffHour;
  const milesPerTransitDay = options.milesPerTransitDay ?? DEFAULTS.milesPerTransitDay;
  const minimumTransitDays = options.minimumTransitDays ?? DEFAULTS.minimumTransitDays;
  const fallbackTransitDays = options.fallbackTransitDays ?? DEFAULTS.fallbackTransitDays;
  const nonDeliveryDays = options.nonDeliveryDays ?? DEFAULTS.nonDeliveryDays;

  if (cutoffHour !== null && (!Number.isInteger(cutoffHour) || cutoffHour < 0 || cutoffHour > 23)) {
    throw new RangeError('cutoffHour must be false or an integer from 0 through 23.');
  }
  if (!Number.isFinite(milesPerTransitDay) || milesPerTransitDay <= 0) {
    throw new RangeError('milesPerTransitDay must be a positive number.');
  }
  if (!Number.isInteger(minimumTransitDays) || minimumTransitDays < 0) {
    throw new RangeError('minimumTransitDays must be a non-negative integer.');
  }
  if (!Number.isInteger(fallbackTransitDays) || fallbackTransitDays < 0) {
    throw new RangeError('fallbackTransitDays must be a non-negative integer.');
  }
  if (!Array.isArray(nonDeliveryDays) || nonDeliveryDays.some(day => !Number.isInteger(day) || day < 0 || day > 6)) {
    throw new RangeError('nonDeliveryDays must contain weekdays from 0 (Sunday) through 6 (Saturday).');
  }
  if (new Set(nonDeliveryDays).size === 7) {
    throw new RangeError('At least one delivery weekday must remain available.');
  }
  if (options.now !== undefined && typeof options.now !== 'function' && !(options.now instanceof Date)) {
    throw new TypeError('now must be a Date or a function that returns a Date.');
  }
  if (options.routingProvider !== undefined && typeof options.routingProvider !== 'function') {
    throw new TypeError('routingProvider must be a function.');
  }
  if (options.weatherProvider !== undefined && typeof options.weatherProvider !== 'function') {
    throw new TypeError('weatherProvider must be a function.');
  }
  if (options.onIssue !== undefined && typeof options.onIssue !== 'function') {
    throw new TypeError('onIssue must be a function.');
  }

  return {
    ...options,
    cutoffHour,
    milesPerTransitDay,
    minimumTransitDays,
    fallbackTransitDays,
    nonDeliveryDays: new Set(nonDeliveryDays),
  };
}

function readNow(now) {
  const value = now === undefined ? new Date() : typeof now === 'function' ? now() : now;
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) {
    throw new TypeError('now must produce a valid Date.');
  }
  return new Date(value.getTime());
}

function readDistanceMiles(result) {
  if (result && typeof result === 'object' && result.ok === false) {
    throw new Error(`Routing provider returned an unsuccessful response${result.status ? ` (${result.status})` : ''}.`);
  }
  const candidate = typeof result === 'number'
    ? result
    : result?.distanceMiles ?? result?.distance_miles ?? result?.routes?.[0]?.distance_miles;
  if (typeof candidate !== 'number' || !Number.isFinite(candidate) || candidate < 0) {
    throw new TypeError('Routing provider must return a finite, non-negative distance in miles.');
  }
  return candidate;
}

function readSevereWeatherFlag(result) {
  if (typeof result === 'boolean') return result;
  if (result && typeof result === 'object' && result.ok === false) {
    throw new Error(`Weather provider returned an unsuccessful response${result.status ? ` (${result.status})` : ''}.`);
  }
  return typeof result?.hasSevereAlerts === 'boolean' ? result.hasSevereAlerts : null;
}

function addDeliveryDays(date, days, nonDeliveryDays) {
  const result = new Date(date.getTime());
  result.setDate(result.getDate() + days);
  for (let attempts = 0; nonDeliveryDays.has(result.getDay()); attempts += 1) {
    if (attempts >= 7) throw new RangeError('No available delivery weekday was found.');
    result.setDate(result.getDate() + 1);
  }
  return result;
}

function reportIssue(onIssue, stage, error) {
  if (!onIssue) return;
  try {
    onIssue({ stage, error });
  } catch {
    // An observability callback must not change the estimate.
  }
}

function asError(error) {
  return error instanceof Error ? error : new Error(String(error));
}

function readEnvironment(name) {
  return typeof process !== 'undefined' && process.env ? process.env[name] : undefined;
}

module.exports = { calculateRealDeliveryDate, createDefaultProviders };
