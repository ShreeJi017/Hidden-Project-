const screenButtons = document.querySelectorAll('[data-screen]');
const screens = [...document.querySelectorAll('.screen')];
const navItems = [...document.querySelectorAll('.nav-item')];
const canvas = document.querySelector('#particle-orb');
const context = canvas.getContext('2d');
const motionSetting = document.querySelector('#motion-setting');
const glowSetting = document.querySelector('#glow-setting');
const glowValue = document.querySelector('#glow-value');
const reducedMotionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
const requestedScreen = window.location.hash.replace(/^#screen-/, '');
let activeScreen = screens.some((screen) => screen.id === `screen-${requestedScreen}`)
  ? requestedScreen
  : document.querySelector('.screen:not([hidden])')?.id.replace(/^screen-/, '') || 'home';
window.history.replaceState({ screen: activeScreen }, '', window.location.href);

function readPreferences() {
  try {
    return JSON.parse(localStorage.getItem('zerogravity.preferences')) ?? {};
  } catch {
    return {};
  }
}

const savedPreferences = readPreferences();
let motionEnabled = !(savedPreferences.reducedMotion ?? reducedMotionQuery.matches);
let glowLevel = Number(savedPreferences.glowLevel) || 75;
let offlineMode = Object.values(window.ZeroGravityOffline.modes).includes(savedPreferences.offlineMode)
  ? savedPreferences.offlineMode
  : window.ZeroGravityOffline.modes.AUTOMATIC;
let frameRequest = 0;
let rotation = 0;
let canvasWidth = 0;
let canvasHeight = 0;
let pixelRatio = 1;
let points = [];

function savePreferences() {
  try {
    localStorage.setItem('zerogravity.preferences', JSON.stringify({
      ...readPreferences(),
      reducedMotion: !motionEnabled,
      glowLevel,
      voiceReplies: voiceRepliesEnabled,
      speechRate,
      speechVoiceURI,
      speechVoiceGender,
      previousSpeechVoiceURI,
      wakeWordEnabled,
      wakeWordPhrase,
      wakeWordSensitivity,
      offlineMode
    }));
  } catch {
    // Settings remain usable when browser storage is unavailable.
  }
}

function setScreen(name, { pushHistory = true } = {}) {
  if (pushHistory && name !== activeScreen) {
    window.history.pushState({ screen: name }, '', `#screen-${name}`);
  }
  activeScreen = name;
  document.body.classList.toggle('voice-mode-active', name === 'voice-mode');
  screens.forEach((screen) => {
    screen.hidden = screen.id !== `screen-${name}`;
  });

  const primaryDestination = ({
    chats: 'chat',
    'voice-mode': 'home',
    modules: 'discover',
    projects: 'discover',
    'file-analyzer': 'discover',
    'image-generator': 'discover',
    'image-gallery': 'discover',
    'live-search': 'discover',
    weather: 'discover',
    'api-connections': 'settings',
    models: 'settings',
    profile: 'settings',
    authentication: 'settings'
  })[name] || name;
  navItems.forEach((item) => {
    const isActive = item.dataset.screen === primaryDestination;
    item.classList.toggle('is-active', isActive);
    if (isActive) item.setAttribute('aria-current', 'page');
    else item.removeAttribute('aria-current');
  });

  if (name === 'home') renderOrb();
  window.ZeroGravityImagesUI?.onScreen(name);
  window.ZeroGravityLiveUI?.onScreen(name);
}

window.addEventListener('popstate', (event) => {
  const screen = event.state?.screen;
  if (screens.some((entry) => entry.id === `screen-${screen}`)) {
    setScreen(screen, { pushHistory: false });
  }
});

screenButtons.forEach((button) => {
  button.addEventListener('click', () => {
    setScreen(button.dataset.screen);
    const target = button.dataset.settingsTarget;
    if (target) {
      document.querySelector(target)?.scrollIntoView({
        behavior: motionEnabled ? 'smooth' : 'auto',
        block: 'start'
      });
    }
  });
});

function makePoints(count) {
  const result = [];
  const goldenAngle = Math.PI * (3 - Math.sqrt(5));

  for (let index = 0; index < count; index += 1) {
    const y = 1 - (index / (count - 1)) * 2;
    const radius = Math.sqrt(1 - y * y);
    const angle = goldenAngle * index;
    result.push({ x: Math.cos(angle) * radius, y, z: Math.sin(angle) * radius });
  }

  return result;
}

function resizeCanvas() {
  const bounds = canvas.getBoundingClientRect();
  if (!bounds.width || !bounds.height) return;

  pixelRatio = Math.min(window.devicePixelRatio || 1, 1.5);
  canvasWidth = bounds.width;
  canvasHeight = bounds.height;
  canvas.width = Math.round(canvasWidth * pixelRatio);
  canvas.height = Math.round(canvasHeight * pixelRatio);
  context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
  points = makePoints(window.innerWidth < 600 ? 1200 : 1800);
  renderOrb();
}

function drawOrb() {
  if (!canvasWidth || !canvasHeight) return;

  context.clearRect(0, 0, canvasWidth, canvasHeight);
  const centerX = canvasWidth / 2;
  const centerY = canvasHeight / 2;
  const state = document.body.dataset.voiceState || 'idle';
  const pulse = state === 'speaking' ? 1 + Math.sin(Date.now() / 190) * 0.035
    : state === 'listening' ? 1 + Math.sin(Date.now() / 320) * 0.025
      : state === 'thinking' ? 0.96 + Math.sin(Date.now() / 240) * 0.035
        : 1 + Math.sin(Date.now() / 2400) * 0.012;
  const radius = Math.min(canvasWidth, canvasHeight) * 0.34 * pulse;
  const tiltCosine = Math.cos(-0.18);
  const tiltSine = Math.sin(-0.18);
  const cosine = Math.cos(rotation);
  const sine = Math.sin(rotation);
  const glow = context.createRadialGradient(centerX, centerY, radius * 0.08, centerX, centerY, radius * 1.1);
  glow.addColorStop(0, state === 'error' ? 'rgba(240, 150, 145, 0.13)' : 'rgba(155, 140, 255, 0.17)');
  glow.addColorStop(0.48, 'rgba(98, 217, 207, 0.06)');
  glow.addColorStop(1, 'rgba(98, 217, 207, 0)');
  context.fillStyle = glow;
  context.beginPath();
  context.arc(centerX, centerY, radius * 1.1, 0, Math.PI * 2);
  context.fill();

  const projected = points.map((point) => {
    const rotatedX = point.x * cosine - point.z * sine;
    const rotatedZ = point.x * sine + point.z * cosine;
    const rotatedY = point.y * tiltCosine - rotatedZ * tiltSine;
    const depth = point.y * tiltSine + rotatedZ * tiltCosine;
    const convergence = state === 'thinking' ? 0.84 + ((point.x + 1) / 2) * 0.16 : 1;
    return { x: centerX + rotatedX * radius * convergence, y: centerY + rotatedY * radius * convergence, depth };
  }).sort((first, second) => first.depth - second.depth);

  projected.forEach((point) => {
    const depth = (point.depth + 1) / 2;
    const size = 0.65 + depth * 1.2;
    const opacity = (0.12 + depth * 0.76) * (glowLevel / 75);
    context.fillStyle = state === 'error'
      ? `rgba(240, 150, 145, ${Math.min(opacity, 1)})`
      : depth > 0.82
        ? `rgba(224, 220, 255, ${Math.min(opacity, 1)})`
        : depth > 0.48
          ? `rgba(155, 140, 255, ${Math.min(opacity, 1)})`
          : `rgba(98, 217, 207, ${Math.min(opacity, 1)})`;
    context.beginPath();
    context.arc(point.x, point.y, size, 0, Math.PI * 2);
    context.fill();
  });
}

function animateOrb() {
  if (!motionEnabled || document.querySelector('#screen-home').hidden) {
    frameRequest = 0;
    return;
  }

  rotation += document.body.dataset.voiceState === 'thinking' ? 0.009 : 0.0018;
  drawOrb();
  frameRequest = window.requestAnimationFrame(animateOrb);
}

function renderOrb() {
  if (!canvasWidth) return;
  if (frameRequest) window.cancelAnimationFrame(frameRequest);
  drawOrb();
  if (motionEnabled && !document.querySelector('#screen-home').hidden) {
    frameRequest = window.requestAnimationFrame(animateOrb);
  } else {
    frameRequest = 0;
  }
}

motionSetting.checked = !motionEnabled;
glowSetting.value = String(glowLevel);
glowValue.value = `${glowLevel}%`;
document.documentElement.style.setProperty('--glow-opacity', String(glowLevel / 100));

motionSetting.addEventListener('change', () => {
  motionEnabled = !motionSetting.checked;
  savePreferences();
  renderOrb();
});

glowSetting.addEventListener('input', () => {
  glowLevel = Number(glowSetting.value);
  glowValue.value = `${glowLevel}%`;
  document.documentElement.style.setProperty('--glow-opacity', String(glowLevel / 100));
  savePreferences();
  drawOrb();
});

reducedMotionQuery.addEventListener('change', (event) => {
  if (savedPreferences.reducedMotion === undefined) {
    motionEnabled = !event.matches;
    motionSetting.checked = !motionEnabled;
    renderOrb();
  }
});

new ResizeObserver(resizeCanvas).observe(canvas);
setScreen(activeScreen, { pushHistory: false });

const chatForm = document.querySelector('#chat-form');
const chatInput = document.querySelector('#chat-input');
const privateConversationSetting = document.querySelector('#private-conversation-mode');
const chatMessages = document.querySelector('#chat-messages');
const chatNotice = document.querySelector('#chat-notice');
const historySelect = document.querySelector('#conversation-history');
const configSelect = document.querySelector('#provider-config-select');
const activeProviderSelect = document.querySelector('#active-provider-select');
const providerFunctionSelect = document.querySelector('#provider-function-select');
const providerTypeSelect = document.querySelector('#provider-type-select');
const providerNameInput = document.querySelector('#provider-name');
const providerEndpointInput = document.querySelector('#provider-endpoint');
const providerKeyInput = document.querySelector('#provider-key');
const providerKeyStatus = document.querySelector('#provider-key-status');
const providerHeadersInput = document.querySelector('#provider-headers');
const providerRequestSettingsInput = document.querySelector('#provider-request-settings');
const providerModelInput = document.querySelector('#provider-model');
const providerEnabledInput = document.querySelector('#provider-enabled');
const providerIsDefaultInput = document.querySelector('#provider-is-default');
const providerIsBackupInput = document.querySelector('#provider-is-backup');
const providerPriorityInput = document.querySelector('#provider-priority');
const apiSettingsStatus = document.querySelector('#api-settings-status');
const sendButton = document.querySelector('#send-message');
const testProviderButton = document.querySelector('#test-provider');
const conversationStorageKey = 'zerogravity.chat.conversations';
const providerStorageKey = 'zerogravity.api.providers';
const activeProviderStorageKey = 'zerogravity.api.active-provider';
const sessionProviderCredentials = new Map();
const sessionProviderHeaders = new Map();
const sessionProviderSettings = new Map();
let providerMigrationWarning = '';
const imageGalleryStore = window.ZeroGravityImages.createGalleryStore();
let activeImageRequest = null;
let lastImageOptions = null;
let generatedImage = null;
let selectedGalleryImage = null;
let imageDetailSource = '';
const galleryObjectURLs = new Set();
const imageSaveCallbacks = new Map();
const localMemoryStore = window.ZeroGravityOffline.createLocalMemoryStore();
window.ZeroGravityMemoryUI?.setLegacyMemoryClearHandler(() => {
  localMemoryStore.clear();
  const legacyMemoryInput = document.querySelector('#local-memory-input');
  if (legacyMemoryInput) legacyMemoryInput.value = '';
  const localDataStatus = document.querySelector('#local-data-message');
  if (localDataStatus) {
    localDataStatus.textContent = 'Local memory cleared from this device.';
    localDataStatus.classList.remove('is-error');
  }
});
const localCapabilityService = window.ZeroGravityOffline.createLocalCapabilityService(localMemoryStore);
const localModelManager = window.ZeroGravityOffline.createLocalModelManager();
const requestRouter = window.ZeroGravityOffline.createRequestRouter({ modelManager: localModelManager, localCapabilities: localCapabilityService });
const offlineModeSetting = document.querySelector('#offline-mode-setting');
const localModelSelect = document.querySelector('#local-model-select');
let discoveredLocalModels = [];
const voiceRepliesSetting = document.querySelector('#voice-replies-setting');
const speechRateSetting = document.querySelector('#voice-rate-setting');
const speechRateValue = document.querySelector('#voice-rate-value');
const speechVoiceSelect = document.querySelector('#voice-selection');
const speechVoiceGenderSetting = document.querySelector('#voice-gender-setting');
const speechPreviewPhrase = document.querySelector('#voice-preview-phrase');
const voiceSettingsStatus = document.querySelector('#voice-settings-status');
const phoneCapabilityList = document.querySelector('#phone-capability-list');
const phoneBridgeState = document.querySelector('#phone-bridge-state');
const phoneCommandForm = document.querySelector('#phone-command-form');
const phoneCommandInput = document.querySelector('#phone-command-input');
const phoneCommandStatus = document.querySelector('#phone-command-status');
const phoneCommandHistoryList = document.querySelector('#phone-command-history-list');
const voiceRecognitionService = window.ZeroGravityVoice.createSpeechRecognitionService();
const speechSynthesisService = window.ZeroGravityVoice.createSpeechSynthesisService();
const voiceSettingsService = window.ZeroGravityVoiceSettings;
const wakeWordService = window.ZeroGravityVoice.createWakeWordService();
const listeningModeManager = window.ZeroGravityVoice.createListeningModeManager();
const phoneActionService = window.ZeroGravityPhoneActions;
const phoneActionBridge = phoneActionService.createBridge();
const phoneCommandHistory = [];
let voiceRepliesEnabled = savedPreferences.voiceReplies === true;
let speechRate = Number(savedPreferences.speechRate) || 1;
let speechVoiceURI = typeof savedPreferences.speechVoiceURI === 'string' ? savedPreferences.speechVoiceURI : '';
let speechVoiceGender = ['male', 'female'].includes(savedPreferences.speechVoiceGender)
  ? savedPreferences.speechVoiceGender
  : 'any';
let previousSpeechVoiceURI = typeof savedPreferences.previousSpeechVoiceURI === 'string'
  ? savedPreferences.previousSpeechVoiceURI
  : '';
let wakeWordEnabled = savedPreferences.wakeWordEnabled === true;
let wakeWordPhrase = typeof savedPreferences.wakeWordPhrase === 'string' ? savedPreferences.wakeWordPhrase : 'Hey ZeroGravity';
let wakeWordSensitivity = Number.isFinite(Number(savedPreferences.wakeWordSensitivity))
  ? Math.max(0, Math.min(100, Number(savedPreferences.wakeWordSensitivity)))
  : 50;
let voiceState = 'idle';
let activeSpeechToken = 0;
let activeSpeechMessageId = '';
let voiceInteractionToken = 0;
let voiceDraftPending = false;
let privateConversationMode = false;

function readStoredJSON(key, fallback) {
  try {
    const stored = localStorage.getItem(key);
    return stored ? JSON.parse(stored) : fallback;
  } catch {
    return fallback;
  }
}

function makeId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function createConversation() {
  return { id: makeId(), title: 'New conversation', updatedAt: Date.now(), messages: [] };
}

function loadConversations() {
  const stored = readStoredJSON(conversationStorageKey, []);
  if (!Array.isArray(stored)) return [];
  return stored.filter((conversation) => (
    conversation
    && typeof conversation.id === 'string'
    && Array.isArray(conversation.messages)
  )).map((conversation) => ({
    id: conversation.id,
    title: typeof conversation.title === 'string' ? conversation.title : 'Conversation',
    updatedAt: Number(conversation.updatedAt) || Date.now(),
    pinned: conversation.pinned === true,
    archived: conversation.archived === true,
    messages: conversation.messages.filter((message) => (
      message
      && ['user', 'assistant'].includes(message.role)
      && typeof message.content === 'string'
    )).map((message) => ({
      role: message.role,
      content: message.content,
      ...(typeof message.id === 'string' ? { id: message.id } : {}),
      ...(typeof message.source === 'string' ? { source: message.source } : {}),
      ...(typeof message.providerName === 'string' ? { providerName: message.providerName } : {}),
      ...(Array.isArray(message.citations) ? {
        citations: message.citations.filter((citation) => citation
          && typeof citation.title === 'string'
          && typeof citation.url === 'string'
          && /^https?:\/\//i.test(citation.url))
          .slice(0, 12)
          .map((citation) => ({
            title: citation.title.slice(0, 200),
            url: citation.url,
            ...(typeof citation.source === 'string' ? { source: citation.source.slice(0, 100) } : {})
          }))
      } : {}),
      ...(Array.isArray(message.citations) ? {
        citations: message.citations.filter((citation) => citation
          && typeof citation.title === 'string'
          && typeof citation.url === 'string'
          && /^https?:\/\//i.test(citation.url))
          .slice(0, 12)
          .map((citation) => ({
            title: citation.title.slice(0, 200),
            url: citation.url,
            ...(typeof citation.source === 'string' ? { source: citation.source.slice(0, 100) } : {})
          }))
      } : {})
    }))
  })).slice(0, 20);
}

function loadProviders() {
  const stored = readStoredJSON(providerStorageKey, []);
  if (!Array.isArray(stored)) return [];
  const validFunctionIds = new Set(window.ZeroGravityAI.functions.map((entry) => entry.id));
  const migrated = stored.filter((provider) => (
    provider
    && typeof provider.id === 'string'
    && typeof provider.name === 'string'
    && typeof provider.endpoint === 'string'
    && typeof provider.model === 'string'
    && typeof provider.enabled === 'boolean'
  )).map((provider) => {
    const functionId = validFunctionIds.has(provider.functionId) ? provider.functionId : 'chat-ai';
    const supportedTypes = window.ZeroGravityAI.getSupportedProviderTypes(functionId);
    return {
      id: provider.id,
      functionId,
      type: supportedTypes.includes(provider.type)
        ? provider.type
        : provider.type === 'custom-http' && supportedTypes.includes('custom-http')
          ? 'custom-http'
          : supportedTypes[0] || 'openai-compatible',
      name: provider.name,
      endpoint: provider.endpoint,
      model: provider.model,
      enabled: provider.enabled,
      isDefault: provider.isDefault === true,
      isBackup: provider.isBackup === true,
      priority: Math.max(1, Math.min(5, Number(provider.priority) || 3)),
      ...(provider.functionId === 'image-generation' && provider.imageOptions && typeof provider.imageOptions === 'object'
        ? { imageOptions: getPersistableImageOptions(provider.imageOptions) }
        : {}),
      ...(['internet-search', 'weather'].includes(functionId) && provider.liveOptions
        ? { liveOptions: getPersistableLiveOptions(provider.liveOptions, functionId) }
        : {})
    };
  });
  const hadSecrets = stored.some((provider) => (
    provider && (
      Object.hasOwn(provider, 'apiKey')
      || Object.hasOwn(provider, 'headers')
      || Object.hasOwn(provider, 'requestSettings')
    )
  ));
  if (hadSecrets) {
    try {
      localStorage.setItem(providerStorageKey, JSON.stringify(migrated));
    } catch {
      providerMigrationWarning = 'Legacy browser-stored provider secrets could not be removed. Clear this site’s browser storage before continuing.';
    }
  }
  return migrated;
}

let conversations = loadConversations();
if (!conversations.length) conversations = [createConversation()];
let activeConversationId = conversations[0].id;
let providers = loadProviders();
let activeProviderId = (() => {
  try {
    return localStorage.getItem(activeProviderStorageKey) || '';
  } catch {
    return '';
  }
})();
if (!providers.some((provider) => provider.isDefault && provider.functionId === 'chat-ai') && activeProviderId) {
  const legacyDefault = providers.find((provider) => provider.id === activeProviderId && provider.functionId === 'chat-ai');
  if (legacyDefault) legacyDefault.isDefault = true;
}
let requestInFlight = false;
let phoneActionInFlight = false;
let testingProvider = false;
let editingProviderId = '';
let selectedFunctionId = 'chat-ai';
let selectedApiAdapter = window.ZeroGravityAI.createProvider('openai-compatible', 'chat-ai');

function persistConversations() {
  try {
    const savedConversations = conversations
      .filter((conversation) => conversation.messages.some((message) => ['user', 'assistant'].includes(message.role)))
      .sort((first, second) => second.updatedAt - first.updatedAt)
      .slice(0, 20)
      .map((conversation) => ({
        ...conversation,
        messages: conversation.messages.filter((message) => ['user', 'assistant'].includes(message.role))
      }));
    localStorage.setItem(conversationStorageKey, JSON.stringify(savedConversations));
    return true;
  } catch {
    setChatNotice('This browser could not save conversation history. Your current chat is still available until you leave.', 'error');
    return false;
  }
}

function getActiveConversation() {
  return conversations.find((conversation) => conversation.id === activeConversationId);
}

function searchLocalConversations(query) {
  const needle = String(query || '').toLocaleLowerCase();
  if (!needle) return [];
  return conversations.flatMap((conversation) => conversation.messages
    .filter((message) => ['user', 'assistant'].includes(message.role)
      && message.content.toLocaleLowerCase().includes(needle))
    .map((message) => `“${conversation.title}”: ${message.content.replace(/\s+/g, ' ').slice(0, 180)}`))
    .slice(0, 3);
}

function setChatNotice(message, tone = '') {
  chatNotice.textContent = message;
  chatNotice.classList.toggle('is-error', tone === 'error');
  chatNotice.classList.toggle('is-success', tone === 'success');
}

function renderPhoneCapabilityList(nativeCapabilities = []) {
  const capabilityRows = phoneActionService.capabilities.map((capability) => {
    const nativeCapability = nativeCapabilities.find((entry) => entry.id === capability.id);
    const row = document.createElement('div');
    row.className = 'phone-capability-row';
    const title = document.createElement('strong');
    title.textContent = capability.label;
    const permission = document.createElement('span');
    permission.textContent = `Permission: ${nativeCapability?.permission || capability.permission}`;
    const availability = document.createElement('span');
    availability.className = nativeCapability?.available ? 'is-available' : '';
    availability.textContent = nativeCapability
      ? (nativeCapability.available ? 'Available in this Android app' : nativeCapability.reason || 'Unavailable')
      : 'Requires the ZeroGravity Android app';
    row.append(title, permission, availability);
    return row;
  });
  phoneCapabilityList.replaceChildren(...capabilityRows);
}

async function refreshPhoneCapabilities() {
  const result = await phoneActionBridge.getCapabilities();
  const native = result.status === 'success' && Array.isArray(result.capabilities);
  phoneBridgeState.textContent = native ? 'Android app connected' : 'Browser only';
  renderPhoneCapabilityList(native ? result.capabilities : []);
  return result;
}

function renderPhoneCommandHistory() {
  const items = phoneCommandHistory.map((entry) => {
    const item = document.createElement('li');
    item.textContent = `${entry.action}: ${entry.status}`;
    return item;
  });
  phoneCommandHistoryList.replaceChildren(...items);
}

function rememberPhoneCommand(action, result) {
  phoneCommandHistory.unshift({
    action: action.replaceAll('_', ' ').toLocaleLowerCase(),
    status: result.status
  });
  phoneCommandHistory.splice(10);
  renderPhoneCommandHistory();
}

async function executeParsedPhoneCommand(parsed) {
  if (parsed.validationError) {
    return { status: 'failure', message: parsed.validationError };
  }
  try {
    const result = await phoneActionBridge.execute(parsed.action, parsed.arguments);
    if (result.status === 'permission-required') await refreshPhoneCapabilities();
    return result;
  } catch (error) {
    return {
      status: 'failure',
      message: error instanceof Error ? `Phone action failed: ${error.message}` : 'Phone action failed unexpectedly.'
    };
  }
}

async function runPhoneCommand(text, { fromChat = false } = {}) {
  const parsed = phoneActionService.parse(text);
  if (!parsed) {
    const result = {
      status: 'unsupported',
      message: 'Command not recognized. Try “open Android settings”, “set a timer for 5 minutes”, or another listed action.'
    };
    if (!fromChat) {
      phoneCommandStatus.textContent = result.message;
      phoneCommandStatus.classList.add('is-error');
      phoneCommandStatus.classList.remove('is-success');
      rememberPhoneCommand('Unrecognized command', result);
    }
    return result;
  }
  if (!fromChat) {
    phoneCommandStatus.textContent = parsed.validationError || 'Checking command…';
    phoneCommandStatus.classList.toggle('is-error', Boolean(parsed.validationError));
    phoneCommandStatus.classList.remove('is-success');
    phoneCommandForm.querySelector('button[type="submit"]').disabled = true;
  }
  const result = await executeParsedPhoneCommand(parsed);
  if (!fromChat) {
    phoneCommandStatus.textContent = result.message;
    phoneCommandStatus.classList.toggle('is-error', !['success'].includes(result.status));
    phoneCommandStatus.classList.toggle('is-success', result.status === 'success');
    phoneCommandForm.querySelector('button[type="submit"]').disabled = false;
  }
  rememberPhoneCommand(parsed.action, result);
  return result;
}

function getActiveProvider() {
  const provider = getDefaultProvider('chat-ai');
  if (!provider) return null;
  return {
    ...provider,
    apiKey: sessionProviderCredentials.get(provider.id) || '',
    headers: sessionProviderHeaders.get(provider.id) || {},
    requestSettings: sessionProviderSettings.get(provider.id) || {}
  };
}

function getDefaultProvider(functionId) {
  const candidates = providers.filter((provider) => provider.functionId === functionId && provider.enabled);
  return candidates.find((provider) => provider.isDefault)
    || [...candidates].sort((first, second) => first.priority - second.priority)[0]
    || null;
}

function getBackupProvider(functionId, excludedId = '') {
  return providers
    .filter((provider) => provider.functionId === functionId
      && provider.enabled
      && provider.isBackup
      && provider.id !== excludedId)
    .sort((first, second) => first.priority - second.priority)[0] || null;
}

function providerStatusText() {
  const provider = getActiveProvider();
  if (!provider) return 'No provider configured for Chat AI. Add one in Settings → Own API to begin.';
  if (!provider.apiKey) return `${provider.name} is configured, but its API key must be entered again for this browser session.`;
  return `Using ${provider.name}. Direct-browser requests are development-only; provider calls go from this browser to the configured endpoint.`;
}

function renderConversationHistory() {
  const previousSelection = activeConversationId;
  const ordered = [...conversations].sort((first, second) => second.updatedAt - first.updatedAt);
  historySelect.replaceChildren();

  ordered.forEach((conversation) => {
    const option = document.createElement('option');
    option.value = conversation.id;
    option.textContent = conversation.title;
    historySelect.append(option);
  });

  historySelect.value = previousSelection;
}

function createMessageElement(message) {
  const article = document.createElement('article');
  article.className = `chat-message ${message.role}`;

  const label = document.createElement('p');
  label.className = 'chat-message-label';
  label.textContent = message.role !== 'assistant'
    ? 'You'
    : message.source === 'local-tool'
      ? 'ZeroGravity · Local tool'
      : message.source === 'memory'
        ? 'ZeroGravity · Local memory'
      : message.source === 'local-model'
        ? 'ZeroGravity AI · On-device model'
        : message.source === 'online'
          ? `ZeroGravity AI · Online${message.providerName ? ` · ${message.providerName}` : ''}`
            : message.source === 'live-search'
              ? 'ZeroGravity · Live search'
              : message.source === 'live-wikipedia'
                ? 'ZeroGravity · Wikipedia'
                : message.source === 'live-weather'
                  ? 'ZeroGravity · Live weather'
            : 'ZeroGravity AI';
  article.append(label);

  const content = document.createElement('p');
  content.className = 'chat-message-content';
  content.textContent = message.content;
  article.append(content);

  if (Array.isArray(message.citations) && message.citations.length) {
    const citations = document.createElement('div');
    citations.className = 'chat-message-citations';
    const heading = document.createElement('strong');
    heading.textContent = 'Sources';
    citations.append(heading);
    message.citations.forEach((citation, index) => {
      let url;
      try {
        url = new URL(citation.url);
      } catch {
        return;
      }
      if (!['http:', 'https:'].includes(url.protocol)) return;
      const link = document.createElement('a');
      link.href = url.href;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      link.textContent = `[${index + 1}] ${citation.title}${citation.source ? ` · ${citation.source}` : ''}`;
      citations.append(link);
    });
    if (citations.childElementCount > 1) article.append(citations);
  }

  const tools = document.createElement('div');
  tools.className = 'chat-message-tools';

  if (message.role === 'assistant') {
    if (Array.isArray(message.memoryInfluence) && message.memoryInfluence.length) {
      const influence = document.createElement('details');
      influence.className = 'memory-influence-indicator';
      const summary = document.createElement('summary');
      summary.textContent = `Personalization used ${message.memoryInfluence.length} selected saved ${message.memoryInfluence.length === 1 ? 'memory' : 'memories'}`;
      const memoryList = document.createElement('ul');
      message.memoryInfluence.forEach((memory) => {
        const item = document.createElement('li');
        item.textContent = `${memory.category.replaceAll('-', ' ')}: ${memory.content}`;
        memoryList.append(item);
      });
      influence.append(summary, memoryList);
      article.append(influence);
    }
    const copyButton = document.createElement('button');
    copyButton.type = 'button';
    copyButton.textContent = 'Copy';
    copyButton.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(message.content);
        setChatNotice('Assistant response copied.', 'success');
      } catch {
        setChatNotice('Could not copy the response. Check clipboard permissions.', 'error');
      }
    });
    tools.append(copyButton);

    const speakButton = document.createElement('button');
    speakButton.type = 'button';
    speakButton.dataset.speechMessage = message.id;
    speakButton.textContent = voiceState === 'speaking' && activeSpeechMessageId === message.id ? 'Stop speaking' : 'Speak';
    speakButton.setAttribute('aria-label', voiceState === 'speaking' && activeSpeechMessageId === message.id
      ? 'Stop speaking this response'
      : 'Speak assistant response');
    speakButton.addEventListener('click', () => {
      if (voiceState === 'speaking' && activeSpeechMessageId === message.id) stopVoiceActivities();
      else speakAssistantText(message.content, message.id);
    });
    tools.append(speakButton);
  }

  if (message.role === 'error') {
    const retryButton = document.createElement('button');
    retryButton.type = 'button';
    retryButton.textContent = 'Retry';
    retryButton.disabled = requestInFlight;
    retryButton.addEventListener('click', () => retryMessage(message.retryUserId));
    tools.append(retryButton);
  }

  if (tools.childElementCount) article.append(tools);
  return article;
}

