(function exposeImageGeneration() {
  const STORAGE_KEY = 'zerogravity.images.gallery';
  const MAX_PROMPT_LENGTH = 4000;
  const MAX_NEGATIVE_PROMPT_LENGTH = 2000;
  const ASPECT_RATIOS = Object.freeze(['1:1', '9:16', '16:9', '4:3']);

  function validatePrompt(prompt, negativePrompt = '') {
    if (typeof prompt !== 'string' || !prompt.trim()) {
      throw new Error('Enter a prompt before generating an image.');
    }
    if (prompt.length > MAX_PROMPT_LENGTH) {
      throw new Error(`The prompt must be ${MAX_PROMPT_LENGTH} characters or fewer.`);
    }
    if (typeof negativePrompt !== 'string' || negativePrompt.length > MAX_NEGATIVE_PROMPT_LENGTH) {
      throw new Error(`The negative prompt must be ${MAX_NEGATIVE_PROMPT_LENGTH} characters or fewer.`);
    }
    return { prompt: prompt.trim(), negativePrompt: negativePrompt.trim() };
  }

  function selectProvider(providers) {
    const eligible = providers.filter((provider) => (
      provider
      && provider.functionId === 'image-generation'
      && provider.enabled === true
      && ['openai-images', 'custom-image-json'].includes(provider.type)
    ));
    return eligible.find((provider) => provider.isDefault)
      || eligible.sort((first, second) => first.priority - second.priority)[0]
      || null;
  }

  function validateAspectRatio(aspectRatio) {
    if (!ASPECT_RATIOS.includes(aspectRatio)) throw new Error('Choose a supported aspect ratio.');
    return aspectRatio;
  }

  function isRemoteImageURL(url) {
    try {
      return ['http:', 'https:'].includes(new URL(url).protocol);
    } catch {
      return false;
    }
  }

  function createIndexedDBBlobStore(database = null) {
    try {
      database = database || globalThis.indexedDB;
    } catch {
      database = null;
    }
    if (!database) {
      return {
        available: false,
        async put() { throw new Error('Image file storage is unavailable in this browser.'); },
        async get() { return null; },
        async delete() {}
      };
    }
    let connection;
    function open() {
      if (connection) return connection;
      connection = new Promise((resolve, reject) => {
        const request = database.open('zerogravity-image-files', 1);
        request.onupgradeneeded = () => {
          if (!request.result.objectStoreNames.contains('images')) {
            request.result.createObjectStore('images');
          }
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(new Error('Could not open local image file storage.'));
      });
      return connection;
    }
    async function requestResult(mode, action) {
      const db = await open();
      return new Promise((resolve, reject) => {
        const transaction = db.transaction('images', mode);
        const request = action(transaction.objectStore('images'));
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(new Error('Could not access a saved image file.'));
        transaction.onabort = () => reject(new Error('Image file storage transaction was interrupted.'));
      });
    }
    return {
      available: true,
      put: (key, blob) => requestResult('readwrite', (store) => store.put(blob, key)),
      get: (key) => requestResult('readonly', (store) => store.get(key)),
      delete: (key) => requestResult('readwrite', (store) => store.delete(key))
    };
  }

  function createGalleryStore({
    storage = null,
    blobStore = createIndexedDBBlobStore()
  } = {}) {
    function getStorage() {
      if (storage) return storage;
      try {
        return globalThis.localStorage;
      } catch {
        throw new Error('Browser storage is unavailable. The generated image cannot be added to the local gallery.');
      }
    }

    function read() {
      let items;
      try {
        items = JSON.parse(getStorage().getItem(STORAGE_KEY) || '[]');
      } catch {
        throw new Error('Saved gallery metadata is unreadable. Clear the damaged gallery data and try again.');
      }
      if (!Array.isArray(items)) throw new Error('Saved gallery metadata has an invalid format.');
      return items.filter((item) => item && typeof item.id === 'string');
    }

    function write(items) {
      try {
        getStorage().setItem(STORAGE_KEY, JSON.stringify(items));
      } catch {
        throw new Error('The browser could not save gallery metadata. The generated image was not added to the gallery.');
      }
    }

    return Object.freeze({
      async list() {
        return read().sort((first, second) => second.createdAt - first.createdAt);
      },
      async add({ prompt, aspectRatio, providerName, model, url = '', blob = null, mimeType = '' }) {
        if (!prompt || typeof prompt !== 'string') throw new Error('Gallery prompt metadata is missing.');
        if (!ASPECT_RATIOS.includes(aspectRatio)) throw new Error('Gallery aspect-ratio metadata is invalid.');
        if (!blob && !isRemoteImageURL(url)) throw new Error('The provider response did not contain a savable image URL or file.');
        if (blob && !(blob instanceof Blob)) throw new Error('The generated image file has an invalid format.');

        const id = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
        const blobKey = blob ? id : '';
        if (blob) await blobStore.put(blobKey, blob);
        const item = {
          id,
          prompt,
          aspectRatio,
          providerName: providerName || 'Unknown provider',
          model: model || '',
          createdAt: Date.now(),
          url: blob ? '' : url,
          blobKey,
          mimeType: mimeType || blob?.type || '',
          temporaryUrl: !blob && Boolean(url)
        };
        try {
          write([item, ...read()]);
        } catch (error) {
          if (blobKey) await blobStore.delete(blobKey);
          throw error;
        }
        return item;
      },
      async getBlob(item) {
        return item.blobKey ? blobStore.get(item.blobKey) : null;
      },
      async remove(id) {
        const items = read();
        const item = items.find((entry) => entry.id === id);
        if (!item) return false;
        write(items.filter((entry) => entry.id !== id));
        if (item.blobKey) await blobStore.delete(item.blobKey);
        return true;
      }
    });
  }

  globalThis.ZeroGravityImages = Object.freeze({
    aspectRatios: ASPECT_RATIOS,
    validatePrompt,
    validateAspectRatio,
    selectProvider,
    createGalleryStore,
    createIndexedDBBlobStore
  });
})();
