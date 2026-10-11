(function exposeLiveData() {
  const WIKIPEDIA_API = 'https://en.wikipedia.org/w/api.php';
  const OPEN_METEO_GEOCODING = 'https://geocoding-api.open-meteo.com/v1/search';
  const WEATHER_CODES = Object.freeze({
    0: ['Clear sky', '☀'],
    1: ['Mainly clear', '🌤'],
    2: ['Partly cloudy', '⛅'],
    3: ['Overcast', '☁'],
    45: ['Fog', '🌫'],
    48: ['Depositing rime fog', '🌫'],
    51: ['Light drizzle', '🌦'],
    53: ['Drizzle', '🌦'],
    55: ['Heavy drizzle', '🌧'],
    56: ['Freezing drizzle', '🌧'],
    57: ['Heavy freezing drizzle', '🌧'],
    61: ['Light rain', '🌦'],
    63: ['Rain', '🌧'],
    65: ['Heavy rain', '🌧'],
    66: ['Freezing rain', '🌧'],
    67: ['Heavy freezing rain', '🌧'],
    71: ['Light snow', '🌨'],
    73: ['Snow', '❄'],
    75: ['Heavy snow', '❄'],
    77: ['Snow grains', '🌨'],
    80: ['Rain showers', '🌦'],
    81: ['Rain showers', '🌧'],
    82: ['Heavy rain showers', '🌧'],
    85: ['Snow showers', '🌨'],
    86: ['Heavy snow showers', '❄'],
    95: ['Thunderstorm', '⛈'],
    96: ['Thunderstorm with hail', '⛈'],
    99: ['Heavy thunderstorm with hail', '⛈']
  });

  function iconForCondition(condition) {
    if (typeof condition !== 'string') return '◌';
    const text = condition.toLocaleLowerCase();
    if (/thunder|storm|lightning/.test(text)) return '⛈';
    if (/snow|sleet|ice|hail/.test(text)) return '🌨';
    if (/rain|drizzle|shower/.test(text)) return '🌧';
    if (/fog|mist/.test(text)) return '🌫';
    if (/cloud|overcast/.test(text)) return '☁';
    if (/clear|sunny/.test(text)) return '☀';
    return '◌';
  }

  function safeURL(value, { protocols = ['http:', 'https:'], allowQuery = true } = {}) {
    let url;
    try {
      url = new URL(value);
    } catch {
      throw new Error('Provider returned an invalid URL.');
    }
    if (!protocols.includes(url.protocol) || url.username || url.password || url.hash || (!allowQuery && url.search)) {
      throw new Error('Provider returned an unsafe or unsupported URL.');
    }
    return url.href;
  }

  function readPath(object, path) {
    if (typeof path !== 'string' || !path.trim()) return undefined;
    return path.split('.').filter(Boolean).reduce((value, part) => {
      if (value == null) return undefined;
      return /^\d+$/.test(part) ? value[Number(part)] : value[part];
    }, object);
  }

  function requireConfig(config, { apiKey = false } = {}) {
    window.ZeroGravityAI.validateConfig(config, { requireApiKey: apiKey, requireModel: false });
  }

  function getRequestHeaders(config, auth) {
    const headers = { ...config.headers };
    if (!auth || auth.mode === 'none') return headers;
    if (!config.apiKey) throw new Error('Enter the provider API key in Own API for this browser session.');
    if (auth.mode === 'bearer') headers[auth.headerName || 'Authorization'] = `${auth.prefix ?? 'Bearer '}${config.apiKey}`;
    else if (auth.mode === 'header') headers[auth.headerName || 'X-API-Key'] = `${auth.prefix ?? ''}${config.apiKey}`;
    else throw new Error('Authentication mode must be bearer, header, or none.');
    return headers;
  }

  function errorForStatus(response, service) {
    const explanation = response.status === 401 || response.status === 403
      ? 'The provider rejected the API key or access.'
      : response.status === 404
        ? 'The configured provider endpoint was not found.'
        : response.status === 429
          ? 'The provider is rate-limiting requests or its quota is exhausted.'
          : response.status >= 500
            ? 'The provider reported a server error.'
            : `${service} request failed with HTTP ${response.status}.`;
    return new Error(`${explanation} Verify its Own API settings and try again.`);
  }

  async function fetchJSON(url, options = {}, { timeoutMs = 30000, signal } = {}) {
    const controller = new AbortController();
    const onAbort = () => controller.abort();
    if (signal?.aborted) controller.abort();
    else signal?.addEventListener('abort', onAbort, { once: true });
    const boundedTimeout = Math.max(1000, Math.min(120000, timeoutMs));
    let didTimeout = false;
    const timeout = window.setTimeout(() => {
      didTimeout = true;
      controller.abort();
    }, boundedTimeout);
    try {
      const response = await fetch(url, { ...options, signal: controller.signal });
      if (!response.ok) throw errorForStatus(response, 'Live data');
      try {
        return await response.json();
      } catch {
        throw new Error('The provider returned invalid JSON.');
      }
    } catch (error) {
      if (error.name === 'AbortError' && didTimeout) {
        throw new Error(`The live-data provider timed out after ${boundedTimeout} ms.`);
      }
      if (error.name === 'AbortError') throw error;
      if (/provider|HTTP \d{3}|invalid JSON|API key|authentication/i.test(error.message)) throw error;
      throw new Error('Could not reach the provider. Check the endpoint, network, and browser CORS settings.');
    } finally {
      window.clearTimeout(timeout);
      signal?.removeEventListener('abort', onAbort);
    }
  }

  function searchSettings(config) {
    return config.requestSettings?.search || {};
  }

  function normalizeBraveSearch(data) {
    const results = Array.isArray(data?.web?.results) ? data.web.results : [];
    return results.filter((item) => typeof item.title === 'string' && typeof item.url === 'string')
      .map((item) => ({
        title: item.title,
        summary: typeof item.description === 'string' ? item.description : '',
        source: item.meta_url?.hostname || (() => {
          try { return new URL(item.url).hostname; } catch { return ''; }
        })(),
        url: safeURL(item.url),
        publishedAt: item.published_at || item.published_date || ''
      }));
  }

  function normalizeCustomSearch(data, config) {
    const settings = searchSettings(config);
    const results = readPath(data, settings.resultsPath || 'results');
    if (!Array.isArray(results)) throw new Error('The configured search response did not contain an array at its resultsPath.');
    return results.map((item) => {
      const rawURL = readPath(item, settings.urlPath || 'url');
      const title = readPath(item, settings.titlePath || 'title');
      if (typeof rawURL !== 'string' || typeof title !== 'string' || !title.trim()) return null;
      const url = safeURL(rawURL);
      let source = '';
      try { source = new URL(url).hostname; } catch {}
      return {
        title,
        summary: typeof readPath(item, settings.summaryPath || 'description') === 'string'
          ? readPath(item, settings.summaryPath || 'description')
          : '',
        source: typeof readPath(item, settings.sourcePath || 'source') === 'string'
          ? readPath(item, settings.sourcePath || 'source')
          : source,
        url,
        publishedAt: typeof readPath(item, settings.publishedAtPath || 'publishedAt') === 'string'
          ? readPath(item, settings.publishedAtPath || 'publishedAt')
          : ''
      };
    }).filter(Boolean);
  }

  async function search(config, query, { signal } = {}) {
    if (!config || typeof config !== 'object') requireConfig(config);
    requireConfig(config, { apiKey: config.type === 'brave-search' });
    if (typeof query !== 'string' || !query.trim()) throw new Error('Enter a search topic.');
    if (!['brave-search', 'custom-search-json'].includes(config.type)) {
      throw new Error('Choose a supported Internet Search provider in Own API.');
    }
    const settings = searchSettings(config);
    const endpoint = safeURL(config.endpoint, { allowQuery: false });
    let data;
    if (config.type === 'brave-search') {
      const url = new URL(endpoint);
      url.searchParams.set('q', query.trim());
      url.searchParams.set('count', String(Math.max(1, Math.min(20, Number(settings.count) || 8))));
      data = await fetchJSON(url.href, {
        headers: {
          ...config.headers,
          [settings.apiKeyHeader || 'X-Subscription-Token']: config.apiKey,
          Accept: 'application/json'
        }
      }, { timeoutMs: config.requestSettings?.timeoutMs, signal });
      return normalizeBraveSearch(data).slice(0, 20);
    }

    const method = String(settings.method || 'GET').toUpperCase();
    const queryField = settings.queryField || 'q';
    let url = endpoint;
    const options = { method, headers: getRequestHeaders(config, settings.authentication) };
    if (method === 'GET') {
      const target = new URL(endpoint);
      target.searchParams.set(queryField, query.trim());
      if (settings.limit) target.searchParams.set(settings.limitField || 'count', String(settings.limit));
      url = target.href;
    } else if (method === 'POST') {
      const body = { ...(settings.staticBody || {}) };
      body[queryField] = query.trim();
      if (settings.limit) body[settings.limitField || 'count'] = settings.limit;
      options.headers = { ...options.headers, 'Content-Type': 'application/json' };
      options.body = JSON.stringify(body);
    } else {
      throw new Error('Custom search supports GET or POST requests.');
    }
    data = await fetchJSON(url, options, { timeoutMs: config.requestSettings?.timeoutMs, signal });
    return normalizeCustomSearch(data, config).slice(0, 20);
  }

  async function testSearch(config) {
    const startedAt = performance.now();
    const results = await search(config, 'ZeroGravity software');
    return {
      ok: true,
      status: 200,
      latencyMs: Math.round(performance.now() - startedAt),
      message: `Search request succeeded with ${results.length} valid result${results.length === 1 ? '' : 's'}.`
    };
  }

  async function searchWikipedia(query, { signal } = {}) {
    if (typeof query !== 'string' || !query.trim()) throw new Error('Enter a Wikipedia search topic.');
    const url = new URL(WIKIPEDIA_API);
    url.search = new URLSearchParams({
      action: 'query',
      generator: 'search',
      gsrsearch: query.trim(),
      gsrlimit: '5',
      prop: 'extracts|pageimages|info',
      exintro: '1',
      explaintext: '1',
      piprop: 'thumbnail',
      pithumbsize: '480',
      inprop: 'url',
      format: 'json',
      origin: '*'
    }).toString();
    const data = await fetchJSON(url.href, { headers: { Accept: 'application/json' } }, { signal });
    const pages = Object.values(data?.query?.pages || {});
    return pages.filter((page) => typeof page.title === 'string')
      .map((page) => ({
        title: page.title,
        summary: typeof page.extract === 'string' ? page.extract : '',
        thumbnail: typeof page.thumbnail?.source === 'string' ? safeURL(page.thumbnail.source) : '',
        url: typeof page.fullurl === 'string'
          ? safeURL(page.fullurl)
          : `https://en.wikipedia.org/?curid=${encodeURIComponent(page.pageid)}`,
        source: 'Wikipedia',
        publishedAt: ''
      }));
  }

  function weatherSettings(config) {
    return config.requestSettings?.weather || {};
  }

  async function geocodeCity(city, { signal } = {}) {
    if (typeof city !== 'string' || !city.trim()) throw new Error('Enter a city name.');
    const url = new URL(OPEN_METEO_GEOCODING);
    url.search = new URLSearchParams({ name: city.trim(), count: '1', language: 'en', format: 'json' }).toString();
    const data = await fetchJSON(url.href, { headers: { Accept: 'application/json' } }, { signal });
    const place = data?.results?.[0];
    if (!place || !Number.isFinite(place.latitude) || !Number.isFinite(place.longitude)) {
      throw new Error(`No location was found for “${city.trim()}”. Check the spelling or try a nearby city.`);
    }
    return {
      name: [place.name, place.admin1, place.country].filter(Boolean).join(', '),
      latitude: place.latitude,
      longitude: place.longitude,
      timezone: place.timezone || 'auto'
    };
  }

  const OPEN_METEO_FIELDS = Object.freeze({
    current: ['temperature_2m', 'apparent_temperature', 'relative_humidity_2m', 'precipitation', 'weather_code', 'wind_speed_10m'],
    hourly: ['temperature_2m', 'precipitation_probability', 'weather_code'],
    daily: ['weather_code', 'temperature_2m_max', 'temperature_2m_min', 'precipitation_probability_max', 'sunrise', 'sunset']
  });

  function normalizeWeather(data, location, units = 'celsius') {
    const current = data?.current;
    if (!current || !Number.isFinite(current.temperature_2m)) {
      throw new Error('The weather provider response did not contain current temperature data.');
    }
    const code = Number(current.weather_code);
    const [condition, icon] = WEATHER_CODES[code] || ['Unknown conditions', '◌'];
    const daily = data.daily || {};
    const hourly = data.hourly || {};
    const count = Math.min(Array.isArray(daily.time) ? daily.time.length : 0, 7);
    const providerTime = typeof current.time === 'string' ? current.time.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/) : null;
    const updatedAt = providerTime && Number.isFinite(data.utc_offset_seconds)
      ? Date.UTC(
        Number(providerTime[1]),
        Number(providerTime[2]) - 1,
        Number(providerTime[3]),
        Number(providerTime[4]),
        Number(providerTime[5])
      ) - data.utc_offset_seconds * 1000
      : Date.parse(current.time);
    const hasProviderTime = Number.isFinite(updatedAt);
    return {
      location: location.name,
      latitude: location.latitude,
      longitude: location.longitude,
      timezone: data.timezone || location.timezone || 'auto',
      updatedAt: hasProviderTime ? updatedAt : Date.now(),
      updatedAtSource: hasProviderTime ? 'provider' : 'retrieved',
      units,
      windSpeedUnit: data.current_units?.wind_speed_10m || '',
      precipitationUnit: data.current_units?.precipitation || '',
      current: {
        temperature: current.temperature_2m,
        feelsLike: Number.isFinite(current.apparent_temperature) ? current.apparent_temperature : null,
        humidity: Number.isFinite(current.relative_humidity_2m) ? current.relative_humidity_2m : null,
        windSpeed: Number.isFinite(current.wind_speed_10m) ? current.wind_speed_10m : null,
        precipitation: Number.isFinite(current.precipitation) ? current.precipitation : null,
        condition,
        icon
      },
      hourly: (hourly.time || []).slice(0, 24).map((time, index) => ({
        time,
        temperature: hourly.temperature_2m?.[index] ?? null,
        precipitationChance: hourly.precipitation_probability?.[index] ?? null,
        weatherCode: hourly.weather_code?.[index] ?? null
      })),
      daily: Array.from({ length: count }, (_, index) => {
        const dailyCode = Number(daily.weather_code?.[index]);
        return {
          date: daily.time[index],
          condition: WEATHER_CODES[dailyCode]?.[0] || 'Unknown conditions',
          icon: WEATHER_CODES[dailyCode]?.[1] || '◌',
          high: daily.temperature_2m_max?.[index] ?? null,
          low: daily.temperature_2m_min?.[index] ?? null,
          precipitationChance: daily.precipitation_probability_max?.[index] ?? null,
          sunrise: daily.sunrise?.[index] ?? null,
          sunset: daily.sunset?.[index] ?? null
        };
      }),
      alerts: Array.isArray(data.alerts) ? data.alerts : []
    };
  }

  function normalizeCustomWeather(data, config, location) {
    const fields = weatherSettings(config).response || {};
    const read = (key) => readPath(data, fields[key] || key);
    const current = read('current');
    if (!current || typeof current !== 'object') throw new Error('The custom weather response has no configured current object.');
    const temperature = readPath(current, fields.temperaturePath || 'temperature');
    if (!Number.isFinite(temperature)) throw new Error('The custom weather response is missing a numeric current temperature.');
    const code = Number(readPath(current, fields.weatherCodePath || 'weatherCode'));
    const conditionValue = readPath(current, fields.conditionPath || 'condition');
    const mappedCondition = WEATHER_CODES[code];
    const condition = mappedCondition?.[0] || (typeof conditionValue === 'string' && conditionValue.trim())
      || 'Condition not provided';
    const icon = mappedCondition?.[1] || (fields.iconPath && typeof readPath(current, fields.iconPath) === 'string'
      ? readPath(current, fields.iconPath)
      : iconForCondition(condition));
    const forecastValue = read('daily');
    const forecast = Array.isArray(forecastValue) ? forecastValue : [];
    const hours = read('hourly');
    const parsedUpdatedAt = Date.parse(read('updatedAt'));
    return {
      location: location.name,
      latitude: location.latitude,
      longitude: location.longitude,
      timezone: read('timezone') || location.timezone || 'auto',
      updatedAt: Number.isFinite(parsedUpdatedAt) ? parsedUpdatedAt : Date.now(),
      updatedAtSource: Number.isFinite(parsedUpdatedAt) ? 'provider' : 'retrieved',
      units: fields.units || 'celsius',
      windSpeedUnit: weatherSettings(config).windSpeedUnit || '',
      precipitationUnit: weatherSettings(config).precipitationUnit || '',
      current: {
        temperature,
        feelsLike: readPath(current, fields.feelsLikePath || 'feelsLike') ?? null,
        humidity: readPath(current, fields.humidityPath || 'humidity') ?? null,
        windSpeed: readPath(current, fields.windSpeedPath || 'windSpeed') ?? null,
        precipitation: readPath(current, fields.precipitationPath || 'precipitation') ?? null,
        condition,
        icon
      },
      hourly: Array.isArray(hours) ? hours.slice(0, 24).map((hour) => {
        const weatherCode = Number(readPath(hour, fields.hourlyWeatherCodePath || 'weatherCode'));
        return {
          time: readPath(hour, fields.hourlyTimePath || 'time') ?? null,
          temperature: readPath(hour, fields.hourlyTemperaturePath || 'temperature') ?? null,
          precipitationChance: readPath(hour, fields.hourlyPrecipitationChancePath || 'precipitationChance') ?? null,
          weatherCode,
          condition: WEATHER_CODES[weatherCode]?.[0]
            || readPath(hour, fields.hourlyConditionPath || 'condition')
            || 'Condition not provided',
          icon: WEATHER_CODES[weatherCode]?.[1]
            || readPath(hour, fields.hourlyIconPath || 'icon')
            || '◌'
        };
      }) : [],
      daily: forecast.slice(0, 7).map((day) => {
        const dailyCode = Number(readPath(day, fields.dailyWeatherCodePath || 'weatherCode'));
        return {
          date: readPath(day, fields.dailyDatePath || 'date'),
          condition: WEATHER_CODES[dailyCode]?.[0]
            || readPath(day, fields.conditionPath || 'condition')
            || 'Condition not provided',
          icon: WEATHER_CODES[dailyCode]?.[1]
            || readPath(day, fields.dailyIconPath || 'icon')
            || iconForCondition(readPath(day, fields.conditionPath || 'condition')),
          high: readPath(day, fields.highPath || 'high') ?? null,
          low: readPath(day, fields.lowPath || 'low') ?? null,
          precipitationChance: readPath(day, fields.dailyPrecipitationChancePath || 'precipitationChance') ?? null,
          sunrise: readPath(day, fields.sunrisePath || 'sunrise') ?? null,
          sunset: readPath(day, fields.sunsetPath || 'sunset') ?? null
        };
      }),
      alerts: Array.isArray(read('alerts')) ? read('alerts') : []
    };
  }

  async function fetchWeather(config, location, units = 'celsius', { signal } = {}) {
    requireConfig(config, { apiKey: false });
    if (!['open-meteo', 'custom-weather-json'].includes(config.type)) {
      throw new Error('Choose a supported Weather provider in Own API.');
    }
    if (!Number.isFinite(location?.latitude) || !Number.isFinite(location?.longitude)) {
      throw new Error('Choose a valid city or share a valid device location.');
    }
    if (!['celsius', 'fahrenheit'].includes(units)) throw new Error('Choose Celsius or Fahrenheit units.');
    const settings = weatherSettings(config);
    let data;
    if (config.type === 'open-meteo') {
      const url = new URL(safeURL(config.endpoint, { allowQuery: false }));
      url.search = new URLSearchParams({
        latitude: String(location.latitude),
        longitude: String(location.longitude),
        current: OPEN_METEO_FIELDS.current.join(','),
        hourly: OPEN_METEO_FIELDS.hourly.join(','),
        daily: OPEN_METEO_FIELDS.daily.join(','),
        temperature_unit: units === 'fahrenheit' ? 'fahrenheit' : 'celsius',
        wind_speed_unit: settings.windSpeedUnit || 'kmh',
        precipitation_unit: settings.precipitationUnit || 'mm',
        timezone: location.timezone || 'auto',
        forecast_days: '7'
      }).toString();
      data = await fetchJSON(url.href, { headers: { ...config.headers, Accept: 'application/json' } }, {
        timeoutMs: config.requestSettings?.timeoutMs,
        signal
      });
      return normalizeWeather(data, location, units);
    }
    const method = String(settings.method || 'GET').toUpperCase();
    if (!['GET', 'POST'].includes(method)) throw new Error('Custom weather requests support GET or POST.');
    const options = { method, headers: getRequestHeaders(config, settings.authentication) };
    let url = safeURL(config.endpoint, { allowQuery: false });
    const query = {
      [settings.latitudeField || 'latitude']: location.latitude,
      [settings.longitudeField || 'longitude']: location.longitude,
      [settings.unitsField || 'units']: units
    };
    if (method === 'GET') {
      const target = new URL(url);
      Object.entries(query).forEach(([key, value]) => target.searchParams.set(key, String(value)));
      url = target.href;
    } else {
      options.headers = { ...options.headers, 'Content-Type': 'application/json' };
      options.body = JSON.stringify({ ...settings.staticBody, ...query });
    }
    data = await fetchJSON(url, options, { timeoutMs: config.requestSettings?.timeoutMs, signal });
    return normalizeCustomWeather(data, config, location);
  }

  async function testWeather(config) {
    requireConfig(config, { apiKey: false });
    const startedAt = performance.now();
    const data = await fetchWeather(config, {
      name: 'Test location',
      latitude: 51.5072,
      longitude: -0.1276,
      timezone: 'Europe/London'
    });
    return {
      ok: true,
      status: 200,
      latencyMs: Math.round(performance.now() - startedAt),
      message: `Weather response validated; current temperature is ${data.current.temperature}°.`
    };
  }

  window.ZeroGravityLiveData = Object.freeze({
    search,
    normalizeBraveSearch,
    normalizeCustomSearch,
    searchWikipedia,
    geocodeCity,
    fetchWeather,
    normalizeWeather,
    normalizeCustomWeather,
    readPath,
    safeURL,
    weatherCodes: WEATHER_CODES,
    iconForCondition
  });
})();
