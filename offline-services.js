(function exposeOfflineServices() {
  const MODES = Object.freeze({
    AUTOMATIC: 'automatic',
    ONLINE_ONLY: 'online-only',
    OFFLINE_ONLY: 'offline-only'
  });

  const LOCAL_MEMORY_KEY = 'zerogravity.local.memory';

  function normalizeExpression(expression) {
    return expression.replace(/,/g, '').replace(/\s+/g, '');
  }

  function calculateExpression(expression) {
    const source = normalizeExpression(expression);
    if (!source || source.length > 128) throw new Error('Enter a shorter calculation.');
    const tokens = source.match(/(?:\d+(?:\.\d*)?|\.\d+|[()+\-*/%^])/g);
    if (!tokens || tokens.join('') !== source) return null;
    let position = 0;

    function parsePrimary() {
      const token = tokens[position];
      if (token === '+' || token === '-') {
        position += 1;
        const value = parsePrimary();
        return token === '-' ? -value : value;
      }
      if (token === '(') {
        position += 1;
        const value = parseAdditive();
        if (tokens[position] !== ')') throw new Error('Check the parentheses in that calculation.');
        position += 1;
        return value;
      }
      if (!token || !/^(?:\d+(?:\.\d*)?|\.\d+)$/.test(token)) {
        throw new Error('Check the numbers and operators in that calculation.');
      }
      position += 1;
      return Number(token);
    }

    function parsePower() {
      const value = parsePrimary();
      if (tokens[position] === '^') {
        position += 1;
        return value ** parsePower();
      }
      return value;
    }

    function parseMultiplicative() {
      let value = parsePower();
      while (['*', '/', '%'].includes(tokens[position])) {
        const operator = tokens[position++];
        const next = parsePower();
        if ((operator === '/' || operator === '%') && next === 0) {
          throw new Error('Division by zero is not defined.');
        }
        value = operator === '*' ? value * next : operator === '/' ? value / next : value % next;
      }
      return value;
    }

    function parseAdditive() {
      let value = parseMultiplicative();
      while (tokens[position] === '+' || tokens[position] === '-') {
        const operator = tokens[position++];
        const next = parseMultiplicative();
        value = operator === '+' ? value + next : value - next;
      }
      return value;
    }

    const result = parseAdditive();
    if (position !== tokens.length) throw new Error('Check the calculation syntax.');
    if (!Number.isFinite(result) || Math.abs(result) > Number.MAX_SAFE_INTEGER) {
      throw new Error('That calculation is outside the supported numeric range.');
    }
    return Number(result.toPrecision(12)).toString();
  }

  function stripCommandPrefix(text, pattern) {
    const match = text.match(pattern);
    return match ? match[1].trim() : '';
  }

  function createLocalMemoryStore(storage = null) {
    function getStorage() {
      try {
        return storage || window.localStorage;
      } catch {
        throw new Error('This browser does not allow local storage access.');
      }
    }

    return Object.freeze({
      read() {
        try {
          return getStorage().getItem(LOCAL_MEMORY_KEY) || '';
        } catch {
          throw new Error('Local memory could not be read from this browser.');
        }
      },
      write(value) {
        if (typeof value !== 'string') throw new Error('Local memory must be text.');
        try {
          const store = getStorage();
          if (value.trim()) store.setItem(LOCAL_MEMORY_KEY, value.trim());
          else store.removeItem(LOCAL_MEMORY_KEY);
        } catch {
          throw new Error('Local memory could not be saved. Check available browser storage.');
        }
        return value.trim();
      },
      clear() {
        try {
          getStorage().removeItem(LOCAL_MEMORY_KEY);
        } catch {
          throw new Error('Local memory could not be cleared from this browser.');
        }
      },
      key: LOCAL_MEMORY_KEY
    });
  }

  function createLocalCapabilityService(memoryStore = createLocalMemoryStore()) {
    return Object.freeze({
      process(text, context = {}) {
        const input = String(text || '').trim();
        const normalized = input.toLowerCase().replace(/[.!?]+$/g, '').trim();
        if (!normalized) return null;

        const search = input.match(/^(?:search local history|search my conversations|find in local history)(?: for)?\s+(.+)$/i);
        if (search) {
          if (typeof context.searchLocalContent !== 'function') {
            return { handled: true, source: 'local-tool', content: 'Local conversation search is unavailable.' };
          }
          const matches = context.searchLocalContent(search[1].trim());
          return {
            handled: true,
            source: 'local-tool',
            content: matches.length
              ? `Local conversation matches:\n${matches.slice(0, 3).join('\n')}`
              : 'No matching text was found in locally saved conversations.'
          };
        }

        const remembered = stripCommandPrefix(input, /^(?:remember(?: that)?|save to local memory)\s*[:,-]?\s+(.+)$/i);
        if (remembered) {
          const saved = memoryStore.write(remembered);
          return { handled: true, source: 'local-tool', content: `Saved locally: ${saved}` };
        }
        if (/^(?:what do you remember|read local memory|show local memory|what is in local memory)$/.test(normalized)) {
          const memory = memoryStore.read();
          return {
            handled: true,
            source: 'local-tool',
            content: memory ? `Your local memory says: ${memory}` : 'Local memory is empty.'
          };
        }
        if (/^(?:forget(?: local memory)?|clear local memory|delete local memory)$/.test(normalized)) {
          memoryStore.clear();
          return { handled: true, source: 'local-tool', content: 'Local memory cleared from this device.' };
        }

        if (/^(?:what time is it|what is the time|current time|time now|tell me the time)$/.test(normalized)) {
          const now = context.now instanceof Date ? context.now : new Date();
          return {
            handled: true,
            source: 'local-tool',
            content: `This device's local time is ${new Intl.DateTimeFormat(undefined, {
              hour: 'numeric',
              minute: '2-digit',
              second: '2-digit'
            }).format(now)}.`
          };
        }
        if (/^(?:what is the date|what date is it|today|today's date|current date|what day is it)$/.test(normalized)) {
          const now = context.now instanceof Date ? context.now : new Date();
          return {
            handled: true,
            source: 'local-tool',
            content: `This device's local date is ${new Intl.DateTimeFormat(undefined, {
              weekday: 'long',
              year: 'numeric',
              month: 'long',
              day: 'numeric'
            }).format(now)}.`
          };
        }

        const textOperation = input.match(/^(?:uppercase|make (?:this )?uppercase|lowercase|make (?:this )?lowercase|reverse|reverse text|count words|count characters)\s*[:,-]?\s+(.+)$/i);
        if (textOperation) {
          const command = input.slice(0, input.indexOf(textOperation[1])).toLowerCase();
          const value = textOperation[1];
          let content;
          if (command.includes('uppercase')) content = value.toLocaleUpperCase();
          else if (command.includes('lowercase')) content = value.toLocaleLowerCase();
          else if (command.includes('reverse')) content = Array.from(value).reverse().join('');
          else if (command.includes('count words')) content = `Word count: ${(value.trim().match(/\S+/g) || []).length}.`;
          else content = `Character count: ${Array.from(value).length}.`;
          return { handled: true, source: 'local-tool', content };
        }
        if (/^(?:offline help|local help|what can you do offline)$/.test(normalized)) {
          return {
            handled: true,
            source: 'local-tool',
            content: 'Offline tools can calculate arithmetic, report this device’s date and time, transform or count text, and save or read one explicit local memory note. General AI answers need a loaded compatible local model or an allowed online provider.'
          };
        }

        const calculation = input.match(/^(?:calculate|compute|solve|what is|what's)\s+(.+?)[?=]?$/i);
        const bareExpression = /^[\d\s.,()+\-*/%^]+$/.test(input) && /[+\-*/%^]/.test(input);
        if (calculation || bareExpression) {
          const expression = calculation ? calculation[1].trim() : input;
          const result = calculateExpression(expression);
          if (result !== null) {
            return { handled: true, source: 'local-tool', content: `${expression} = ${result}` };
          }
          if (calculation) {
            return { handled: true, source: 'local-tool', content: 'I could not parse that as a supported arithmetic expression.' };
          }
        }

        return null;
      }
    });
  }

  function createLocalModelManager(engine = window.ZeroGravityNativeInference || null) {
    const requiredMethods = ['discoverModels', 'checkResources', 'selectModel', 'loadModel', 'unloadModel', 'infer'];
    let models = [];
    let selectedModelId = '';
    let loadedModelId = '';
    let lastError = '';
    let hasEngine = false;
    try {
      hasEngine = Boolean(engine && requiredMethods.every((method) => typeof engine[method] === 'function')
        && (typeof engine.isAvailable === 'function'
          ? engine.isAvailable() === true
          : engine.isAvailable !== false));
    } catch {
      hasEngine = false;
    }

    async function discover() {
      if (!hasEngine) {
        models = [];
        selectedModelId = '';
        loadedModelId = '';
        return { available: false, models: [], error: 'No compatible on-device inference engine is installed.' };
      }
      try {
        const discovered = await engine.discoverModels();
        models = Array.isArray(discovered) ? discovered.filter((model) => (
          model && typeof model.id === 'string' && typeof model.name === 'string'
        )) : [];
        lastError = '';
        return {
          available: true,
          models: [...models],
          error: models.some((model) => model.installed === true) ? '' : 'No compatible local models are installed.'
        };
      } catch (error) {
        lastError = error.message || 'Local model discovery failed.';
        return { available: true, models: [], error: lastError };
      }
    }

    function recordInstalledModel(model) {
      if (!model || typeof model.id !== 'string' || typeof model.name !== 'string' || model.installed !== true) {
        throw new Error('The local engine did not confirm that the model was installed.');
      }
      models = [...models.filter((entry) => entry.id !== model.id), model];
      return model;
    }

    return Object.freeze({
      isSupported: () => hasEngine,
      async discoverModels() {
        return discover();
      },
      getStatus() {
        return {
          supported: hasEngine,
          models: [...models],
          selectedModelId,
          loadedModelId,
          error: lastError
        };
      },
      async selectModel(modelId) {
        if (!hasEngine) throw new Error('On-device inference is unavailable in this browser app.');
        const model = models.find((entry) => entry.id === modelId && entry.installed === true);
        if (!model) throw new Error('Choose an installed compatible model.');
        await engine.selectModel(modelId);
        selectedModelId = modelId;
        return model;
      },
      async loadSelectedModel() {
        if (!hasEngine) throw new Error('No on-device inference engine is installed.');
        const model = models.find((entry) => entry.id === selectedModelId && entry.installed === true);
        if (!model) throw new Error('Discover and select an installed local model before loading it.');
        const resources = await engine.checkResources(model);
        if (!resources || resources.canLoad !== true) {
          throw new Error(resources?.reason || 'The device does not have enough resources to load this model.');
        }
        await engine.loadModel(model.id);
        loadedModelId = model.id;
        lastError = '';
      },
      async unloadModel() {
        if (!hasEngine || !loadedModelId) return;
        await engine.unloadModel(loadedModelId);
        loadedModelId = '';
      },
      async infer(text, context = {}) {
        if (!hasEngine || !loadedModelId) throw new Error('No local model is loaded.');
        const answer = await engine.infer({ modelId: loadedModelId, text, context });
        if (typeof answer !== 'string' || !answer.trim()) throw new Error('The local model returned no text response.');
        return answer.trim();
      },
      async importModel(file) {
        if (!hasEngine || typeof engine.importModel !== 'function') {
          throw new Error('Model import requires a compatible native inference engine. No model was imported.');
        }
        if (!file) throw new Error('Choose a model file to import.');
        return recordInstalledModel(await engine.importModel(file, { userInitiated: true }));
      },
      async downloadModel(modelId, onProgress) {
        if (!hasEngine || typeof engine.downloadModel !== 'function') {
          throw new Error('Model downloads require a compatible native inference engine. No download was started.');
        }
        if (!window.confirm('Download this model now? Model downloads may use substantial data and device storage.')) {
          return { cancelled: true };
        }
        return recordInstalledModel(await engine.downloadModel(modelId, { userInitiated: true, onProgress }));
      }
    });
  }

  function createRequestRouter({ modelManager, localCapabilities }) {
    return Object.freeze({
      async route({ text, mode, onlineAvailable, localContext = {}, completeOnline }) {
        if (!Object.values(MODES).includes(mode)) throw new Error('Choose a valid offline mode.');
        if (typeof text !== 'string' || !text.trim()) throw new Error('Enter a message to route.');

        if (mode !== MODES.ONLINE_ONLY) {
          const localResult = localCapabilities.process(text, localContext);
          if (localResult?.handled) return localResult;
          const modelStatus = modelManager.getStatus();
          if (modelStatus.loadedModelId) {
            return {
              source: 'local-model',
              content: await modelManager.infer(text, localContext)
            };
          }
        }

        if (mode === MODES.OFFLINE_ONLY) {
          throw new Error('This request needs a compatible local model or offline tool. No online request was sent.');
        }
        if (!onlineAvailable) {
          throw new Error('No network is available and this request has no matching offline tool or loaded local model.');
        }
        if (typeof completeOnline !== 'function') throw new Error('No online Chat AI provider is configured.');
        const online = await completeOnline();
        if (!online || typeof online.content !== 'string' || !online.content.trim()) {
          throw new Error('The online provider did not return a response.');
        }
        return {
          source: 'online',
          providerName: online.providerName,
          content: online.content
        };
      }
    });
  }

  window.ZeroGravityOffline = Object.freeze({
    modes: MODES,
    localMemoryKey: LOCAL_MEMORY_KEY,
    createLocalMemoryStore,
    createLocalCapabilityService,
    createLocalModelManager,
    createRequestRouter,
    calculateExpression
  });
})();
