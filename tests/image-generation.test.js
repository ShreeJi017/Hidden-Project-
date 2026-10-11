const assert = require('node:assert/strict');
const { afterEach, test } = require('node:test');

const originalFetch = global.fetch;
global.window = globalThis;
delete require.cache[require.resolve('../ai-provider.js')];
require('../ai-provider.js');
delete require.cache[require.resolve('../image-generation.js')];
require('../image-generation.js');

afterEach(() => {
  global.fetch = originalFetch;
});

function config(overrides = {}) {
  return {
    id: 'image-provider',
    functionId: 'image-generation',
    type: 'openai-images',
    name: 'Mock Image API',
    endpoint: 'https://images.example.test/v1/images/generations',
    model: 'test-image-model',
    enabled: true,
    isDefault: true,
    priority: 1,
    apiKey: 'session-secret',
    headers: {},
    requestSettings: {},
    ...overrides
  };
}

test('validates required image prompts and supported aspect ratios', () => {
  assert.throws(() => window.ZeroGravityImages.validatePrompt('  '), /Enter a prompt/);
  assert.throws(() => window.ZeroGravityImages.validatePrompt('x'.repeat(4001)), /4000 characters/);
  assert.throws(() => window.ZeroGravityImages.validatePrompt('image', 'x'.repeat(2001)), /2000 characters/);
  assert.deepEqual(window.ZeroGravityImages.validatePrompt('  a quiet moon  '), {
    prompt: 'a quiet moon',
    negativePrompt: ''
  });
  assert.equal(window.ZeroGravityImages.validateAspectRatio('4:3'), '4:3');
  assert.throws(() => window.ZeroGravityImages.validateAspectRatio('3:2'), /supported aspect ratio/);
});

test('selects only enabled image adapters, preferring the configured default', () => {
  const candidates = [
    { functionId: 'chat-ai', type: 'openai-compatible', enabled: true, isDefault: true, priority: 1 },
    { functionId: 'image-generation', type: 'custom-http', enabled: true, isDefault: true, priority: 1 },
    { functionId: 'image-generation', type: 'custom-image-json', enabled: false, isDefault: true, priority: 1 },
    { functionId: 'image-generation', type: 'openai-images', enabled: true, isDefault: false, priority: 3 },
    { functionId: 'image-generation', type: 'custom-image-json', enabled: true, isDefault: true, priority: 5 }
  ];
  assert.equal(window.ZeroGravityImages.selectProvider(candidates), candidates[4]);
  assert.equal(window.ZeroGravityImages.selectProvider([]), null);
});

test('supports configured image provider types without changing chat adapters', () => {
  assert.deepEqual(window.ZeroGravityAI.getSupportedProviderTypes('image-generation'), [
    'openai-images',
    'custom-image-json',
    'custom-http'
  ]);
  assert.deepEqual(window.ZeroGravityAI.getSupportedProviderTypes('chat-ai'), ['openai-compatible']);
  assert.equal(window.ZeroGravityAI.functions.find((item) => item.id === 'image-generation').implemented, true);
});

test('sends configured prompt, ratio, model, and authentication with the provider-specific format', async () => {
  let request;
  global.fetch = async (url, options) => {
    request = { url, options, body: JSON.parse(options.body) };
    return {
      ok: true,
      status: 200,
      async json() { return { data: [{ url: 'https://cdn.example.test/image.png' }] }; }
    };
  };
  const settings = {
    imageGeneration: {
      negativePromptField: 'negative_prompt',
      qualityField: 'quality',
      styleField: 'style',
      authentication: { mode: 'header', headerName: 'X-Image-Key', prefix: 'Token ' }
    }
  };
  const result = await window.ZeroGravityAI.generateImage(config({
    type: 'openai-images',
    requestSettings: settings
  }), {
    prompt: 'green nebula',
    negativePrompt: 'text',
    aspectRatio: '9:16',
    quality: 'hd',
    style: 'vivid'
  });
  assert.equal(request.url, 'https://images.example.test/v1/images/generations');
  assert.equal(request.options.headers['X-Image-Key'], 'Token session-secret');
  assert.equal(request.options.headers.Authorization, undefined);
  assert.deepEqual(request.body, {
    prompt: 'green nebula',
    model: 'test-image-model',
    negative_prompt: 'text',
    size: '1024x1792',
    quality: 'hd',
    style: 'vivid'
  });
  assert.equal(result.url, 'https://cdn.example.test/image.png');
  assert.equal(result.temporaryUrl, true);
});