function renderChat() {
  renderConversationHistory();
  const conversation = getActiveConversation();
  chatMessages.replaceChildren();

  if (!conversation || conversation.messages.length === 0) {
    const emptyMessage = document.createElement('p');
    emptyMessage.className = 'chat-empty';
    emptyMessage.textContent = 'Start a conversation when your provider is ready.';
    chatMessages.append(emptyMessage);
  } else {
    conversation.messages.forEach((message) => chatMessages.append(createMessageElement(message)));
  }

  if (requestInFlight) {
    const pendingMessage = createMessageElement({ role: 'pending', content: 'Thinking…' });
    pendingMessage.querySelector('.chat-message-label').textContent = 'ZeroGravity AI';
    chatMessages.append(pendingMessage);
  }

  chatMessages.scrollTop = chatMessages.scrollHeight;
  renderDestinationHistory();
  sendButton.disabled = requestInFlight;
  chatInput.disabled = requestInFlight;
  document.querySelector('#new-conversation').disabled = requestInFlight;
  historySelect.disabled = requestInFlight;
  document.querySelector('#clear-local-history').disabled = requestInFlight;
}

function refreshProviderNotice() {
  const currentNotice = chatNotice.textContent;
  if (currentNotice === providerStatusText() || currentNotice.startsWith('No provider configured') || currentNotice.endsWith('to start chatting.')) {
    setChatNotice(providerStatusText());
  }
}

