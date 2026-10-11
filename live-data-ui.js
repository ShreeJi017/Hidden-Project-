(function initializeLiveDataUI() {
  const CACHE_KEY = 'zerogravity.live.cache';
  const WEATHER_PREFS_KEY = 'zerogravity.weather.preferences';
  const WIKI_SOURCE = 'Wikipedia';
  let lastSearchQuery = '';

  function readJSON(key, fallback) {
    try {
      const value = localStorage.getItem(key);
      return value ? JSON.parse(value) : fallback;
    } catch {
      return fallback;
    }
  }

  function writeJSON(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
      return true;
    } catch {
      return false;
    }
  }

  function cacheKey(type, query) {
    return `${type}:${query.trim().toLocaleLowerCase()}`;
  }

  function getCache(type, query) {
    return readJSON(CACHE_KEY, {})[cacheKey(type, query)] || null;
  }

  function getLatestCachedWikipedia() {
    return Object.entries(readJSON(CACHE_KEY, {}))
      .filter(([key, entry]) => key.startsWith('wikipedia:') && Array.isArray(entry.value))
      .sort((first, second) => second[1].cachedAt - first[1].cachedAt)[0]?.[1] || null;
  }

  function setCache(type, query, value) {
    const cache = readJSON(CACHE_KEY, {});
    cache[cacheKey(type, query)] = { value, cachedAt: Date.now() };
    const entries = Object.entries(cache).sort((first, second) => second[1].cachedAt - first[1].cachedAt).slice(0, 30);
    return writeJSON(CACHE_KEY, Object.fromEntries(entries));
  }

  function setStatus(element, message, tone = '') {
    element.textContent = message;
    element.classList.toggle('is-error', tone === 'error');
    element.classList.toggle('is-success', tone === 'success');
  }

  function makeLink(url, label) {
    let parsed;
    try {
      parsed = new URL(url);
    } catch {
      return null;
    }
    if (!['http:', 'https:'].includes(parsed.protocol)) return null;
    const link = document.createElement('a');
    link.href = parsed.href;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.textContent = label;
    return link;
  }

  function renderResults(container, results, { wikipedia = false } = {}) {
    container.replaceChildren();
    if (!results.length) {
      const empty = document.createElement('p');
      empty.className = 'live-empty';
      empty.textContent = wikipedia
        ? 'No Wikipedia articles matched this search.'
        : 'The provider returned no web results for this topic.';
      container.append(empty);
      return;
    }
    results.slice(0, 10).forEach((result) => {
      const article = document.createElement('article');
      article.className = `live-result-card${wikipedia ? ' is-wikipedia' : ''}`;
      if (wikipedia && result.thumbnail) {
        const thumbnail = document.createElement('img');
        thumbnail.src = result.thumbnail;
        thumbnail.alt = '';
        thumbnail.loading = 'lazy';
        thumbnail.referrerPolicy = 'no-referrer';
        thumbnail.addEventListener('error', () => thumbnail.remove(), { once: true });
        article.append(thumbnail);
      }
      const body = document.createElement('div');
      body.className = 'live-result-body';
      const source = document.createElement('span');
      source.className = 'live-result-source';
      source.textContent = wikipedia ? WIKI_SOURCE : (result.source || 'Web search result');
      const title = makeLink(result.url, result.title);
      if (!title) return;
      title.className = 'live-result-title';
      const summary = document.createElement('p');
      summary.textContent = result.summary || 'No summary was provided by the source.';
      body.append(source, title, summary);
      if (!wikipedia && result.publishedAt) {
        const date = document.createElement('time');
        date.className = 'live-result-date';
        date.textContent = `Published · ${result.publishedAt}`;
        body.append(date);
      }
      article.append(body);
      container.append(article);
    });
  }

  function getLiveConfig(functionId) {
    return window.ZeroGravityApp.getLiveProviderConfig(functionId);
  }

  function getOfflineMode() {
    return window.ZeroGravityApp.getOfflineMode();
  }

  function weatherPreferences() {
    const saved = readJSON(WEATHER_PREFS_KEY, {});
    return {
      units: saved.units === 'fahrenheit' ? 'fahrenheit' : 'celsius',
      location: saved.location && Number.isFinite(saved.location.latitude) && Number.isFinite(saved.location.longitude)
        ? saved.location
        : null
    };
  }

  function saveWeatherPreferences(preferences) {
    if (!writeJSON(WEATHER_PREFS_KEY, preferences)) {
      setStatus(document.querySelector('#weather-status'), 'Could not save weather preferences in this browser.', 'error');
    }
  }

  function formatDateTime(value, timezone) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return 'Not available';
    try {
      return new Intl.DateTimeFormat(undefined, {
        weekday: 'short',
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
        ...(timezone ? { timeZone: timezone } : {})
      }).format(date);
    } catch {
      return date.toLocaleString();
    }
  }

  function weatherTimestampLabel(weather, { cached = false } = {}) {
    const timestamp = formatDateTime(weather.updatedAt, weather.timezone);
    if (weather.updatedAtSource === 'retrieved') {
      return `${cached ? 'Cached; originally retrieved' : 'Retrieved from provider'} ${timestamp}`;
    }
    return `${cached ? 'Cached; provider last updated' : 'Provider last updated'} ${timestamp}`;
  }

  function updateLocalClock() {
    const clock = document.querySelector('#local-date-time');
    const now = new Date();
    clock.dateTime = now.toISOString();
    clock.textContent = new Intl.DateTimeFormat(undefined, {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      second: '2-digit'
    }).format(now);
  }

  function weatherProviderInfo() {
    const config = getLiveConfig('weather');
    if (!config) return 'No enabled weather provider is configured. In Settings → Own API, add Open-Meteo (no API key) or a custom weather JSON provider.';
    if (config.type === 'open-meteo') return `Weather provider · ${config.name} (Open-Meteo public API)`;
    return `Weather provider · ${config.name} · configured custom response mappings`;
  }

  function formatTemp(value, sourceUnits, targetUnits) {
    if (!Number.isFinite(value)) return 'Not provided';
    let converted = value;
    if (sourceUnits !== targetUnits) {
      converted = sourceUnits === 'fahrenheit' ? (value - 32) * 5 / 9 : value * 9 / 5 + 32;
    }
    return `${Math.round(converted * 10) / 10}°${targetUnits === 'fahrenheit' ? 'F' : 'C'}`;
  }

  function formatValue(value, suffix = '') {
    return Number.isFinite(value) ? `${value}${suffix}` : 'Not provided';
  }

  function timeOnly(value, timezone) {
    if (!value) return 'Not provided';
    if (typeof value === 'string') {
      const localTime = value.match(/T(\d{2}:\d{2})(?::\d{2})?$/);
      if (localTime && !/(?:Z|[+-]\d{2}:?\d{2})$/.test(value)) return localTime[1];
    }
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return String(value);
    try {
      return new Intl.DateTimeFormat(undefined, {
        hour: 'numeric',
        minute: '2-digit',
        ...(timezone ? { timeZone: timezone } : {})
      }).format(date);
    } catch {
      return date.toLocaleTimeString();
    }
  }

  function renderWeather(weather, { cached = false } = {}) {
    const currentContainer = document.querySelector('#weather-current');
    const current = weather.current || {};
    const units = document.querySelector('#weather-units').value;
    const currentValue = (label, value) => {
      const item = document.createElement('div');
      const name = document.createElement('span');
      name.textContent = label;
      const data = document.createElement('strong');
      data.textContent = value;
      item.append(name, data);
      return item;
    };
    currentContainer.replaceChildren();
    const heading = document.createElement('div');
    heading.className = 'weather-current-heading';
    const place = document.createElement('h3');
    place.textContent = weather.location || 'Selected location';
    const updated = document.createElement('p');
    updated.textContent = weatherTimestampLabel(weather, { cached });
    heading.append(place, updated);
    const icon = document.createElement('span');
    icon.className = 'weather-icon';
    icon.setAttribute('aria-hidden', 'true');
    icon.textContent = current.icon || '◌';
    const condition = document.createElement('p');
    condition.className = 'weather-condition';
    condition.textContent = current.condition || 'Condition not provided';
    const metrics = document.createElement('div');
    metrics.className = 'weather-metrics';
    metrics.append(
      currentValue('Temperature', formatTemp(current.temperature, weather.units, units)),
      currentValue('Feels like', formatTemp(current.feelsLike, weather.units, units)),
      currentValue('Humidity', formatValue(current.humidity, '%')),
      currentValue('Wind', formatValue(current.windSpeed, weather.windSpeedUnit ? ` ${weather.windSpeedUnit}` : '')),
      currentValue('Precipitation', formatValue(current.precipitation, weather.precipitationUnit ? ` ${weather.precipitationUnit}` : ''))
    );
    currentContainer.append(heading, icon, condition, metrics);
    currentContainer.hidden = false;

    const sun = document.querySelector('#weather-sun');
    sun.replaceChildren();
    const today = weather.daily?.[0];
    if (today?.sunrise || today?.sunset) {
      const sunrise = document.createElement('span');
      sunrise.textContent = `Sunrise · ${timeOnly(today.sunrise, weather.timezone)}`;
      const sunset = document.createElement('span');
      sunset.textContent = `Sunset · ${timeOnly(today.sunset, weather.timezone)}`;
      sun.append(sunrise, sunset);
      sun.hidden = false;
    } else {
      sun.hidden = true;
    }

    const hourly = document.querySelector('#weather-hourly');
    hourly.replaceChildren();
    const hourlyValues = (weather.hourly || []).slice(0, 24);
    hourlyValues.forEach((hour) => {
      const item = document.createElement('article');
      item.className = 'weather-hour';
      const time = document.createElement('strong');
      const localHour = typeof hour.time === 'string' ? hour.time.match(/T(\d{2}:\d{2})/) : null;
      time.textContent = localHour?.[1] || formatDateTime(hour.time, weather.timezone).split(', ').at(-1) || '—';
      const temperature = document.createElement('span');
      temperature.textContent = formatTemp(hour.temperature, weather.units, units);
      const rain = document.createElement('span');
      rain.textContent = Number.isFinite(hour.precipitationChance) ? `Rain ${hour.precipitationChance}%` : 'Rain —';
      item.append(time, temperature, rain);
      hourly.append(item);
    });
    document.querySelector('#weather-hourly-section').hidden = hourlyValues.length === 0;

    const daily = document.querySelector('#weather-daily');
    daily.replaceChildren();
    (weather.daily || []).slice(0, 7).forEach((day) => {
      const item = document.createElement('article');
      item.className = 'weather-day';
      const date = document.createElement('strong');
      const parsedDate = new Date(`${day.date}T12:00:00Z`);
      date.textContent = Number.isNaN(parsedDate.getTime())
        ? String(day.date || 'Day')
        : new Intl.DateTimeFormat(undefined, {
          weekday: 'short',
          month: 'short',
          day: 'numeric',
          timeZone: 'UTC'
        }).format(parsedDate);
      const forecast = document.createElement('span');
      forecast.textContent = `${day.icon || ''} ${day.condition || 'Forecast unavailable'}`.trim();
      const range = document.createElement('span');
      range.textContent = `${formatTemp(day.high, weather.units, units)} / ${formatTemp(day.low, weather.units, units)}`;
      const chance = document.createElement('span');
      chance.textContent = Number.isFinite(day.precipitationChance) ? `Precipitation chance · ${day.precipitationChance}%` : 'Precipitation chance · Not provided';
      const sunlight = document.createElement('span');
      sunlight.textContent = `Sunrise ${timeOnly(day.sunrise, weather.timezone)} · Sunset ${timeOnly(day.sunset, weather.timezone)}`;
      item.append(date, forecast, range, chance, sunlight);
      daily.append(item);
    });
    document.querySelector('#weather-daily-section').hidden = !(weather.daily || []).length;

    const alerts = document.querySelector('#weather-alerts');
    alerts.replaceChildren();
    (weather.alerts || []).forEach((alert) => {
      const item = document.createElement('p');
      item.textContent = typeof alert === 'string' ? alert : (alert.title || alert.description || 'Weather alert');
      alerts.append(item);
    });
    document.querySelector('#weather-alerts-section').hidden = !(weather.alerts || []).length;
  }

  function setWeatherState(weather, location, { cached = false, cacheUnavailable = false } = {}) {
    const current = { ...weather, location: weather.location || location.name };
    renderWeather(current, { cached });
    const status = document.querySelector('#weather-status');
    const note = cached
      ? `Showing cached forecast for ${current.location}. Not live; ${weatherTimestampLabel(current)}.`
      : `${weatherProviderInfo()} · ${weatherTimestampLabel(current)}.`;
    setStatus(status, `${note}${cacheUnavailable ? ' The browser could not save this forecast for offline use.' : ''}`, cached ? 'error' : 'success');
    const prefs = weatherPreferences();
    saveWeatherPreferences({ ...prefs, location });
    document.querySelector('#weather-city').value = location.name || '';
  }

  async function requestWeather(location, { permitCache = true } = {}) {
    const status = document.querySelector('#weather-status');
    const provider = getLiveConfig('weather');
    const mode = getOfflineMode();
    const key = location.name || `${location.latitude},${location.longitude}`;
    const cached = getCache('weather', key);
    if (mode === 'offline-only' || navigator.onLine === false) {
      if (permitCache && (mode === 'offline-only' || mode === 'automatic') && cached) {
        setWeatherState(cached.value, location, { cached: true });
        return cached.value;
      }
      throw new Error(mode === 'offline-only'
        ? 'Offline-only mode blocked the weather request, and there is no cached forecast for this location.'
        : 'The browser reports offline and no cached forecast is available for this location.');
    }
    if (!provider) {
      if (mode === 'automatic' && permitCache && cached) {
        setWeatherState(cached.value, location, { cached: true });
        return cached.value;
      }
      throw new Error(weatherProviderInfo());
    }
    setStatus(status, `Loading weather for ${key} from ${provider.name}…`);
    try {
      const adapter = window.ZeroGravityAI.createProvider(provider.type, 'weather');
      const data = await adapter.getWeather(provider, location, document.querySelector('#weather-units').value);
      const cachedSuccessfully = setCache('weather', data.location || key, data);
      setWeatherState(data, location, { cacheUnavailable: !cachedSuccessfully });
      return data;
    } catch (error) {
      if (mode === 'automatic' && permitCache && cached) {
        setWeatherState(cached.value, location, { cached: true });
        setStatus(status, `Live weather unavailable: ${error.message} Showing the saved forecast, not current conditions.`, 'error');
        return cached.value;
      }
      throw error;
    }
  }

  async function searchWeb(query, { fromChat = false } = {}) {
    const status = document.querySelector('#live-search-status');
    const results = document.querySelector('#live-search-results');
    const mode = getOfflineMode();
    const cached = getCache('search', query);
    if (mode === 'offline-only' || navigator.onLine === false) {
      if ((mode === 'offline-only' || mode === 'automatic') && cached) {
        renderResults(results, cached.value.results);
        setStatus(status, `Cached search results · originally retrieved ${new Date(cached.cachedAt).toLocaleString()}. Not current live results.`);
        return { results: cached.value.results, cached: true, cachedAt: cached.cachedAt };
      }
      throw new Error(mode === 'offline-only'
        ? 'Offline-only mode blocked web search, and there are no cached results for this exact query.'
        : 'The browser reports offline and no cached results are available for this query.');
    }
    const provider = getLiveConfig('internet-search');
    if (!provider) throw new Error('No enabled Internet Search provider is configured. Add Brave Search or a custom search JSON provider in Settings → Own API.');
    const adapter = window.ZeroGravityAI.createProvider(provider.type, 'internet-search');
    const found = await adapter.search(provider, query);
    const cachedSuccessfully = setCache('search', query, { results: found });
    if (!fromChat) renderResults(results, found);
    if (!fromChat) setStatus(status, `${found.length ? `${found.length} result${found.length === 1 ? '' : 's'} from ${provider.name}.` : `No results were returned by ${provider.name}.`}${cachedSuccessfully ? '' : ' Results could not be saved for offline use.'}`);
    return { results: found, cached: false, providerName: provider.name };
  }

  async function searchWiki(query, { fromChat = false, mode = getOfflineMode() } = {}) {
    const cached = getCache('wikipedia', query);
    if (mode === 'offline-only' || navigator.onLine === false) {
      if ((mode === 'offline-only' || mode === 'automatic') && cached) {
        if (!fromChat) {
          renderResults(document.querySelector('#wikipedia-results'), cached.value, { wikipedia: true });
          setStatus(document.querySelector('#wikipedia-status'), `Cached Wikipedia results · originally retrieved ${new Date(cached.cachedAt).toLocaleString()}.`);
        }
        return { articles: cached.value, cached: true, cachedAt: cached.cachedAt };
      }
      throw new Error(mode === 'offline-only'
        ? 'Offline-only mode blocked Wikipedia, and there are no cached results for this exact query.'
        : 'The browser is offline and no cached Wikipedia results are available.');
    }
    const found = await window.ZeroGravityLiveData.searchWikipedia(query);
    const cachedSuccessfully = setCache('wikipedia', query, found);
    if (!fromChat) {
      renderResults(document.querySelector('#wikipedia-results'), found, { wikipedia: true });
      setStatus(document.querySelector('#wikipedia-status'), found.length
        ? `${found.length} Wikipedia article${found.length === 1 ? '' : 's'} found. Wikipedia is shown separately from web search.`
        : 'No Wikipedia articles matched this search.');
      if (!cachedSuccessfully) {
        setStatus(document.querySelector('#wikipedia-status'), `${document.querySelector('#wikipedia-status').textContent} Results could not be saved for offline use.`);
      }
    }
    return { articles: found, cached: false };
  }

  function formatSearchAnswer(result, label = 'Web search results') {
    if (!result.results.length) return result.cached
      ? `No cached results were available for this search. No live search was sent in Offline-only mode.`
      : 'The search provider returned no results.';
    const header = result.cached
      ? `Cached results (not current live data; retrieved ${new Date(result.cachedAt).toLocaleString()}):`
      : `${label}${result.providerName ? ` from ${result.providerName}` : ''}:`;
    const claims = result.results.slice(0, 6).map((item, index) => (
      `${index + 1}. ${item.title}${item.summary ? ` — ${item.summary}` : ''}${item.publishedAt ? ` (Published: ${item.publishedAt})` : ''} [${index + 1}]`
    ));
    return `${header}\n${claims.join('\n')}`;
  }

  function classifyChatQuery(text) {
    const value = text.trim();
    const lower = value.toLocaleLowerCase();
    if (/^(?:please\s+)?search\s+(?:the\s+)?local\s+history\b/i.test(lower)) return null;
    if (/^(?:please\s+)?summari[sz]e\s+(?:this\s+)?wikipedia\s+article[?.!]*$/i.test(value)) {
      return { type: 'wikipedia', latest: true };
    }
    const wikiMatch = lower.match(/(?:wikipedia|wiki)\s+(?:article\s+)?(?:about|on|for)?\s*(.+)|summari[sz]e\s+(?:this\s+)?(?:wikipedia\s+)?(?:article\s+)?(?:about|on)?\s*(.+)/i);
    if (wikiMatch) return { type: 'wikipedia', query: (wikiMatch[1] || wikiMatch[2] || value).replace(/[?.!]+$/, '').trim() };
    if (/(?:weather|mausam|baarish|barish|बारिश|मौसम|rain|forecast|sunrise|sunset|temperature|temp\b)/i.test(value)) {
      const cityMatch = value.match(/\b(?:weather|forecast|temperature|temp)\s+(?:in|for|at)\s+([^?.!,]+)/i);
      const tomorrow = /\b(?:tomorrow|kal)\b|कल/i.test(value);
      return { type: 'weather', city: cityMatch?.[1]?.trim() || '', tomorrow };
    }
    if (/(?:search|latest|current information|recent information|web results|internet search)/i.test(value)) {
      const query = value.replace(/^(?:please\s+)?(?:search(?:\s+the)?\s+(?:latest\s+)?(?:information\s+)?(?:about|on|for)?|find\s+(?:the\s+)?latest\s+(?:information\s+)?(?:about|on|for)?|latest\s+information\s+(?:about|on|for)?)/i, '')
        .replace(/[?.!]+$/, '')
        .trim();
      return { type: 'search', query: query || value };
    }
    return null;
  }

  async function weatherAnswer(intent, mode) {
    let location = weatherPreferences().location;
    if (intent.city) {
      if (mode === 'offline-only' || navigator.onLine === false) {
        if (mode === 'online-only') throw new Error('The browser is offline. Online-only mode will not use cached weather or contact a provider.');
        const cached = getCache('weather', intent.city);
        if (!cached) throw new Error(mode === 'offline-only'
          ? 'No cached forecast for this city. Offline-only mode did not request location or contact a weather provider.'
          : 'The browser is offline and no cached forecast exists for this city.');
        location = {
          name: intent.city,
          latitude: cached.value.latitude,
          longitude: cached.value.longitude,
          timezone: cached.value.timezone
        };
        const weather = cached.value;
        return { weather, cached: true, cachedAt: cached.cachedAt };
      }
      location = await window.ZeroGravityLiveData.geocodeCity(intent.city);
      saveWeatherPreferences({ ...weatherPreferences(), location });
      const weather = await requestWeather(location);
      setCache('weather', intent.city, weather);
      return { weather, cached: false };
    }
    if (!location) throw new Error('Choose a city in Modules → Weather & Local time, or ask “What is the weather in Lucknow?” while online.');
    const weather = await requestWeather(location);
    return { weather, cached: false };
  }

  async function handleChatQuery(text, mode) {
    const intent = classifyChatQuery(text);
    if (!intent) return null;
    if (intent.type === 'wikipedia') {
      const result = intent.latest
        ? (() => {
          const latest = getLatestCachedWikipedia();
          return latest
            ? { articles: latest.value, cached: true, cachedAt: latest.cachedAt }
            : null;
        })()
        : await searchWiki(intent.query, { fromChat: true, mode });
      if (!result) throw new Error('No previously opened Wikipedia article is available to summarize. Search Wikipedia for an article title first.');
      const articles = result.articles;
      if (!articles.length) throw new Error(intent.latest
        ? 'The most recent Wikipedia search had no article summaries to summarize.'
        : `No Wikipedia article was found for “${intent.query}”.`);
      const citations = articles.slice(0, 4).map((article) => ({
        title: article.title,
        url: article.url,
        source: 'Wikipedia'
      }));
      return {
        source: 'live-wikipedia',
        providerName: result.cached ? 'Cached Wikipedia results' : 'Wikipedia public API',
        citations,
        content: `${result.cached ? `Cached Wikipedia summaries${intent.query ? ` for “${intent.query}”` : ''}, originally retrieved ${new Date(result.cachedAt).toLocaleString()} (not live):` : `Wikipedia summaries for “${intent.query}” (Wikipedia source, not a general web search):`}\n${articles.slice(0, 4).map((article, index) => `${index + 1}. ${article.title}${article.summary ? ` — ${article.summary}` : ''} [${index + 1}]`).join('\n')}`
      };
    }
    if (intent.type === 'search') {
      const result = await searchWeb(intent.query, { fromChat: true });
      return {
        source: 'live-search',
        providerName: result.cached ? 'Cached web results' : result.providerName,
        citations: result.results.slice(0, 6).map((item) => ({
          title: item.title,
          url: item.url,
          source: item.source
        })),
        content: formatSearchAnswer(result)
      };
    }
    const result = await weatherAnswer(intent, mode);
    const weather = result.weather;
    const units = document.querySelector('#weather-units').value;
    const tomorrow = intent.tomorrow && weather.daily?.[1] ? weather.daily[1] : null;
    const temp = (value) => formatTemp(value, weather.units, units);
    const content = tomorrow
      ? `Forecast for ${weather.location} tomorrow (${tomorrow.date}): ${tomorrow.condition || 'Condition not provided'}${Number.isFinite(tomorrow.high) ? `, high ${temp(tomorrow.high)}` : ''}${Number.isFinite(tomorrow.low) ? `, low ${temp(tomorrow.low)}` : ''}${Number.isFinite(tomorrow.precipitationChance) ? `, precipitation chance ${tomorrow.precipitationChance}%` : ', precipitation chance not provided'}. ${result.cached ? `Cached forecast, ${weatherTimestampLabel(weather)}; not live.` : `${weatherTimestampLabel(weather)}.`}`
      : `Weather for ${weather.location}: ${weather.current.condition || 'Condition not provided'}, ${temp(weather.current.temperature)}${Number.isFinite(weather.current.feelsLike) ? `, feels like ${temp(weather.current.feelsLike)}` : ''}${Number.isFinite(weather.current.humidity) ? `, humidity ${weather.current.humidity}%` : ''}${Number.isFinite(weather.current.windSpeed) ? `, wind ${weather.current.windSpeed}` : ''}. Sunrise ${timeOnly(weather.daily?.[0]?.sunrise, weather.timezone)}; sunset ${timeOnly(weather.daily?.[0]?.sunset, weather.timezone)}. ${result.cached ? `Cached data, ${weatherTimestampLabel(weather)}; not live.` : `${weatherTimestampLabel(weather)}.`}`;
    return {
      source: 'live-weather',
      providerName: result.cached ? 'Cached weather data' : weatherProviderInfo(),
      content
    };
  }

  function runSearchForm(event) {
    event.preventDefault();
    const query = document.querySelector('#live-search-query').value.trim();
    if (!query) return;
    lastSearchQuery = query;
    const button = document.querySelector('#live-search-form button[type="submit"]');
    button.disabled = true;
    document.querySelector('#retry-live-search').disabled = true;
    setStatus(document.querySelector('#live-search-status'), 'Searching the configured live provider…');
    searchWeb(query).catch((error) => {
      setStatus(document.querySelector('#live-search-status'), error.message, 'error');
      document.querySelector('#live-search-results').replaceChildren();
    }).finally(() => {
      button.disabled = false;
      document.querySelector('#retry-live-search').disabled = !lastSearchQuery;
    });
  }

  function runWikipediaForm(event) {
    event.preventDefault();
    const query = document.querySelector('#wikipedia-query').value.trim();
    if (!query) return;
    const button = document.querySelector('#wikipedia-search-form button[type="submit"]');
    button.disabled = true;
    setStatus(document.querySelector('#wikipedia-status'), 'Searching Wikipedia…');
    searchWiki(query).catch((error) => {
      setStatus(document.querySelector('#wikipedia-status'), error.message, 'error');
      document.querySelector('#wikipedia-results').replaceChildren();
    }).finally(() => { button.disabled = false; });
  }

  async function runWeatherForm(event) {
    event.preventDefault();
    const city = document.querySelector('#weather-city').value.trim();
    if (!city) {
      setStatus(document.querySelector('#weather-status'), 'Enter a city name, or choose Use my location.', 'error');
      return;
    }
    const submit = document.querySelector('#weather-city-submit');
    submit.disabled = true;
    try {
      if (getOfflineMode() === 'offline-only' || navigator.onLine === false) {
        if (getOfflineMode() === 'online-only') {
          throw new Error('The browser is offline. Online-only mode will not use cached forecasts.');
        }
        const cached = getCache('weather', city);
        if (!cached) {
          throw new Error(getOfflineMode() === 'offline-only'
            ? 'Offline-only mode blocks city lookup, and there is no cached forecast for this city.'
            : 'The browser is offline, and there is no cached forecast for this city.');
        }
        const location = {
          name: cached.value.location || city,
          latitude: cached.value.latitude,
          longitude: cached.value.longitude,
          timezone: cached.value.timezone
        };
        setWeatherState(cached.value, location, { cached: true });
      } else {
        if (!getLiveConfig('weather')) {
          const cached = getCache('weather', city);
          if (getOfflineMode() === 'automatic' && cached) {
            const location = {
              name: cached.value.location || city,
              latitude: cached.value.latitude,
              longitude: cached.value.longitude,
              timezone: cached.value.timezone
            };
            setWeatherState(cached.value, location, { cached: true });
            return;
          }
          throw new Error(weatherProviderInfo());
        }
        const location = await window.ZeroGravityLiveData.geocodeCity(city);
        const weather = await requestWeather(location);
        setCache('weather', city, weather);
      }
    } catch (error) {
      setStatus(document.querySelector('#weather-status'), error.message, 'error');
    } finally {
      submit.disabled = false;
    }
  }

  function requestDeviceLocation() {
    const status = document.querySelector('#weather-status');
    if (getOfflineMode() === 'offline-only' || (getOfflineMode() === 'online-only' && navigator.onLine === false)) {
      setStatus(status, getOfflineMode() === 'offline-only'
        ? 'Offline-only mode blocks location lookup and live weather requests. Enter a city to use a saved forecast.'
        : 'The browser is offline. Online-only mode blocks location lookup and cached forecasts.', 'error');
      return;
    }
    if (!getLiveConfig('weather')) {
      setStatus(status, weatherProviderInfo(), 'error');
      return;
    }
    if (!window.confirm('ZeroGravity will request your device location to look up nearby weather. Coordinates will be sent to the configured weather provider. Continue?')) return;
    if (!navigator.geolocation) {
      setStatus(status, 'Device location is unavailable in this browser. Enter a city manually.', 'error');
      return;
    }
    setStatus(status, 'Waiting for browser/device location permission…');
    navigator.geolocation.getCurrentPosition(async (position) => {
      const location = {
        name: 'Current device location',
        latitude: position.coords.latitude,
        longitude: position.coords.longitude,
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'auto'
      };
      try {
        await requestWeather(location);
      } catch (error) {
        setStatus(status, `${error.message} You can still enter a city manually.`, 'error');
      }
    }, (error) => {
      const reason = error.code === error.PERMISSION_DENIED
        ? 'Location permission was denied.'
        : error.code === error.POSITION_UNAVAILABLE
          ? 'The device could not determine a location.'
          : 'The location request timed out.';
      setStatus(status, `${reason} Enter a city manually to continue.`, 'error');
    }, { enableHighAccuracy: false, timeout: 15000, maximumAge: 300000 });
  }

  function initialize() {
    document.querySelector('#live-search-form').addEventListener('submit', runSearchForm);
    document.querySelector('#retry-live-search').addEventListener('click', () => {
      if (lastSearchQuery) {
        document.querySelector('#live-search-query').value = lastSearchQuery;
        document.querySelector('#live-search-form').requestSubmit();
      }
    });
    document.querySelector('#wikipedia-search-form').addEventListener('submit', runWikipediaForm);
    document.querySelector('#weather-city-form').addEventListener('submit', runWeatherForm);
    document.querySelector('#weather-location').addEventListener('click', requestDeviceLocation);
    document.querySelector('#weather-retry').addEventListener('click', async () => {
      const location = weatherPreferences().location;
      if (!location) {
        setStatus(document.querySelector('#weather-status'), 'Enter a city or choose Use my location before refreshing.', 'error');
        return;
      }
      try {
        await requestWeather(location, { permitCache: false });
      } catch (error) {
        setStatus(document.querySelector('#weather-status'), error.message, 'error');
      }
    });
    document.querySelector('#weather-units').value = weatherPreferences().units;
    document.querySelector('#weather-units').addEventListener('change', () => {
      const prefs = weatherPreferences();
      saveWeatherPreferences({ ...prefs, units: document.querySelector('#weather-units').value });
      const cached = prefs.location && getCache('weather', prefs.location.name);
      if (cached) renderWeather(cached.value, { cached: getOfflineMode() === 'offline-only' });
    });
    document.querySelector('#weather-city').value = weatherPreferences().location?.name || '';
    updateLocalClock();
    window.setInterval(updateLocalClock, 1000);
  }

  document.addEventListener('DOMContentLoaded', initialize, { once: true });
  window.ZeroGravityLiveUI = Object.freeze({
    onScreen(screen) {
      if (screen === 'weather') {
        updateLocalClock();
        const location = weatherPreferences().location;
        if (!document.querySelector('#weather-current').hidden) return;
        if (location) {
          void requestWeather(location).catch((error) => setStatus(document.querySelector('#weather-status'), error.message, 'error'));
        } else {
          setStatus(document.querySelector('#weather-status'), weatherProviderInfo());
        }
      }
    },
    handleChatQuery,
    classifyChatQuery
  });
})();
