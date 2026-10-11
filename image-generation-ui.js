(function initializeImageGenerationUI() {
  const store = window.ZeroGravityImages.createGalleryStore();
  const objectURLs = new Set();
  const saveCallbacks = new Map();
  let activeRequest = null;
  let lastOptions = null;
  let generated = null;
  let selected = null;

  function providerConfig() {
    return window.ZeroGravityApp.getImageProviderConfig();
  }

  function setStatus(message, tone = '') {
    const status = document.querySelector('#image-generation-status');
    status.textContent = message;
    status.classList.toggle('is-error', tone === 'error');
    status.classList.toggle('is-success', tone === 'success');
  }

  function refreshProvider() {
    const status = document.querySelector('#image-provider-status');
    const config = providerConfig();
    if (!config) {
      status.textContent = 'No enabled Image Generation provider is configured. Add one in Settings → Own API.';
    } else if (window.ZeroGravityApp.isOfflineOnly()) {
      status.textContent = `${config.name} is configured, but Offline-only mode blocks online image generation.`;
    } else if ((config.requestSettings.imageGeneration?.authentication?.mode || 'bearer') !== 'none' && !config.apiKey) {
      status.textContent = `${config.name} is selected. Enter its API key in Settings → Own API for this browser session.`;
    } else {
      status.textContent = `Provider · ${config.name} · ${config.model}`;
    }
    const capabilities = config ? window.ZeroGravityAI.getImageCapabilities(config) : {};
    const controls = {
      negativePrompt: document.querySelector('#image-negative-prompt'),
      aspectRatio: document.querySelector('#image-aspect-ratio'),
      quality: document.querySelector('#image-quality'),
      style: document.querySelector('#image-style')
    };
    Object.entries(controls).forEach(([name, control]) => {
      control.disabled = capabilities[name] !== true || Boolean(activeRequest);
    });
    document.querySelector('#image-negative-support').textContent = capabilities.negativePrompt
      ? 'Supported by selected provider'
      : 'Not configured for selected provider';
  }

  function sourceFor(item) {
    if (item.blob) {
      if (!item.objectURL) {
        item.objectURL = URL.createObjectURL(item.blob);
        objectURLs.add(item.objectURL);
      }
      return item.objectURL;
    }
    return item.url || '';
  }

  async function loadSavedImage(item) {
    return { ...item, blob: item.blob || await store.getBlob(item) };
  }

  function formatDate(value) {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? 'Date unavailable' : date.toLocaleString();
  }

  function addMetadata(parent, label, value) {
    const row = document.createElement('div');
    const term = document.createElement('dt');
    term.textContent = label;
    const description = document.createElement('dd');
    description.textContent = value || 'Not available';
    row.append(term, description);
    parent.append(row);
  }

  async function renderGallery() {
    const grid = document.querySelector('#image-gallery-grid');
    for (const url of objectURLs) URL.revokeObjectURL(url);
    objectURLs.clear();
    grid.replaceChildren();
    try {
      const items = await store.list();
      document.querySelector('#image-gallery-empty').hidden = items.length > 0;
      for (const item of items) {
        const card = document.createElement('article');
        card.className = 'image-gallery-card';
        const image = document.createElement('img');
        image.alt = item.prompt;
        image.loading = 'lazy';
        image.onerror = () => {
          image.classList.add('is-broken');
          image.alt = `Image unavailable: ${item.prompt}`;
        };
        let viewItem;
        try {
          viewItem = await loadSavedImage(item);
        } catch {
          viewItem = item;
        }
        image.src = sourceFor(viewItem);
        const details = document.createElement('div');
        details.className = 'image-gallery-card-details';
        const provider = document.createElement('strong');
        provider.textContent = item.providerName || 'Unknown provider';
        const prompt = document.createElement('p');
        prompt.textContent = item.prompt;
        const date = document.createElement('span');
        date.textContent = `${item.model || 'Model unavailable'} · ${formatDate(item.createdAt)}`;
        const open = document.createElement('button');
        open.type = 'button';
        open.className = 'secondary-button';
        open.textContent = 'View details';
        open.addEventListener('click', () => void openDetails(item));
        details.append(provider, prompt, date, open);
        card.append(image, details);
        grid.append(card);
      }
      const status = document.querySelector('#image-gallery-status');
      status.textContent = '';
      status.classList.remove('is-error');
    } catch (error) {
      document.querySelector('#image-gallery-empty').hidden = true;
      const status = document.querySelector('#image-gallery-status');
      status.textContent = error.message;
      status.classList.add('is-error');
    }
  }

  async function openDetails(item) {
    selected = item;
    const dialog = document.querySelector('#image-detail-dialog');
    const preview = document.querySelector('#image-detail-preview');
    const metadata = document.querySelector('#image-detail-metadata');
    const status = document.querySelector('#image-detail-status');
    metadata.replaceChildren();
    status.textContent = '';
    let viewItem;
    try {
      viewItem = await loadSavedImage(item);
    } catch {
      viewItem = item;
    }
    preview.src = sourceFor(viewItem);
    preview.alt = item.prompt;
    preview.classList.remove('is-broken');
    preview.onerror = () => {
      preview.classList.add('is-broken');
      preview.alt = `Image unavailable: ${item.prompt}`;
      status.textContent = 'The provider image URL may have expired, or this image is unavailable.';
    };
    addMetadata(metadata, 'Prompt', item.prompt);
    addMetadata(metadata, 'Provider', item.providerName);
    addMetadata(metadata, 'Model', item.model);
    addMetadata(metadata, 'Created', formatDate(item.createdAt));
    addMetadata(metadata, 'Aspect ratio', item.aspectRatio);
    if (item.temporaryUrl) addMetadata(metadata, 'URL notice', 'Provider-hosted URL may expire; save a local copy while it is available.');
    document.querySelectorAll('.android-save-image').forEach((button) => {
      button.hidden = !window.ZeroGravityNativeImages?.saveImage;
    });
    document.querySelector('#share-gallery-image').hidden = !(viewItem.blob && typeof navigator.share === 'function');
    dialog.showModal();
  }

  async function generate(options = lastOptions) {
    if (activeRequest) return;
    if (!options) {
      setStatus('Enter a prompt before generating an image.', 'error');
      return;
    }
    let prompts;
    try {
      prompts = window.ZeroGravityImages.validatePrompt(options.prompt, options.negativePrompt || '');
      window.ZeroGravityImages.validateAspectRatio(options.aspectRatio);
    } catch (error) {
      setStatus(error.message, 'error');
      return;
    }
    if (window.ZeroGravityApp.isOfflineOnly()) {
      setStatus('Offline-only mode blocks online image generation. Change the mode in Settings to continue.', 'error');
      return;
    }
    const config = providerConfig();
    if (!config) {
      setStatus('No enabled Image Generation provider is configured. Add one in Settings → Own API.', 'error');
      return;
    }
    const capabilities = window.ZeroGravityAI.getImageCapabilities(config);
    const generationOptions = { ...options, ...prompts };
    for (const key of ['negativePrompt', 'quality', 'style', 'aspectRatio']) {
      const capability = key === 'aspectRatio' ? 'aspectRatio' : key;
      if (generationOptions[key] && !capabilities[capability]) {
        setStatus(`The selected provider does not support ${key === 'negativePrompt' ? 'a negative prompt' : key}. Configure provider options in Settings → Own API.`, 'error');
        return;
      }
    }
    const controller = new AbortController();
    activeRequest = controller;
    lastOptions = { ...options, ...prompts };
    const generateButton = document.querySelector('#generate-image');
    generateButton.disabled = true;
    document.querySelector('#cancel-image-generation').disabled = false;
    document.querySelector('#retry-image-generation').disabled = true;
    document.querySelector('#image-prompt').disabled = true;
    refreshProvider();
    document.querySelector('#image-result').hidden = true;
    setStatus('Contacting provider… progress is not available for this API.');
    try {
      const result = await window.ZeroGravityAI.generateImage(config, {
        ...generationOptions,
        signal: controller.signal
      });
      const image = {
        ...result,
        prompt: prompts.prompt,
        aspectRatio: options.aspectRatio,
        createdAt: Date.now()
      };
      const preview = document.querySelector('#image-result-preview');
      preview.src = image.blob ? sourceFor(image) : image.url;
      preview.alt = prompts.prompt;
      preview.classList.remove('is-broken');
      preview.onerror = () => {
        preview.classList.add('is-broken');
        preview.alt = 'Generated image URL is unavailable or has expired.';
      };
      generated = image;
      document.querySelector('#image-result-details').textContent = `${image.providerName} · ${image.model} · ${formatDate(image.createdAt)}${image.temporaryUrl ? ' · Provider URL may expire' : ''}`;
      document.querySelector('#image-result').hidden = false;
      document.querySelector('#retry-image-generation').disabled = false;
      document.querySelectorAll('.android-save-image').forEach((button) => {
        button.hidden = !window.ZeroGravityNativeImages?.saveImage;
      });
      document.querySelector('#share-generated-image').hidden = !(image.blob && typeof navigator.share === 'function');
      try {
        await store.add({
          prompt: image.prompt,
          aspectRatio: image.aspectRatio,
          providerName: image.providerName,
          model: image.model,
          url: image.url,
          blob: image.blob,
          mimeType: image.mimeType
        });
        setStatus(`Image generated successfully and saved to the gallery.${image.temporaryUrl ? ' Its provider URL may expire; download a copy now.' : ''}`, 'success');
      } catch (error) {
        setStatus(`Image generated successfully, but could not be saved to the gallery: ${error.message}`, 'error');
      }
    } catch (error) {
      setStatus(controller.signal.aborted
        ? 'Request cancelled in this browser. The provider may still have processed it; no image response was received.'
        : window.ZeroGravityAI.redactError(error, [config.apiKey, ...Object.values(config.headers || {})]), 'error');
    } finally {
      activeRequest = null;
      generateButton.disabled = false;
      document.querySelector('#cancel-image-generation').disabled = true;
      document.querySelector('#retry-image-generation').disabled = !lastOptions;
      document.querySelector('#image-prompt').disabled = false;
      refreshProvider();
    }
  }

  async function getBlob(item) {
    if (item.blob) return item.blob;
    if (!item.url) throw new Error('The saved image file is unavailable.');
    let response;
    try {
      response = await fetch(item.url);
    } catch {
      throw new Error('Could not fetch this provider-hosted image. Its URL may have expired or the provider may block browser access.');
    }
    if (!response.ok) throw new Error(`Could not download the image. The image URL returned HTTP ${response.status}.`);
    return response.blob();
  }

  async function download(item) {
    const blob = await getBlob(item);
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `zerogravity-${Date.now()}.${blob.type.split('/')[1] || 'png'}`;
    document.body.append(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  async function share(item) {
    const blob = await getBlob(item);
    if (typeof navigator.share !== 'function' || typeof File !== 'function') {
      throw new Error('File sharing is not supported by this browser. Use Download instead.');
    }
    const file = new File([blob], `zerogravity-image.${blob.type.split('/')[1] || 'png'}`, { type: blob.type });
    if (typeof navigator.canShare === 'function' && !navigator.canShare({ files: [file] })) {
      throw new Error('This browser cannot share image files. Use Download instead.');
    }
    await navigator.share({ files: [file], title: 'ZeroGravity image' });
  }

  function blobAsDataURL(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(new Error('Could not read the image file for Android storage.'));
      reader.readAsDataURL(blob);
    });
  }

  async function saveToAndroid(item, status) {
    const bridge = window.ZeroGravityNativeImages;
    if (!bridge?.saveImage) {
      status.textContent = 'Native image saving is unavailable. Use Download or Share; browsers cannot silently write to arbitrary device folders.';
      status.classList.add('is-error');
      return;
    }
    try {
      const blob = await getBlob(item);
      if (blob.size > 20 * 1024 * 1024) throw new Error('The Android image-save bridge supports images up to 20 MB.');
      const dataURL = await blobAsDataURL(blob);
      const callbackId = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
      status.textContent = 'Saving image to Android Photos…';
      status.classList.remove('is-error');
      saveCallbacks.set(callbackId, (result) => {
        status.textContent = result.message;
        status.classList.toggle('is-error', result.status !== 'success');
        status.classList.toggle('is-success', result.status === 'success');
        saveCallbacks.delete(callbackId);
      });
      bridge.saveImage(dataURL, blob.type || 'image/png', `ZeroGravity-${Date.now()}`, callbackId);
    } catch (error) {
      status.textContent = error.message;
      status.classList.add('is-error');
    }
  }

  window.ZeroGravityImageSaveResult = (callbackId, result) => saveCallbacks.get(callbackId)?.(result);

  document.querySelector('#image-generation-form').addEventListener('submit', (event) => {
    event.preventDefault();
    void generate({
      prompt: document.querySelector('#image-prompt').value,
      negativePrompt: document.querySelector('#image-negative-prompt').value,
      aspectRatio: document.querySelector('#image-aspect-ratio').value,
      quality: document.querySelector('#image-quality').value,
      style: document.querySelector('#image-style').value
    });
  });
  document.querySelector('#cancel-image-generation').addEventListener('click', () => activeRequest?.abort());
  document.querySelector('#retry-image-generation').addEventListener('click', () => void generate());
  document.querySelector('#clear-image-generation').addEventListener('click', () => {
    if (activeRequest) activeRequest.abort();
    document.querySelector('#image-generation-form').reset();
    document.querySelector('#image-result').hidden = true;
    document.querySelector('#image-result-preview').removeAttribute('src');
    document.querySelector('#retry-image-generation').disabled = true;
    generated = null;
    lastOptions = null;
    setStatus('Image form cleared.');
    refreshProvider();
  });
  document.querySelector('#download-generated-image').addEventListener('click', async () => {
    try {
      await download(generated);
      setStatus('Download started. Check your browser downloads.', 'success');
    } catch (error) {
      setStatus(`${error.message} Provider URLs may require CORS access; try again or use the provider’s URL.`, 'error');
    }
  });
  document.querySelector('#share-generated-image').addEventListener('click', async () => {
    try {
      await share(generated);
    } catch (error) {
      setStatus(error.message, 'error');
    }
  });
  document.querySelector('#save-generated-image').addEventListener('click', () => void saveToAndroid(generated, document.querySelector('#image-generation-status')));
  document.querySelector('#close-image-detail').addEventListener('click', () => document.querySelector('#image-detail-dialog').close());
  document.querySelector('#copy-image-prompt').addEventListener('click', async () => {
    const status = document.querySelector('#image-detail-status');
    try {
      await navigator.clipboard.writeText(selected.prompt);
      status.textContent = 'Prompt copied.';
      status.classList.remove('is-error');
    } catch {
      status.textContent = 'Could not copy the prompt. Check clipboard permissions.';
      status.classList.add('is-error');
    }
  });
  document.querySelector('#retry-gallery-image').addEventListener('click', () => {
    document.querySelector('#image-prompt').value = selected.prompt;
    document.querySelector('#image-aspect-ratio').value = selected.aspectRatio;
    document.querySelector('#image-detail-dialog').close();
    window.ZeroGravityImagesUI.onScreen('image-generator');
    document.querySelector('#image-prompt').focus({ preventScroll: true });
  });
  document.querySelector('#download-gallery-image').addEventListener('click', async () => {
    try {
      await download({ ...selected, blob: await store.getBlob(selected) });
      document.querySelector('#image-detail-status').textContent = 'Download started. Check your browser downloads.';
    } catch (error) {
      const status = document.querySelector('#image-detail-status');
      status.textContent = error.message;
      status.classList.add('is-error');
    }
  });
  document.querySelector('#share-gallery-image').addEventListener('click', async () => {
    try {
      await share({ ...selected, blob: await store.getBlob(selected) });
    } catch (error) {
      const status = document.querySelector('#image-detail-status');
      status.textContent = error.message;
      status.classList.add('is-error');
    }
  });
  document.querySelector('#save-gallery-image').addEventListener('click', async () => {
    try {
      await saveToAndroid(await loadSavedImage(selected), document.querySelector('#image-detail-status'));
    } catch (error) {
      const status = document.querySelector('#image-detail-status');
      status.textContent = error.message;
      status.classList.add('is-error');
    }
  });
  document.querySelector('#delete-gallery-image').addEventListener('click', async () => {
    if (!selected || !window.confirm('Delete this image from the local gallery?')) return;
    try {
      await store.remove(selected.id);
      document.querySelector('#image-detail-dialog').close();
      await renderGallery();
    } catch (error) {
      const status = document.querySelector('#image-detail-status');
      status.textContent = error.message;
      status.classList.add('is-error');
    }
  });

  window.ZeroGravityImagesUI = Object.freeze({
    onScreen(screen) {
      if (screen === 'image-generator') refreshProvider();
      if (screen === 'image-gallery') void renderGallery();
    },
    refreshProvider
  });
})();