function getOfflineModeLabel(mode = offlineMode) {
  return ({
    automatic: 'Automatic',
    'online-only': 'Online-only',
    'offline-only': 'Offline-only'
  })[mode] || 'Automatic';
}

function updateOfflineStatus() {
  const modeLabel = getOfflineModeLabel();
  document.querySelector('#offline-mode-state').textContent = modeLabel;
  const networkAvailable = navigator.onLine !== false;
  document.querySelector('#offline-network-status').textContent = networkAvailable
    ? 'Browser reports online · not verified'
    : 'Browser reports offline';
  const provider = getActiveProvider();
  const onlineReady = networkAvailable && Boolean(provider?.enabled && provider.apiKey);
  const modelStatus = localModelManager.getStatus();
  const hasLoadedModel = Boolean(modelStatus.loadedModelId);
  const offlineTools = 'Offline tools available';
  const localInference = hasLoadedModel ? 'Loaded local model available' : 'No local model loaded';

  if (offlineMode === window.ZeroGravityOffline.modes.OFFLINE_ONLY) {
    document.querySelector('#offline-ai-status').textContent = hasLoadedModel
      ? `${offlineTools} · ${localInference}`
      : `${offlineTools} · general AI unavailable`;
  } else if (offlineMode === window.ZeroGravityOffline.modes.ONLINE_ONLY) {
    document.querySelector('#offline-ai-status').textContent = onlineReady
      ? `Online provider ready · ${provider.name}`
      : 'Online provider unavailable · check network, configuration, and session key';
  } else {
    document.querySelector('#offline-ai-status').textContent = `${offlineTools} · ${hasLoadedModel ? localInference : 'no local model'} · ${onlineReady ? `online provider ready (${provider.name})` : 'online provider unavailable'}`;
  }

  document.querySelectorAll('.provider-card-actions .provider-test-button').forEach((button) => {
    button.disabled = button.dataset.unavailable === 'true'
      || testingProvider
      || offlineMode === window.ZeroGravityOffline.modes.OFFLINE_ONLY;
    button.title = offlineMode === window.ZeroGravityOffline.modes.OFFLINE_ONLY
      ? 'Connection testing is disabled in Offline-only mode.'
      : '';
  });
  testProviderButton.disabled = testingProvider || offlineMode === window.ZeroGravityOffline.modes.OFFLINE_ONLY;
}

async function discoverLocalModels() {
  const status = document.querySelector('#local-model-message');
  status.textContent = 'Checking for installed compatible models…';
  status.classList.remove('is-error', 'is-success');
  const result = await localModelManager.discoverModels();
  discoveredLocalModels = result.models.filter((model) => model.installed === true);
  localModelSelect.replaceChildren();
  if (!discoveredLocalModels.length) {
    localModelSelect.add(new Option('No installed models', ''));
    localModelSelect.disabled = true;
    document.querySelector('#load-local-model').disabled = true;
  } else {
    localModelSelect.add(new Option('Select a model', ''));
    discoveredLocalModels.forEach((model) => {
      localModelSelect.add(new Option(model.name, model.id));
    });
    localModelSelect.disabled = localModelSelect.options.length <= 1;
  }
  const modelStatus = localModelManager.getStatus();
  const availableModel = discoveredLocalModels.find((model) => model.id === modelStatus.loadedModelId);
  document.querySelector('#local-model-status').textContent = !result.available
    ? 'No inference engine installed'
    : modelStatus.loadedModelId
      ? `Loaded · ${availableModel?.name || modelStatus.loadedModelId}`
      : discoveredLocalModels.length
        ? `${discoveredLocalModels.length} model(s) found`
        : 'No installed models';
  document.querySelector('#local-model-detail').textContent = result.error
    || (modelStatus.loadedModelId
      ? `Loaded model: ${availableModel?.name || modelStatus.loadedModelId}. Model inference runs through the connected local engine.`
      : 'Models must be installed or imported through a compatible native engine. Models are never downloaded automatically.');
  status.textContent = result.error || `Found ${discoveredLocalModels.length} compatible installed model(s).`;
  status.classList.toggle('is-error', !result.available || Boolean(result.error));
  status.classList.toggle('is-success', result.available && !result.error);
  document.querySelector('#unload-local-model').disabled = !modelStatus.loadedModelId;
  updateOfflineStatus();
}

function showLocalModelError(error) {
  const status = document.querySelector('#local-model-message');
  status.textContent = error.message || 'The local model operation failed.';
  status.classList.add('is-error');
  status.classList.remove('is-success');
}

function initializeOfflineSettings() {
  offlineModeSetting.value = offlineMode;
  try {
    document.querySelector('#local-memory-input').value = localMemoryStore.read();
  } catch (error) {
    document.querySelector('#local-data-message').textContent = error.message;
    document.querySelector('#local-data-message').classList.add('is-error');
  }
  updateOfflineStatus();
}

function setAPIStatus(message, tone = '') {
  apiSettingsStatus.textContent = message;
  apiSettingsStatus.classList.toggle('is-error', tone === 'error');
  apiSettingsStatus.classList.toggle('is-success', tone === 'success');
}

function serializeProviderConfig(provider) {
  const imageOptions = provider.functionId === 'image-generation'
    ? getPersistableImageOptions(provider.requestSettings?.imageGeneration || provider.imageOptions)
    : null;
  const liveOptions = ['internet-search', 'weather'].includes(provider.functionId)
    ? getPersistableLiveOptions(provider.requestSettings || provider.liveOptions, provider.functionId)
    : null;
  return {
    id: provider.id,
    functionId: provider.functionId,
    type: provider.type,
    name: provider.name,
    endpoint: provider.endpoint,
    model: provider.model,
    enabled: provider.enabled,
    isDefault: provider.isDefault,
    isBackup: provider.isBackup,
    priority: provider.priority,
    ...(imageOptions ? { imageOptions } : {}),
    ...(liveOptions ? { liveOptions } : {})
  };
}

function getPersistableLiveOptions(settings, functionId) {
  if (!settings || typeof settings !== 'object' || Array.isArray(settings)) return null;
  const service = functionId === 'internet-search' ? settings.search : settings.weather;
  if (!service || typeof service !== 'object' || Array.isArray(service)) return null;
  const allowed = functionId === 'internet-search'
    ? ['method', 'queryField', 'limitField', 'limit', 'count', 'resultsPath', 'titlePath', 'summaryPath', 'urlPath', 'sourcePath', 'publishedAtPath', 'apiKeyHeader']
    : ['method', 'latitudeField', 'longitudeField', 'unitsField', 'windSpeedUnit', 'precipitationUnit'];
  const saved = Object.fromEntries(allowed.filter((key) => (
    ['string', 'number'].includes(typeof service[key]) && String(service[key]).length <= 200
  )).map((key) => [key, service[key]]));
  if (service.response && typeof service.response === 'object' && !Array.isArray(service.response)) {
    const responseFields = functionId === 'weather'
      ? ['current', 'timezone', 'updatedAt', 'daily', 'hourly', 'alerts', 'temperaturePath', 'feelsLikePath', 'humidityPath', 'windSpeedPath', 'precipitationPath', 'weatherCodePath', 'conditionPath', 'iconPath', 'hourlyTimePath', 'hourlyTemperaturePath', 'hourlyPrecipitationChancePath', 'hourlyWeatherCodePath', 'hourlyConditionPath', 'hourlyIconPath', 'dailyDatePath', 'highPath', 'lowPath', 'dailyPrecipitationChancePath', 'dailyWeatherCodePath', 'dailyIconPath', 'sunrisePath', 'sunsetPath', 'units']
      : [];
    const response = Object.fromEntries(responseFields.filter((key) => (
      typeof service.response[key] === 'string' && service.response[key].length <= 200
    )).map((key) => [key, service.response[key]]));
    if (Object.keys(response).length) saved.response = response;
  }
  if (service.authentication && typeof service.authentication === 'object'
    && ['bearer', 'header', 'none'].includes(service.authentication.mode)) {
    saved.authentication = {
      mode: service.authentication.mode,
      ...(typeof service.authentication.headerName === 'string' && service.authentication.headerName.length <= 120
        ? { headerName: service.authentication.headerName }
        : {})
    };
  }
  return Object.keys(saved).length
    ? { [functionId === 'internet-search' ? 'search' : 'weather']: saved }
    : null;
}

function getPersistableImageOptions(settings) {
  if (!settings || typeof settings !== 'object' || Array.isArray(settings)) return null;
  const saved = {};
  ['promptField', 'modelField', 'negativePromptField', 'aspectRatioField', 'qualityField', 'styleField']
    .forEach((key) => {
      if (typeof settings[key] === 'string' && settings[key].length <= 120) saved[key] = settings[key];
    });
  if (settings.aspectRatioValues && typeof settings.aspectRatioValues === 'object' && !Array.isArray(settings.aspectRatioValues)) {
    saved.aspectRatioValues = Object.fromEntries(
      Object.entries(settings.aspectRatioValues)
        .filter(([ratio, value]) => ['1:1', '9:16', '16:9', '4:3'].includes(ratio)
          && typeof value === 'string' && value.length <= 120)
    );
  }
  if (settings.authentication && typeof settings.authentication === 'object') {
    const { mode, headerName } = settings.authentication;
    if (['bearer', 'header', 'none'].includes(mode)) {
      saved.authentication = {
        mode,
        ...(typeof headerName === 'string' && headerName.length <= 120 ? { headerName } : {})
      };
    }
  }
  if (settings.response && typeof settings.response === 'object') {
    const response = {};
    ['urlPath', 'base64Path', 'mimeType'].forEach((key) => {
      if (typeof settings.response[key] === 'string' && settings.response[key].length <= 200) {
        response[key] = settings.response[key];
      }
    });
    if (Object.keys(response).length) saved.response = response;
  }
  return Object.keys(saved).length ? saved : null;
}

function persistProviders() {
  try {
    const savedProviders = providers.map((provider) => serializeProviderConfig({
      ...provider,
      requestSettings: sessionProviderSettings.get(provider.id)
        || provider.requestSettings
        || provider.liveOptions
    }));
    localStorage.setItem(providerStorageKey, JSON.stringify(savedProviders));
    activeProviderId = getDefaultProvider('chat-ai')?.id || '';
    localStorage.setItem(activeProviderStorageKey, activeProviderId);
    return true;
  } catch {
    setAPIStatus('Browser storage failed. Provider settings were not saved.', 'error');
    return false;
  }
}

function refreshProviderOptions() {
  const functionProviders = providers.filter((provider) => provider.functionId === selectedFunctionId);
  const previousConfig = editingProviderId;
  configSelect.replaceChildren(new Option('New provider', ''));
  functionProviders.forEach((provider) => {
    configSelect.add(new Option(`${provider.name}${provider.enabled ? '' : ' (disabled)'}`, provider.id));
  });
  configSelect.value = functionProviders.some((provider) => provider.id === previousConfig) ? previousConfig : '';

  const activeProviderIdForFunction = getDefaultProvider(selectedFunctionId)?.id || '';
  activeProviderSelect.replaceChildren(new Option('No default provider', ''));
  functionProviders.filter((provider) => provider.enabled).forEach((provider) => {
    activeProviderSelect.add(new Option(provider.name, provider.id));
  });
  activeProviderSelect.value = activeProviderIdForFunction;
}

function populateProviderTypes(functionId) {
  const supportedTypes = window.ZeroGravityAI.getSupportedProviderTypes(functionId);
  providerTypeSelect.replaceChildren();
  supportedTypes.forEach((type) => {
    const labels = {
      'openai-compatible': 'OpenAI-compatible Chat Completions',
      'custom-http': 'Custom HTTP (connectivity test only)',
      'openai-images': 'OpenAI Images API',
      'custom-image-json': 'Custom image JSON API',
      'brave-search': 'Brave Search API',
      'custom-search-json': 'Custom search JSON API',
      'open-meteo': 'Open-Meteo (public API)',
      'custom-weather-json': 'Custom weather JSON API'
    };
    providerTypeSelect.add(new Option(labels[type] || type, type));
  });
  providerTypeSelect.disabled = supportedTypes.length <= 1;
  if (!supportedTypes.includes(providerTypeSelect.value)) {
    providerTypeSelect.value = supportedTypes[0] || '';
  }
  updateProviderAdapterNote();
}

