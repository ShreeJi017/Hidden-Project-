const assert = require('node:assert/strict');
const { afterEach, test } = require('node:test');

const originalFetch = global.fetch;
global.window = globalThis;
global.performance = global.performance || { now: () => Date.now() };
delete require.cache[require.resolve('../ai-provider.js')];
require('../ai-provider.js');
delete require.cache[require.resolve('../live-data.js')];
require('../live-data.js');

afterEach(() => {
  global.fetch = originalFetch;
});

function provider(type, overrides = {}) {
  return {
    id: `test-${type}`,
    functionId: type.includes('search') ? 'internet-search' : 'weather',
    type,
    name: 'Mock live provider',
    endpoint: type === 'open-meteo'
      ? 'https://api.open-meteo.com/v1/forecast'
      : type === 'brave-search'
        ? 'https://api.search.brave.com/res/v1/web/search'
        : 'https://provider.example.test/live',
    model: '',
    apiKey: type === 'brave-search' ? 'test-key' : '',
    headers: {},
    requestSettings: {},
    ...overrides
  };
}

function jsonResponse(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() { return body; }
  };
}

test('Brave search sends the configured key and returns provider-supplied citations only', async () => {
  let request;
  global.fetch = async (url, options) => {
    request = { url: new URL(url), options };
    return jsonResponse({
      web: {
        results: [{
          title: 'Recent report',
          description: 'Provider summary.',
          url: 'https://news.example.test/story',
          meta_url: { hostname: 'news.example.test' },
          page_age: '2 hours ago'
        }]
      }
    });
  };
  const results = await window.ZeroGravityLiveData.search(provider('brave-search'), 'latest topic');
  assert.equal(request.url.searchParams.get('q'), 'latest topic');
  assert.equal(request.options.headers['X-Subscription-Token'], 'test-key');
  assert.deepEqual(results, [{
    title: 'Recent report',
    summary: 'Provider summary.',
    source: 'news.example.test',
    url: 'https://news.example.test/story',
    publishedAt: ''
  }]);
});

test('search reports missing credentials, provider limits, and invalid result URLs', async () => {
  await assert.rejects(
    window.ZeroGravityLiveData.search(provider('brave-search', { apiKey: '' }), 'topic'),
    /API key/
  );
  global.fetch = async () => jsonResponse({ error: { message: 'quota' } }, 429);
  await assert.rejects(
    window.ZeroGravityLiveData.search(provider('brave-search'), 'topic'),
    /rate-limiting/
  );
  global.fetch = async () => jsonResponse({
    web: { results: [{ title: 'Unsafe', url: 'javascript:alert(1)' }] }
  });
  await assert.rejects(
    window.ZeroGravityLiveData.search(provider('brave-search'), 'topic'),
    /unsafe or unsupported URL/
  );
});

test('registers the search/weather adapters and rejects missing provider configuration', async () => {
  assert.deepEqual(window.ZeroGravityAI.getSupportedProviderTypes('internet-search'), [
    'brave-search',
    'custom-search-json'
  ]);
  assert.deepEqual(window.ZeroGravityAI.getSupportedProviderTypes('weather'), [
    'open-meteo',
    'custom-weather-json'
  ]);
  await assert.rejects(window.ZeroGravityLiveData.search(null, 'topic'), /Choose or save an API provider/);
  await assert.rejects(window.ZeroGravityLiveData.fetchWeather(null, {
    name: 'City',
    latitude: 1,
    longitude: 2
  }), /Choose or save an API provider/);
});

test('custom search honors configured request/response mappings and validates endpoint URLs', async () => {
  let request;
  const config = provider('custom-search-json', {
    requestSettings: {
      search: {
        method: 'POST',
        queryField: 'term',
        resultsPath: 'payload.items',
        titlePath: 'headline',
        summaryPath: 'excerpt',
        urlPath: 'link',
        publishedAtPath: 'date'
      }
    }
  });
  global.fetch = async (url, options) => {
    request = { url, options };
    return jsonResponse({
      payload: {
        items: [{
          headline: 'Mapped title',
          excerpt: 'Mapped summary',
          link: 'https://source.example.test/item',
          date: '2026-01-01'
        }]
      }
    });
  };
  const found = await window.ZeroGravityLiveData.search(config, 'mapped topic');
  assert.equal(JSON.parse(request.options.body).term, 'mapped topic');
  assert.equal(found[0].title, 'Mapped title');
  assert.equal(found[0].publishedAt, '2026-01-01');
  await assert.rejects(
    window.ZeroGravityLiveData.search({ ...config, endpoint: 'javascript:alert(1)' }, 'topic'),
    /valid API endpoint URL|unsafe or unsupported URL|HTTP or HTTPS endpoint/
  );
});

