(function initializeMemoryUI() {
  const PREFERENCES_KEY = 'zerogravity.memory.preferences';
  const store = window.ZeroGravityMemory.createMemoryStore();
  const elements = {};
  const defaults = Object.freeze({
    memoryEnabled: true,
    personalizationEnabled: false,
    calmMode: false,
    includeSelectedOnline: false,
    language: '',
    responseLength: 'balanced'
  });
  let preferences = { ...defaults };
  let records = [];
  let storageStatus = 'Browser-local storage; not encrypted.';
  let clearLegacyMemory = async () => {};

  async function clearAllSavedMemory({ resetPersonalization = false } = {}) {
    await store.clear();
    await clearLegacyMemory();
    if (resetPersonalization) {
      preferences = { ...defaults, memoryEnabled: preferences.memoryEnabled };
      if (!savePreferences()) throw new Error('Saved memories were cleared, but personalization settings could not be reset.');
      updatePreferenceControls();
    }
    await refreshList();
  }

  function readPreferences() {
    try {
      const raw = localStorage.getItem(PREFERENCES_KEY);
      if (!raw) return { ...defaults };
      const parsed = JSON.parse(raw);
      return {
        memoryEnabled: parsed.memoryEnabled !== false,
        personalizationEnabled: parsed.personalizationEnabled === true,
        calmMode: parsed.calmMode === true,
        includeSelectedOnline: parsed.includeSelectedOnline === true,
        language: typeof parsed.language === 'string'
          && !window.ZeroGravityMemory.containsSecret(parsed.language)
          && !window.ZeroGravityMemory.requiresSensitiveConsent(parsed.language)
          ? parsed.language.slice(0, 80)
          : '',
        responseLength: ['brief', 'balanced', 'detailed'].includes(parsed.responseLength) ? parsed.responseLength : 'balanced'
      };
    } catch {
      storageStatus = 'Personalization settings are unreadable. Check browser storage before changing them.';
      return { ...defaults };
    }
  }

  function savePreferences() {
    try {
      localStorage.setItem(PREFERENCES_KEY, JSON.stringify(preferences));
      return true;
    } catch {
      setStatus('memory-settings-status', 'Personalization settings could not be saved in this browser.', 'error');
      return false;
    }
  }

  function setStatus(id, message, tone = '') {
    const element = elements[id] || document.getElementById(id);
    if (!element) return;
    element.textContent = message;
    element.classList.toggle('is-error', tone === 'error');
    element.classList.toggle('is-success', tone === 'success');
  }

  function categoryFor(content) {
    if (/\b(?:speak|reply|respond|write|language|hindi|english)\b/i.test(content)) return 'language';
    if (/\b(?:short|brief|detailed|concise|length)\b/i.test(content)) return 'response-length';
    if (/\b(?:tone|gentle|calm|formal|casual|communication style)\b/i.test(content)) return 'communication-style';
    if (/\b(?:project|building|working on|ongoing)\b/i.test(content)) return 'project';
    if (/\b(?:goal|aim|plan to|want to achieve)\b/i.test(content)) return 'goal';
    if (/\b(?:usually|often|frequently|every day|workflow|shortcut)\b/i.test(content)) return 'feature';
    if (/^(?:i prefer|my preference is)\b/i.test(content)) return 'preference';
    return 'context';
  }

  function trimCommand(text, pattern) {
    const match = text.match(pattern);
    return match?.[1]?.trim().replace(/^["“]|["”]$/g, '').trim() || '';
  }

  async function refreshList() {
    records = await store.list();
    renderList();
    elements['memory-count'].textContent = `${records.length} saved ${records.length === 1 ? 'memory' : 'memories'}`;
    elements['memory-storage-status'].textContent = `Storage · ${storageStatus} · Last updated ${records[0]?.updatedAt ? new Date(records[0].updatedAt).toLocaleString() : 'not yet saved'}`;
    elements['memory-list-empty'].hidden = records.length > 0;
  }

  function categoryLabel(category) {
    return category.replaceAll('-', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
  }

  function renderList() {
    const list = elements['memory-list'];
    const query = elements['memory-search'].value.trim().toLocaleLowerCase();
    list.replaceChildren();
    records.filter((record) => (
      !query || `${record.content} ${record.category}`.toLocaleLowerCase().includes(query)
    )).forEach((record) => {
      const article = document.createElement('article');
      article.className = 'memory-card';
      article.dataset.memoryId = record.id;
      const detail = document.createElement('div');
      detail.className = 'memory-card-content';
      const label = document.createElement('span');
      label.className = 'memory-category';
      label.textContent = categoryLabel(record.category);
      const content = document.createElement('p');
      content.textContent = record.content;
      const timestamp = document.createElement('time');
      timestamp.dateTime = record.updatedAt;
      timestamp.textContent = `Updated ${new Date(record.updatedAt).toLocaleString()}${record.expiresAt ? ` · Expires ${new Date(record.expiresAt).toLocaleDateString()}` : ''}`;
      detail.append(label, content, timestamp);
      const actions = document.createElement('div');
      actions.className = 'memory-card-actions';
      const onlineLabel = document.createElement('label');
      onlineLabel.className = 'memory-online-choice';
      const onlineInput = document.createElement('input');
      onlineInput.type = 'checkbox';
      onlineInput.checked = record.allowOnline;
      onlineInput.setAttribute('aria-label', `Allow this memory online: ${record.content.slice(0, 70)}`);
      onlineInput.addEventListener('change', async () => {
        try {
          await store.update(record.id, { allowOnline: onlineInput.checked });
          await refreshList();
          setStatus('memory-settings-status', onlineInput.checked
            ? 'Memory marked as eligible for online use. The separate online-sharing toggle must also be enabled.'
            : 'Memory will not be included in online AI requests.', 'success');
        } catch (error) {
          setStatus('memory-settings-status', error.message, 'error');
          onlineInput.checked = record.allowOnline;
        }
      });
      onlineLabel.append(onlineInput, document.createTextNode('Share eligible'));
      const edit = document.createElement('button');
      edit.className = 'secondary-button';
      edit.type = 'button';
      edit.textContent = 'Edit';
      edit.setAttribute('aria-label', `Edit memory: ${record.content.slice(0, 70)}`);
      edit.addEventListener('click', () => openEditor(record));
      const remove = document.createElement('button');
      remove.className = 'secondary-button';
      remove.type = 'button';
      remove.textContent = 'Delete';
      remove.setAttribute('aria-label', `Delete memory: ${record.content.slice(0, 70)}`);
      remove.addEventListener('click', async () => {
        if (!window.confirm('Delete this saved memory? This cannot be undone.')) return;
        try {
          await store.remove(record.id);
          await refreshList();
          setStatus('memory-settings-status', 'Memory deleted from this device.', 'success');
        } catch (error) {
          setStatus('memory-settings-status', error.message, 'error');
        }
      });
      actions.append(onlineLabel, edit, remove);
      article.append(detail, actions);
      list.append(article);
    });
    elements['memory-list-empty'].hidden = list.childElementCount > 0;
  }

  function openEditor(record = null) {
    elements['memory-edit-id'].value = record?.id || '';
    elements['memory-edit-content'].value = record?.content || '';
    elements['memory-edit-category'].value = record?.category || 'context';
    elements['memory-edit-expiration'].value = record?.expiresAt ? record.expiresAt.slice(0, 10) : '';
    elements['memory-edit-online'].checked = record?.allowOnline === true;
    elements['memory-edit-title'].textContent = record ? 'Edit saved memory' : 'Add saved memory';
    elements['memory-edit-dialog'].showModal();
    elements['memory-edit-content'].focus();
  }

  async function saveEditor(event) {
    event.preventDefault();
    const id = elements['memory-edit-id'].value;
    const content = elements['memory-edit-content'].value.trim();
    const sensitiveConsent = !window.ZeroGravityMemory.requiresSensitiveConsent(content)
      || window.confirm('This may contain sensitive personal information. Save it to this device anyway? It will not be shared online unless you explicitly enable sharing for this memory and the global online-memory setting.');
    if (!sensitiveConsent) return;
    const expiresAt = elements['memory-edit-expiration'].value
      ? new Date(`${elements['memory-edit-expiration'].value}T23:59:59`).toISOString()
      : null;
    try {
      if (id) {
        const result = await store.update(id, {
          content,
          category: elements['memory-edit-category'].value,
          expiresAt,
          allowOnline: elements['memory-edit-online'].checked,
          sensitiveConsent
        });
        setStatus('memory-settings-status', result.replaced.length
          ? `Memory updated. Replaced ${result.replaced.length} older conflicting preference.`
          : 'Memory updated.', 'success');
      } else {
        const result = await store.add({
          content,
          category: elements['memory-edit-category'].value,
          expiresAt,
          allowOnline: elements['memory-edit-online'].checked,
          sensitiveConsent
        });
        setStatus('memory-settings-status', result.duplicate
          ? 'This memory already exists; no duplicate was saved.'
          : result.replaced.length
            ? `Memory saved. Replaced ${result.replaced.length} older conflicting preference.`
            : 'Memory saved on this device.', 'success');
      }
      elements['memory-edit-dialog'].close();
      await refreshList();
    } catch (error) {
      setStatus('memory-settings-status', error.message, 'error');
    }
  }

  async function handleMemoryCommand(text, { privateConversation = false } = {}) {
    const value = text.trim();
    const normalized = value.toLocaleLowerCase().replace(/[.!?]+$/g, '').trim();
    if (/^(?:forget everything you remember about me|forget everything|clear all (?:saved )?memories|delete all (?:saved )?memories)$/.test(normalized)) {
      if (!window.confirm('Permanently delete all saved memories and personalization context from this device?')) {
        return { handled: true, source: 'memory', content: 'No memories were deleted.' };
      }
      await clearAllSavedMemory({ resetPersonalization: true });
      setStatus('memory-settings-status', 'All saved memories and personalization settings were cleared from this device.', 'success');
      return { handled: true, source: 'memory', clearAll: true, content: 'All saved memories and personalization settings were cleared from this device.' };
    }

    if (/^(?:what do you remember(?: about me)?|what do you know about me|show my saved memories|list my memories)$/.test(normalized)) {
      if (privateConversation) {
        return { handled: true, source: 'memory', content: 'Private mode is on, so I will not look up saved memories for this conversation.' };
      }
      if (!preferences.memoryEnabled) {
        return { handled: true, source: 'memory', content: 'Memory is turned off. Saved memories are not used until you enable Memory in Modules → Memory & Personalization.' };
      }
      const saved = await store.list();
      return {
        handled: true,
        source: 'memory',
        content: saved.length
          ? `I have ${saved.length} saved ${saved.length === 1 ? 'memory' : 'memories'} on this device:\n${saved.map((memory, index) => `${index + 1}. ${memory.content} (${categoryLabel(memory.category)})`).join('\n')}`
          : 'I do not have any saved memories about you.'
      };
    }

    if (/^(?:read local memory|show local memory|what is in local memory)$/.test(normalized)) {
      if (privateConversation || !preferences.memoryEnabled) {
        return {
          handled: true,
          source: 'memory',
          content: privateConversation
            ? 'Private mode is on, so I will not look up saved memories for this conversation.'
            : 'Memory is turned off, so saved memories are not used.'
        };
      }
      return null;
    }

    const forget = trimCommand(value, /^(?:forget|delete memory|remove from memory)(?: this| that)?\s*[:,-]\s*(.+)$/i)
      || trimCommand(value, /^(?:forget|delete memory|remove from memory)\s+(.+)$/i);
    if (forget) {
      const matches = await store.removeMatching(forget);
      await refreshList();
      return {
        handled: true,
        source: 'memory',
        content: matches.length
          ? `Forgot ${matches.length} matching ${matches.length === 1 ? 'memory' : 'memories'} from this device.`
          : `I could not find a saved memory matching “${forget}”.`
      };
    }
    if (/^(?:forget this|forget that|delete this memory)$/.test(normalized)) {
      return {
        handled: true,
        source: 'memory',
        content: 'Tell me which memory to forget (for example, “Forget: I prefer short replies”), or delete it from Memory & Personalization.'
      };
    }

    const remembered = trimCommand(value, /^(?:remember this|remember(?: that)?|save this to memory|save to memory|save to local memory)\s*(?:[:,-]\s*)?(.*)$/i);
    if (remembered || /^(?:remember this|remember|save this to memory|save to memory|save to local memory)$/.test(normalized)) {
      if (privateConversation) {
        return { handled: true, source: 'memory', content: 'This is a private conversation. I will not add anything to persistent memory here.' };
      }
      if (!preferences.memoryEnabled) {
        return { handled: true, source: 'memory', content: 'Memory is turned off, so nothing was saved. Enable Memory in Modules → Memory & Personalization to save approved details.' };
      }
      if (!remembered) {
        return { handled: true, source: 'memory', content: 'Add the detail after “Remember this: …” so I know exactly what you want saved.' };
      }
      const sensitiveConsent = !window.ZeroGravityMemory.requiresSensitiveConsent(remembered)
        || window.confirm('This may contain sensitive personal information. Save it to this device anyway? It will not be shared online unless you explicitly opt in.');
      if (!sensitiveConsent) {
        return { handled: true, source: 'memory', content: 'I did not save that information.' };
      }
      const result = await store.add({
        content: remembered,
        category: categoryFor(remembered),
        sensitiveConsent
      });
      await refreshList();
      const message = result.duplicate
        ? 'That information is already saved; I did not create a duplicate.'
        : `Saved to local memory: ${result.memory.content}${result.replaced.length ? ` Replaced ${result.replaced.length} older conflicting preference.` : ''}`;
      setStatus('memory-settings-status', message, 'success');
      return { handled: true, source: 'memory', content: message };
    }
    return null;
  }

  async function prepareOnlineContext(privateConversation) {
    if (privateConversation
      || !preferences.memoryEnabled
      || !preferences.personalizationEnabled
      || !preferences.includeSelectedOnline) return null;
    const guidance = [];
    if (preferences.language) guidance.push(`Preferred response language: ${preferences.language}.`);
    if (preferences.responseLength !== 'balanced') {
      guidance.push(`Preferred response length: ${preferences.responseLength}.`);
    }
    if (preferences.calmMode) {
      guidance.push('Use Calm Mode: gentle, clear, non-judgmental language, short sentences, and one manageable step at a time. Do not diagnose.');
    }
    const selected = (await store.list()).filter((memory) => memory.allowOnline);
    if (!guidance.length && !selected.length) return null;
    const sections = [];
    if (guidance.length) sections.push(`User-selected communication preferences (never override the current request or safety requirements):\n${guidance.join('\n')}`);
    if (selected.length) {
      sections.push(`User-approved saved memories (shared because online personalization sharing is enabled):\n${selected.map((memory) => `- ${memory.content}`).join('\n')}`);
    }
    return {
      instruction: sections.join('\n\n'),
      influence: selected.map((memory) => ({ id: memory.id, category: memory.category, content: memory.content })),
      sharedMemoryCount: selected.length
    };
  }

  function updatePreferenceControls() {
    elements['memory-enabled'].checked = preferences.memoryEnabled;
    elements['personalization-enabled'].checked = preferences.personalizationEnabled;
    elements['calm-mode-enabled'].checked = preferences.calmMode;
    elements['online-memory-enabled'].checked = preferences.includeSelectedOnline;
    elements['personalization-language'].value = preferences.language;
    elements['personalization-length'].value = preferences.responseLength;
    const onlineSettings = preferences.includeSelectedOnline
      ? 'Online personalization sharing is enabled; only individually selected memories are included.'
      : 'No personalization preferences or saved memories are included in online AI requests.';
    elements['memory-privacy-status'].textContent = `${onlineSettings} Personalization preferences are also used only when enabled.`;
  }

  function bindPreference(input, key, transform = (value) => value) {
    input.addEventListener('change', () => {
      const nextValue = transform(input.type === 'checkbox' ? input.checked : input.value);
      if (key === 'language' && window.ZeroGravityMemory.containsSecret(nextValue)) {
        input.value = preferences.language;
        setStatus('memory-settings-status', 'Credentials and secrets cannot be saved as response preferences.', 'error');
        return;
      }
      if (key === 'language'
        && window.ZeroGravityMemory.requiresSensitiveConsent(nextValue)
        && !window.confirm('This may be sensitive personal information. Save it as a response preference on this device?')) {
        input.value = preferences.language;
        return;
      }
      preferences[key] = nextValue;
      savePreferences();
      updatePreferenceControls();
      setStatus('memory-settings-status', 'Memory and personalization settings updated.', 'success');
    });
  }

  async function initialize() {
    elements['memory-list'] = document.querySelector('#memory-list');
    [
      'memory-search', 'memory-count', 'memory-storage-status', 'memory-list-empty',
      'memory-settings-status', 'memory-edit-dialog', 'memory-edit-id', 'memory-edit-title',
      'memory-edit-content', 'memory-edit-category', 'memory-edit-expiration',
      'memory-edit-online', 'memory-export', 'memory-import', 'memory-import-file',
      'memory-clear-all', 'memory-add', 'memory-enabled', 'personalization-enabled',
      'calm-mode-enabled', 'online-memory-enabled', 'personalization-language',
      'personalization-length', 'memory-privacy-status', 'memory-close-editor', 'reset-personalization'
    ].forEach((id) => { elements[id] = document.getElementById(id); });
    preferences = readPreferences();
    updatePreferenceControls();
    elements['memory-search'].addEventListener('input', renderList);
    elements['memory-add'].addEventListener('click', () => openEditor());
    elements['memory-close-editor'].addEventListener('click', () => elements['memory-edit-dialog'].close());
    document.querySelector('#memory-edit-form').addEventListener('submit', saveEditor);
    bindPreference(elements['memory-enabled'], 'memoryEnabled');
    bindPreference(elements['personalization-enabled'], 'personalizationEnabled');
    bindPreference(elements['calm-mode-enabled'], 'calmMode');
    bindPreference(elements['online-memory-enabled'], 'includeSelectedOnline');
    bindPreference(elements['personalization-language'], 'language');
    bindPreference(elements['personalization-length'], 'responseLength');
    elements['reset-personalization'].addEventListener('click', async () => {
      preferences = { ...preferences, personalizationEnabled: false, calmMode: false, includeSelectedOnline: false, language: '', responseLength: 'balanced' };
      const settingsSaved = savePreferences();
      updatePreferenceControls();
      try {
        const saved = await store.list();
        for (const memory of saved) {
          if (memory.allowOnline) await store.update(memory.id, { allowOnline: false });
        }
        await refreshList();
        setStatus('memory-settings-status', settingsSaved
          ? 'Personalization, language, Calm Mode, and online-sharing approvals were reset. Saved memories were kept.'
          : 'Sharing approvals were reset, but personalization settings could not be saved in this browser.', settingsSaved ? 'success' : 'error');
      } catch (error) {
        setStatus('memory-settings-status', `Personalization settings reset, but some memory-sharing approvals could not be cleared: ${error.message}`, 'error');
      }
    });
    elements['memory-clear-all'].addEventListener('click', async () => {
      if (!window.confirm('Permanently delete every saved memory, including the legacy local note, from this device? This cannot be undone.')) return;
      try {
        await clearAllSavedMemory();
        setStatus('memory-settings-status', 'All saved memories, including the legacy local note, were deleted.', 'success');
      } catch (error) {
        setStatus('memory-settings-status', error.message, 'error');
      }
    });
    elements['memory-export'].addEventListener('click', async () => {
      try {
        const blob = new Blob([await store.exportData()], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = 'zerogravity-memory-export.json';
        link.click();
        URL.revokeObjectURL(url);
        setStatus('memory-settings-status', 'Memory export downloaded as JSON.', 'success');
      } catch (error) {
        setStatus('memory-settings-status', error.message, 'error');
      }
    });
    elements['memory-import'].addEventListener('click', () => elements['memory-import-file'].click());
    elements['memory-import-file'].addEventListener('change', async () => {
      const file = elements['memory-import-file'].files?.[0];
      if (!file) return;
      if (file.size > window.ZeroGravityMemory.maxImportBytes) {
        setStatus('memory-settings-status', 'Memory import must be no larger than 256 KB.', 'error');
        elements['memory-import-file'].value = '';
        return;
      }
      if (!window.confirm('Importing replaces the saved memories on this device. Sensitive details need your consent, and online-sharing approvals are reset to off. Continue?')) {
        elements['memory-import-file'].value = '';
        return;
      }
      try {
        const count = await store.importData(await file.text(), { sensitiveConsent: true });
        await refreshList();
        setStatus('memory-settings-status', `Imported ${count} validated ${count === 1 ? 'memory' : 'memories'}.`, 'success');
      } catch (error) {
        setStatus('memory-settings-status', error.message, 'error');
      } finally {
        elements['memory-import-file'].value = '';
      }
    });
    try {
      await refreshList();
      if (storageStatus !== 'Browser-local storage; not encrypted.') {
        setStatus('memory-settings-status', storageStatus, 'error');
      }
    } catch (error) {
      storageStatus = error.message;
      setStatus('memory-settings-status', error.message, 'error');
      elements['memory-storage-status'].textContent = `Storage error · ${error.message}`;
    }
  }

  document.addEventListener('DOMContentLoaded', initialize, { once: true });
  window.ZeroGravityMemoryUI = Object.freeze({
    handleChatQuery: handleMemoryCommand,
    prepareOnlineContext,
    isCalmMode: () => preferences.calmMode,
    getPreferences: () => ({ ...preferences }),
    getVoiceRate(rate) {
      return preferences.calmMode ? Math.min(rate, 0.85) : rate;
    },
    async list() {
      return store.list();
    },
    setLegacyMemoryClearHandler(handler) {
      if (typeof handler !== 'function') throw new Error('The legacy memory clear handler must be a function.');
      clearLegacyMemory = handler;
    }
  });
})();