function updateProviderAdapterNote() {
  const selectedType = providerTypeSelect.value;
  const supported = window.ZeroGravityAI.getSupportedProviderTypes(selectedFunctionId).includes(selectedType);
  const chatAI = selectedFunctionId === 'chat-ai' && selectedType === 'openai-compatible';
  const openAIImages = selectedFunctionId === 'image-generation' && selectedType === 'openai-images';
  const customImage = selectedFunctionId === 'image-generation' && selectedType === 'custom-image-json';
  const liveSearch = selectedFunctionId === 'internet-search';
  const liveWeather = selectedFunctionId === 'weather';
  testProviderButton.textContent = openAIImages || customImage ? 'Test generation' : 'Test connection';
  document.querySelector('#provider-adapter-note').textContent = openAIImages
    ? 'Implemented adapter: OpenAI Images JSON request format. Configure imageGeneration.response paths, optional option fields, authentication mode, and aspectRatioValues for the selected endpoint/model. Provider model limits still apply.'
    : customImage
      ? 'Implemented configurable image JSON adapter. Set imageGeneration promptField/modelField, supported option fields, authentication, and response.urlPath or response.base64Path in Optional request settings. This adapter does not assume a universal API format.'
      : liveSearch && selectedType === 'brave-search'
        ? 'Live Brave Search adapter. Configure the Search API endpoint (for example https://api.search.brave.com/res/v1/web/search) and API subscription key. Model is not required. Connection test performs a real search request.'
        : liveSearch && selectedType === 'custom-search-json'
            ? 'Configurable GET/POST web search. Set search.queryField, search.resultsPath, search.titlePath, search.summaryPath, search.urlPath, and optional authentication in request settings. Non-secret field mappings are saved; keys and custom headers remain in page memory. Model is not required; connection test performs a real search.'
          : liveWeather && selectedType === 'open-meteo'
            ? 'Open-Meteo public weather adapter; no API key or model is required. Set endpoint https://api.open-meteo.com/v1/forecast. City lookup uses the Open-Meteo public geocoding API.'
            : liveWeather && selectedType === 'custom-weather-json'
              ? 'Configurable GET/POST weather JSON adapter. Map response field paths under weather.response and provide a supported city location. Non-secret field mappings are saved; keys and custom headers remain in page memory. Model is not required; connection test performs a real forecast request.'
    : !supported
    ? 'No provider adapter is available for this function.'
    : chatAI
      ? 'Implemented adapter: OpenAI-compatible Chat Completions. Requires a compatible POST endpoint, JSON response, and provider CORS access.'
      : 'Implemented adapter: generic HTTP connectivity test only. This does not implement the selected function’s request or response protocol.';
}

function renderProviderDashboard() {
  const dashboard = document.querySelector('#provider-dashboard');
  dashboard.replaceChildren();
  window.ZeroGravityAI.functions.forEach((definition) => {
    const functionProviders = providers
      .filter((provider) => provider.functionId === definition.id)
      .sort((first, second) => first.priority - second.priority);
    const defaultProvider = getDefaultProvider(definition.id);
    const backupProvider = getBackupProvider(definition.id, defaultProvider?.id);
    const card = document.createElement('article');
    card.className = 'provider-function-card';
    card.dataset.function = definition.id;

    const heading = document.createElement('div');
    heading.className = 'provider-function-heading';
    const title = document.createElement('h3');
    title.textContent = definition.name;
    const implementation = document.createElement('span');
    implementation.className = `provider-implementation${definition.implemented ? ' is-available' : ''}`;
    implementation.textContent = definition.implemented ? 'Adapter available' : 'Adapter not implemented';
    heading.append(title, implementation);
    card.append(heading);

    if (!functionProviders.length) {
      const empty = document.createElement('p');
      empty.className = 'provider-empty';
      empty.textContent = definition.implemented
        ? 'No provider configured.'
        : 'No provider configured. This function has no live adapter yet.';
      card.append(empty);
    } else {
      functionProviders.forEach((provider) => {
        const providerRow = document.createElement('div');
        providerRow.className = 'provider-card-row';
        const details = document.createElement('div');
        details.className = 'provider-card-details';
        const providerTitle = document.createElement('strong');
        providerTitle.textContent = provider.name;
        const model = document.createElement('span');
        model.textContent = provider.model || 'No model';
        const status = document.createElement('span');
        status.textContent = `${provider.enabled ? 'Enabled' : 'Disabled'}${provider.isDefault ? ' · Default' : ''}${provider.isBackup ? ' · Backup' : ''} · Priority ${provider.priority}`;
        details.append(providerTitle, model, status);
        const actions = document.createElement('div');
        actions.className = 'provider-card-actions';
        const testButton = document.createElement('button');
        testButton.type = 'button';
        testButton.className = 'secondary-button provider-test-button';
        testButton.textContent = ['openai-images', 'custom-image-json'].includes(provider.type) ? 'Test generation' : 'Test connection';
        testButton.dataset.unavailable = String(!provider.enabled || !window.ZeroGravityAI.getSupportedProviderTypes(provider.functionId).includes(provider.type));
        testButton.disabled = testButton.dataset.unavailable === 'true'
          || testingProvider
          || offlineMode === window.ZeroGravityOffline.modes.OFFLINE_ONLY;
        testButton.addEventListener('click', () => testProvider(provider.id, testButton));
        const editButton = document.createElement('button');
        editButton.type = 'button';
        editButton.className = 'secondary-button';
        editButton.textContent = 'Edit configuration';
        editButton.addEventListener('click', () => loadProviderForm(provider.id));
        actions.append(testButton, editButton);
        providerRow.append(details, actions);
        card.append(providerRow);
      });
    }

    const routing = document.createElement('p');
    routing.className = 'provider-routing-status';
    routing.textContent = `Default: ${defaultProvider?.name || 'None'} · Backup: ${backupProvider?.name || 'None'}`;
    card.append(routing);
    const addButton = document.createElement('button');
    addButton.type = 'button';
    addButton.className = 'provider-add-function secondary-button';
    addButton.textContent = 'Add configuration';
    addButton.addEventListener('click', () => clearProviderForm(definition.id));
    card.append(addButton);
    dashboard.append(card);
  });
  updateOfflineStatus();
}

function clearProviderForm(functionId = selectedFunctionId) {
  editingProviderId = '';
  selectedFunctionId = functionId;
  providerFunctionSelect.value = functionId;
  populateProviderTypes(functionId);
  providerTypeSelect.value = window.ZeroGravityAI.getSupportedProviderTypes(functionId)[0] || '';
  updateProviderAdapterNote();
  refreshProviderOptions();
  configSelect.value = '';
  providerNameInput.value = '';
  providerEndpointInput.value = '';
  providerKeyInput.value = '';
  providerKeyStatus.textContent = '';
  providerKeyInput.placeholder = 'Entered for this page session only';
  providerHeadersInput.value = '';
  providerRequestSettingsInput.value = '{"timeoutMs":30000}';
  providerModelInput.value = '';
  providerEnabledInput.checked = false;
  providerIsDefaultInput.checked = false;
  providerIsBackupInput.checked = false;
  providerPriorityInput.value = '3';
  document.querySelector('#provider-editor').hidden = false;
  document.querySelector('#delete-provider').hidden = true;
  setAPIStatus('');
  providerNameInput.focus({ preventScroll: true });
}

function loadProviderForm(providerId) {
  const provider = providers.find((entry) => entry.id === providerId);
  if (!provider) {
    clearProviderForm();
    return;
  }
  editingProviderId = providerId;
  selectedFunctionId = provider.functionId;
  providerFunctionSelect.value = selectedFunctionId;
  populateProviderTypes(selectedFunctionId);
  providerTypeSelect.value = provider.type;
  updateProviderAdapterNote();
  refreshProviderOptions();
  configSelect.value = providerId;
  providerNameInput.value = provider.name;
  providerEndpointInput.value = provider.endpoint;
  providerKeyInput.value = '';
  providerKeyInput.placeholder = sessionProviderCredentials.has(providerId)
    ? 'Key is available for this page session; blank keeps it'
    : 'Enter key for this page session';
  providerKeyStatus.textContent = sessionProviderCredentials.has(providerId) ? '(present in memory)' : '(not saved)';
  providerHeadersInput.value = JSON.stringify(sessionProviderHeaders.get(providerId) || {}, null, 2);
  providerRequestSettingsInput.value = JSON.stringify(
    sessionProviderSettings.get(providerId)
      || (provider.imageOptions ? { imageGeneration: provider.imageOptions } : provider.liveOptions || {}),
    null,
    2
  );
  providerModelInput.value = provider.model;
  providerEnabledInput.checked = provider.enabled;
  providerIsDefaultInput.checked = provider.isDefault;
  providerIsBackupInput.checked = provider.isBackup;
  providerPriorityInput.value = String(provider.priority);
  document.querySelector('#provider-editor').hidden = false;
  document.querySelector('#delete-provider').hidden = false;
  setAPIStatus('');
}

function readProviderForm() {
  let headers;
  let requestSettings;
  try {
    headers = JSON.parse(providerHeadersInput.value || '{}');
  } catch {
    throw new Error('Custom headers must be valid JSON.');
  }
  try {
    requestSettings = JSON.parse(providerRequestSettingsInput.value || '{}');
  } catch {
    throw new Error('Optional request settings must be valid JSON.');
  }
  const existing = providers.find((provider) => provider.id === editingProviderId);
  return {
    id: editingProviderId || makeId(),
    functionId: selectedFunctionId,
    type: providerTypeSelect.value,
    name: providerNameInput.value.trim(),
    endpoint: providerEndpointInput.value.trim(),
    model: providerModelInput.value.trim(),
    apiKey: providerKeyInput.value.trim() || sessionProviderCredentials.get(editingProviderId) || '',
    headers,
    requestSettings,
    enabled: providerEnabledInput.checked,
    isDefault: providerIsDefaultInput.checked || (!existing && !getDefaultProvider(selectedFunctionId)),
    isBackup: providerIsBackupInput.checked,
    priority: Number(providerPriorityInput.value)
  };
}

function setFunctionDefault(provider) {
  if (!provider.isDefault) return;
  providers.forEach((entry) => {
    if (entry.functionId === provider.functionId && entry.id !== provider.id) entry.isDefault = false;
  });
}

function setProviderBackup(provider) {
  if (!provider.isBackup) return;
  providers.forEach((entry) => {
    if (entry.functionId === provider.functionId && entry.id !== provider.id) entry.isBackup = false;
  });
}

function showProviderTestResult(result, target) {
  const text = result.ok
    ? `Connection test succeeded · HTTP ${result.status} · ${result.latencyMs} ms. ${result.message}`
    : result.message;
  if (target) {
    setAPIStatus(text, result.ok ? 'success' : 'error');
  } else {
    setAPIStatus(text, result.ok ? 'success' : 'error');
  }
}

async function testProvider(providerId = editingProviderId, target = testProviderButton) {
  if (testingProvider) return;
  if (offlineMode === window.ZeroGravityOffline.modes.OFFLINE_ONLY) {
    setAPIStatus('Connection testing is blocked in Offline-only mode. Change modes before making an online provider request.', 'error');
    return;
  }
  const saved = providers.find((provider) => provider.id === providerId);
  let provider;
  try {
    provider = saved
      ? {
          ...saved,
          apiKey: saved.id === editingProviderId
            ? providerKeyInput.value.trim() || sessionProviderCredentials.get(saved.id) || ''
            : sessionProviderCredentials.get(saved.id) || '',
          headers: saved.id === editingProviderId
            ? JSON.parse(providerHeadersInput.value || '{}')
            : sessionProviderHeaders.get(saved.id) || {},
          requestSettings: saved.id === editingProviderId
            ? JSON.parse(providerRequestSettingsInput.value || '{}')
            : sessionProviderSettings.get(saved.id)
              || (saved.imageOptions ? { imageGeneration: saved.imageOptions } : saved.liveOptions || {})
        }
      : readProviderForm();
    selectedApiAdapter = window.ZeroGravityAI.createProvider(provider.type, provider.functionId);
    window.ZeroGravityAI.validateConfig(provider, {
      requireApiKey: provider.type === 'openai-compatible' || provider.type === 'brave-search',
      requireModel: !['brave-search', 'custom-search-json', 'open-meteo', 'custom-weather-json'].includes(provider.type)
    });
  } catch (error) {
    setAPIStatus(error.message, 'error');
    return;
  }

  testingProvider = true;
  if (target) {
    target.disabled = true;
    target.dataset.previousText = target.textContent;
    target.textContent = 'Testing…';
  }
  testProviderButton.disabled = true;
  const startedAt = performance.now();
  setAPIStatus('Testing connection…');
  try {
    const result = await selectedApiAdapter.test(provider);
    showProviderTestResult({ ...result, latencyMs: result.latencyMs ?? Math.round(performance.now() - startedAt) }, target);
  } catch (error) {
    const statusMatch = error.message.match(/HTTP (\d{3})/);
    const httpStatus = statusMatch ? ` HTTP ${statusMatch[1]}.` : '';
    const safeMessage = window.ZeroGravityAI.redactError(error, [
      provider.apiKey,
      ...Object.values(provider.headers || {})
    ]);
    setAPIStatus(`${safeMessage}${httpStatus} Check the endpoint, model, credentials, CORS policy, and whether the selected adapter matches the provider protocol.`, 'error');
  } finally {
    testingProvider = false;
    if (target) {
      target.disabled = false;
      target.textContent = target.dataset.previousText || 'Test connection';
      delete target.dataset.previousText;
    }
    testProviderButton.disabled = false;
    renderProviderDashboard();
  }
}

function setVoiceSettingsStatus(message, tone = '') {
  voiceSettingsStatus.textContent = message;
  voiceSettingsStatus.classList.toggle('is-error', tone === 'error');
  voiceSettingsStatus.classList.toggle('is-success', tone === 'success');
  document.querySelector('#home-voice-status').textContent = message;
  document.querySelector('#home-voice-status').classList.toggle('is-error', tone === 'error');
}

function listeningModeLabel(mode) {
  return ({
    disabled: 'Disabled',
    'push-to-talk': 'Push-to-talk',
    'wake-word-listening': 'Wake-word listening',
    'active-conversation': 'Active conversation'
  })[mode] || 'Disabled';
}

function updateListeningMode(mode = listeningModeManager.getMode()) {
  const label = listeningModeLabel(mode);
  document.querySelector('#voice-mode-state').textContent = label;
  document.querySelector('#listening-mode-state').textContent = label;
  document.querySelector('#wake-listening-mode').textContent = label;
  document.querySelector('#orb-listening-mode').textContent = label.toUpperCase();
}

function setWakeWordStatus(message, tone = '') {
  const status = document.querySelector('#wake-word-status');
  status.textContent = message;
  status.classList.toggle('is-error', tone === 'error');
  status.classList.toggle('is-success', tone === 'success');
}

function updateWakeWordControls() {
  const capabilities = wakeWordService.getCapabilities();
  const listening = listeningModeManager.getMode() === 'wake-word-listening';
  const sensitivityInput = document.querySelector('#wake-sensitivity');
  document.querySelector('#wake-word-engine-status').textContent = capabilities.available
    ? `Available (${capabilities.source})`
    : 'Unavailable in this browser';
  sensitivityInput.disabled = !capabilities.sensitivity;
  document.querySelector('#wake-sensitivity-support').textContent = capabilities.sensitivity
    ? 'This local engine supports sensitivity adjustment.'
    : 'Sensitivity adjustment requires a local engine that exposes this setting.';
  document.querySelector('#wake-word-toggle').textContent = listening
    ? 'Stop wake-word listening'
    : 'Start wake-word listening';
  document.querySelector('#wake-word-stop').disabled = !listening;
}

async function refreshMicrophonePermission() {
  const permission = await wakeWordService.getPermissionStatus();
  const label = ({
    granted: 'Granted',
    denied: 'Denied',
    prompt: 'Not requested'
  })[permission] || 'Unknown / unavailable';
  document.querySelector('#microphone-permission-state').textContent = label;
}

