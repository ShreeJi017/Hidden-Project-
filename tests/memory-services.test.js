const assert = require('node:assert/strict');
const { test } = require('node:test');

global.window = globalThis;
global.crypto = global.crypto || require('node:crypto').webcrypto;
delete require.cache[require.resolve('../memory-services.js')];
require('../memory-services.js');

function createStorageAdapter(initial = null) {
  let value = initial;
  return {
    name: 'test-storage',
    async load() { return value; },
    async save(next) { value = next; },
    read() { return value; }
  };
}

test('memories can be saved, listed, edited, and deleted', async () => {
  const store = window.ZeroGravityMemory.createMemoryStore({ adapter: createStorageAdapter() });
  const added = await store.add({ content: 'I prefer concise explanations.', category: 'response-length' });
  assert.equal(added.memory.content, 'I prefer concise explanations.');
  assert.equal((await store.list()).length, 1);
  const updated = await store.update(added.memory.id, { content: 'I prefer detailed explanations.', category: 'response-length' });
  assert.equal(updated.memory.content, 'I prefer detailed explanations.');
  assert.equal((await store.list()).length, 1);
  assert.equal(await store.remove(added.memory.id), true);
  assert.deepEqual(await store.list(), []);
});

test('duplicate entries are ignored and new explicit preferences replace older ones', async () => {
  const store = window.ZeroGravityMemory.createMemoryStore({ adapter: createStorageAdapter() });
  const first = await store.add({ content: 'Please reply in English.', category: 'language' });
  const duplicate = await store.add({ content: '  please   reply in english. ', category: 'language' });
  assert.equal(duplicate.duplicate, true);
  const replacement = await store.add({ content: 'Please reply in Hindi.', category: 'language' });
  assert.equal(replacement.replaced.length, 1);
  assert.deepEqual((await store.list()).map((memory) => memory.content), ['Please reply in Hindi.']);
  assert.equal(first.memory.id, replacement.replaced[0].id);
});

test('sensitive memories require consent and secrets are always rejected', async () => {
  const store = window.ZeroGravityMemory.createMemoryStore({ adapter: createStorageAdapter() });
  await assert.rejects(
    store.add({ content: 'My medication is called Example.' }),
    /Confirm consent/
  );
  await store.add({ content: 'My medication is called Example.', sensitiveConsent: true });
  await assert.rejects(
    store.add({ content: 'My password is hunter2', sensitiveConsent: true }),
    /cannot be saved/
  );
  assert.equal(window.ZeroGravityMemory.containsSecret('API key: sk-test_12345678901234567890'), true);
});

test('export/import validates schema and size and resets online-sharing approval', async () => {
  const original = window.ZeroGravityMemory.createMemoryStore({ adapter: createStorageAdapter() });
  await original.add({
    content: 'I am working on a garden project.',
    category: 'project',
    allowOnline: true
  });
  const data = await original.exportData();
  const restored = window.ZeroGravityMemory.createMemoryStore({ adapter: createStorageAdapter() });
  assert.equal(await restored.importData(data), 1);
  assert.equal((await restored.list())[0].allowOnline, false);
  await assert.rejects(restored.importData('not-json'), /valid JSON/);
  await assert.rejects(
    restored.importData(JSON.stringify({ schemaVersion: 99, memories: [] })),
    /unsupported schema/
  );
  await assert.rejects(
    restored.importData(JSON.stringify({
      schemaVersion: 1,
      memories: [{
        id: 'valid-id',
        category: 'context',
        content: 'A valid note',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
        expiresAt: null,
        allowOnline: false,
        extra: 'unexpected'
      }]
    })),
    /unsupported record fields/
  );
  await assert.rejects(
    restored.importData('x'.repeat(window.ZeroGravityMemory.maxImportBytes)),
    /no larger than 256 KB/
  );
});

test('sensitive imports require consent and expired memories are hidden', async () => {
  const adapter = createStorageAdapter();
  const store = window.ZeroGravityMemory.createMemoryStore({ adapter });
  const sensitive = window.ZeroGravityMemory.createMemoryStore({ adapter: createStorageAdapter() });
  await sensitive.add({ content: 'I have a medical condition.', sensitiveConsent: true });
  const data = await sensitive.exportData();
  await assert.rejects(store.importData(data), /Confirm consent/);
  assert.equal(await store.importData(data, { sensitiveConsent: true }), 1);

  const now = new Date('2026-01-01T00:00:00.000Z');
  const expiringStore = window.ZeroGravityMemory.createMemoryStore({
    adapter: createStorageAdapter(),
    clock: () => now
  });
  await expiringStore.add({ content: 'Temporary project note', expiresAt: '2026-01-02T00:00:00.000Z' });
  now.setUTCDate(3);
  assert.deepEqual(await expiringStore.list(), []);
});

test('corrupted memory storage reports an explicit error', async () => {
  const store = window.ZeroGravityMemory.createMemoryStore({ adapter: createStorageAdapter('{broken') });
  await assert.rejects(store.list(), /corrupted/);
});
