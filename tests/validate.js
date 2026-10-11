const fs = require('fs');
const path = require('path');
const http = require('http');
const { chromium } = require('playwright');

const baseDir = path.join(__dirname, '..');

function serveStatic(request, response) {
  const requestPath = request.url === '/' ? '/index.html' : request.url.split('?')[0];
  const filePath = path.join(baseDir, requestPath);

  fs.readFile(filePath, (error, content) => {
    if (error) {
      response.writeHead(404);
      response.end('Not found');
      return;
    }

    const extension = path.extname(filePath).toLowerCase();
    const contentType = {
      '.html': 'text/html; charset=utf-8',
      '.css': 'text/css; charset=utf-8',
      '.js': 'application/javascript; charset=utf-8',
      '.json': 'application/json; charset=utf-8',
      '.svg': 'image/svg+xml',
      '.png': 'image/png',
      '.jpg': 'image/jpeg',
      '.ico': 'image/x-icon'
    }[extension] || 'text/plain; charset=utf-8';

    response.writeHead(200, { 'Content-Type': contentType });
    response.end(content);
  });

}

async function main() {
  const server = http.createServer(serveStatic);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();

  try {
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({
      viewport: { width: 390, height: 844 },
      isMobile: true,
      hasTouch: true,
      userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1'
    });

    const pageErrors = [];
    const apiRequests = [];
    const liveSearchRequests = [];
    const liveWeatherRequests = [];
    const geocodingRequests = [];
    let wikipediaRequests = 0;
    let apiResponseNumber = 0;
    let retryWorked = false;
    page.on('pageerror', (error) => pageErrors.push(error.message));
    await page.addInitScript(() => {
      window.__recognitions = [];
      window.__spokenText = [];
      window.__speechCancelCount = 0;
      window.__microphoneTracksStopped = 0;
      window.__microphonePermissionRequests = 0;
      window.SpeechRecognition = class {
        constructor() {
          window.__recognitions.push(this);
        }
        start() {
          this.onstart?.();
        }
        abort() {
          this.aborted = true;
          this.onend?.();
        }
      };
      Object.defineProperty(navigator, 'mediaDevices', {
        configurable: true,
        value: {
          getUserMedia: async () => {
            window.__microphonePermissionRequests += 1;
            return {
              getTracks: () => [{
                stop() {
                  window.__microphoneTracksStopped += 1;
                }
              }]
            };
          }
        }
      });
      window.SpeechSynthesisUtterance = class {
        constructor(text) {
          this.text = text;
        }
      };
      const speechSynthesisMock = {
        speaking: false,
        voices: [{ name: 'Test Voice', lang: 'en-US', voiceURI: 'test-voice' }],
        getVoices() {
          return this.voices;
        },
        addEventListener() {},
        speak(utterance) {
          this.currentUtterance = utterance;
          this.speaking = true;
          window.__spokenText.push(utterance.text);
          utterance.onstart?.();
        },
        cancel() {
          this.speaking = false;
          window.__speechCancelCount += 1;
        }
      };
      Object.defineProperty(window, 'speechSynthesis', {
        configurable: true,
        value: speechSynthesisMock
      });
    });
    await page.route(`http://127.0.0.1:${port}/mock-chat`, async (route) => {
      apiResponseNumber += 1;
      apiRequests.push({
        authorizationPresent: route.request().headers().authorization === 'Bearer test-key-not-a-real-secret',
        payload: route.request().postDataJSON()
      });
      await new Promise((resolve) => setTimeout(resolve, apiResponseNumber === 6 ? 350 : 150));

      if (apiResponseNumber === 3) {
        await route.fulfill({ status: 500, contentType: 'application/json', body: '{"error":"test failure"}' });
        return;
      }

      const content = apiResponseNumber === 1 ? 'OK' : `Mock provider response ${apiResponseNumber}`;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ choices: [{ message: { content } }] })
      });
    });
    await page.route(`http://127.0.0.1:${port}/mock-http`, async (route) => {
      await route.fulfill({ status: 204, body: '' });
    });
    await page.route(`http://127.0.0.1:${port}/mock-leak`, async (route) => {
      await route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: '{"error":{"message":"local-api-secret header-secret"}}'
      });
      await page.route(`http://127.0.0.1:${port}/mock-search**`, async (route) => {
        liveSearchRequests.push(route.request().url());
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            results: [{
              title: 'Current events report',
              description: 'A provider-supplied current events summary.',
              url: 'https://news.example.test/current-events',
              source: 'Example News',
              publishedAt: '2026-02-03'
            }]
          })
        });
      });
      await page.route(`http://127.0.0.1:${port}/mock-weather**`, async (route) => {
        liveWeatherRequests.push(route.request().url());
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            current: { temp: 21, feels: 20, text: 'Partly cloudy', humidity: 52, wind: 9, precipitation: 0 },
            updated: '2026-02-03T10:00:00Z',
            timezone: 'Asia/Kolkata',
            daily: [{
              date: '2026-02-03',
              high: 24,
              low: 15,
              rainChance: 20,
              sunrise: '2026-02-03T06:30',
              sunset: '2026-02-03T17:50'
            }, {
              date: '2026-02-04',
              high: 23,
              low: 14,
              rainChance: 45,
              sunrise: '2026-02-04T06:30',
              sunset: '2026-02-04T17:50'
            }]
          })
        });
      });
      await page.route('https://geocoding-api.open-meteo.com/v1/search**', async (route) => {
        geocodingRequests.push(route.request().url());
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            results: [{
              name: 'Lucknow',
              admin1: 'Uttar Pradesh',
              country: 'India',
              latitude: 26.85,
              longitude: 80.95,
              timezone: 'Asia/Kolkata'
            }]
          })
        });
      });
      await page.route('https://en.wikipedia.org/w/api.php**', async (route) => {
        wikipediaRequests += 1;
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            query: {
              pages: {
                42: {
                  pageid: 42,
                  title: 'Example topic',
                  extract: 'A summary supplied by the Wikipedia API.',
                  fullurl: 'https://en.wikipedia.org/wiki/Example_topic',
                  thumbnail: { source: 'https://upload.wikimedia.org/example.jpg' }
                }
              }
            }
          })
        });
      });
    });

    const imageRequests = [];
    await page.route(`http://127.0.0.1:${port}/mock-image`, async (route) => {
      imageRequests.push({
        authorizationPresent: route.request().headers().authorization === 'Bearer image-session-secret',
        payload: route.request().postDataJSON()
      });
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          data: [{
            b64_json: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/f9sAAAAASUVORK5CYII='
          }]
        })
      });
    });

    await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'networkidle' });
    if (await page.evaluate(() => window.__microphonePermissionRequests) !== 0) {
      throw new Error('The app requested microphone permission before the user activated voice input');
    }

    const stylesheetCount = await page.locator('link[href="styles.css"]').count();
    const scriptCount = await page.locator('script[src="app.js"]').count();
    const providerScriptCount = await page.locator('script[src="ai-provider.js"]').count();
    const imageScriptCount = await page.locator('script[src="image-generation.js"]').count();
    const imageUIScriptCount = await page.locator('script[src="image-generation-ui.js"]').count();
    const liveDataScriptCount = await page.locator('script[src="live-data.js"]').count();
    const liveDataUIScriptCount = await page.locator('script[src="live-data-ui.js"]').count();
    const voiceScriptCount = await page.locator('script[src="voice-services.js"]').count();
    const offlineScriptCount = await page.locator('script[src="offline-services.js"]').count();
    const phoneActionScriptCount = await page.locator('script[src="phone-actions.js"]').count();
    if (stylesheetCount !== 1 || scriptCount !== 1 || providerScriptCount !== 1 || imageScriptCount !== 1 || imageUIScriptCount !== 1 || liveDataScriptCount !== 1 || liveDataUIScriptCount !== 1 || voiceScriptCount !== 1 || offlineScriptCount !== 1 || phoneActionScriptCount !== 1) {
      throw new Error(`Expected app stylesheet and all scripts, got ${stylesheetCount}, ${scriptCount}, ${providerScriptCount}, ${imageScriptCount}, ${imageUIScriptCount}, ${liveDataScriptCount}, ${liveDataUIScriptCount}, ${voiceScriptCount}, ${offlineScriptCount}, ${phoneActionScriptCount}`);
    }

    const offlineBoundaries = await page.evaluate(async () => {
      const memoryValues = new Map();
      const memory = window.ZeroGravityOffline.createLocalMemoryStore({
        getItem: (key) => memoryValues.get(key) || null,
        setItem: (key, value) => memoryValues.set(key, value),
        removeItem: (key) => memoryValues.delete(key)
      });
      const local = window.ZeroGravityOffline.createLocalCapabilityService(memory);
      const arithmetic = local.process('calculate (8 + 4) / 3');
      const uppercase = local.process('uppercase: zero gravity');
      const fixedDate = local.process('what is the date', { now: new Date('2026-10-10T12:00:00Z') });
      const savedMemory = local.process('remember that my favorite color is green');
      const recalledMemory = local.process('what do you remember?');
      const historySearch = local.process('search local history for offline phrase', {
        searchLocalContent: (query) => [`Conversation: found ${query}`]
      });
      const manager = window.ZeroGravityOffline.createLocalModelManager(null);
      const unavailable = await manager.discoverModels();
      let resourceAvailable = false;
      let modelLoadCalls = 0;
      let modelDownloadCalls = 0;
      let importedWithUserAction = false;
      let downloadedWithUserAction = false;
      const modelManager = window.ZeroGravityOffline.createLocalModelManager({
        async discoverModels() {
          return [{ id: 'mock-model', name: 'Mock local model', installed: true }];
        },
        async checkResources() {
          return resourceAvailable ? { canLoad: true } : { canLoad: false, reason: 'Not enough available memory.' };
        },
        async selectModel() {},
        async loadModel() { modelLoadCalls += 1; },
        async unloadModel() {},
        async infer() { return 'Genuine mock local inference result'; },
        async importModel(file, options) {
          importedWithUserAction = Boolean(file && options.userInitiated);
          return { id: 'imported-model', name: 'Imported mock model', installed: true };
        },
        async downloadModel(modelId, options) {
          modelDownloadCalls += 1;
          downloadedWithUserAction = modelId === 'mock-model' && options.userInitiated === true;
          return { id: modelId, name: 'Mock local model', installed: true };
        }
      });
      await modelManager.discoverModels();
      await modelManager.selectModel('mock-model');
      let lowMemoryRejected = false;
      try {
        await modelManager.loadSelectedModel();
      } catch (error) {
        lowMemoryRejected = error.message.includes('Not enough available memory');
      }
      resourceAvailable = true;
      await modelManager.loadSelectedModel();
      const inference = await modelManager.infer('Test prompt');
      await modelManager.unloadModel();
      const confirmBeforeDownload = window.confirm;
      window.confirm = () => false;
      const canceledDownload = await modelManager.downloadModel('mock-model');
      const downloadCallsAfterCancellation = modelDownloadCalls;
      window.confirm = () => true;
      await modelManager.downloadModel('mock-model');
      window.confirm = confirmBeforeDownload;
      await modelManager.importModel({ name: 'selected-by-user.gguf' });
      let onlineCalls = 0;
      const router = window.ZeroGravityOffline.createRequestRouter({
        modelManager: manager,
        localCapabilities: local
      });
      const online = async () => {
        onlineCalls += 1;
        return { content: 'Online response', providerName: 'Mock provider' };
      };
      const automaticLocal = await router.route({
        text: 'calculate 2 + 2',
        mode: 'automatic',
        onlineAvailable: true,
        completeOnline: online
      });
      const onlineOnly = await router.route({
        text: 'calculate 2 + 2',
        mode: 'online-only',
        onlineAvailable: true,
        completeOnline: online
      });
      let offlineBlocked = false;
      try {
        await router.route({
          text: 'Give me a general answer',
          mode: 'offline-only',
          onlineAvailable: true,
          completeOnline: online
        });
      } catch (error) {
        offlineBlocked = error.message.includes('No online request was sent');
      }
      const offlineTool = await router.route({
        text: 'uppercase: offline',
        mode: 'offline-only',
        onlineAvailable: true,
        completeOnline: online
      });
      let automaticOfflineBlocked = false;
      try {
        await router.route({
          text: 'Give me an answer that needs a model',
          mode: 'automatic',
          onlineAvailable: false,
          completeOnline: online
        });
      } catch (error) {
        automaticOfflineBlocked = error.message.includes('No network is available');
      }
      return {
        arithmetic: arithmetic.content,
        uppercase: uppercase.content,
        date: fixedDate.content,
        savedMemory: savedMemory.content,
        recalledMemory: recalledMemory.content,
        localHistorySearch: historySearch.content,
        unsupportedModel: !unavailable.available && unavailable.models.length === 0,
        lowMemoryRejected,
        guardedModelLoadCalls: modelLoadCalls,
        modelInference: inference,
        unloadedAfterInference: !modelManager.getStatus().loadedModelId,
        downloadRequiresConfirmation: canceledDownload.cancelled === true,
        canceledDownloadDidNotStart: downloadCallsAfterCancellation === 0,
        downloadWasUserConfirmed: downloadedWithUserAction,
        importWasUserInitiated: importedWithUserAction,
        automaticLocalSource: automaticLocal.source,
        onlineOnlySource: onlineOnly.source,
        offlineBlocked,
        automaticOfflineBlocked,
        offlineToolSource: offlineTool.source,
        onlineCalls
      };
    });
    if (offlineBoundaries.arithmetic !== '(8 + 4) / 3 = 4'
      || offlineBoundaries.uppercase !== 'ZERO GRAVITY'
      || !offlineBoundaries.date.includes('October 10, 2026')
      || !offlineBoundaries.savedMemory.includes('Saved locally')
      || !offlineBoundaries.recalledMemory.includes('favorite color is green')
      || !offlineBoundaries.localHistorySearch.includes('found offline phrase')
      || !offlineBoundaries.unsupportedModel
      || !offlineBoundaries.lowMemoryRejected
      || offlineBoundaries.guardedModelLoadCalls !== 1
      || offlineBoundaries.modelInference !== 'Genuine mock local inference result'
      || !offlineBoundaries.unloadedAfterInference
      || !offlineBoundaries.downloadRequiresConfirmation
      || !offlineBoundaries.canceledDownloadDidNotStart
      || !offlineBoundaries.downloadWasUserConfirmed
      || !offlineBoundaries.importWasUserInitiated
      || offlineBoundaries.automaticLocalSource !== 'local-tool'
      || offlineBoundaries.onlineOnlySource !== 'online'
      || !offlineBoundaries.offlineBlocked
      || !offlineBoundaries.automaticOfflineBlocked
      || offlineBoundaries.offlineToolSource !== 'local-tool'
      || offlineBoundaries.onlineCalls !== 1) {
      throw new Error(`Offline capabilities/router violated expected local and network boundaries: ${JSON.stringify(offlineBoundaries)}`);
    }

    const wakeWordBoundary = await page.evaluate(async () => {
      const manager = window.ZeroGravityVoice.createListeningModeManager();
      const transitions = [];
      manager.subscribe((mode) => transitions.push(mode));
      manager.setMode(manager.modes.PUSH_TO_TALK);
      manager.setMode(manager.modes.ACTIVE_CONVERSATION);
      manager.setMode(manager.modes.DISABLED);
      let wakeCallback;
      let stopped = false;
      let detected = false;
      const service = window.ZeroGravityVoice.createWakeWordService({
        isAvailable: true,
        getCapabilities: () => ({ sensitivity: true }),
        getPermissionStatus: async () => 'granted',
        start: async (options) => {
          wakeCallback = options.onWakeWord;
        },
        stop: async () => { stopped = true; }
      });
      const started = await service.start({ phrase: 'Test wake phrase', sensitivity: 0.6 }, {
        onWakeWord: () => { detected = true; }
      });
      wakeCallback({ phrase: 'Test wake phrase' });
      await service.stop();
      return {
        transitions,
        started,
        wakeDetected: detected,
        stopped,
        sensitivitySupported: service.getCapabilities().sensitivity,
        permission: await service.getPermissionStatus()
      };
    });
    if (wakeWordBoundary.transitions.join('|') !== 'push-to-talk|active-conversation|disabled'
      || !wakeWordBoundary.started
      || !wakeWordBoundary.wakeDetected
      || !wakeWordBoundary.stopped
      || !wakeWordBoundary.sensitivitySupported
      || wakeWordBoundary.permission !== 'granted') {
      throw new Error(`Listening mode or native wake-word engine interface failed: ${JSON.stringify(wakeWordBoundary)}`);
    }

    const navTexts = await page.locator('.nav-item span').allTextContents();
    if (navTexts.join('|') !== 'Home|Modules|Chat|Settings') {
      throw new Error(`Unexpected nav labels: ${navTexts.join(', ')}`);
    }

    await page.locator('.nav-item[data-screen="modules"]').click();
    if (await page.locator('#screen-modules').evaluate((el) => el.hidden) !== false) {
      throw new Error('Modules screen did not become visible');
    }

    await page.locator('.nav-item[data-screen="settings"]').click();
    if (await page.locator('#screen-settings').evaluate((el) => el.hidden) !== false) {
      throw new Error('Settings screen did not become visible');
    }

    await page.locator('.nav-item[data-screen="home"]').click();
    if (await page.locator('#screen-home').evaluate((el) => el.hidden) !== false) {
      throw new Error('Home screen did not become visible');
    }

    const orbMetrics = await page.locator('#particle-orb').evaluate((canvas) => ({
      width: canvas.width,
      height: canvas.height,
      pixels: canvas.toDataURL().length
    }));
    if (orbMetrics.width < 200 || orbMetrics.height < 200 || orbMetrics.pixels < 500) {
      throw new Error(`Orb did not render as expected: ${JSON.stringify(orbMetrics)}`);
    }

    await page.locator('.nav-item[data-screen="chat"]').click();
    await page.locator('#chat-form').evaluate((form) => form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
    if (apiRequests.length !== 0 || !(await page.locator('#chat-notice').innerText()).startsWith('No provider configured')) {
      throw new Error('An empty chat submission without a provider should be blocked with a helpful notice');
    }

    await page.locator('.nav-item[data-screen="settings"]').click();
    if (await page.locator('.provider-function-card').count() !== 17) {
      throw new Error('Own API dashboard should show 17 function cards');
    }
    if (await page.locator('#own-api-title').innerText() !== 'Own API') {
      throw new Error('The unified API settings dashboard title is missing');
    }
    if (!(await page.locator('#local-model-status').innerText()).includes('No inference engine')) {
      throw new Error('The UI should not claim local inference availability without an engine');
    }
    if ((await page.locator('#phone-capability-list .phone-capability-row').count()) !== 10
      || (await page.locator('#phone-bridge-state').innerText()) !== 'Browser only') {
      throw new Error('Phone Actions must list device actions and report browser-only support without a native bridge');
    }
    await page.locator('#phone-command-input').fill('open Android settings');
    await page.locator('#run-phone-command').click();
    await page.getByText('A browser cannot control Android apps or phone features.', { exact: false }).waitFor();
    if ((await page.locator('#phone-command-history-list li').count()) !== 1) {
      throw new Error('Phone Actions should show the outcome in recent command history');
    }
    await page.locator('#clear-phone-command-history').click();
    if ((await page.locator('#phone-command-history-list li').count()) !== 0) {
      throw new Error('Phone command history should be clearable');
    }
    const phoneCommandPage = await browser.newPage();
    await phoneCommandPage.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'networkidle' });
    await phoneCommandPage.locator('.nav-item[data-screen="chat"]').click();
    await phoneCommandPage.locator('#chat-input').fill('open android settings');
    await phoneCommandPage.locator('#send-message').click();
    await phoneCommandPage.locator('#chat-notice').filter({ hasText: 'A browser cannot control Android apps or phone features.' }).waitFor();
    await phoneCommandPage.close();
    await page.locator('#discover-local-models').click();
    await page.locator('#local-model-message').getByText('No compatible on-device inference engine is installed.', { exact: true }).waitFor();
    if (!(await page.locator('#local-model-select').isDisabled())) {
      throw new Error('Local model selection should be unavailable when no compatible model engine exists');
    }

    const beforeMotion = await page.locator('#motion-setting').evaluate((input) => input.checked);
    if (beforeMotion !== false) {
      throw new Error('Motion toggle should be unchecked when motion is enabled by default');
    }

    await page.evaluate(() => {
      const motionInput = document.querySelector('#motion-setting');
      motionInput.checked = true;
      motionInput.dispatchEvent(new Event('change', { bubbles: true }));
      const glowInput = document.querySelector('#glow-setting');
      glowInput.value = '60';
      glowInput.dispatchEvent(new Event('input', { bubbles: true }));
    });

    const savedPrefs = await page.evaluate(() => JSON.parse(localStorage.getItem('zerogravity.preferences')));
    if (!savedPrefs || savedPrefs.reducedMotion !== true || savedPrefs.glowLevel !== 60) {
      throw new Error(`Unexpected saved preferences: ${JSON.stringify(savedPrefs)}`);
    }

    await page.reload({ waitUntil: 'networkidle' });

    const persistedMotion = await page.locator('#motion-setting').evaluate((input) => input.checked);
    const persistedGlow = await page.locator('#glow-setting').evaluate((input) => input.value);
    const persistedPrefs = await page.evaluate(() => JSON.parse(localStorage.getItem('zerogravity.preferences')));

    if (persistedMotion !== true || persistedGlow !== '60' || persistedPrefs.reducedMotion !== true || persistedPrefs.glowLevel !== 60) {
      throw new Error(`Preferences did not persist after reload: motion=${persistedMotion}, glow=${persistedGlow}, prefs=${JSON.stringify(persistedPrefs)}`);
    }

    await page.locator('.nav-item[data-screen="settings"]').click();
    await page.locator('#new-provider').click();
    await page.locator('#provider-function-select').selectOption('chat-ai');
    await page.locator('#provider-name').fill('Test provider');
    await page.locator('#provider-endpoint').fill(`http://127.0.0.1:${port}/mock-chat`);
    await page.locator('#provider-key').fill('test-key-not-a-real-secret');
    await page.locator('#provider-headers').fill('{"X-Session-Test":"header-not-persisted"}');
    await page.locator('#provider-request-settings').fill('{"timeoutMs":30000}');
    await page.locator('#provider-model').fill('test-model');
    await page.locator('#provider-enabled').check();
    await page.locator('#save-provider').click();
    const providerId = await page.locator('#provider-config-select').inputValue();
    await page.locator('#active-provider-select').selectOption(providerId);
    await page.locator('#offline-mode-setting').selectOption('offline-only');
    if (!(await page.locator('#test-provider').isDisabled())
      || !(await page.locator('.provider-function-card[data-function="chat-ai"] .provider-test-button').isDisabled())
      || await page.locator('#offline-mode-state').innerText() !== 'Offline-only') {
      throw new Error('Offline-only mode should disable online connection testing and update the displayed mode');
    }
    await page.locator('.nav-item[data-screen="chat"]').click();
    await page.locator('#chat-input').fill('calculate 10 - 3');
    await page.locator('#send-message').click();
    await page.getByText('10 - 3 = 7', { exact: true }).waitFor();
    if (apiRequests.length !== 0
      || !(await page.locator('.chat-message.assistant').last().innerText()).toLowerCase().includes('local tool')) {
      throw new Error(`Offline-only local arithmetic should complete locally without calling the online provider: requests=${apiRequests.length}, assistant=${await page.locator('.chat-message.assistant').last().innerText()}`);
    }
    await page.locator('#chat-input').fill('Give me a general explanation that needs AI.');
    await page.locator('#send-message').click();
    await page.locator('#chat-notice').getByText('No online request was sent.', { exact: false }).waitFor();
    if (apiRequests.length !== 0) {
      throw new Error('Offline-only mode sent an unsupported AI request to the configured provider');
    }
    await page.locator('.nav-item[data-screen="settings"]').click();
    await page.locator('#offline-mode-setting').selectOption('automatic');
    await page.locator('#test-provider').click();
    await page.waitForFunction(() => !document.querySelector('#api-settings-status').textContent.includes('Testing connection…'));
    if (!(await page.locator('#api-settings-status').innerText()).includes('Connection test succeeded')) {
      throw new Error(`Chat provider test failed: ${await page.locator('#api-settings-status').innerText()}`);
    }

    if (apiRequests.length !== 1 || !apiRequests[0].authorizationPresent) {
      throw new Error(`Provider connection test did not send the configured credentials: ${JSON.stringify(apiRequests)}`);
    }
    if (await page.locator('body').innerText().then((text) => text.includes('test-key-not-a-real-secret'))) {
      throw new Error('The API key was displayed in the page text');
    }
    const storedProviderData = await page.evaluate(() => localStorage.getItem('zerogravity.api.providers'));
    if (storedProviderData.includes('test-key-not-a-real-secret')
      || storedProviderData.includes('header-not-persisted')
      || JSON.parse(storedProviderData).some((entry) => (
        Object.hasOwn(entry, 'apiKey')
        || Object.hasOwn(entry, 'headers')
        || Object.hasOwn(entry, 'requestSettings')
      ))) {
      throw new Error('Session-only provider credentials, headers, or request settings were persisted');
    }
    if (!(await page.locator('.provider-function-card[data-function="chat-ai"]').innerText()).includes('Test provider')) {
      throw new Error('The Chat AI dashboard card did not show its configured provider');
    }

    await page.locator('.nav-item[data-screen="chat"]').click();
    await page.locator('#chat-input').fill('remember that private offline memory phrase');
    await page.locator('#send-message').click();
    await page.getByText('Saved locally: private offline memory phrase', { exact: true }).waitFor();
    if (apiRequests.length !== 1
      || await page.locator('#local-memory-input').inputValue() !== 'private offline memory phrase') {
      throw new Error('Explicit local memory should be stored on-device without an online request');
    }
    await page.locator('#chat-input').fill('calculate 12 * (3 + 2)');
    await page.locator('#send-message').click();
    await page.getByText('12 * (3 + 2) = 60', { exact: true }).waitFor();
    await page.locator('#chat-input').fill('search local history for private offline memory phrase');
    await page.locator('#send-message').click();
    await page.getByText('Local conversation matches:', { exact: false }).waitFor();
    if (apiRequests.length !== 1) {
      throw new Error('Local conversation history search should not call the configured online provider');
    }

    const adapterCapabilities = await page.evaluate(() => {
      let unsupportedRejected = false;
      try {
        window.ZeroGravityAI.createProvider('openai-compatible', 'stt');
      } catch {
        unsupportedRejected = true;
      }
      return {
        chatTypes: window.ZeroGravityAI.getSupportedProviderTypes('chat-ai'),
        sttTypes: window.ZeroGravityAI.getSupportedProviderTypes('stt'),
        unsupportedRejected
      };
    });
    if (!adapterCapabilities.chatTypes.includes('openai-compatible')
      || adapterCapabilities.chatTypes.includes('custom-http')
      || adapterCapabilities.sttTypes.includes('openai-compatible')
      || !adapterCapabilities.sttTypes.includes('custom-http')
      || !adapterCapabilities.unsupportedRejected) {
      throw new Error(`Provider registry exposed unexpected function adapters: ${JSON.stringify(adapterCapabilities)}`);
    }
    const safeError = await page.evaluate(async (endpoint) => {
      const adapter = window.ZeroGravityAI.createProvider('openai-compatible', 'chat-ai');
      try {
        await adapter.test({
          name: 'Redaction test',
          endpoint,
          model: 'test-model',
          apiKey: 'local-api-secret',
          headers: { 'X-Private': 'header-secret' },
          requestSettings: { timeoutMs: 30000 }
        });
        return 'Unexpected success';
      } catch (error) {
        return error.message;
      }
    }, `http://127.0.0.1:${port}/mock-leak`);
    if (safeError.includes('local-api-secret') || safeError.includes('header-secret')) {
      throw new Error(`Provider errors leaked credential/header values: ${safeError}`);
    }

    await page.locator('.nav-item[data-screen="settings"]').click();
    await page.locator('.provider-function-card[data-function="custom-api"] .provider-add-function').click();
    await page.locator('#provider-name').fill('Connectivity probe');
    await page.locator('#provider-endpoint').fill(`http://127.0.0.1:${port}/mock-http`);
    await page.locator('#provider-model').fill('probe-model');
    await page.locator('#provider-enabled').check();
    await page.locator('#save-provider').click();
    await page.locator('#test-provider').click();
    await page.waitForFunction(() => !document.querySelector('#api-settings-status').textContent.includes('Testing connection…'));
    const customHTTPTestStatus = await page.locator('#api-settings-status').innerText();
    if (!customHTTPTestStatus.includes('Connection test succeeded')
      || !customHTTPTestStatus.includes('HTTP 204')
      || !customHTTPTestStatus.toLowerCase().includes('connectivity verified')) {
      throw new Error(`Custom HTTP connectivity test did not report verified reachability: ${customHTTPTestStatus}`);
    }
    if (!(await page.locator('.provider-function-card[data-function="stt"]').innerText()).includes('Adapter not implemented')) {
      throw new Error('Unimplemented function-specific adapters should be identified honestly on the dashboard');
    }
    const customFunctionCard = page.locator('.provider-function-card[data-function="custom-api"]');
    await customFunctionCard.getByRole('button', { name: 'Edit configuration' }).click();
    if (await page.locator('#provider-name').inputValue() !== 'Connectivity probe') {
      throw new Error('Editing a provider did not load its saved configuration');
    }
    await page.locator('#provider-name').fill('Connectivity probe edited');
    await page.locator('#save-provider').click();
    if (!(await customFunctionCard.innerText()).includes('Connectivity probe edited')) {
      throw new Error('Edited provider details were not saved');
    }
    await customFunctionCard.getByRole('button', { name: 'Edit configuration' }).click();
    page.once('dialog', (dialog) => dialog.accept());
    await page.locator('#delete-provider').click();
    if ((await customFunctionCard.innerText()).includes('Connectivity probe edited')) {
      throw new Error('Confirmed provider deletion did not remove the configuration');
    }

    await page.locator('.provider-function-card[data-function="image-generation"] .provider-add-function').click();
    await page.locator('#provider-name').fill('Mock image provider');
    await page.locator('#provider-endpoint').fill(`http://127.0.0.1:${port}/mock-image`);
    await page.locator('#provider-model').fill('mock-image-model');
    await page.locator('#provider-key').fill('image-session-secret');
    await page.locator('#provider-request-settings').fill('{"timeoutMs":30000,"imageGeneration":{"qualityField":"quality"}}');
    await page.locator('#provider-enabled').check();
    await page.locator('#save-provider').click();
    await page.locator('#api-settings-status').getByText('Provider configuration saved', { exact: false }).waitFor();
    await page.locator('.nav-item[data-screen="modules"]').click();
    await page.getByRole('button', { name: 'Open Image Generator' }).click();
    await page.locator('#image-prompt').fill('A small green planet');
    await page.locator('#image-aspect-ratio').selectOption('16:9');
    await page.locator('#generate-image').click();
    await page.locator('#image-generation-status').getByText('saved to the gallery', { exact: false }).waitFor();
    if (imageRequests.length !== 1
      || !imageRequests[0].authorizationPresent
      || imageRequests[0].payload.prompt !== 'A small green planet'
      || imageRequests[0].payload.size !== '1792x1024'
      || imageRequests[0].payload.model !== 'mock-image-model') {
      throw new Error(`Image generation did not send the configured provider request: ${JSON.stringify(imageRequests)}`);
    }
    await page.locator('#open-image-gallery').click();
    await page.getByRole('button', { name: 'View details' }).click();
    await page.locator('#image-detail-dialog').getByText('A small green planet', { exact: true }).waitFor();
    await page.locator('#image-detail-dialog').getByText('Mock image provider', { exact: true }).waitFor();
    page.once('dialog', (dialog) => dialog.accept());
    await page.locator('#delete-gallery-image').click();
    await page.locator('#image-gallery-empty').waitFor({ state: 'visible' });

    await page.locator('.nav-item[data-screen="settings"]').click();
    await page.locator('#provider-function-select').selectOption('internet-search');
    await page.locator('#provider-type-select').selectOption('custom-search-json');
    await page.locator('#provider-name').fill('Mock live search');
    await page.locator('#provider-endpoint').fill(`http://127.0.0.1:${port}/mock-search`);
    await page.locator('#provider-model').fill('');
    await page.locator('#provider-request-settings').fill(JSON.stringify({
      timeoutMs: 30000,
      search: {
        method: 'GET',
        queryField: 'q',
        resultsPath: 'results',
        titlePath: 'title',
        summaryPath: 'description',
        urlPath: 'url',
        sourcePath: 'source',
        publishedAtPath: 'publishedAt'
      }
    }));
    await page.locator('#provider-enabled').check();
    await page.locator('#save-provider').click();
    await page.locator('#api-settings-status').getByText('Provider configuration saved', { exact: false }).waitFor();
    const savedSearchSetup = await page.evaluate(() => {
      const entries = JSON.parse(localStorage.getItem('zerogravity.api.providers'));
      const provider = entries.find((entry) => entry.functionId === 'internet-search');
      return { provider, requestSettingsText: document.querySelector('#provider-request-settings').value };
    });
    if (savedSearchSetup.provider.liveOptions?.search?.resultsPath !== 'results') {
      throw new Error(`Search mapping was not persisted on save: ${JSON.stringify(savedSearchSetup)}`);
    }

    await page.locator('#provider-function-select').selectOption('weather');
    await page.locator('#provider-type-select').selectOption('custom-weather-json');
    await page.locator('#provider-name').fill('Mock weather');
    await page.locator('#provider-endpoint').fill(`http://127.0.0.1:${port}/mock-weather`);
    await page.locator('#provider-model').fill('');
    await page.locator('#provider-request-settings').fill(JSON.stringify({
      timeoutMs: 30000,
      weather: {
        method: 'GET',
        latitudeField: 'lat',
        longitudeField: 'lon',
        unitsField: 'units',
        response: {
          current: 'current',
          temperaturePath: 'temp',
          feelsLikePath: 'feels',
          conditionPath: 'text',
          humidityPath: 'humidity',
          windSpeedPath: 'wind',
          precipitationPath: 'precipitation',
          updatedAt: 'updated',
          timezone: 'timezone',
          daily: 'daily',
          dailyDatePath: 'date',
          highPath: 'high',
          lowPath: 'low',
          dailyPrecipitationChancePath: 'rainChance',
          sunrisePath: 'sunrise',
          sunsetPath: 'sunset',
          units: 'celsius'
        }
      }
    }));
    await page.locator('#provider-enabled').check();
    await page.locator('#save-provider').click();
    await page.locator('#api-settings-status').getByText('Provider configuration saved', { exact: false }).waitFor();

    await page.locator('.nav-item[data-screen="modules"]').click();
    await page.getByRole('button', { name: 'Open Search and Wikipedia' }).click();
    await page.locator('#live-search-query').fill('current events');
    await page.locator('#live-search-form button[type="submit"]').click();
    await page.locator('#live-search-results').getByText('Current events report', { exact: true }).waitFor();
    if (liveSearchRequests.length !== 1
      || !liveSearchRequests[0].includes('q=current+events')
      || !(await page.locator('#live-search-results').getByRole('link').first().getAttribute('href')).startsWith('https://news.example.test/')) {
      throw new Error(`Live search did not display provider results and source links: ${JSON.stringify(liveSearchRequests)}`);
    }
    await page.locator('#wikipedia-query').fill('Example topic');
    await page.locator('#wikipedia-search-form button[type="submit"]').click();
    await page.locator('#wikipedia-results').getByText('A summary supplied by the Wikipedia API.', { exact: true }).waitFor();
    if (wikipediaRequests !== 1) throw new Error('Wikipedia search did not call its public API exactly once');

    await page.locator('.nav-item[data-screen="chat"]').click();
    await page.locator('#chat-input').fill('Search the latest information about current events');
    await page.locator('#send-message').click();
    await page.locator('.chat-message.assistant .chat-message-content').last().getByText('Current events report', { exact: false }).waitFor();
    await page.locator('.chat-message-citations a').first().waitFor();
    if (liveSearchRequests.length !== 2) throw new Error('Chat search intent did not use the configured live search provider');

    await page.locator('.nav-item[data-screen="modules"]').click();
    await page.getByRole('button', { name: 'Open Weather and Local time' }).click();
    await page.locator('#weather-city').fill('Lucknow');
    await page.locator('#weather-city-submit').click();
    await page.locator('#weather-current').waitFor({ state: 'visible' });
    await page.locator('#weather-current').getByText('Partly cloudy', { exact: true }).waitFor();
    if (liveWeatherRequests.length !== 1 || geocodingRequests.length !== 1
      || !(await page.locator('#weather-current').innerText()).includes('21°C')) {
      throw new Error(`Manual city weather lookup failed: requests=${liveWeatherRequests.length}, geocoding=${geocodingRequests.length}`);
    }
    await page.locator('#weather-units').selectOption('fahrenheit');
    await page.locator('#weather-current').getByText('69.8°F', { exact: true }).waitFor();
    await page.evaluate(() => {
      window.confirm = () => true;
      Object.defineProperty(navigator, 'geolocation', {
        configurable: true,
        value: {
          getCurrentPosition(success, failure) {
            failure({ code: 1, PERMISSION_DENIED: 1 });
          }
        }
      });
    });
    await page.locator('#weather-location').click();
    await page.locator('#weather-status').getByText('Location permission was denied', { exact: false }).waitFor();
    await page.locator('.nav-item[data-screen="settings"]').click();
    await page.locator('#offline-mode-setting').selectOption('offline-only');
    await page.locator('.nav-item[data-screen="modules"]').click();
    await page.getByRole('button', { name: 'Open Weather and Local time' }).click();
    const requestsBeforeOffline = {
      search: liveSearchRequests.length,
      weather: liveWeatherRequests.length,
      geocoding: geocodingRequests.length,
      wikipedia: wikipediaRequests
    };
    await page.locator('#weather-city').fill('Delhi');
    await page.locator('#weather-city-submit').click();
    await page.locator('#weather-status').getByText('Offline-only mode blocks city lookup', { exact: false }).waitFor();
    if (liveWeatherRequests.length !== requestsBeforeOffline.weather
      || geocodingRequests.length !== requestsBeforeOffline.geocoding) {
      throw new Error('Offline-only manual city lookup made a network request');
    }
    await page.locator('#weather-city').fill('Lucknow');
    await page.locator('.nav-item[data-screen="chat"]').click();
    await page.locator('#chat-input').fill('Search the latest information about current events');
    await page.locator('#send-message').click();
    await page.locator('.chat-message.assistant .chat-message-content').last().getByText('Cached results', { exact: false }).waitFor();
    await page.locator('#chat-input').fill('Summarize this Wikipedia article.');
    await page.locator('#send-message').click();
    await page.waitForFunction(() => !document.querySelector('#send-message').disabled);
    const cachedWikipediaReply = await page.locator('.chat-message.assistant .chat-message-content').last().innerText();
    if (!cachedWikipediaReply.includes('Cached Wikipedia summaries')) {
      throw new Error(`Cached Wikipedia chat query did not use its cached result: reply=${cachedWikipediaReply}; lastMessage=${await page.locator('.chat-message').last().innerText()}; composer=${await page.locator('#chat-input').inputValue()}; notice=${await page.locator('#chat-notice').innerText()}`);
    }
    await page.locator('#chat-input').fill('What is the weather in Lucknow?');
    await page.locator('#send-message').click();
    await page.locator('.chat-message.assistant .chat-message-content').last().getByText('Cached data', { exact: false }).waitFor();
    if (liveSearchRequests.length !== requestsBeforeOffline.search
      || liveWeatherRequests.length !== requestsBeforeOffline.weather
      || geocodingRequests.length !== requestsBeforeOffline.geocoding
      || wikipediaRequests !== requestsBeforeOffline.wikipedia) {
      throw new Error('Offline-only search, Wikipedia, or weather chat routing sent a network request');
    }

    await page.locator('.nav-item[data-screen="settings"]').click();
    await page.locator('#offline-mode-setting').selectOption('automatic');
    await page.locator('.nav-item[data-screen="chat"]').click();
    await page.locator('#chat-input').fill('Please respond.');
    await page.locator('#send-message').click();
    if (!(await page.locator('#send-message').isDisabled()) || !(await page.getByText('Thinking…').isVisible())) {
      throw new Error('The send control and loading state should be visible while a request is processing');
    }
    await page.locator('#chat-form').evaluate((form) => form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
    await page.getByText('Mock provider response 2').waitFor();
    if (!(await page.locator('.chat-message.assistant').last().innerText()).toLowerCase().includes('online · test provider')) {
      throw new Error('Online AI responses should identify that they were processed by the configured provider');
    }
    if (apiRequests.length !== 2 || apiRequests[1].payload.model !== 'test-model' || apiRequests[1].payload.messages.at(-1).content !== 'Please respond.') {
      throw new Error(`Chat request did not contain the configured model and user message: ${JSON.stringify(apiRequests[1])}`);
    }
    if (JSON.stringify(apiRequests[1].payload.messages).includes('private offline memory phrase')
      || JSON.stringify(apiRequests[1].payload.messages).includes('12 * (3 + 2) = 60')) {
      throw new Error('Previously processed local memory or tool output was automatically included in an online prompt');
    }

    await page.locator('#chat-form').evaluate((form) => form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
    if (apiRequests.length !== 2) throw new Error('An empty message should not create an API request');

    await page.locator('#chat-input').fill('Please retry this.');
    await page.locator('#send-message').click();
    await page.getByRole('button', { name: 'Retry' }).last().waitFor();
    await page.getByRole('button', { name: 'Retry' }).last().click();
    await page.getByText('Mock provider response 4').waitFor();
    if (apiRequests.length !== 4) {
      throw new Error(`Expected one connection test, one regular request, one failed request, and one retry; got ${apiRequests.length}`);
    }
    retryWorked = apiRequests[3].payload.messages.at(-1).content === 'Please retry this.';
    if (!retryWorked) throw new Error('Retry did not resend the original user message');

    const conversationId = await page.locator('#conversation-history').inputValue();
    await page.reload({ waitUntil: 'networkidle' });
    await page.locator('.nav-item[data-screen="chat"]').click();
    await page.getByText('Mock provider response 2').waitFor();
    await page.getByText('Mock provider response 4').waitFor();
    const restoredProviderId = await page.locator('#active-provider-select').inputValue();
    if (restoredProviderId !== providerId) {
      throw new Error('The selected active provider did not persist after reload');
    }

    await page.locator('#new-conversation').click();
    if (await page.locator('#conversation-history option').count() !== 2) {
      throw new Error('New conversation did not preserve the existing conversation in history');
    }
    await page.locator('#conversation-history').selectOption(conversationId);
    await page.getByText('Mock provider response 4').waitFor();

    await page.locator('.nav-item[data-screen="settings"]').click();
    await page.locator('#provider-config-select').selectOption(providerId);
    await page.locator('#provider-key').fill('test-key-not-a-real-secret');
    await page.locator('#save-provider').click();
    await page.locator('#voice-replies-setting').evaluate((input) => {
      input.checked = true;
      input.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await page.locator('#voice-rate-setting').evaluate((input) => {
      input.value = '1.2';
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await page.locator('#voice-selection').selectOption('test-voice');
    await page.locator('#wake-word-enabled').check();
    await page.locator('#wake-word-phrase').fill('Hey ZeroGravity test');
    if (!(await page.locator('#wake-sensitivity').isDisabled())) {
      throw new Error('Wake-word sensitivity should be disabled without a supporting local engine');
    }
    const permissionRequestsBeforeWake = await page.evaluate(() => window.__microphonePermissionRequests);
    await page.locator('#wake-word-toggle').click();
    await page.getByText('Wake-word listening is unavailable', { exact: false }).waitFor();
    if (await page.evaluate(() => window.__microphonePermissionRequests) !== permissionRequestsBeforeWake
      || await page.locator('#listening-mode-state').innerText() !== 'Disabled'
      || await page.locator('#wake-word-engine-status').innerText() !== 'Unavailable in this browser') {
      throw new Error('Unavailable browser wake-word mode should not request microphone permission or change the listening mode');
    }
    const persistedVoiceSettings = await page.evaluate(() => JSON.parse(localStorage.getItem('zerogravity.preferences')));
    if (persistedVoiceSettings.voiceReplies !== true || persistedVoiceSettings.speechRate !== 1.2 || persistedVoiceSettings.speechVoiceURI !== 'test-voice') {
      throw new Error(`Voice settings did not persist: ${JSON.stringify(persistedVoiceSettings)}`);
    }
    if (persistedVoiceSettings.wakeWordEnabled !== true || persistedVoiceSettings.wakeWordPhrase !== 'Hey ZeroGravity test') {
      throw new Error(`Wake-word preferences did not persist: ${JSON.stringify(persistedVoiceSettings)}`);
    }

    await page.locator('.nav-item[data-screen="chat"]').click();
    await page.locator('#new-conversation').click();
    await page.locator('#chat-voice-input').click();
    await page.waitForFunction(() => window.__recognitions.length === 1);
    await page.evaluate(() => {
      const recognition = window.__recognitions[0];
      const result = [{ transcript: 'voice test message' }];
      result.isFinal = true;
      recognition.onresult({ resultIndex: 0, results: [result] });
      recognition.onend();
    });
    await page.getByText('Speech recognized. Review or edit the text', { exact: false }).waitFor();
    if (await page.locator('#chat-input').inputValue() !== 'voice test message') {
      throw new Error('Recognized speech was not placed in the editable chat composer');
    }
    await page.locator('#send-message').click();
    await page.getByText('Mock provider response 5').waitFor();
    await page.waitForFunction(() => document.querySelector('#voice-state').textContent === 'Speaking');
    if (!(await page.locator('#screen-chat').isVisible())) {
      throw new Error(`Chat screen was hidden while voice state was ${await page.locator('#voice-state').innerText()}`);
    }
    const autoSpokenText = await page.evaluate(() => window.__spokenText.at(-1));
    if (autoSpokenText !== 'Mock provider response 5') {
      throw new Error(`Spoken reply did not read the AI response: ${autoSpokenText}`);
    }
    await page.getByRole('button', { name: 'Stop speaking this response' }).waitFor();
    await page.getByRole('button', { name: 'Stop speaking this response' }).click();
    await page.waitForFunction(() => document.querySelector('#voice-state').textContent === 'Idle');
    await page.getByRole('button', { name: 'Speak assistant response' }).last().click();
    await page.waitForFunction(() => document.querySelector('#voice-state').textContent === 'Speaking');

    await page.locator('#chat-voice-input').click();
    await page.waitForFunction(() => window.__recognitions.length === 2);
    const canceledForNewVoice = await page.evaluate(() => window.__speechCancelCount > 0 && !window.speechSynthesis.speaking);
    if (!canceledForNewVoice) throw new Error('Starting voice input did not interrupt speech playback');
    await page.locator('#chat-voice-input').click();
    const tracksReleased = await page.evaluate(() => window.__microphoneTracksStopped === 2);
    if (!tracksReleased) throw new Error('Microphone permission tracks were not stopped after voice input ended');

    await page.locator('button[aria-label="Speak assistant response"]').last().click();
    await page.waitForFunction(() => document.querySelector('#voice-state').textContent === 'Speaking');
    if (!(await page.locator('#screen-chat').isVisible())) {
      throw new Error(`Chat screen was hidden before manual speech stop: ${await page.locator('#voice-state').innerText()}`);
    }
    await page.locator('#stop-voice').click();
    const afterStopState = await page.evaluate(() => ({
      state: document.querySelector('#voice-state').textContent,
      screens: [...document.querySelectorAll('.screen')].map((screen) => [screen.id, screen.hidden]),
      speechActive: window.speechSynthesis.speaking
    }));
    if (afterStopState.state !== 'Idle' || afterStopState.screens.find(([id]) => id === 'screen-chat')?.[1]) {
      throw new Error(`Stop voice state did not return to idle in chat: ${JSON.stringify(afterStopState)}`);
    }
    const speechStopped = await page.evaluate(() => !window.speechSynthesis.speaking);
    if (!speechStopped) throw new Error('Stop voice did not cancel speech playback');
    const unsupportedPlayback = await page.evaluate(() => {
      const utteranceDescriptor = Object.getOwnPropertyDescriptor(window, 'SpeechSynthesisUtterance');
      Object.defineProperty(window, 'SpeechSynthesisUtterance', {
        configurable: true,
        value: undefined
      });
      const service = window.ZeroGravityVoice.createSpeechSynthesisService();
      let message = '';
      try {
        service.speak('This should not play.');
      } catch (error) {
        message = error.message;
      }
      const supported = service.isSupported();
      Object.defineProperty(window, 'SpeechSynthesisUtterance', utteranceDescriptor);
      return { supported, message };
    });
    if (unsupportedPlayback.supported || !unsupportedPlayback.message.includes('unavailable')) {
      throw new Error(`Unsupported speech playback was not handled gracefully: ${JSON.stringify(unsupportedPlayback)}`);
    }

    const spokenBeforeNewInteraction = await page.evaluate(() => window.__spokenText.length);
    await page.locator('#new-conversation').click();
    await page.locator('#chat-input').fill('Start a reply before beginning another voice interaction.');
    await page.locator('#send-message').click();
    await page.locator('#chat-voice-input').click();
    await page.waitForFunction(() => window.__recognitions.length === 3);
    await page.getByText('Mock provider response 6').waitFor();
    const spokenDuringNewInteraction = await page.evaluate(() => window.__spokenText.length);
    if (spokenDuringNewInteraction !== spokenBeforeNewInteraction
      || !(await page.locator('#voice-state').innerText()).startsWith('Listening')) {
      throw new Error('A reply arriving during a newer voice interaction interrupted listening or played unexpectedly');
    }
    await page.locator('#chat-voice-input').click();

    await page.reload({ waitUntil: 'networkidle' });
    const voiceSettingsAfterReload = await page.evaluate(() => JSON.parse(localStorage.getItem('zerogravity.preferences')));
    if (voiceSettingsAfterReload.voiceReplies !== true || voiceSettingsAfterReload.speechRate !== 1.2 || voiceSettingsAfterReload.speechVoiceURI !== 'test-voice') {
      throw new Error(`Voice settings did not remain persisted after reload: ${JSON.stringify(voiceSettingsAfterReload)}`);
    }
    if (voiceSettingsAfterReload.wakeWordEnabled !== true
      || voiceSettingsAfterReload.wakeWordPhrase !== 'Hey ZeroGravity test'
      || voiceSettingsAfterReload.wakeWordSensitivity !== 50) {
      throw new Error(`Wake-word settings did not remain persisted after reload: ${JSON.stringify(voiceSettingsAfterReload)}`);
    }
    if (voiceSettingsAfterReload.offlineMode !== 'automatic') {
      throw new Error(`Offline routing preference did not remain persisted: ${JSON.stringify(voiceSettingsAfterReload)}`);
    }
    await page.evaluate(() => {
      Object.defineProperty(navigator.mediaDevices, 'getUserMedia', {
        configurable: true,
        value: async () => { throw new DOMException('Permission denied', 'NotAllowedError'); }
      });
    });
    await page.locator('#home-voice-input').click();
    await page.locator('#home-voice-status').getByText('Microphone permission was denied', { exact: false }).waitFor();
    if (await page.locator('#listening-mode-state').innerText() !== 'Disabled'
      || await page.locator('#voice-settings-state').innerText() !== 'Error') {
      throw new Error('Denied microphone access should return the listening mode to Disabled and show an error state');
    }
    const unsupportedPage = await browser.newPage();
    await unsupportedPage.addInitScript(() => {
      window.SpeechRecognition = undefined;
      window.webkitSpeechRecognition = undefined;
      localStorage.setItem('zerogravity.api.providers', JSON.stringify([{
        id: 'legacy-provider',
        functionId: 'chat-ai',
        type: 'openai-compatible',
        name: 'Legacy provider',
        endpoint: 'https://example.test/v1/chat/completions',
        model: 'legacy-model',
        apiKey: 'legacy-api-secret',
        headers: { 'X-Legacy-Private': 'legacy-header-secret' },
        requestSettings: { token: 'legacy-request-secret' },
        enabled: true
      }]));
    });
    await unsupportedPage.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'networkidle' });
    const migratedProviderData = await unsupportedPage.evaluate(() => localStorage.getItem('zerogravity.api.providers'));
    if (migratedProviderData.includes('legacy-api-secret')
      || migratedProviderData.includes('legacy-header-secret')
      || migratedProviderData.includes('legacy-request-secret')
      || JSON.parse(migratedProviderData).some((entry) => (
        Object.hasOwn(entry, 'apiKey')
        || Object.hasOwn(entry, 'headers')
        || Object.hasOwn(entry, 'requestSettings')
      ))) {
      throw new Error('Migration did not remove legacy secrets and session-only settings from browser storage');
    }
    await unsupportedPage.locator('#home-voice-input').click();
    await unsupportedPage.locator('#home-voice-status').getByText('Voice input is unavailable in this browser', { exact: false }).waitFor();
    await unsupportedPage.close();

    await page.locator('.nav-item[data-screen="settings"]').click();
    if (await page.locator('#local-memory-input').inputValue() !== 'private offline memory phrase') {
      throw new Error('Explicit local memory did not persist on this device across reload');
    }
    page.once('dialog', (dialog) => dialog.accept());
    await page.locator('#clear-local-memory').click();
    if (await page.evaluate(() => localStorage.getItem('zerogravity.local.memory')) !== null
      || await page.locator('#local-memory-input').inputValue() !== '') {
      throw new Error('Clear local memory did not remove the saved note');
    }
    page.once('dialog', (dialog) => dialog.accept());
    await page.locator('#clear-local-history').click();
    if (JSON.parse(await page.evaluate(() => localStorage.getItem('zerogravity.chat.conversations'))).length !== 0) {
      throw new Error('Clear conversation history did not remove locally saved conversations');
    }

    await page.setViewportSize({ width: 320, height: 740 });
    const navGeometry = await page.locator('.bottom-nav').evaluate((nav) => ({
      width: nav.clientWidth,
      contentWidth: nav.scrollWidth
    }));
    if (navGeometry.contentWidth > navGeometry.width) {
      throw new Error(`Mobile navigation overflows at 320px: ${JSON.stringify(navGeometry)}`);
    }

    await page.locator('.nav-item[data-screen="modules"]').click();
    await page.getByRole('button', { name: 'Open Memory and Personalization' }).click();
    await page.evaluate(() => history.back());
    await page.waitForFunction(() => !document.querySelector('#screen-modules').hidden);
    await page.getByRole('button', { name: 'Open Memory and Personalization' }).click();
    await page.locator('#memory-add').click();
    if (!(await page.locator('#memory-edit-dialog').evaluate((dialog) => dialog.open))) {
      throw new Error(`Memory editor did not open: pageErrors=${JSON.stringify(pageErrors)}, status=${await page.locator('#memory-settings-status').innerText()}`);
    }
    await page.locator('#memory-edit-content').fill('I prefer a quiet workspace.');
    await page.locator('#memory-edit-category').selectOption('preference');
    await page.locator('#memory-edit-form button[type="submit"]').click();
    await page.locator('#memory-list').getByText('I prefer a quiet workspace.').waitFor();
    const memoryLayout = await page.evaluate(() => ({
      viewport: document.documentElement.clientWidth,
      document: document.documentElement.scrollWidth
    }));
    if (memoryLayout.document > memoryLayout.viewport) {
      throw new Error(`Memory screen overflows horizontally at 320px: ${JSON.stringify(memoryLayout)}`);
    }
    await page.locator('.nav-item[data-screen="settings"]').click();
    await page.locator('#offline-mode-setting').selectOption('offline-only');
    await page.locator('.nav-item[data-screen="chat"]').click();
    const requestsBeforeMemoryCommands = apiRequests.length;
    await page.locator('#chat-input').fill('What do you remember about me?');
    await page.locator('#send-message').click();
    await page.locator('.chat-message.assistant .chat-message-content').last().getByText('quiet workspace', { exact: false }).waitFor();
    const memoryCountBeforePrivate = JSON.parse(await page.evaluate(() => localStorage.getItem('zerogravity.memory.v1'))).memories.length;
    await page.locator('#private-conversation-mode').check();
    await page.evaluate(() => localStorage.setItem('zerogravity.local.memory', 'legacy note hidden in private mode'));
    await page.locator('#chat-input').fill('What do you remember about me?');
    await page.locator('#send-message').click();
    const privateMemoryReply = page.locator('.chat-message.assistant .chat-message-content').last();
    await privateMemoryReply.getByText('Private mode is on', { exact: false }).waitFor();
    if ((await privateMemoryReply.innerText()).includes('quiet workspace')) {
      throw new Error('Private mode returned saved memory contents');
    }
    await page.locator('#chat-input').fill('Read local memory');
    await page.locator('#send-message').click();
    await page.locator('.chat-message.assistant .chat-message-content').last().getByText('Private mode is on', { exact: false }).waitFor();
    await page.locator('#chat-input').fill('Remember this: a private-only detail.');
    await page.locator('#send-message').click();
    await page.locator('.chat-message.assistant .chat-message-content').last().getByText('private conversation', { exact: false }).waitFor();
    const memoryCountAfterPrivate = JSON.parse(await page.evaluate(() => localStorage.getItem('zerogravity.memory.v1'))).memories.length;
    if (memoryCountAfterPrivate !== memoryCountBeforePrivate || apiRequests.length !== requestsBeforeMemoryCommands) {
      throw new Error('Private or Offline-only memory commands must not persist new data or send network requests');
    }
    await page.evaluate(() => localStorage.removeItem('zerogravity.local.memory'));
    await page.locator('#private-conversation-mode').uncheck();
    await page.locator('.nav-item[data-screen="modules"]').evaluate((button) => button.click());
    await page.getByRole('button', { name: 'Open Memory and Personalization' }).click();
    await page.locator('#memory-enabled').evaluate((input) => {
      input.checked = false;
      input.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await page.locator('.nav-item[data-screen="chat"]').evaluate((button) => button.click());
    await page.locator('#chat-input').fill('Remember this: a memory while disabled.');
    await page.locator('#send-message').click();
    await page.locator('.chat-message.assistant .chat-message-content').last().getByText('Memory is turned off', { exact: false }).waitFor();
    if (JSON.parse(await page.evaluate(() => localStorage.getItem('zerogravity.memory.v1'))).memories.length !== memoryCountBeforePrivate) {
      throw new Error('Disabled memory must not save chat commands');
    }
    await page.locator('.nav-item[data-screen="settings"]').evaluate((button) => button.click());
    await page.locator('#offline-mode-setting').selectOption('automatic');
    const chatProviderCard = page.locator('.provider-function-card[data-function="chat-ai"]');
    await chatProviderCard.getByRole('button', { name: 'Edit configuration' }).click();
    await page.locator('#provider-key').fill('test-key-not-a-real-secret');
    await page.locator('#save-provider').click();
    await page.locator('.nav-item[data-screen="modules"]').evaluate((button) => button.click());
    await page.getByRole('button', { name: 'Open Memory and Personalization' }).click();
    for (const id of ['memory-enabled', 'personalization-enabled', 'online-memory-enabled', 'calm-mode-enabled']) {
      await page.locator(`#${id}`).evaluate((input) => {
        input.checked = true;
        input.dispatchEvent(new Event('change', { bubbles: true }));
      });
    }
    if (await page.evaluate(() => window.ZeroGravityMemoryUI.getVoiceRate(1.2)) !== 0.85) {
      throw new Error('Calm Mode should slow supported speech output without overwriting the saved speech-rate preference');
    }
    await page.locator('#memory-list .memory-card input[type="checkbox"]').check();
    await page.locator('.nav-item[data-screen="chat"]').evaluate((button) => button.click());
    await page.locator('#chat-input').fill('Please use my approved workspace preference.');
    await page.locator('#send-message').click();
    await page.waitForFunction(() => !document.querySelector('#send-message').disabled, null, { timeout: 10000 });
    if (!(await page.locator('.chat-message.assistant').last().innerText()).includes('Mock provider response')) {
      throw new Error(`Opt-in personalization chat request failed: apiRequests=${JSON.stringify(apiRequests.slice(-2))}, assistant=${await page.locator('.chat-message.assistant').last().innerText()}, error=${await page.locator('.chat-message.error').last().innerText()}`);
    }
    const approvedMemoryPayload = apiRequests.at(-1).payload.messages;
    if (!JSON.stringify(approvedMemoryPayload).includes('I prefer a quiet workspace.')
      || !JSON.stringify(approvedMemoryPayload).includes('Use Calm Mode')
      || !(await page.locator('.chat-message.assistant').last().innerText()).includes('Personalization used 1 selected saved memory')) {
      throw new Error('An explicitly approved memory should be shown as used and included only when online sharing is enabled');
    }
    const privateResponseNumber = apiResponseNumber + 1;
    await page.locator('#private-conversation-mode').check();
    await page.locator('#chat-input').fill('Please respond privately without personalization.');
    await page.locator('#send-message').click();
    await page.getByText(`Mock provider response ${privateResponseNumber}`).waitFor();
    if (JSON.stringify(apiRequests.at(-1).payload.messages).includes('I prefer a quiet workspace.')
      || JSON.stringify(apiRequests.at(-1).payload.messages).includes('Use Calm Mode')) {
      throw new Error('Private conversations must not send saved memory to an online provider');
    }
    await page.locator('#private-conversation-mode').uncheck();
    await page.locator('.nav-item[data-screen="modules"]').evaluate((button) => button.click());
    await page.getByRole('button', { name: 'Open Memory and Personalization' }).click();
    await page.locator('#reset-personalization').click();
    await page.getByText('online-sharing approvals were reset', { exact: false }).waitFor();
    if (await page.locator('#personalization-enabled').isChecked()
      || await page.locator('#calm-mode-enabled').isChecked()
      || await page.locator('#online-memory-enabled').isChecked()
      || await page.locator('#memory-list .memory-card input[type="checkbox"]').isChecked()) {
      throw new Error('Reset personalization must disable its settings and revoke saved-memory sharing approvals');
    }
    await page.evaluate(() => localStorage.setItem('zerogravity.local.memory', 'legacy note to clear'));
    page.once('dialog', (dialog) => dialog.accept());
    await page.locator('#memory-clear-all').click();
    const clearedMemoryData = await page.evaluate(() => localStorage.getItem('zerogravity.memory.v1'));
    if ((clearedMemoryData !== null && JSON.parse(clearedMemoryData).memories.length !== 0)
      || await page.evaluate(() => localStorage.getItem('zerogravity.local.memory')) !== null) {
      throw new Error('Clear all memories must also clear the legacy local memory note');
    }

    const reloadedContext = await browser.newContext({ storageState: await page.context().storageState() });
    const reloadedPage = await reloadedContext.newPage();
    await reloadedPage.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'networkidle' });
    const restoredLiveProviderOptions = await reloadedPage.evaluate(() => ({
      search: window.ZeroGravityApp.getLiveProviderConfig('internet-search'),
      weather: window.ZeroGravityApp.getLiveProviderConfig('weather')
    }));
    if (restoredLiveProviderOptions.search?.requestSettings.search?.resultsPath !== 'results'
      || restoredLiveProviderOptions.weather?.requestSettings.weather?.response?.temperaturePath !== 'temp'
      || restoredLiveProviderOptions.search.apiKey
      || restoredLiveProviderOptions.weather.apiKey) {
      throw new Error(`Non-secret live-data mappings should persist without credentials: ${JSON.stringify(restoredLiveProviderOptions)}; stored=${await reloadedPage.evaluate(() => localStorage.getItem('zerogravity.api.providers'))}`);
    }
    await reloadedPage.locator('.nav-item[data-screen="settings"]').click();
    const savedImageProviderCard = reloadedPage.locator('.provider-function-card[data-function="image-generation"]');
    await savedImageProviderCard.getByRole('button', { name: 'Edit configuration' }).click();
    const reloadedRequestSettings = JSON.parse(await reloadedPage.locator('#provider-request-settings').inputValue());
    if (await reloadedPage.locator('#provider-type-select').inputValue() !== 'openai-images'
      || reloadedRequestSettings.imageGeneration?.qualityField !== 'quality'
      || (await reloadedPage.locator('#provider-key-status').innerText()).includes('present in memory')) {
      throw new Error(`The image provider type/options should persist while its API key remains session-only: type=${await reloadedPage.locator('#provider-type-select').inputValue()}, options=${JSON.stringify(reloadedRequestSettings)}, key=${await reloadedPage.locator('#provider-key-status').innerText()}`);
    }
    await reloadedPage.locator('.nav-item[data-screen="modules"]').click();
    await reloadedPage.getByRole('button', { name: 'Open Image Generator' }).click();
    if (await reloadedPage.locator('#image-quality').isDisabled()
      || !(await reloadedPage.locator('#image-provider-status').innerText()).includes('Enter its API key')) {
      throw new Error(`Reloaded image provider options or the session-key warning did not restore correctly: disabled=${await reloadedPage.locator('#image-quality').isDisabled()}, status=${await reloadedPage.locator('#image-provider-status').innerText()}`);
    }
    await reloadedContext.close();

    if (pageErrors.length > 0) {
      throw new Error(`Page errors encountered: ${pageErrors.join('; ')}`);
    }

    console.log(JSON.stringify({
      stylesheetCount,
      scriptCount,
      providerScriptCount,
      imageScriptCount,
      imageUIScriptCount,
      liveDataScriptCount,
      liveDataUIScriptCount,
      voiceScriptCount,
      phoneActionScriptCount,
      navTexts,
      orbMetrics,
      beforeMotion,
      persistedMotion,
      persistedGlow,
      persistedPrefs,
      apiRequests: apiRequests.length,
      imageRequests: imageRequests.length,
      liveSearchRequests: liveSearchRequests.length,
      liveWeatherRequests: liveWeatherRequests.length,
      geocodingRequests: geocodingRequests.length,
      wikipediaRequests,
      retryWorked,
      conversationHistoryRestored: true,
      activeProviderRestored: restoredProviderId === providerId,
      recognizedSpeechSent: true,
      spokenReply: autoSpokenText,
      speechInterrupted: canceledForNewVoice && speechStopped,
      microphoneTracksStopped: tracksReleased,
      persistedVoiceSettings: true,
      phoneCommandIntercepted: true,
      navGeometry,
      pageErrors
    }, null, 2));

    await browser.close();
  } finally {
    await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  }
}

main().catch((error) => {
  console.error(error.stack || error.message || String(error));
  process.exit(1);
});