function syncVoiceControls() {
  const listening = voiceState === 'listening' || voiceState === 'requesting';
  const homeButton = document.querySelector('#home-voice-input');
  const chatButton = document.querySelector('#chat-voice-input');
  const settingsButton = document.querySelector('#settings-voice-input');
  const voiceModeButton = document.querySelector('#voice-mode-listen');

  homeButton.setAttribute('aria-label', listening ? 'Stop voice input' : 'Start voice input');
  homeButton.title = listening ? 'Stop voice input' : 'Start voice input';
  chatButton.querySelector('.voice-button-label').textContent = listening ? 'Stop' : 'Voice';
  chatButton.setAttribute('aria-label', listening ? 'Stop voice input' : 'Start voice input');
  chatButton.title = listening ? 'Stop voice input' : 'Start voice input';
  settingsButton.textContent = listening ? 'Stop voice input' : 'Start voice input';
  voiceModeButton.setAttribute('aria-label', listening ? 'Stop voice input' : 'Start voice input');
  voiceModeButton.title = listening ? 'Stop voice input' : 'Start voice input';
  [homeButton, chatButton, settingsButton].forEach((button) => {
    button.classList.toggle('is-listening', listening);
  });
  document.querySelectorAll('.chat-message-tools button[data-speech-message]').forEach((button) => {
    const speakingThisMessage = voiceState === 'speaking' && button.dataset.speechMessage === activeSpeechMessageId;
    button.textContent = speakingThisMessage ? 'Stop speaking' : 'Speak';
    button.setAttribute('aria-label', speakingThisMessage ? 'Stop speaking this response' : 'Speak assistant response');
  });
}

function setVoiceState(state) {
  voiceState = state;
  const stateLabel = state === 'wake-word-detected'
    ? 'Wake word detected'
    : state === 'requesting'
      ? 'Listening…'
      : `${state[0].toUpperCase()}${state.slice(1)}`;
  const orbState = state === 'requesting' ? 'LISTENING' : state.toUpperCase().replaceAll('-', ' ');
  document.querySelector('#voice-state').textContent = stateLabel;
  document.querySelector('#voice-state').dataset.state = state === 'requesting' ? 'listening' : state;
  document.querySelector('#voice-settings-state').textContent = stateLabel;
  document.querySelector('#voice-settings-state').dataset.state = state === 'requesting' ? 'listening' : state;
  document.querySelector('#orb-voice-state').textContent = orbState;
  const voiceModeLabel = document.querySelector('#voice-mode-state-label');
  if (voiceModeLabel) {
    voiceModeLabel.textContent = ({
      idle: 'READY WHEN YOU ARE',
      requesting: 'REQUESTING MICROPHONE',
      listening: 'LISTENING',
      thinking: 'THINKING',
      speaking: 'SPEAKING',
      error: 'VOICE UNAVAILABLE',
      'wake-word-detected': 'WAKE WORD DETECTED'
    })[state] || state.toUpperCase();
  }
  document.body.dataset.voiceState = state === 'requesting' ? 'listening' : state;
  syncVoiceControls();
}

async function stopVoiceActivities() {
  voiceInteractionToken += 1;
  activeSpeechToken += 1;
  activeSpeechMessageId = '';
  voiceDraftPending = false;
  voiceRecognitionService.stop();
  speechSynthesisService.stop();
  try {
    await wakeWordService.stop();
  } catch (error) {
    setVoiceState('error');
    setWakeWordStatus(error.message || 'Wake-word service could not stop cleanly.', 'error');
    listeningModeManager.setMode(listeningModeManager.modes.DISABLED);
    return;
  }
  listeningModeManager.setMode(listeningModeManager.modes.DISABLED);
  setVoiceState('idle');
  setVoiceSettingsStatus('Voice input and speech playback stopped.');
}

async function startVoiceInput() {
  if (voiceState === 'listening' || voiceState === 'requesting') {
    voiceInteractionToken += 1;
    voiceRecognitionService.stop();
    listeningModeManager.setMode(listeningModeManager.modes.DISABLED);
    setVoiceSettingsStatus('Voice input stopped.');
    return;
  }

  if (listeningModeManager.getMode() === listeningModeManager.modes.WAKE_WORD) {
    try {
      await wakeWordService.stop();
    } catch (error) {
      setWakeWordStatus(error.message || 'Wake-word service could not stop.', 'error');
      return;
    }
  }
  listeningModeManager.setMode(listeningModeManager.modes.PUSH_TO_TALK);
  voiceInteractionToken += 1;
  activeSpeechToken += 1;
  activeSpeechMessageId = '';
  speechSynthesisService.stop();

  if (!voiceRecognitionService.isSupported()) {
    listeningModeManager.setMode(listeningModeManager.modes.DISABLED);
    setVoiceState('idle');
    const message = 'Voice input is unavailable in this browser. Try a current Chrome browser on Android or type your message.';
    setChatNotice(message, 'error');
    setVoiceSettingsStatus(message, 'error');
    return;
  }

  let finalTranscript = '';
  let recognitionError = false;
  let transcriptPrefix = chatInput.value.trim();
  setVoiceState('requesting');
  setVoiceSettingsStatus('Requesting microphone permission. Your browser will manage the recognition session.');
  setChatNotice('Listening for speech… Your recognized words will appear as editable text.');

  await voiceRecognitionService.start({
    onState(state) {
      if (state === 'listening') {
        setVoiceState('listening');
        setVoiceSettingsStatus('Listening. Tap Stop listening when you are done.');
      } else if (state === 'idle' && voiceState !== 'idle') {
        setVoiceState('idle');
      }
    },
    onTranscript(result) {
      if (result.finalTranscript) finalTranscript = `${finalTranscript} ${result.finalTranscript}`.trim();
      const recognizedText = `${finalTranscript} ${result.interimTranscript}`.trim();
      chatInput.value = [transcriptPrefix, recognizedText].filter(Boolean).join(' ');
      const voiceTranscript = document.querySelector('#voice-mode-transcript');
      if (voiceTranscript && activeScreen === 'voice-mode') {
        voiceTranscript.textContent = recognizedText || 'Listening…';
      }
      if (result.finalTranscript) {
        voiceDraftPending = true;
        setChatNotice('Speech recognized. Review or edit the text, then send it when ready.', 'success');
        if (document.querySelector('#screen-home').hidden === false || document.querySelector('#screen-settings').hidden === false) {
          setScreen('chat');
        }
      }
    },
    onError(message) {
      recognitionError = true;
      listeningModeManager.setMode(listeningModeManager.modes.DISABLED);
      setVoiceState('error');
      setVoiceSettingsStatus(message, 'error');
      setChatNotice(message, 'error');
    },
    onEnd(result = {}) {
      if (finalTranscript) {
        voiceDraftPending = true;
        chatInput.value = [transcriptPrefix, finalTranscript].filter(Boolean).join(' ');
        setChatNotice('Speech recognized. Review or edit the text, then send it when ready.', 'success');
        setVoiceSettingsStatus('Speech recognized. Review or edit the words before sending.');
        if (!document.querySelector('#screen-chat').hidden) chatInput.focus({ preventScroll: true });
      } else if (!result.cancelled && !recognitionError) {
        setChatNotice('Voice input ended without recognized words. You can type a message and send it.');
        setVoiceSettingsStatus('Voice input ended without recognized words. You can type a message instead.');
      }
      if (voiceState !== 'speaking' && voiceState !== 'thinking') {
        if (listeningModeManager.getMode() === listeningModeManager.modes.PUSH_TO_TALK) {
          listeningModeManager.setMode(listeningModeManager.modes.DISABLED);
        }
        if (voiceState !== 'error') setVoiceState('idle');
      }
    }
  });
  await refreshMicrophonePermission();
}

async function toggleWakeWordListening() {
  if (listeningModeManager.getMode() === listeningModeManager.modes.WAKE_WORD) {
    try {
      await wakeWordService.stop();
      listeningModeManager.setMode(listeningModeManager.modes.DISABLED);
      setVoiceState('idle');
      setWakeWordStatus('Wake-word listening stopped. The local engine has been asked to release microphone resources.');
      await refreshMicrophonePermission();
    } catch (error) {
      setVoiceState('error');
      setWakeWordStatus(error.message || 'Wake-word listening could not stop cleanly.', 'error');
    }
    return;
  }

  if (!wakeWordEnabled) {
    setWakeWordStatus('Enable wake word first. Wake-word listening still requires a supported local engine.', 'error');
    return;
  }
  if (!wakeWordPhrase) {
    setWakeWordStatus('Enter a wake phrase before starting the local wake-word engine.', 'error');
    return;
  }
  if (!wakeWordService.isSupported()) {
    listeningModeManager.setMode(listeningModeManager.modes.DISABLED);
    setVoiceState('error');
    setWakeWordStatus('Wake-word listening is unavailable: connect a supported local detector or native Android service. Browser speech recognition is not used as an always-listening wake-word detector. Use push-to-talk instead.', 'error');
    return;
  }

  voiceInteractionToken += 1;
  activeSpeechToken += 1;
  activeSpeechMessageId = '';
  speechSynthesisService.stop();
  voiceRecognitionService.stop();
  listeningModeManager.setMode(listeningModeManager.modes.WAKE_WORD);
  setVoiceState('listening');
  setWakeWordStatus('Starting the local wake-word engine after your request. No conversation recording starts automatically.');
  const started = await wakeWordService.start({
    phrase: wakeWordPhrase,
    sensitivity: wakeWordSensitivity / 100
  }, {
    onState(state) {
      if (state === 'listening') {
        setVoiceState('listening');
        setWakeWordStatus('Wake-word listener is active. Tap Stop listening to release its microphone resources.');
      } else if (state === 'idle') {
        listeningModeManager.setMode(listeningModeManager.modes.DISABLED);
        setVoiceState('idle');
      }
    },
    onWakeWord() {
      setVoiceState('wake-word-detected');
      setWakeWordStatus(`“${wakeWordPhrase}” detected. Tap Start voice input to speak; no conversation is recorded automatically.`, 'success');
    },
    onError(message) {
      listeningModeManager.setMode(listeningModeManager.modes.DISABLED);
      setVoiceState('error');
      setWakeWordStatus(message, 'error');
    }
  });
  await refreshMicrophonePermission();
  if (!started) {
    listeningModeManager.setMode(listeningModeManager.modes.DISABLED);
    setVoiceState('error');
  }
}

function speakAssistantText(text, messageId = '', rateOverride = null, onComplete = null) {
  activeSpeechToken += 1;
  const speechToken = activeSpeechToken;
  let completionCalled = false;
  const complete = () => {
    if (completionCalled) return;
    completionCalled = true;
    onComplete?.();
  };
  listeningModeManager.setMode(listeningModeManager.modes.ACTIVE_CONVERSATION);
  voiceRecognitionService.stop();
  activeSpeechMessageId = messageId;
  try {
    const started = speechSynthesisService.speak(text, {
      rate: rateOverride ?? window.ZeroGravityMemoryUI?.getVoiceRate(speechRate) ?? speechRate,
      voiceURI: speechVoiceURI
    }, {
      onStart() {
        if (speechToken !== activeSpeechToken) return;
        setVoiceState('speaking');
        setVoiceSettingsStatus('Speaking assistant response. Use Stop speech to interrupt.');
      },
      onEnd() {
        if (speechToken !== activeSpeechToken) return;
        activeSpeechMessageId = '';
        setVoiceState('idle');
        if (listeningModeManager.getMode() === listeningModeManager.modes.ACTIVE_CONVERSATION) {
          listeningModeManager.setMode(listeningModeManager.modes.DISABLED);
        }
        setVoiceSettingsStatus('Speech playback complete.');
        complete();
      },
      onError(message) {
        if (speechToken !== activeSpeechToken) return;
        activeSpeechMessageId = '';
        setVoiceState('error');
        if (listeningModeManager.getMode() === listeningModeManager.modes.ACTIVE_CONVERSATION) {
          listeningModeManager.setMode(listeningModeManager.modes.DISABLED);
        }
        setVoiceSettingsStatus(message, 'error');
        complete();
      }
    });
    if (!started) {
      activeSpeechMessageId = '';
      setVoiceState('idle');
      complete();
    }
  } catch (error) {
    activeSpeechMessageId = '';
    setVoiceState('idle');
    setVoiceSettingsStatus(error.message, 'error');
    complete();
  }
}

function populateSpeechVoices() {
  const selectedVoice = speechVoiceURI;
  speechVoiceSelect.replaceChildren(new Option('System default', ''));
  const voices = speechSynthesisService.getVoices();
  voices.forEach((voice) => {
    speechVoiceSelect.add(new Option(`${voice.name}${voice.lang ? ` (${voice.lang})` : ''}`, voice.voiceURI));
  });
  speechVoiceSelect.value = voices.some((voice) => voice.voiceURI === selectedVoice) ? selectedVoice : '';
  speechVoiceSelect.disabled = !speechSynthesisService.isSupported() || voices.length === 0;
}

function applyVoiceSettingsIntent(intent) {
  const voices = speechSynthesisService.getVoices();
  let confirmation;
  let shouldSpeak = true;
  if (intent.type === 'stop') {
    activeSpeechToken += 1;
    activeSpeechMessageId = '';
    speechSynthesisService.stop();
    setVoiceState('idle');
    confirmation = 'Speech stopped.';
    shouldSpeak = false;
  } else if (intent.type === 'speed-set') {
    speechRate = Math.max(voiceSettingsService.MIN_RATE, Math.min(voiceSettingsService.MAX_RATE, intent.rate));
    speechRateSetting.value = String(speechRate);
    speechRateValue.value = `${speechRate.toFixed(1)}×`;
    confirmation = `I’ll speak at ${speechRate.toFixed(1)} times normal speed.`;
  } else if (intent.type === 'voice-gender') {
    speechVoiceGender = intent.gender;
    speechVoiceGenderSetting.value = speechVoiceGender;
    const match = voiceSettingsService.findGenderVoice(voices, intent.gender);
    if (!match) {
      const available = voices.map(voiceSettingsService.getVoiceLabel);
      confirmation = available.length
        ? `No available device voice identifies itself as ${intent.gender}. Available voices: ${available.join(', ')}.`
        : 'No device speech voices are currently available. You can review device voice settings or choose another voice later.';
    } else {
      previousSpeechVoiceURI = speechVoiceURI;
      speechVoiceURI = match.voiceURI;
      speechVoiceSelect.value = speechVoiceURI;
      confirmation = `I’ll use ${voiceSettingsService.getVoiceLabel(match)}.`;
    }
  } else {
    const match = intent.type === 'voice-previous'
      ? voiceSettingsService.findPreviousVoice(voices, previousSpeechVoiceURI)
      : voiceSettingsService.findNextVoice(voices, speechVoiceURI);
    if (!match) {
      confirmation = intent.type === 'voice-previous'
        ? 'There is no previous available voice to return to.'
        : 'No device speech voices are currently available.';
    } else {
      previousSpeechVoiceURI = speechVoiceURI;
      speechVoiceURI = match.voiceURI;
      speechVoiceGender = voiceSettingsService.voiceGender(match) || 'any';
      speechVoiceSelect.value = speechVoiceURI;
      speechVoiceGenderSetting.value = speechVoiceGender;
      confirmation = `I’ll use ${voiceSettingsService.getVoiceLabel(match)}.`;
    }
  }
  savePreferences();
  return { confirmation, shouldSpeak };
}