test('configures non-OpenAI request and response shapes without assuming their protocol', async () => {
  let request;
  global.fetch = async (url, options) => {
    request = { url, body: JSON.parse(options.body), headers: options.headers };
    return {
      ok: true,
      status: 200,
      async json() { return { result: { image: { href: 'https://cdn.example.test/custom.webp' } } }; }
    };
  };
  const custom = config({
    type: 'custom-image-json',
    endpoint: 'https://images.example.test/generate',
    requestSettings: {
      imageGeneration: {
        promptField: 'input.description',
        modelField: 'engine',
        aspectRatioField: 'output.ratio',
        aspectRatioValues: { '4:3': 'landscape_4_3' },
        staticBody: { input: {}, output: { format: 'webp' } },
        authentication: { mode: 'none' },
        response: { urlPath: 'result.image.href' }
      }
    }
  });
  const result = await window.ZeroGravityAI.generateImage(custom, {
    prompt: 'a glass forest',
    aspectRatio: '4:3'
  });
  assert.deepEqual(request.body, {
    input: { description: 'a glass forest' },
    output: { format: 'webp', ratio: 'landscape_4_3' },
    engine: 'test-image-model'
  });
  assert.equal(request.headers.Authorization, undefined);
  assert.equal(result.url, 'https://cdn.example.test/custom.webp');
});

test('reports missing keys, unsupported options, provider limits, and malformed responses', async () => {
  let calls = 0;
  global.fetch = async () => {
    calls += 1;
    return {
      ok: false,
      status: 429,
      async json() { return { error: { message: 'quota reached' } }; }
    };
  };
  const noKey = config({ apiKey: '' });
  await assert.rejects(
    window.ZeroGravityAI.generateImage(noKey, { prompt: 'an image', aspectRatio: '1:1' }),
    /Enter the image provider API key/
  );
  await assert.rejects(
    window.ZeroGravityAI.generateImage(config(), {
      prompt: 'an image',
      negativePrompt: 'text',
      aspectRatio: '1:1'
    }),
    /does not support a negative prompt/
  );
  assert.equal(calls, 0);
  await assert.rejects(
    window.ZeroGravityAI.generateImage(config(), { prompt: 'an image', aspectRatio: '1:1' }),
    /image quota is exhausted.*quota reached/
  );
  assert.equal(calls, 1);
  global.fetch = async () => ({
    ok: true,
    status: 200,
    async json() { return { unexpected: true }; }
  });
  await assert.rejects(
    window.ZeroGravityAI.generateImage(config(), { prompt: 'an image', aspectRatio: '1:1' }),
    /neither a configured image URL nor base64/
  );
});

test('does not claim success when provider requests fail or are cancelled', async () => {
  global.fetch = async () => {
    throw new TypeError('network disconnected');
  };
  await assert.rejects(
    window.ZeroGravityAI.generateImage(config(), { prompt: 'an image', aspectRatio: '1:1' }),
    /Could not reach the image provider/
  );
  const controller = new AbortController();
  controller.abort();
  global.fetch = async (url, options) => {
    assert.equal(options.signal.aborted, true);
    throw new DOMException('Aborted', 'AbortError');
  };
  await assert.rejects(
    window.ZeroGravityAI.generateImage(config(), {
      prompt: 'an image',
      aspectRatio: '1:1',
      signal: controller.signal
    }),
    { name: 'AbortError' }
  );
});

test('persists gallery metadata without base64 and removes associated image blobs', async () => {
  const values = new Map();
  const storedBlobs = new Map();
  const storage = {
    getItem(key) { return values.get(key) || null; },
    setItem(key, value) { values.set(key, value); }
  };
  const blobStore = {
    async put(key, blob) { storedBlobs.set(key, blob); },
    async get(key) { return storedBlobs.get(key) || null; },
    async delete(key) { storedBlobs.delete(key); }
  };
  const gallery = window.ZeroGravityImages.createGalleryStore({ storage, blobStore });
  const imageBlob = new Blob(['mock image bytes'], { type: 'image/png' });
  const saved = await gallery.add({
    prompt: 'a tiny forest',
    aspectRatio: '1:1',
    providerName: 'Mock Image API',
    model: 'model-10',
    blob: imageBlob
  });
  const serialized = values.get('zerogravity.images.gallery');
  assert.equal(serialized.includes('base64'), false);
  assert.equal(serialized.includes('mock image bytes'), false);
  assert.equal((await gallery.list())[0].providerName, 'Mock Image API');
  assert.equal((await gallery.getBlob(saved)).size, imageBlob.size);
  assert.equal(await gallery.remove(saved.id), true);
  assert.equal((await gallery.list()).length, 0);
  assert.equal(storedBlobs.size, 0);
});

test('saves temporary URL metadata without pretending the URL is permanent', async () => {
  const values = new Map();
  const gallery = window.ZeroGravityImages.createGalleryStore({
    storage: {
      getItem(key) { return values.get(key) || null; },
      setItem(key, value) { values.set(key, value); }
    },
    blobStore: { async put() {}, async get() { return null; }, async delete() {} }
  });
  const image = await gallery.add({
    prompt: 'a passing comet',
    aspectRatio: '16:9',
    providerName: 'Temporary API',
    model: 'model-a',
    url: 'https://cdn.example.test/short-lived.png'
  });
  assert.equal(image.temporaryUrl, true);
  assert.equal(image.url, 'https://cdn.example.test/short-lived.png');
  await assert.rejects(
    gallery.add({
      prompt: 'invalid URL',
      aspectRatio: '1:1',
      url: 'javascript:alert(1)'
    }),
    /savable image URL/
  );
});
