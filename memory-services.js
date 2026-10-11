(function exposeMemoryServices() {
  const STORAGE_KEY = 'zerogravity.memory.v1';
  const SCHEMA_VERSION = 1;
  const MAX_MEMORIES = 200;
  const MAX_CONTENT_LENGTH = 2000;
  const MAX_IMPORT_BYTES = 256 * 1024;
  const CATEGORIES = Object.freeze([
    'preference',
    'language',
    'communication-style',
    'response-length',
    'feature',
    'goal',
    'project',
    'fact',
    'context'
  ]);
  const SECRET_PATTERNS = [
    /\b(?:password|passcode|api[\s_-]?key|access[\s_-]?token|refresh[\s_-]?token|auth(?:entication)?[\s_-]?token|secret|private[\s_-]?key)\s*(?:[:=]|\bis\b)\s*\S+/i,
    /\b(?:sk|rk|pk)-[A-Za-z0-9_-]{16,}\b/,
    /\bBearer\s+[A-Za-z0-9._~+/-]{12,}/i,
    /\b(?:ghp|github_pat)_[A-Za-z0-9_]{20,}\b/i
  ];
  const SENSITIVE_PATTERNS = [
    /\b(?:diagnosed|diagnosis|medical|health condition|medication|therapy|mental health|disability)\b/i,
    /\b(?:religion|religious|faith|church|mosque|temple)\b/i,
    /\b(?:bank account|credit card|financial account|salary|income|debt)\b/i,
    /\b(?:home address|street address|date of birth|social security|national id)\b/i,
    /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i,
    /\b(?:\+?\d[\d\s().-]{8,}\d)\b/
  ];

  function makeId() {
    return globalThis.crypto?.randomUUID?.()
      || `${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
  }

  function containsSecret(value) {
    return SECRET_PATTERNS.some((pattern) => pattern.test(value));
  }

  function requiresSensitiveConsent(value) {
    return SENSITIVE_PATTERNS.some((pattern) => pattern.test(value));
  }

  function normalizeContent(value) {
    if (typeof value !== 'string') throw new Error('Memory content must be text.');
    const content = value.trim();
    if (!content) throw new Error('Enter memory text first.');
    if (content.length > MAX_CONTENT_LENGTH) throw new Error(`Memory text must be ${MAX_CONTENT_LENGTH} characters or fewer.`);
    if (containsSecret(content)) throw new Error('Passwords, API keys, tokens, and secrets cannot be saved to memory.');
    return content;
  }

  function validateRecord(record) {
    if (!record || typeof record !== 'object' || Array.isArray(record)) throw new Error('Memory import contains an invalid record.');
    const allowedFields = ['id', 'category', 'content', 'createdAt', 'updatedAt', 'expiresAt', 'allowOnline'];
    if (Object.keys(record).some((key) => !allowedFields.includes(key))) throw new Error('Memory import contains unsupported record fields.');
    if (typeof record.id !== 'string' || record.id.length > 100 || containsSecret(record.id)) throw new Error('Memory import contains an invalid record ID.');
    if (!CATEGORIES.includes(record.category)) throw new Error('Memory import contains an unsupported category.');
    const content = normalizeContent(record.content);
    if (!Number.isFinite(Date.parse(record.createdAt)) || !Number.isFinite(Date.parse(record.updatedAt))) {
      throw new Error('Memory import contains an invalid timestamp.');
    }
    const expiresAt = record.expiresAt == null ? null : new Date(record.expiresAt);
    if (expiresAt && !Number.isFinite(expiresAt.getTime())) throw new Error('Memory import contains an invalid expiration date.');
    if (typeof record.allowOnline !== 'boolean') throw new Error('Memory import must specify whether each memory may be shared online.');
    return {
      id: record.id,
      category: record.category,
      content,
      createdAt: new Date(record.createdAt).toISOString(),
      updatedAt: new Date(record.updatedAt).toISOString(),
      expiresAt: expiresAt ? expiresAt.toISOString() : null,
      allowOnline: record.allowOnline
    };
  }

  function createLocalStorageAdapter(storage = null) {
    function getStorage() {
      try {
        return storage || window.localStorage;
      } catch {
        throw new Error('This browser does not allow access to local storage.');
      }
    }
    return Object.freeze({
      name: 'browser-local-storage',
      async load() {
        try {
          return getStorage().getItem(STORAGE_KEY);
        } catch {
          throw new Error('Saved memories could not be read from browser storage.');
        }
      },
      async save(value) {
        try {
          const target = getStorage();
          if (value == null) target.removeItem(STORAGE_KEY);
          else target.setItem(STORAGE_KEY, value);
        } catch {
          throw new Error('Memories could not be saved. Check available browser storage.');
        }
      }
    });
  }

  function createAndroidAdapter(nativeStore) {
    if (!nativeStore || typeof nativeStore.readMemories !== 'function' || typeof nativeStore.writeMemories !== 'function') {
      throw new Error('The native Android memory interface is unavailable.');
    }
    return Object.freeze({
      name: 'android-memory-interface',
      async load() {
        return nativeStore.readMemories();
      },
      async save(value) {
        return nativeStore.writeMemories(value);
      }
    });
  }

  function createBackendAdapter(client) {
    if (!client || typeof client.readMemories !== 'function' || typeof client.writeMemories !== 'function') {
      throw new Error('A configured, authenticated memory backend client is required.');
    }
    return Object.freeze({
      name: 'authenticated-backend',
      async load() {
        return client.readMemories();
      },
      async save(value) {
        return client.writeMemories(value);
      }
    });
  }

  function createMemoryStore({ adapter = createLocalStorageAdapter(), clock = () => new Date() } = {}) {
    if (!adapter || typeof adapter.load !== 'function' || typeof adapter.save !== 'function') {
      throw new Error('Memory storage requires an adapter with load and save operations.');
    }

    async function readRecords() {
      const raw = await adapter.load();
      if (raw == null || raw === '') return [];
      let parsed;
      try {
        parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
      } catch {
        throw new Error('Saved memory data is corrupted. Export or clear the browser storage before continuing.');
      }
      if (!parsed || parsed.schemaVersion !== SCHEMA_VERSION || !Array.isArray(parsed.memories)) {
        throw new Error('Saved memory data has an unsupported format. Export or clear the browser storage before continuing.');
      }
      if (parsed.memories.length > MAX_MEMORIES) throw new Error('Saved memory data exceeds the supported record limit.');
      const records = parsed.memories.map(validateRecord);
      const now = clock().getTime();
      return records.filter((record) => !record.expiresAt || Date.parse(record.expiresAt) > now);
    }

    async function writeRecords(records) {
      if (records.length > MAX_MEMORIES) throw new Error(`Memory is limited to ${MAX_MEMORIES} records.`);
      const serialized = JSON.stringify({ schemaVersion: SCHEMA_VERSION, memories: records.map(validateRecord) });
      if (serialized.length * 2 > MAX_IMPORT_BYTES) throw new Error('Memory data exceeds the supported storage size.');
      await adapter.save(serialized);
    }

    async function list() {
      return (await readRecords()).sort((first, second) => Date.parse(second.updatedAt) - Date.parse(first.updatedAt));
    }

    async function add({ content, category = 'context', expiresAt = null, allowOnline = false, sensitiveConsent = false }) {
      const safeContent = normalizeContent(content);
      if (!CATEGORIES.includes(category)) throw new Error('Choose a supported memory category.');
      if (requiresSensitiveConsent(safeContent) && sensitiveConsent !== true) {
        throw new Error('This memory may contain sensitive personal information. Confirm consent before saving it.');
      }
      const expiration = expiresAt ? new Date(expiresAt) : null;
      if (expiration && (!Number.isFinite(expiration.getTime()) || expiration.getTime() <= clock().getTime())) {
        throw new Error('Choose a valid expiration date in the future.');
      }
      if (typeof allowOnline !== 'boolean') throw new Error('Choose whether this memory may be included in online AI requests.');
      const records = await readRecords();
      const normalized = safeContent.toLocaleLowerCase().replace(/\s+/g, ' ');
      const duplicate = records.find((record) => record.content.toLocaleLowerCase().replace(/\s+/g, ' ') === normalized);
      if (duplicate) return { memory: duplicate, duplicate: true, replaced: [] };

      const replacementCategories = ['language', 'communication-style', 'response-length'];
      const replaced = replacementCategories.includes(category)
        ? records.filter((record) => record.category === category)
        : [];
      const retained = records.filter((record) => !replaced.some((old) => old.id === record.id));
      const now = clock().toISOString();
      const memory = {
        id: makeId(),
        category,
        content: safeContent,
        createdAt: now,
        updatedAt: now,
        expiresAt: expiration?.toISOString() || null,
        allowOnline
      };
      await writeRecords([...retained, memory]);
      return { memory, duplicate: false, replaced };
    }

    async function update(id, changes) {
      const records = await readRecords();
      const index = records.findIndex((record) => record.id === id);
      if (index < 0) throw new Error('The selected memory no longer exists.');
      const current = records[index];
      const content = normalizeContent(changes.content ?? current.content);
      const category = changes.category ?? current.category;
      if (!CATEGORIES.includes(category)) throw new Error('Choose a supported memory category.');
      if (requiresSensitiveConsent(content) && changes.sensitiveConsent !== true) {
        throw new Error('This memory may contain sensitive personal information. Confirm consent before saving it.');
      }
      const expiresAt = changes.expiresAt === undefined ? current.expiresAt : changes.expiresAt;
      const expiration = expiresAt ? new Date(expiresAt) : null;
      if (expiration && (!Number.isFinite(expiration.getTime()) || expiration.getTime() <= clock().getTime())) {
        throw new Error('Choose a valid expiration date in the future.');
      }
      const updated = {
        ...current,
        category,
        content,
        updatedAt: clock().toISOString(),
        expiresAt: expiration?.toISOString() || null,
        allowOnline: changes.allowOnline ?? current.allowOnline
      };
      const normalized = content.toLocaleLowerCase().replace(/\s+/g, ' ');
      if (records.some((record) => record.id !== id && record.content.toLocaleLowerCase().replace(/\s+/g, ' ') === normalized)) {
        throw new Error('An equivalent memory already exists.');
      }
      const replacementCategories = ['language', 'communication-style', 'response-length'];
      const replaced = replacementCategories.includes(category)
        ? records.filter((record) => record.id !== id && record.category === category)
        : [];
      const next = records.filter((record) => record.id !== id && !replaced.some((old) => old.id === record.id));
      await writeRecords([...next, updated]);
      return { memory: updated, replaced };
    }

    async function remove(id) {
      const records = await readRecords();
      const next = records.filter((record) => record.id !== id);
      if (next.length === records.length) return false;
      await writeRecords(next);
      return true;
    }

    async function removeMatching(query) {
      const needle = String(query || '').trim().toLocaleLowerCase().replace(/\s+/g, ' ');
      if (!needle) throw new Error('Specify which memory to forget.');
      const records = await readRecords();
      const matches = records.filter((record) => record.content.toLocaleLowerCase().replace(/\s+/g, ' ').includes(needle));
      if (!matches.length) return [];
      await writeRecords(records.filter((record) => !matches.some((memory) => memory.id === record.id)));
      return matches;
    }

    async function clear() {
      await adapter.save(null);
    }

    async function exportData() {
      return JSON.stringify({ schemaVersion: SCHEMA_VERSION, memories: await list() }, null, 2);
    }

    async function importData(value, { sensitiveConsent = false } = {}) {
      if (typeof value !== 'string' || value.length * 2 > MAX_IMPORT_BYTES) {
        throw new Error('Memory import must be a JSON file no larger than 256 KB.');
      }
      let parsed;
      try {
        parsed = JSON.parse(value);
      } catch {
        throw new Error('Memory import is not valid JSON.');
      }
      if (!parsed || parsed.schemaVersion !== SCHEMA_VERSION || !Array.isArray(parsed.memories)) {
        throw new Error('Memory import has an unsupported schema.');
      }
      if (parsed.memories.length > MAX_MEMORIES) throw new Error(`Memory import may contain at most ${MAX_MEMORIES} records.`);
      const memories = parsed.memories.map(validateRecord);
      if (memories.some((memory) => requiresSensitiveConsent(memory.content)) && sensitiveConsent !== true) {
        throw new Error('This import may contain sensitive personal information. Confirm consent before importing it.');
      }
      const seen = new Set();
      memories.forEach((memory) => {
        const normalized = memory.content.toLocaleLowerCase().replace(/\s+/g, ' ');
        if (seen.has(normalized)) throw new Error('Memory import contains duplicate entries.');
        seen.add(normalized);
      });
      await writeRecords(memories.map((memory) => ({ ...memory, allowOnline: false })));
      return memories.length;
    }

    return Object.freeze({
      list,
      add,
      update,
      remove,
      removeMatching,
      clear,
      exportData,
      importData,
      adapterName: adapter.name || 'custom'
    });
  }

  window.ZeroGravityMemory = Object.freeze({
    categories: CATEGORIES,
    storageKey: STORAGE_KEY,
    schemaVersion: SCHEMA_VERSION,
    maxMemories: MAX_MEMORIES,
    maxContentLength: MAX_CONTENT_LENGTH,
    maxImportBytes: MAX_IMPORT_BYTES,
    containsSecret,
    requiresSensitiveConsent,
    createLocalStorageAdapter,
    createAndroidAdapter,
    createBackendAdapter,
    createMemoryStore
  });
})();