async function requestAssistantReply(conversation, userMessageId, questionOverride = '') {
  if (requestInFlight) return;

  const responseVoiceInteractionToken = voiceInteractionToken;
  const requestMode = offlineMode;
  const provider = getActiveProvider();
  const providerCandidates = (provider ? [
    provider,
    getBackupProvider('chat-ai', provider.id)
  ] : []).filter(Boolean).map((candidate) => ({
    ...candidate,
    apiKey: candidate.apiKey || sessionProviderCredentials.get(candidate.id) || '',
    headers: candidate.headers || sessionProviderHeaders.get(candidate.id) || {},
    requestSettings: sessionProviderSettings.get(candidate.id) || {}
  }));

  const userIndex = conversation.messages.findIndex((message) => message.id === userMessageId);
  if (userIndex < 0) return;
  const requestMessages = conversation.messages
    .slice(0, userIndex + 1)
    .filter((message) => !['local-tool', 'local-model', 'offline-only', 'memory'].includes(message.source))
    .filter((message) => ['user', 'assistant'].includes(message.role))
    .map(({ id, role, content }) => ({
      role,
      content: id === userMessageId && questionOverride ? questionOverride : content
    }));

  requestInFlight = true;
  setVoiceState('thinking');
  setChatNotice(requestMode === window.ZeroGravityOffline.modes.OFFLINE_ONLY
    ? 'Checking offline tools and loaded local models…'
    : `Routing in ${getOfflineModeLabel(requestMode)} mode…`);
  renderChat();

  let replyToSpeak = '';
  let replyMessageId = '';
  let responseMemoryInfluence = [];
  try {
    const currentUserText = questionOverride
      || conversation.messages.find((message) => message.id === userMessageId)?.content
      || '';
    const memoryIsEnabled = window.ZeroGravityMemoryUI?.getPreferences().memoryEnabled !== false;
    const legacyMemoryCommand = !privateConversationMode && memoryIsEnabled && /^(?:remember that\s+.+|save to local memory\s+.+|read local memory|show local memory|what is in local memory|forget local memory|clear local memory|delete local memory)$/i
      .test(currentUserText.trim());
    const memoryResult = legacyMemoryCommand ? null : await window.ZeroGravityMemoryUI?.handleChatQuery(currentUserText, {
      privateConversation: privateConversationMode
    });
    const liveResult = memoryResult || await window.ZeroGravityLiveUI?.handleChatQuery(currentUserText, requestMode);
    const savedMemoryContext = !privateConversationMode
      && window.ZeroGravityMemoryUI?.getPreferences().memoryEnabled
      && window.ZeroGravityMemoryUI?.getPreferences().personalizationEnabled
      ? await window.ZeroGravityMemoryUI.list()
      : [];
    const memoryPreferences = window.ZeroGravityMemoryUI?.getPreferences();
    const localPersonalization = !privateConversationMode
      && memoryPreferences?.memoryEnabled
      && memoryPreferences?.personalizationEnabled;
    const localPreferenceGuidance = localPersonalization ? [
      memoryPreferences.language ? `Preferred response language: ${memoryPreferences.language}.` : '',
      memoryPreferences.responseLength !== 'balanced' ? `Preferred response length: ${memoryPreferences.responseLength}.` : '',
      memoryPreferences.calmMode ? 'Use Calm Mode: gentle, clear, non-judgmental language, short sentences, and one manageable step at a time. Do not diagnose.' : ''
    ].filter(Boolean) : [];
    const localMemoryContext = [
      localPersonalization ? localMemoryStore.read() : '',
      ...(localPreferenceGuidance.length ? [`User-selected communication preferences (never override the current request or safety requirements):\n${localPreferenceGuidance.join('\n')}`] : []),
      ...(localPersonalization ? savedMemoryContext.map((memory) => memory.content) : [])
    ].filter(Boolean).join('\n');
    const localMemoryInfluence = localPersonalization
      ? savedMemoryContext.map((memory) => ({ id: memory.id, category: memory.category, content: memory.content }))
      : [];
    const routed = liveResult || await requestRouter.route({
      text: currentUserText,
      mode: requestMode,
      onlineAvailable: navigator.onLine !== false,
      localContext: {
        memory: localMemoryContext,
        searchLocalContent: searchLocalConversations
      },
      async completeOnline() {
        if (!provider || !provider.enabled) throw new Error(providerStatusText());
        const personalization = requestMode === window.ZeroGravityOffline.modes.OFFLINE_ONLY
          ? null
          : await window.ZeroGravityMemoryUI?.prepareOnlineContext(privateConversationMode);
        const messages = personalization?.instruction
          ? [{ role: 'system', content: personalization.instruction }, ...requestMessages]
          : requestMessages;
        responseMemoryInfluence = personalization?.influence || [];
        const providerErrors = [];
        for (const candidate of providerCandidates) {
          try {
            const adapter = window.ZeroGravityAI.createProvider(candidate.type, candidate.functionId);
            const content = await adapter.complete(candidate, messages);
            return { content, providerName: candidate.name };
          } catch (error) {
            providerErrors.push(`${candidate.name}: ${window.ZeroGravityAI.redactError(error, [
              candidate.apiKey,
              ...Object.values(candidate.headers || {})
            ])}`);
          }
        }
        throw new Error(providerErrors.length
          ? `Chat provider request failed. ${providerErrors.join(' Backup provider was also attempted when configured.')}`
          : 'No compatible Chat AI provider is configured.');
      }
    });
    if (routed.source === 'local-model') responseMemoryInfluence = localMemoryInfluence;
    const content = routed.content;
    const currentIndex = conversation.messages.findIndex((message) => message.id === userMessageId);
    if (currentIndex < 0) return;
    replyToSpeak = content;
    conversation.messages = conversation.messages.filter((message) => message.retryUserId !== userMessageId);
    const insertIndex = conversation.messages.findIndex((message) => message.id === userMessageId) + 1;
    const assistantMessage = {
      id: makeId(),
      role: 'assistant',
      content,
      source: routed.source,
      ...(routed.providerName ? { providerName: routed.providerName } : {}),
      ...(Array.isArray(routed.citations) ? { citations: routed.citations } : {}),
      ...(responseMemoryInfluence.length ? { memoryInfluence: responseMemoryInfluence } : {})
    };
    const routedUserMessage = conversation.messages.find((message) => message.id === userMessageId);
    if (routedUserMessage && routed.source !== 'online') routedUserMessage.source = routed.source;
    if (routed.source === 'local-tool') {
      document.querySelector('#local-memory-input').value = localMemoryStore.read();
    }
    conversation.messages.splice(insertIndex, 0, assistantMessage);
    replyToSpeak = assistantMessage.content;
    replyMessageId = assistantMessage.id;
    conversation.updatedAt = Date.now();
    const firstUserMessage = conversation.messages.find((message) => message.role === 'user');
    if (firstUserMessage && conversation.title === 'New conversation') {
      conversation.title = firstUserMessage.content.trim().replace(/\s+/g, ' ').slice(0, 42) || 'Conversation';
    }
    persistConversations();
    setChatNotice(routed.source === 'memory'
      ? (routed.content.startsWith('Saved to local memory') ? 'Memory saved on this device.' : 'Memory command handled locally. No online AI request was made.')
      : routed.source === 'online'
      ? `Response received online from ${routed.providerName}.`
      : ['live-search', 'live-weather', 'live-wikipedia'].includes(routed.source)
        ? routed.providerName?.includes('Cached')
          ? `${routed.providerName} shown with its original retrieval time; it is not current live data.`
          : `${routed.providerName} returned information from live provider data.`
      : 'Processed locally on this device. No online AI request was made.', 'success');
  } catch (error) {
    const failedUserMessage = conversation.messages.find((message) => message.id === userMessageId);
    if (failedUserMessage && requestMode === window.ZeroGravityOffline.modes.OFFLINE_ONLY) {
      failedUserMessage.source = 'offline-only';
    }
    if (voiceState === 'thinking' && responseVoiceInteractionToken === voiceInteractionToken) {
      setVoiceState('error');
      if (listeningModeManager.getMode() === listeningModeManager.modes.ACTIVE_CONVERSATION) {
        listeningModeManager.setMode(listeningModeManager.modes.DISABLED);
      }
    }
    conversation.messages.push({
      id: makeId(),
      role: 'error',
      content: window.ZeroGravityAI.redactError(error, providerCandidates.flatMap((candidate) => [
        candidate.apiKey,
        ...Object.values(candidate.headers || {})
      ]))
        || 'The request could not be completed.',
      retryUserId: userMessageId
    });
    conversation.updatedAt = Date.now();
    persistConversations();
    setChatNotice(window.ZeroGravityAI.redactError(error, providerCandidates.flatMap((candidate) => [
      candidate.apiKey,
      ...Object.values(candidate.headers || {})
    ]))
      || 'The request failed. Review the message and retry when ready.', 'error');
  } finally {
    requestInFlight = false;
    renderChat();
    if (replyToSpeak && voiceRepliesEnabled && responseVoiceInteractionToken === voiceInteractionToken) {
      listeningModeManager.setMode(listeningModeManager.modes.ACTIVE_CONVERSATION);
      speakAssistantText(replyToSpeak, replyMessageId);
    } else if (voiceState === 'thinking') {
      setVoiceState('idle');
      if (listeningModeManager.getMode() === listeningModeManager.modes.ACTIVE_CONVERSATION) {
        listeningModeManager.setMode(listeningModeManager.modes.DISABLED);
      }
    }
  }
}

function retryMessage(userMessageId) {
  if (requestInFlight) return;
  const conversation = getActiveConversation();
  if (!conversation) return;
  const retryMessage = conversation.messages.find((message) => message.id === userMessageId);
  if (retryMessage) delete retryMessage.source;
  conversation.messages = conversation.messages.filter((message) => message.retryUserId !== userMessageId);
  requestAssistantReply(conversation, userMessageId);
}

chatForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const content = chatInput.value.trim();
  if (!content || requestInFlight || phoneActionInFlight) return;
  if (voiceState === 'listening' || voiceState === 'requesting') voiceRecognitionService.stop();
  const conversation = getActiveConversation();
  if (!conversation) return;
  const isVoiceMessage = voiceDraftPending;
  voiceDraftPending = false;
  if (isVoiceMessage) {
    voiceInteractionToken += 1;
    listeningModeManager.setMode(listeningModeManager.modes.ACTIVE_CONVERSATION);
  } else if (voiceState === 'speaking') {
    activeSpeechToken += 1;
    activeSpeechMessageId = '';
    speechSynthesisService.stop();
    setVoiceState('idle');
  }
  const message = { id: makeId(), role: 'user', content };
  conversation.messages.push(message);
  conversation.updatedAt = Date.now();
  if (conversation.title === 'New conversation') {
    conversation.title = content.replace(/\s+/g, ' ').slice(0, 42) || 'Conversation';
  }
  chatInput.value = '';
  persistConversations();
  const phoneCommand = phoneActionService.parse(content);
  if (phoneCommand) {
    phoneActionInFlight = true;
    renderChat();
    const result = await executeParsedPhoneCommand(phoneCommand);
    rememberPhoneCommand(phoneCommand.action, result);
    conversation.messages.push({
      id: makeId(),
      role: 'assistant',
      source: 'phone-action',
      content: result.message
    });
    conversation.updatedAt = Date.now();
    persistConversations();
    phoneActionInFlight = false;
    renderChat();
    setChatNotice(result.message, result.status === 'success' ? 'success' : 'error');
    return;
  }
  const voiceIntent = voiceSettingsService.parseIntent(content, speechRate);
  if (voiceIntent) {
    const result = applyVoiceSettingsIntent(voiceIntent);
    conversation.messages.push({
      id: makeId(),
      role: 'assistant',
      source: 'voice-control',
      content: result.confirmation
    });
    conversation.updatedAt = Date.now();
    persistConversations();
    renderChat();
    setChatNotice(result.confirmation, result.shouldSpeak ? 'success' : '');
    if (result.shouldSpeak) {
      const rateOverride = voiceIntent.type === 'speed-set' ? speechRate : null;
      const requestFollowUp = voiceIntent.followUp
        ? () => requestAssistantReply(conversation, message.id, voiceIntent.followUp)
        : null;
      speakAssistantText(result.confirmation, '', rateOverride, requestFollowUp);
    } else if (voiceIntent.followUp) {
      requestAssistantReply(conversation, message.id, voiceIntent.followUp);
    }
    return;
  }
  requestAssistantReply(conversation, message.id);
});

privateConversationSetting.addEventListener('change', () => {
  privateConversationMode = privateConversationSetting.checked;
  setChatNotice(privateConversationMode
    ? 'Private mode is on: saved memories and personalization are not used or added. Chat history is still saved in this browser.'
    : 'Private mode is off. Memory and online-sharing settings apply as configured.');
});

function requestAnswerAdjustment(instruction) {
  const conversation = getActiveConversation();
  const previousAnswer = conversation?.messages.findLast?.((message) => message.role === 'assistant')
    || [...(conversation?.messages || [])].reverse().find((message) => message.role === 'assistant');
  if (!previousAnswer) {
    setChatNotice('There is no earlier answer to adjust yet.', 'error');
    return;
  }
  chatInput.value = instruction;
  chatForm.requestSubmit();
}

document.querySelector('#make-simpler').addEventListener('click', () => {
  requestAnswerAdjustment('Please explain your previous answer in simpler language, using short sentences.');
});
document.querySelector('#one-step-at-a-time').addEventListener('click', () => {
  requestAnswerAdjustment('Please give me only the next manageable step from your previous answer.');
});

chatInput.addEventListener('keydown', (event) => {
  if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
    event.preventDefault();
    chatForm.requestSubmit();
  }
});

document.querySelector('#new-conversation').addEventListener('click', () => {
  if (requestInFlight) return;
  const conversation = createConversation();
  conversations.unshift(conversation);
  activeConversationId = conversation.id;
  setChatNotice(providerStatusText());
  renderChat();
});

historySelect.addEventListener('change', () => {
  activeConversationId = historySelect.value;
  setChatNotice(providerStatusText());
  renderChat();
});

offlineModeSetting.addEventListener('change', () => {
  if (!Object.values(window.ZeroGravityOffline.modes).includes(offlineModeSetting.value)) {
    offlineModeSetting.value = offlineMode;
    return;
  }
  offlineMode = offlineModeSetting.value;
  savePreferences();
  updateOfflineStatus();
  renderProviderDashboard();
  setChatNotice(offlineMode === window.ZeroGravityOffline.modes.OFFLINE_ONLY
    ? 'Offline-only mode is active. Online chat and provider connection tests are blocked.'
    : `${getOfflineModeLabel()} mode is active for new requests.`);
});

window.addEventListener('online', updateOfflineStatus);
window.addEventListener('offline', updateOfflineStatus);

