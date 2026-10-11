(function exposeAIProviders() {
  const REQUEST_TIMEOUT_MS = 30000;
  const FUNCTION_DEFINITIONS = Object.freeze([
    { id: 'chat-ai', name: 'Chat AI', adapter: 'openai-compatible-chat', implemented: true },
    { id: 'reasoning', name: 'Reasoning / Thinking', adapter: 'unsupported', implemented: false },
    { id: 'voice-chat', name: 'Voice Chat', adapter: 'unsupported', implemented: false },
    { id: 'stt', name: 'Speech-to-Text (STT)', adapter: 'unsupported', implemented: false },
    { id: 'tts', name: 'Text-to-Speech (TTS)', adapter: 'unsupported', implemented: false },
    { id: 'image-generation', name: 'Image Generation', adapter: 'configurable-image-api', implemented: true },
    { id: 'video-generation', name: 'Video Generation', adapter: 'unsupported', implemented: false },
    { id: 'internet-search', name: 'Internet Search', adapter: 'configurable-web-search', implemented: true },
    { id: 'weather', name: 'Weather', adapter: 'open-meteo-weather', implemented: true },
    { id: 'web-browsing', name: 'Web Browsing', adapter: 'unsupported', implemented: false },
    { id: 'vision', name: 'Vision', adapter: 'unsupported', implemented: false },
    { id: 'ocr', name: 'OCR', adapter: 'unsupported', implemented: false },
    { id: 'translation', name: 'Translation', adapter: 'unsupported', implemented: false },
    { id: 'embeddings', name: 'Embeddings', adapter: 'unsupported', implemented: false },
    { id: 'coding', name: 'Coding', adapter: 'unsupported', implemented: false },
    { id: 'audio-music', name: 'Audio/Music', adapter: 'unsupported', implemented: false },
    { id: 'custom-api', name: 'Custom API', adapter: 'custom-http-test', implemented: false }
  ]);

  function validateConfig(config, options = {}) {
    if (!config || typeof config !== 'object') throw new Error('Choose or save an API provider first.');
    if (typeof config.name !== 'string' || !config.name.trim()) throw new Error('Enter a provider name.');
    if (typeof config.endpoint !== 'string' || !config.endpoint.trim()) throw new Error('Enter an API endpoint.');
    if (options.requireModel !== false && (typeof config.model !== 'string' || !config.model.trim())) throw new Error('Enter a model name.');
    if (options.requireApiKey !== false && (typeof config.apiKey !== 'string' || !config.apiKey.trim())) {
      throw new Error('Enter the API key again for this browser session. Keys are not saved by the web app.');
    }

    let endpoint;
    try {
      endpoint = new URL(config.endpoint.trim());
    } catch {
      throw new Error('Enter a valid API endpoint URL.');
    }
    if (!['http:', 'https:'].includes(endpoint.protocol)
      || endpoint.username
      || endpoint.password
      || endpoint.search
      || endpoint.hash
    ) {
      throw new Error('Use an HTTP or HTTPS endpoint without embedded credentials, query strings, or fragments.');
    }
    if (typeof config.headers !== 'object' || config.headers === null || Array.isArray(config.headers)) {
      throw new Error('Custom headers must be a JSON object.');
    }
    for (const [name, value] of Object.entries(config.headers)) {
      if (!/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(name) || typeof value !== 'string' || /[\r\n]/.test(value)) {
        throw new Error('Check custom header names and values. Header values cannot contain line breaks.');
      }
    }
    const timeout = Number(config.requestSettings?.timeoutMs ?? REQUEST_TIMEOUT_MS);
    if (!Number.isFinite(timeout) || timeout < 1000 || timeout > 120000) {
      throw new Error('Timeout must be between 1,000 and 120,000 milliseconds.');
    }
    const method = String(config.requestSettings?.testMethod || 'GET').toUpperCase();
    if (!['GET', 'POST'].includes(method)) throw new Error('Custom HTTP tests support GET or POST only.');
  }

  function getSecretValues(config) {
    return [
      config.apiKey,
      ...Object.values(config.headers || {})
    ].filter((value) => typeof value === 'string' && value.length > 0);
  }

  function safeProviderMessage(body, secrets) {
    const candidate = body?.error?.message || body?.message || body?.error;
    if (typeof candidate !== 'string') return '';
    const trimmed = candidate.trim().slice(0, 240);
    if (!trimmed) return '';
    return redactText(trimmed, secrets);
  }

  function getHTTPError(status, detail = '') {
    const explanation = status === 401 || status === 403
      ? 'The API rejected this key or access. Verify credentials and provider permissions.'
      : status === 404
        ? 'The endpoint or model was not found. Verify the URL and model.'
        : status === 429
          ? 'The provider is rate-limiting requests or its quota is exhausted.'
          : status >= 500
            ? 'The provider reported a server error. Try again later.'
            : `The endpoint returned HTTP ${status}.`;
    return detail ? `${explanation} Provider detail: ${detail}` : explanation;
  }

  function makeRequestHeaders(config) {
    return {
      ...config.headers,
      ...(config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : {})
    };
  }

  function getTimeout(config) {
    return Math.max(1000, Math.min(120000, Number(config.requestSettings?.timeoutMs) || REQUEST_TIMEOUT_MS));
  }

  const IMAGE_ASPECT_RATIOS = Object.freeze({
    '1:1': '1024x1024',
    '9:16': '1024x1792',
    '16:9': '1792x1024',
    '4:3': '1024x768'
  });

  function imageSettings(config) {
    return config.requestSettings?.imageGeneration || {};
  }

  function getImageCapabilities(config) {
    const settings = imageSettings(config);
    return {
      aspectRatio: config.type === 'openai-images' || Boolean(settings.aspectRatioField),
      negativePrompt: Boolean(settings.negativePromptField),
      quality: Boolean(settings.qualityField),
      style: Boolean(settings.styleField),
      progress: false
    };
  }

  function setPath(target, path, value) {
    if (typeof path !== 'string' || !path.trim()) {
      throw new Error('Configure a valid request field for this image option.');
    }
    const parts = path.split('.').filter(Boolean);
    if (!parts.length || parts.some((part) => ['__proto__', 'prototype', 'constructor'].includes(part))) {
      throw new Error('Image request field paths are invalid.');
    }
    let current = target;
    parts.slice(0, -1).forEach((part) => {
      current[part] ||= {};
      if (typeof current[part] !== 'object' || Array.isArray(current[part])) {
        throw new Error('Image request field paths conflict with configured static fields.');
      }
      current = current[part];
    });
    current[parts.at(-1)] = value;
  }

  function getPath(target, path) {
    if (typeof path !== 'string' || !path.trim()) return undefined;
    return path.split('.').filter(Boolean).reduce((value, part) => value?.[part], target);
  }

  function imageRequestBody(config, options) {
    const settings = imageSettings(config);
    const body = settings.staticBody && typeof settings.staticBody === 'object' && !Array.isArray(settings.staticBody)
      ? structuredClone(settings.staticBody)
      : {};
    setPath(body, settings.promptField || 'prompt', options.prompt);
    if (config.model.trim()) setPath(body, settings.modelField || 'model', config.model.trim());
    if (options.negativePrompt) {
      if (!settings.negativePromptField) throw new Error('The selected image provider does not support a negative prompt. Configure negativePromptField to enable it.');
      setPath(body, settings.negativePromptField, options.negativePrompt);
    }
    if (options.aspectRatio) {
      const ratioField = settings.aspectRatioField || (config.type === 'openai-images' ? 'size' : '');
      if (!ratioField) throw new Error('The selected image provider does not support aspect ratios. Configure aspectRatioField to enable them.');
      const ratioValue = settings.aspectRatioValues?.[options.aspectRatio]
        || (config.type === 'openai-images' ? IMAGE_ASPECT_RATIOS[options.aspectRatio] : options.aspectRatio);
      if (!ratioValue) throw new Error(`The selected image provider does not support ${options.aspectRatio}.`);
      setPath(body, ratioField, ratioValue);
    }
    [['quality', options.quality], ['style', options.style]].forEach(([option, value]) => {
      if (!value) return;
      const field = settings[`${option}Field`];
      if (!field) throw new Error(`The selected image provider does not support ${option}. Configure ${option}Field to enable it.`);
      setPath(body, field, value);
    });
    return body;
  }

  function createImageAuthHeaders(config) {
    const auth = imageSettings(config).authentication || {};
    const headers = { ...config.headers };
    const mode = auth.mode || 'bearer';
    if (mode === 'none') return headers;
    if (!config.apiKey) throw new Error('Enter the image provider API key for this browser session, or configure authentication.mode as "none".');
    if (mode === 'bearer' || mode === 'header') {
      const headerName = auth.headerName || (mode === 'bearer' ? 'Authorization' : 'X-API-Key');
      const prefix = auth.prefix ?? (mode === 'bearer' ? 'Bearer ' : '');
      if (!/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(headerName) || /[\r\n]/.test(prefix)) {
        throw new Error('Image authentication header settings are invalid.');
      }
      headers[headerName] = `${prefix}${config.apiKey}`;
    }
    else throw new Error('Image authentication.mode must be bearer, header, or none.');
    return headers;
  }

  function imageError(status, detail = '') {
    const base = status === 401 || status === 403
      ? 'The image provider rejected the key or access. Verify credentials and provider permissions.'
      : status === 404
        ? 'The image endpoint or model was not found. Verify the URL and model.'
        : status === 413
          ? 'The image request exceeds the provider’s size limit.'
          : status === 422
            ? 'The provider rejected the prompt or an unsupported generation option.'
            : status === 429
              ? 'The provider is rate-limiting requests or its image quota is exhausted.'
              : status >= 500
                ? 'The image provider reported a server error. Try again later.'
                : `The image endpoint returned HTTP ${status}.`;
    return `${base}${detail ? ` Provider detail: ${detail}` : ''}`;
  }

  async function generateImage(config, options, onProgress) {
    validateConfig(config, { requireApiKey: false });
    if (!['openai-images', 'custom-image-json'].includes(config.type)) {
      throw new Error('The selected provider is not an image-generation adapter.');
    }
    if (typeof options?.prompt !== 'string' || !options.prompt.trim()) {
      throw new Error('Enter a prompt before generating an image.');
    }
    if (options.prompt.length > 4000 || (options.negativePrompt || '').length > 2000) {
      throw new Error('The prompt is longer than this image screen supports.');
    }
    if (!['1:1', '9:16', '16:9', '4:3'].includes(options.aspectRatio)) {
      throw new Error('Choose a supported aspect ratio.');
    }
    const settings = imageSettings(config);
    const method = String(settings.method || 'POST').toUpperCase();
    if (!['POST', 'PUT', 'PATCH'].includes(method)) {
      throw new Error('Image generation requests must use POST, PUT, or PATCH.');
    }
    const body = imageRequestBody(config, options);
    if ((settings.authentication?.mode || 'bearer') !== 'none' && !config.apiKey) {
      throw new Error('Enter the image provider API key for this browser session.');
    }
    const controller = new AbortController();
    const externalSignal = options.signal;
    if (externalSignal) {
      if (externalSignal.aborted) controller.abort();
      else externalSignal.addEventListener('abort', () => controller.abort(), { once: true });
    }
    const timeoutMs = getTimeout(config);
    let didTimeout = false;
    const timeout = window.setTimeout(() => {
      didTimeout = true;
      controller.abort();
    }, timeoutMs);
    if (typeof onProgress === 'function') onProgress({ state: 'requesting', progress: null });
    let response;
    try {
      response = await fetch(config.endpoint.trim(), {
        method,
        headers: {
          ...createImageAuthHeaders(config),
          'Content-Type': 'application/json',
          Accept: 'application/json'
        },
        body: JSON.stringify(body),
        signal: controller.signal
      });
    } catch (error) {
      if (error.name === 'AbortError' && didTimeout) {
        throw new Error(`Image generation timed out after ${timeoutMs} ms. Check the endpoint and provider timeout setting.`);
      }
      if (error.name === 'AbortError') throw error;
      throw new Error('Could not reach the image provider. Check the URL, network, and browser CORS settings.');
    } finally {
      window.clearTimeout(timeout);
    }
    if (!response.ok) {
      const detail = safeProviderMessage(await response.json().catch(() => null), getSecretValues(config));
      throw new Error(imageError(response.status, detail));
    }
    let data;
    try {
      data = await response.json();
    } catch {
      throw new Error('The image API returned invalid JSON. Configure the provider response format and response paths.');
    }
    const responseSettings = settings.response || {};
    const url = getPath(data, responseSettings.urlPath || 'data.0.url');
    const encoded = getPath(data, responseSettings.base64Path || 'data.0.b64_json');
    let blob = null;
    if (typeof encoded === 'string' && encoded) {
      const mimeType = typeof responseSettings.mimeType === 'string' ? responseSettings.mimeType : 'image/png';
      if (!['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(mimeType)) {
        throw new Error('The image API response has an unsupported image format.');
      }
      try {
        const binary = atob(encoded);
        blob = new Blob([Uint8Array.from(binary, (character) => character.charCodeAt(0))], { type: mimeType });
      } catch {
        throw new Error('The image API returned invalid base64 image data.');
      }
    } else if (typeof url !== 'string' || !url.trim()) {
      throw new Error('The image API response contains neither a configured image URL nor base64 image data.');
    }
    if (typeof onProgress === 'function') onProgress({ state: 'complete', progress: 100 });
    return {
      url: typeof url === 'string' ? url.trim() : '',
      blob,
      mimeType: blob?.type || 'image/*',
      temporaryUrl: !blob && Boolean(url),
      providerName: config.name,
      model: config.model
    };
  }

  async function testImage(config) {
    const startedAt = performance.now();
    const image = await generateImage(config, { prompt: 'A simple green circle on a dark background.', aspectRatio: '1:1' });
    return {
      ok: true,
      status: 200,
      latencyMs: Math.round(performance.now() - startedAt),
      message: `Real image response received from ${config.name}; the test image was not saved.${image.temporaryUrl ? ' Its provider URL may expire.' : ''}`
    };
  }

  async function fetchWithTimeout(config, options, method) {
    const timeoutMs = getTimeout(config);
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), timeoutMs);
    const startedAt = performance.now();
    try {
      const response = await fetch(config.endpoint.trim(), {
        ...options,
        method,
        headers: {
          ...makeRequestHeaders(config),
          ...options.headers
        },
        signal: controller.signal
      });
      return { response, latencyMs: Math.round(performance.now() - startedAt) };
    } catch (error) {
      if (error.name === 'AbortError') throw new Error(`Request timed out after ${timeoutMs} ms. Check the endpoint and try again.`);
      throw new Error('Could not reach the endpoint. Check the URL, network, and browser CORS settings.');
    } finally {
      window.clearTimeout(timeout);
    }
  }

  async function requestCompletion(config, messages) {
    validateConfig(config);
    if (!Array.isArray(messages) || messages.length === 0 || messages.some((message) => (
      !message || !['system', 'user', 'assistant'].includes(message.role) || typeof message.content !== 'string'
    ))) {
      throw new Error('The conversation could not be sent because its message data is invalid.');
    }
    const body = JSON.stringify({
      model: config.model.trim(),
      messages,
      ...(config.requestSettings?.extraBody || {})
    });
    const { response } = await fetchWithTimeout(config, {
      headers: { 'Content-Type': 'application/json' },
      body
    }, 'POST');
    if (!response.ok) {
      const detail = safeProviderMessage(await response.json().catch(() => null), getSecretValues(config));
      throw new Error(getHTTPError(response.status, detail));
    }

    let data;
    try {
      data = await response.json();
    } catch {
      throw new Error('The API returned an invalid response. Check that the endpoint is OpenAI Chat Completions-compatible.');
    }
    const content = data?.choices?.[0]?.message?.content;
    if (typeof content !== 'string' || !content.trim()) {
      throw new Error('The API response did not contain an assistant message.');
    }
    return redactText(content.trim(), getSecretValues(config));
  }

  async function testChat(config) {
    const startedAt = performance.now();
    const content = await requestCompletion(config, [{ role: 'user', content: 'Reply with OK.' }]);
    return {
      ok: true,
      status: 200,
      latencyMs: Math.round(performance.now() - startedAt),
      message: `Valid chat response received (${content.length} characters).`
    };
  }

  async function testCustomHTTP(config) {
    validateConfig(config, { requireApiKey: false });
    const method = String(config.requestSettings?.testMethod || 'GET').toUpperCase();
    const options = method === 'POST'
      ? {
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(config.requestSettings?.testBody ?? {})
        }
      : {};
    const { response, latencyMs } = await fetchWithTimeout(config, options, method);
    if (!response.ok) {
      const detail = safeProviderMessage(await response.json().catch(() => null), getSecretValues(config));
      throw new Error(`${getHTTPError(response.status, detail)} HTTP ${response.status} · ${latencyMs} ms.`);
    }
    return {
      ok: true,
      status: response.status,
      latencyMs,
      message: `HTTP ${response.status} · ${latencyMs} ms. Connectivity verified; endpoint-specific response behavior is not validated.`
    };
  }

  function redactText(text, secrets = []) {
    return secrets.filter((secret) => typeof secret === 'string' && secret.length > 0)
      .reduce((result, secret) => result.split(secret).join('[redacted credential]'), text)
      .replace(/(?:sk|rk|pk)-[A-Za-z0-9_-]{12,}/g, '[redacted credential]');
  }

  const providerAdapters = Object.freeze({
    'openai-compatible': Object.freeze({
      supports: (functionId) => functionId === 'chat-ai',
      complete: requestCompletion,
      test: testChat
    }),
    'openai-images': Object.freeze({
      supports: (functionId) => functionId === 'image-generation',
      generate: generateImage,
      test: testImage
    }),
    'custom-image-json': Object.freeze({
      supports: (functionId) => functionId === 'image-generation',
      generate: generateImage,
      test: testImage
    }),
    'brave-search': Object.freeze({
      supports: (functionId) => functionId === 'internet-search',
      search: (config, query, options) => window.ZeroGravityLiveData.search(config, query, options),
      test: (config) => window.ZeroGravityLiveData.testSearch(config)
    }),
    'custom-search-json': Object.freeze({
      supports: (functionId) => functionId === 'internet-search',
      search: (config, query, options) => window.ZeroGravityLiveData.search(config, query, options),
      test: (config) => window.ZeroGravityLiveData.testSearch(config)
    }),
    'open-meteo': Object.freeze({
      supports: (functionId) => functionId === 'weather',
      getWeather: (config, location, units, options) => window.ZeroGravityLiveData.fetchWeather(config, location, units, options),
      test: (config) => window.ZeroGravityLiveData.testWeather(config)
    }),
    'custom-weather-json': Object.freeze({
      supports: (functionId) => functionId === 'weather',
      getWeather: (config, location, units, options) => window.ZeroGravityLiveData.fetchWeather(config, location, units, options),
      test: (config) => window.ZeroGravityLiveData.testWeather(config)
    }),
    'custom-http': Object.freeze({
      supports: (functionId) => !['chat-ai', 'internet-search', 'weather'].includes(functionId),
      test: testCustomHTTP
    })
  });

  window.ZeroGravityAI = Object.freeze({
    functions: FUNCTION_DEFINITIONS,
    getFunction(functionId) {
      return FUNCTION_DEFINITIONS.find((entry) => entry.id === functionId);
    },
    validateConfig,
    createProvider(type = 'openai-compatible', functionId = 'chat-ai') {
      const adapter = providerAdapters[type];
      if (!adapter || !adapter.supports(functionId)) {
        throw new Error('This provider adapter does not support the selected function.');
      }
      return adapter;
    },
    getSupportedProviderTypes(functionId) {
      return Object.entries(providerAdapters)
        .filter(([, adapter]) => adapter.supports(functionId))
        .map(([type]) => type);
    },
    getImageCapabilities,
    generateImage,
    redactError(error, secrets = []) {
      return redactText(error instanceof Error ? error.message : String(error), secrets);
    }
  });
})();