test('Wikipedia parsing distinguishes empty results and preserves supplied summaries and links', async () => {
  global.fetch = async () => jsonResponse({ query: { pages: {} } });
  assert.deepEqual(await window.ZeroGravityLiveData.searchWikipedia('nothing'), []);
  global.fetch = async () => jsonResponse({
    query: {
      pages: {
        10: {
          pageid: 10,
          title: 'Example article',
          extract: 'An API-supplied introduction.',
          fullurl: 'https://en.wikipedia.org/wiki/Example_article',
          thumbnail: { source: 'https://upload.wikimedia.org/example.jpg' }
        }
      }
    }
  });
  const [article] = await window.ZeroGravityLiveData.searchWikipedia('Example');
  assert.equal(article.title, 'Example article');
  assert.equal(article.summary, 'An API-supplied introduction.');
  assert.equal(article.url, 'https://en.wikipedia.org/wiki/Example_article');
  assert.equal(article.thumbnail, 'https://upload.wikimedia.org/example.jpg');
  global.fetch = async () => jsonResponse({ query: { pages: { 1: { title: 'Bad', fullurl: 'javascript:alert(1)' } } } });
  await assert.rejects(window.ZeroGravityLiveData.searchWikipedia('Bad'), /unsafe or unsupported URL/);
});

test('Open-Meteo normalization preserves unavailable fields and actual update time', () => {
  const location = { name: 'Test City', latitude: 1, longitude: 2, timezone: 'UTC' };
  const weather = window.ZeroGravityLiveData.normalizeWeather({
    timezone: 'UTC',
    current: {
      time: '2026-01-01T10:00',
      temperature_2m: 22,
      weather_code: 1
    },
    hourly: { time: ['2026-01-01T11:00'], temperature_2m: [23] },
    daily: { time: ['2026-01-01'], weather_code: [1] }
  }, location);
  assert.equal(weather.current.temperature, 22);
  assert.equal(weather.current.condition, 'Mainly clear');
  assert.equal(weather.current.feelsLike, null);
  assert.equal(weather.current.humidity, null);
  assert.equal(weather.hourly[0].precipitationChance, null);
  assert.equal(weather.daily[0].high, null);
  assert.equal(weather.daily[0].sunrise, null);
  assert.ok(Number.isFinite(weather.updatedAt));
  assert.equal(weather.updatedAtSource, 'provider');
  assert.throws(
    () => window.ZeroGravityLiveData.normalizeWeather({ current: {} }, location),
    /current temperature/
  );
});

test('Open-Meteo adapter sends configured location/units and parses provider weather data', async () => {
  let requestUrl;
  global.fetch = async (url) => {
    requestUrl = new URL(url);
    return jsonResponse({
      timezone: 'Asia/Kolkata',
      utc_offset_seconds: 19800,
      current_units: { wind_speed_10m: 'km/h', precipitation: 'mm' },
      current: {
        time: '2026-02-03T10:00',
        temperature_2m: 21,
        apparent_temperature: 20,
        relative_humidity_2m: 52,
        precipitation: 0,
        weather_code: 2,
        wind_speed_10m: 9
      },
      hourly: {
        time: ['2026-02-03T11:00'],
        temperature_2m: [22],
        precipitation_probability: [15],
        weather_code: [2]
      },
      daily: {
        time: ['2026-02-03'],
        weather_code: [2],
        temperature_2m_max: [24],
        temperature_2m_min: [15],
        precipitation_probability_max: [20],
        sunrise: ['2026-02-03T06:30'],
        sunset: ['2026-02-03T17:50']
      }
    });
  };
  const data = await window.ZeroGravityLiveData.fetchWeather(provider('open-meteo'), {
    name: 'Lucknow',
    latitude: 26.85,
    longitude: 80.95,
    timezone: 'Asia/Kolkata'
  }, 'fahrenheit');
  assert.equal(requestUrl.searchParams.get('temperature_unit'), 'fahrenheit');
  assert.equal(requestUrl.searchParams.get('latitude'), '26.85');
  assert.equal(requestUrl.searchParams.get('forecast_days'), '7');
  assert.equal(data.units, 'fahrenheit');
  assert.equal(data.current.temperature, 21);
  assert.equal(data.current.icon, '⛅');
  assert.equal(data.windSpeedUnit, 'km/h');
  assert.equal(data.precipitationUnit, 'mm');
  assert.equal(data.hourly[0].precipitationChance, 15);
  assert.equal(data.daily[0].sunrise, '2026-02-03T06:30');
  assert.equal(data.updatedAt, Date.UTC(2026, 1, 3, 10) - 19800 * 1000);
});

test('custom weather parses configured current response paths and reports provider errors', async () => {
  let requested;
  const config = provider('custom-weather-json', {
    requestSettings: {
      weather: {
        method: 'GET',
        response: {
          current: 'now',
          temperaturePath: 'temp_c',
          feelsLikePath: 'feels',
          conditionPath: 'text',
          humidityPath: 'humidity',
          units: 'celsius'
        }
      }
    }
  });
  global.fetch = async (url) => {
    requested = new URL(url);
    return jsonResponse({ now: { temp_c: 19, feels: 18, text: 'Cloudy', humidity: 60 } });
  };
  const weather = await window.ZeroGravityLiveData.fetchWeather(config, {
    name: 'City',
    latitude: 3,
    longitude: 4,
    timezone: 'UTC'
  });
  assert.equal(requested.searchParams.get('latitude'), '3');
  assert.equal(weather.current.temperature, 19);
  assert.equal(weather.current.condition, 'Cloudy');
  assert.equal(weather.current.humidity, 60);
  assert.deepEqual(weather.hourly, []);
  assert.equal(weather.updatedAtSource, 'retrieved');
  global.fetch = async () => jsonResponse({}, 503);
  await assert.rejects(
    window.ZeroGravityLiveData.fetchWeather(config, { name: 'City', latitude: 3, longitude: 4 }),
    /server error/
  );
});