document.querySelector('#discover-local-models').addEventListener('click', discoverLocalModels);
localModelSelect.addEventListener('change', async () => {
  if (!localModelSelect.value) {
    document.querySelector('#load-local-model').disabled = true;
    return;
  }
  try {
    await localModelManager.selectModel(localModelSelect.value);
    document.querySelector('#load-local-model').disabled = false;
    document.querySelector('#local-model-message').textContent = 'Model selected. Loading is a separate user action and checks device resources first.';
    document.querySelector('#local-model-message').classList.remove('is-error');
  } catch (error) {
    showLocalModelError(error);
  }
});
document.querySelector('#load-local-model').addEventListener('click', async () => {
  const status = document.querySelector('#local-model-message');
  status.textContent = 'Checking available device resources before model load…';
  status.classList.remove('is-error', 'is-success');
  try {
    await localModelManager.loadSelectedModel();
    status.textContent = 'Local model loaded and ready for on-device inference.';
    status.classList.add('is-success');
    document.querySelector('#local-model-status').textContent = 'Loaded';
    document.querySelector('#local-model-detail').textContent = `Loaded model: ${localModelSelect.selectedOptions[0]?.textContent || 'selected model'}.`;
    document.querySelector('#unload-local-model').disabled = false;
    updateOfflineStatus();
  } catch (error) {
    showLocalModelError(error);
  }
});
document.querySelector('#unload-local-model').addEventListener('click', async () => {
  try {
    await localModelManager.unloadModel();
    document.querySelector('#local-model-status').textContent = discoveredLocalModels.length ? 'Model unloaded' : 'No installed models';
    document.querySelector('#local-model-detail').textContent = 'The local model is unloaded to release memory and reduce battery use.';
    document.querySelector('#unload-local-model').disabled = true;
    document.querySelector('#load-local-model').disabled = !localModelSelect.value;
    document.querySelector('#local-model-message').textContent = 'Model unloaded.';
    updateOfflineStatus();
  } catch (error) {
    showLocalModelError(error);
  }
});
document.querySelector('#save-local-memory').addEventListener('click', () => {
  if (window.ZeroGravityMemoryUI?.getPreferences().memoryEnabled === false) {
    document.querySelector('#local-data-message').textContent = 'Memory is turned off. Enable it in Modules → Memory & Personalization before saving a note.';
    document.querySelector('#local-data-message').classList.add('is-error');
    return;
  }
  try {
    localMemoryStore.write(document.querySelector('#local-memory-input').value);
    document.querySelector('#local-data-message').textContent = 'Local memory saved on this device only.';
    document.querySelector('#local-data-message').classList.remove('is-error');
  } catch (error) {
    document.querySelector('#local-data-message').textContent = error.message;
    document.querySelector('#local-data-message').classList.add('is-error');
  }
});
document.querySelector('#clear-local-memory').addEventListener('click', () => {
  if (!window.confirm('Clear the local memory note from this device?')) return;
  try {
    localMemoryStore.clear();
    document.querySelector('#local-memory-input').value = '';
    document.querySelector('#local-data-message').textContent = 'Local memory cleared from this device.';
    document.querySelector('#local-data-message').classList.remove('is-error');
  } catch (error) {
    document.querySelector('#local-data-message').textContent = error.message;
    document.querySelector('#local-data-message').classList.add('is-error');
  }
});
document.querySelector('#clear-local-history').addEventListener('click', () => {
  if (!window.confirm('Permanently clear all conversation history saved in this browser?')) return;
  conversations = [createConversation()];
  activeConversationId = conversations[0].id;
  if (!persistConversations()) return;
  setChatNotice('Local conversation history cleared from this device.', 'success');
  renderChat();
  document.querySelector('#local-data-message').textContent = 'Conversation history cleared from this device.';
  document.querySelector('#local-data-message').classList.remove('is-error');
});

document.querySelector('#new-provider').addEventListener('click', () => clearProviderForm('chat-ai'));
document.querySelector('#cancel-provider-edit').addEventListener('click', () => {
  document.querySelector('#provider-editor').hidden = true;
  setAPIStatus('');
});
configSelect.addEventListener('change', () => {
  if (configSelect.value) loadProviderForm(configSelect.value);
  else clearProviderForm(selectedFunctionId);
});
providerFunctionSelect.addEventListener('change', () => {
  selectedFunctionId = providerFunctionSelect.value;
  editingProviderId = '';
  populateProviderTypes(selectedFunctionId);
  refreshProviderOptions();
  providerTypeSelect.value = window.ZeroGravityAI.getSupportedProviderTypes(selectedFunctionId)[0] || '';
  updateProviderAdapterNote();
  providerNameInput.value = '';
  providerEndpointInput.value = '';
  providerKeyInput.value = '';
  providerHeadersInput.value = '';
  providerRequestSettingsInput.value = '{"timeoutMs":30000}';
  providerModelInput.value = '';
  providerEnabledInput.checked = false;
  providerIsDefaultInput.checked = false;
  providerIsBackupInput.checked = false;
  providerPriorityInput.value = '3';
  testProviderButton.textContent = selectedFunctionId === 'image-generation'
    && ['openai-images', 'custom-image-json'].includes(providerTypeSelect.value)
    ? 'Test generation'
    : 'Test connection';
});
providerTypeSelect.addEventListener('change', updateProviderAdapterNote);
activeProviderSelect.addEventListener('change', () => {
  providers.forEach((provider) => {
    if (provider.functionId === selectedFunctionId) {
      provider.isDefault = provider.id === activeProviderSelect.value;
    }
  });
  persistProviders();
  renderProviderDashboard();
  refreshProviderOptions();
  setAPIStatus(activeProviderSelect.value ? 'Default provider updated.' : 'No default provider selected.', 'success');
  if (selectedFunctionId === 'chat-ai') setChatNotice(providerStatusText());
});

document.querySelector('#save-provider').addEventListener('click', () => {
  let provider;
  try {
    provider = readProviderForm();
    window.ZeroGravityAI.createProvider(provider.type, provider.functionId);
    window.ZeroGravityAI.validateConfig(provider, {
      requireApiKey: false,
      requireModel: !['brave-search', 'custom-search-json', 'open-meteo', 'custom-weather-json'].includes(provider.type)
    });
  } catch (error) {
    setAPIStatus(error.message, 'error');
    return;
  }

  const existingIndex = providers.findIndex((entry) => entry.id === provider.id);
  const storedProvider = serializeProviderConfig(provider);
  if (storedProvider.isDefault) storedProvider.isBackup = false;
  if (existingIndex >= 0) providers.splice(existingIndex, 1, storedProvider);
  else providers.unshift(storedProvider);
  if (provider.apiKey) sessionProviderCredentials.set(provider.id, provider.apiKey);
  if (providerHeadersInput.value.trim()) sessionProviderHeaders.set(provider.id, provider.headers);
  else sessionProviderHeaders.delete(provider.id);
  sessionProviderSettings.set(provider.id, provider.requestSettings);
  setFunctionDefault(storedProvider);
  setProviderBackup(storedProvider);
  editingProviderId = provider.id;

  if (!persistProviders()) return;
  renderProviderDashboard();
  refreshProviderOptions();
  loadProviderForm(provider.id);
  setAPIStatus('Provider configuration saved. API keys and custom headers remain in page memory only.', 'success');
  if (provider.functionId === 'chat-ai') setChatNotice(providerStatusText());
});

testProviderButton.addEventListener('click', () => testProvider());

document.querySelector('#delete-provider').addEventListener('click', () => {
  const provider = providers.find((entry) => entry.id === editingProviderId);
  if (!provider || !window.confirm(`Delete the ${provider.name} provider configuration?`)) return;
  providers = providers.filter((entry) => entry.id !== provider.id);
  sessionProviderCredentials.delete(provider.id);
  sessionProviderHeaders.delete(provider.id);
  sessionProviderSettings.delete(provider.id);
  if (!persistProviders()) return;
  editingProviderId = '';
  renderProviderDashboard();
  refreshProviderOptions();
  clearProviderForm(provider.functionId);
  if (provider.functionId === 'chat-ai') setChatNotice(providerStatusText());
  setAPIStatus('Provider configuration and its in-memory credentials were deleted.', 'success');
});

document.querySelector('#toggle-provider-key').addEventListener('click', (event) => {
  const reveal = providerKeyInput.type === 'password';
  providerKeyInput.type = reveal ? 'text' : 'password';
  event.currentTarget.textContent = reveal ? 'Hide' : 'Show';
  event.currentTarget.setAttribute('aria-label', reveal ? 'Hide API key' : 'Show API key');
});

document.querySelector('#home-voice-input').addEventListener('click', () => {
  chatInput.value = document.querySelector('#home-prompt').value;
  startVoiceInput();
});
document.querySelector('#chat-voice-input').addEventListener('click', startVoiceInput);
document.querySelector('#settings-voice-input').addEventListener('click', startVoiceInput);
document.querySelector('#stop-voice').addEventListener('click', stopVoiceActivities);
document.querySelector('#settings-stop-voice').addEventListener('click', stopVoiceActivities);
document.querySelector('#wake-word-toggle').addEventListener('click', toggleWakeWordListening);
document.querySelector('#wake-word-stop').addEventListener('click', async () => {
  try {
    await wakeWordService.stop();
    listeningModeManager.setMode(listeningModeManager.modes.DISABLED);
    setVoiceState('idle');
    setWakeWordStatus('Wake-word listening stopped. The local engine has been asked to release microphone resources.');
    await refreshMicrophonePermission();
  } catch (error) {
    setVoiceState('error');
    setWakeWordStatus(error.message || 'Wake-word service could not stop cleanly.', 'error');
  }
});

voiceRepliesSetting.checked = voiceRepliesEnabled;
speechRate = Math.max(voiceSettingsService.MIN_RATE, Math.min(voiceSettingsService.MAX_RATE, speechRate));
speechRateSetting.value = String(speechRate);
speechRateValue.value = `${speechRate.toFixed(1)}×`;
speechVoiceGenderSetting.value = speechVoiceGender;
populateSpeechVoices();
speechVoiceSelect.value = speechVoiceURI;
const wakeWordEnabledSetting = document.querySelector('#wake-word-enabled');
const wakeWordPhraseSetting = document.querySelector('#wake-word-phrase');
const wakeSensitivitySetting = document.querySelector('#wake-sensitivity');
const wakeSensitivityValue = document.querySelector('#wake-sensitivity-value');
wakeWordEnabledSetting.checked = wakeWordEnabled;
wakeWordPhraseSetting.value = wakeWordPhrase;
wakeSensitivitySetting.value = String(wakeWordSensitivity);
wakeSensitivityValue.value = `${wakeWordSensitivity}%`;
listeningModeManager.subscribe((mode) => {
  updateListeningMode(mode);
  updateWakeWordControls();
});
updateListeningMode();
updateWakeWordControls();
refreshMicrophonePermission();
setVoiceState('idle');

voiceRepliesSetting.addEventListener('change', () => {
  voiceRepliesEnabled = voiceRepliesSetting.checked;
  savePreferences();
  setVoiceSettingsStatus(voiceRepliesEnabled ? 'Spoken replies enabled.' : 'Spoken replies disabled.');
  if (voiceRepliesEnabled && !speechSynthesisService.isSupported()) {
    setVoiceSettingsStatus('Spoken replies are unavailable in this browser. Assistant responses will remain visible as text.', 'error');
  }
});

speechRateSetting.addEventListener('input', () => {
  speechRate = Number(speechRateSetting.value);
  speechRateValue.value = `${speechRate.toFixed(1)}×`;
  savePreferences();
});

speechVoiceSelect.addEventListener('change', () => {
  previousSpeechVoiceURI = speechVoiceURI;
  speechVoiceURI = speechVoiceSelect.value;
  const selectedVoice = speechSynthesisService.getVoices().find((voice) => voice.voiceURI === speechVoiceURI);
  speechVoiceGender = voiceSettingsService.voiceGender(selectedVoice) || 'any';
  speechVoiceGenderSetting.value = speechVoiceGender;
  savePreferences();
});

speechVoiceGenderSetting.addEventListener('change', () => {
  speechVoiceGender = speechVoiceGenderSetting.value;
  if (speechVoiceGender === 'any') {
    savePreferences();
    setVoiceSettingsStatus('Any available device voice may be selected.', 'success');
    return;
  }
  const match = voiceSettingsService.findGenderVoice(speechSynthesisService.getVoices(), speechVoiceGender);
  if (!match) {
    savePreferences();
    setVoiceSettingsStatus(`No available device voice explicitly identifies as ${speechVoiceGender}. Voice names and gender metadata depend on the device.`, 'error');
    return;
  }
  previousSpeechVoiceURI = speechVoiceURI;
  speechVoiceURI = match.voiceURI;
  speechVoiceSelect.value = speechVoiceURI;
  savePreferences();
  setVoiceSettingsStatus(`Selected ${voiceSettingsService.getVoiceLabel(match)}.`, 'success');
});

document.querySelector('#preview-voice').addEventListener('click', () => {
  const samples = {
    en: 'Hello, this is a preview of the selected voice.',
    hi: 'नमस्ते, यह चुनी हुई आवाज़ का नमूना है।',
    hinglish: 'Namaste, yeh selected voice ka preview hai.'
  };
  if (!speechSynthesisService.isSupported()) {
    setVoiceSettingsStatus('Speech playback is unavailable in this browser.', 'error');
    return;
  }
  try {
    speechSynthesisService.speak(samples[speechPreviewPhrase.value], { rate: speechRate, voiceURI: speechVoiceURI });
    setVoiceSettingsStatus('Playing a preview with the selected device voice. Language pronunciation depends on that voice.', 'success');
  } catch (error) {
    setVoiceSettingsStatus(error.message, 'error');
  }
});

document.querySelector('#reset-voice-settings').addEventListener('click', () => {
  speechRate = voiceSettingsService.DEFAULT_RATE;
  speechVoiceURI = '';
  previousSpeechVoiceURI = '';
  speechVoiceGender = 'any';
  speechRateSetting.value = String(speechRate);
  speechRateValue.value = `${speechRate.toFixed(1)}×`;
  speechVoiceGenderSetting.value = speechVoiceGender;
  populateSpeechVoices();
  savePreferences();
  speechSynthesisService.stop();
  setVoiceSettingsStatus('Voice settings reset to the device default voice and normal speed.', 'success');
});

wakeWordEnabledSetting.addEventListener('change', () => {
  wakeWordEnabled = wakeWordEnabledSetting.checked;
  savePreferences();
  if (!wakeWordEnabled && listeningModeManager.getMode() === listeningModeManager.modes.WAKE_WORD) {
    document.querySelector('#wake-word-stop').click();
  } else if (wakeWordEnabled && !wakeWordService.isSupported()) {
    setWakeWordStatus('Wake word is enabled as a preference, but listening requires a supported local engine or native Android service. No microphone is active.');
  }
});

wakeWordPhraseSetting.addEventListener('input', () => {
  wakeWordPhrase = wakeWordPhraseSetting.value.trim();
  savePreferences();
});

wakeSensitivitySetting.addEventListener('input', () => {
  wakeWordSensitivity = Number(wakeSensitivitySetting.value);
  wakeSensitivityValue.value = `${wakeWordSensitivity}%`;
  savePreferences();
});

if (window.speechSynthesis && typeof window.speechSynthesis.addEventListener === 'function') {
  window.speechSynthesis.addEventListener('voiceschanged', populateSpeechVoices);
}

if (!voiceRecognitionService.isSupported()) {
  setVoiceSettingsStatus('Voice input is not supported by this browser. Type messages instead, or try current Chrome on Android.');
} else if (!speechSynthesisService.isSupported()) {
  setVoiceSettingsStatus('Voice input is available. Speech playback is not supported by this browser; replies remain available as text.');
} else {
  setVoiceSettingsStatus('Voice input and device speech playback are available where permitted by your browser.');
}

function initializeProviderSettings() {
  window.ZeroGravityApp = Object.freeze({
    getImageProviderConfig() {
      const provider = window.ZeroGravityImages.selectProvider(providers);
      if (!provider) return null;
      return {
        ...provider,
        apiKey: sessionProviderCredentials.get(provider.id) || '',
        headers: sessionProviderHeaders.get(provider.id) || {},
        requestSettings: {
          ...(sessionProviderSettings.get(provider.id) || {}),
          imageGeneration: sessionProviderSettings.get(provider.id)?.imageGeneration || provider.imageOptions || {}
        }
      };
    },
    isOfflineOnly() {
      return offlineMode === window.ZeroGravityOffline.modes.OFFLINE_ONLY;
    },
    getOfflineMode() {
      return offlineMode;
    },
    getLiveProviderConfig(functionId) {
      const provider = getDefaultProvider(functionId);
      if (!provider) return null;
      const persistedSettings = provider.imageOptions
        ? { imageGeneration: provider.imageOptions }
        : provider.liveOptions || {};
      return {
        ...provider,
        apiKey: sessionProviderCredentials.get(provider.id) || '',
        headers: sessionProviderHeaders.get(provider.id) || {},
        requestSettings: sessionProviderSettings.get(provider.id) || persistedSettings
      };
    }
  });
  providerFunctionSelect.replaceChildren(...window.ZeroGravityAI.functions.map((definition) => (
    new Option(definition.name, definition.id)
  )));
  selectedFunctionId = 'chat-ai';
  providerFunctionSelect.value = selectedFunctionId;
  populateProviderTypes(selectedFunctionId);
  refreshProviderOptions();
  renderProviderDashboard();
  const configuredActiveProvider = getDefaultProvider('chat-ai');
  if (configuredActiveProvider) {
    loadProviderForm(configuredActiveProvider.id);
    configSelect.value = configuredActiveProvider.id;
  } else {
    document.querySelector('#provider-editor').hidden = true;
  }
  refreshProviderOptions();
  setChatNotice(providerStatusText());
  renderChat();
}

initializeProviderSettings();
if (providerMigrationWarning) setAPIStatus(providerMigrationWarning, 'error');
initializeOfflineSettings();
renderPhoneCapabilityList();
refreshPhoneCapabilities();
window.ZeroGravityRefreshPhoneCapabilities = refreshPhoneCapabilities;
phoneCommandForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const command = phoneCommandInput.value.trim();
  if (!command || phoneActionInFlight || requestInFlight) return;
  phoneActionInFlight = true;
  try {
    await runPhoneCommand(command);
  } finally {
    phoneActionInFlight = false;
  }
});
document.querySelector('#clear-phone-command-history').addEventListener('click', () => {
  phoneCommandHistory.length = 0;
  renderPhoneCommandHistory();
  phoneCommandStatus.textContent = 'Recent command history cleared for this page session.';
  phoneCommandStatus.classList.remove('is-error');
  phoneCommandStatus.classList.remove('is-success');
});

function renderDestinationHistory() {
  const list = document.querySelector('#conversation-list');
  const homeList = document.querySelector('#home-recent-list');
  const emptyState = document.querySelector('#chats-empty');
  if (!list || !homeList || !emptyState) return;

  const filter = document.querySelector('[data-conversation-filter].is-selected')?.dataset.conversationFilter || 'recent';
  const visibleConversations = [...conversations]
    .filter((conversation) => conversation.messages.length > 0)
    .filter((conversation) => filter === 'archived'
      ? conversation.archived
      : !conversation.archived && (filter !== 'pinned' || conversation.pinned))
    .sort((first, second) => Number(second.pinned) - Number(first.pinned) || second.updatedAt - first.updatedAt);
  const query = document.querySelector('#conversation-search')?.value.trim().toLocaleLowerCase() || '';
  const filtered = visibleConversations.filter((conversation) => (
    !query || conversation.title.toLocaleLowerCase().includes(query)
      || conversation.messages.some((message) => message.content.toLocaleLowerCase().includes(query))
  ));
  list.replaceChildren();
  filtered.forEach((conversation) => {
    const latestMessage = conversation.messages.at(-1)?.content || '';
    const row = document.createElement('div');
    row.className = 'conversation-row';
    const openButton = document.createElement('button');
    openButton.type = 'button';
    openButton.className = 'conversation-open';
    openButton.setAttribute('aria-label', `Open ${conversation.title}`);
    openButton.innerHTML = '<span class="conversation-row-icon" aria-hidden="true">◷</span>';
    const copy = document.createElement('span');
    copy.className = 'conversation-row-copy';
    const title = document.createElement('strong');
    title.textContent = conversation.title;
    const excerpt = document.createElement('small');
    excerpt.textContent = latestMessage;
    copy.append(title, excerpt);
    const date = document.createElement('time');
    date.dateTime = new Date(conversation.updatedAt).toISOString();
    date.textContent = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(conversation.updatedAt);
    openButton.append(copy, date);
    openButton.addEventListener('click', () => {
      activeConversationId = conversation.id;
      historySelect.value = conversation.id;
      renderChat();
      setScreen('chat');
    });
    const menu = document.createElement('details');
    menu.className = 'conversation-actions';
    const summary = document.createElement('summary');
    summary.setAttribute('aria-label', `Actions for ${conversation.title}`);
    summary.title = 'Conversation actions';
    summary.textContent = '···';
    menu.append(summary);
    const actionDefinitions = [
      ['rename', 'Rename'],
      [conversation.pinned ? 'unpin' : 'pin', conversation.pinned ? 'Unpin' : 'Pin'],
      [conversation.archived ? 'unarchive' : 'archive', conversation.archived ? 'Restore' : 'Archive'],
      ['export', 'Export'],
      ['delete', 'Delete']
    ];
    actionDefinitions.forEach(([action, label]) => {
      const actionButton = document.createElement('button');
      actionButton.type = 'button';
      actionButton.dataset.conversationAction = action;
      actionButton.textContent = label;
      actionButton.addEventListener('click', () => {
        if (action === 'rename') {
          const nextTitle = window.prompt('Rename conversation', conversation.title)?.trim().slice(0, 80);
          if (nextTitle) conversation.title = nextTitle;
        } else if (action === 'pin' || action === 'unpin') {
          conversation.pinned = action === 'pin';
        } else if (action === 'archive' || action === 'unarchive') {
          conversation.archived = action === 'archive';
        } else if (action === 'delete') {
          if (!window.confirm(`Delete “${conversation.title}” from this device? This cannot be undone.`)) return;
          conversations = conversations.filter((entry) => entry.id !== conversation.id);
          if (activeConversationId === conversation.id) {
            if (!conversations.length) conversations = [createConversation()];
            activeConversationId = conversations[0].id;
          }
        } else if (action === 'export') {
          const file = new Blob([JSON.stringify(conversation, null, 2)], { type: 'application/json' });
          const url = URL.createObjectURL(file);
          const link = document.createElement('a');
          link.href = url;
          link.download = `${conversation.title.replace(/[^a-z0-9-_]+/gi, '-').slice(0, 50) || 'conversation'}.json`;
          link.click();
          URL.revokeObjectURL(url);
          menu.open = false;
          return;
        }
        persistConversations();
        renderChat();
      });
      menu.append(actionButton);
    });
    row.append(openButton, menu);
    list.append(row);
  });
  emptyState.hidden = filtered.length > 0 || Boolean(query && visibleConversations.length);
  const emptyTitle = emptyState.querySelector('h2');
  const emptyCopy = emptyState.querySelector('p');
  if (!query && filter === 'pinned') {
    emptyTitle.textContent = 'No pinned conversations yet.';
    emptyCopy.textContent = 'Pin a conversation from its actions to keep it close.';
  } else if (!query && filter === 'archived') {
    emptyTitle.textContent = 'Nothing archived.';
    emptyCopy.textContent = 'Archived conversations will be kept here until you restore them.';
  } else {
    emptyTitle.textContent = 'Your next thought starts here.';
    emptyCopy.textContent = 'New conversations will appear here and stay on this device.';
  }
  if (!visibleConversations.length) {
    list.replaceChildren();
  } else if (query && !filtered.length) {
    const noResults = document.createElement('p');
    noResults.className = 'chat-empty';
    noResults.textContent = 'No conversations match that search.';
    list.append(noResults);
  }

  homeList.replaceChildren();
  const recent = [...conversations]
    .filter((conversation) => conversation.messages.length > 0 && !conversation.archived)
    .sort((first, second) => Number(second.pinned) - Number(first.pinned) || second.updatedAt - first.updatedAt)
    .slice(0, 2);
  if (!recent.length) {
    const empty = document.createElement('p');
    empty.className = 'home-recent-empty';
    empty.textContent = 'Your conversations will appear here.';
    homeList.append(empty);
    return;
  }
  recent.forEach((conversation) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'recent-conversation';
    button.innerHTML = '<span class="recent-icon" aria-hidden="true">◷</span>';
    const copy = document.createElement('span');
    const title = document.createElement('strong');
    title.textContent = conversation.title;
    const subtitle = document.createElement('small');
    subtitle.textContent = `${conversation.messages.length} messages · ${new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(conversation.updatedAt)}`;
    copy.append(title, subtitle);
    const arrow = document.createElement('span');
    arrow.className = 'recent-arrow';
    arrow.setAttribute('aria-hidden', 'true');
    arrow.textContent = '↗';
    button.append(copy, arrow);
    button.addEventListener('click', () => {
      activeConversationId = conversation.id;
      historySelect.value = conversation.id;
      renderChat();
      setScreen('chat');
    });
    homeList.append(button);
  });
}

function renderConnectionStatuses() {
  document.querySelectorAll('[data-connection-status]').forEach((status) => {
    const functionId = status.dataset.connectionStatus;
    const configured = providers.some((provider) => provider.functionId === functionId && provider.enabled);
    status.textContent = configured ? 'Configured · test needed' : 'Not configured';
    status.classList.toggle('is-configured', configured);
  });
  const activeProvider = getActiveProvider();
  const headerLabel = document.querySelector('#app-connection-label');
  if (headerLabel) {
    headerLabel.textContent = activeProvider
      ? sessionProviderCredentials.has(activeProvider.id) ? 'KEY IN SESSION' : 'KEY NEEDED'
      : 'LOCAL · READY';
  }
  const modelName = document.querySelector('#models-default-name');
  const modelProvider = document.querySelector('#models-default-provider');
  if (modelName && modelProvider) {
    modelName.textContent = activeProvider?.model || 'No model configured';
    modelProvider.textContent = activeProvider
      ? `${activeProvider.name} · connection not verified`
      : 'Connect a Chat AI provider to begin.';
  }
  const imageStatus = document.querySelector('#discover-image-status');
  if (imageStatus) {
    const imageProvider = providers.find((provider) => provider.functionId === 'image-generation' && provider.enabled);
    imageStatus.textContent = imageProvider ? 'Provider setup saved' : 'Provider required';
  }
}

document.querySelector('#home-composer').addEventListener('submit', (event) => {
  event.preventDefault();
  const prompt = document.querySelector('#home-prompt');
  const message = prompt.value.trim();
  if (!message) {
    prompt.focus();
    return;
  }
  chatInput.value = message;
  prompt.value = '';
  setScreen('chat');
  chatForm.requestSubmit();
});

document.querySelector('#voice-mode-listen').addEventListener('click', () => {
  startVoiceInput();
});
document.querySelectorAll('.voice-mode-end, #voice-mode-close').forEach((button) => button.addEventListener('click', () => {
  stopVoiceActivities();
}));
document.querySelector('#conversation-search').addEventListener('input', renderDestinationHistory);
document.querySelectorAll('[data-conversation-filter]').forEach((button) => {
  button.addEventListener('click', () => {
    document.querySelectorAll('[data-conversation-filter]').forEach((filterButton) => {
      const selected = filterButton === button;
      filterButton.classList.toggle('is-selected', selected);
      filterButton.setAttribute('aria-pressed', String(selected));
    });
    renderDestinationHistory();
  });
});
document.querySelector('#discover-search').addEventListener('input', (event) => {
  const query = event.currentTarget.value.trim().toLocaleLowerCase();
  document.querySelectorAll('.discover-card').forEach((card) => {
    card.hidden = Boolean(query) && !card.dataset.tool.includes(query);
  });
  document.querySelectorAll('.tool-group').forEach((group) => {
    group.hidden = !group.querySelector('.discover-card:not([hidden])');
  });
  document.querySelector('#discover-empty').hidden = Boolean(
    document.querySelector('.discover-card:not([hidden])')
  );
});
document.querySelectorAll('.connection-row[data-provider-function]').forEach((row) => {
  row.addEventListener('click', () => {
    const functionId = row.dataset.providerFunction;
    if (!window.ZeroGravityAI.functions.some((item) => item.id === functionId)) return;
    setScreen('settings');
    providerFunctionSelect.value = functionId;
    providerFunctionSelect.dispatchEvent(new Event('change'));
    document.querySelector('.own-api').scrollIntoView({ behavior: motionEnabled ? 'smooth' : 'auto', block: 'start' });
  });
});
document.querySelector('#analyzer-file').addEventListener('change', (event) => {
  const file = event.currentTarget.files?.[0];
  const panel = document.querySelector('#file-preview-panel');
  const status = document.querySelector('#file-processing-status');
  if (!file) {
    panel.hidden = true;
    status.textContent = 'No file selected. Files are not uploaded until an analysis provider is configured.';
    return;
  }
  const supportedFile = /\.(pdf|docx|txt|csv|png|jpe?g)$/i.test(file.name);
  if (!supportedFile) {
    panel.hidden = true;
    status.textContent = 'This file type is not supported. Choose a PDF, DOCX, TXT, CSV, PNG, or JPG file.';
    status.classList.add('is-error');
    return;
  }
  if (file.size > 20 * 1024 * 1024) {
    panel.hidden = true;
    status.textContent = 'This file is larger than 20 MB. Choose a smaller file to inspect.';
    status.classList.add('is-error');
    return;
  }
  document.querySelector('#file-preview-name').textContent = file.name;
  document.querySelector('#file-preview-meta').textContent = `${file.type || 'Unknown type'} · ${(file.size / 1024).toFixed(1)} KB`;
  panel.hidden = false;
  status.classList.remove('is-error');
  status.textContent = 'File selected locally. Its contents have not been read, uploaded, or analyzed.';
});

renderDestinationHistory();
renderConnectionStatuses();