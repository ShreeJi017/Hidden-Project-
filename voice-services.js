(function exposeVoiceServices() {
  function createSpeechRecognitionService() {
    const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    let recognition = null;
    let currentCallbacks = null;
    let runId = 0;

    function releaseMicrophone(stream) {
      if (!stream) return;
      stream.getTracks().forEach((track) => track.stop());
    }

    function isSupported() {
      return Boolean(
        Recognition
        && navigator.mediaDevices
        && typeof navigator.mediaDevices.getUserMedia === 'function'
      );
    }

    async function start(callbacks = {}) {
      if (!isSupported()) {
        callbacks.onError?.('Voice input is unavailable in this browser. Try a current Chrome browser on Android or type your message.');
        return false;
      }

      if (recognition) stop();
      const currentRun = ++runId;
      currentCallbacks = callbacks;
      callbacks.onState?.('requesting');

      let permissionStream;
      try {
        if (!window.isSecureContext) {
          throw new Error('Microphone access requires HTTPS or localhost. Open this app from a secure connection.');
        }
        permissionStream = await navigator.mediaDevices.getUserMedia({ audio: true });
        if (currentRun !== runId) {
          releaseMicrophone(permissionStream);
          return false;
        }

        // Permission is requested only after a user action; the browser recognizer manages its own capture session.
        releaseMicrophone(permissionStream);
        permissionStream = null;

        const instance = new Recognition();
        instance.lang = navigator.language || 'en-US';
        instance.continuous = false;
        instance.interimResults = true;
        instance.maxAlternatives = 1;
        recognition = instance;

        instance.onstart = () => {
          if (currentRun === runId) callbacks.onState?.('listening');
        };
        instance.onresult = (event) => {
          if (currentRun !== runId) return;
          let finalTranscript = '';
          let interimTranscript = '';
          for (let index = event.resultIndex; index < event.results.length; index += 1) {
            const result = event.results[index];
            const text = result[0]?.transcript || '';
            if (result.isFinal) finalTranscript += text;
            else interimTranscript += text;
          }
          callbacks.onTranscript?.({
            finalTranscript: finalTranscript.trim(),
            interimTranscript: interimTranscript.trim()
          });
        };
        instance.onerror = (event) => {
          if (currentRun !== runId || event.error === 'aborted' || event.error === 'no-speech') return;
          const message = event.error === 'not-allowed' || event.error === 'service-not-allowed'
            ? 'Microphone permission was denied. Allow microphone access in your browser settings and try again.'
            : event.error === 'audio-capture'
              ? 'No microphone is available. Check your device microphone and try again.'
              : 'Voice recognition stopped unexpectedly. You can edit the text or type a message.';
          callbacks.onError?.(message);
        };
        instance.onend = () => {
          if (currentRun !== runId) return;
          recognition = null;
          currentCallbacks = null;
          instance.onend = null;
          instance.onerror = null;
          instance.onresult = null;
          instance.onstart = null;
          callbacks.onState?.('idle');
          callbacks.onEnd?.({ cancelled: false });
        };
        instance.start();
        return true;
      } catch (error) {
        releaseMicrophone(permissionStream);
        if (currentRun !== runId) return false;
        currentCallbacks = null;
        recognition = null;
        callbacks.onState?.('idle');
        const message = error.name === 'NotAllowedError' || error.name === 'SecurityError'
          ? 'Microphone permission was denied. Allow microphone access in your browser settings and try again.'
          : error.name === 'NotFoundError'
            ? 'No microphone was found. Connect or enable a microphone and try again.'
            : error.message || 'Could not start voice recognition. You can type your message instead.';
        callbacks.onError?.(message);
        return false;
      }
    }

    function stop() {
      runId += 1;
      const current = recognition;
      const callbacks = currentCallbacks;
      recognition = null;
      currentCallbacks = null;
      if (current) {
        current.onend = null;
        current.onerror = null;
        current.onresult = null;
        current.onstart = null;
        try {
          current.abort();
        } catch {
          // The browser may already have ended recognition.
        }
      }
      callbacks?.onState?.('idle');
      callbacks?.onEnd?.({ cancelled: true });
    }

    return Object.freeze({ isSupported, start, stop, get isListening() { return Boolean(recognition); } });
  }

  function createSpeechSynthesisService() {
    const synthesis = window.speechSynthesis;
    let utteranceId = 0;
    let currentCallbacks = null;

    function isSupported() {
      return Boolean(
        synthesis
        && typeof synthesis.speak === 'function'
        && typeof synthesis.cancel === 'function'
        && typeof window.SpeechSynthesisUtterance === 'function'
      );
    }

    function getVoices() {
      return isSupported() && typeof synthesis.getVoices === 'function' ? synthesis.getVoices() : [];
    }

    function speak(text, options = {}, callbacks = {}) {
      if (!isSupported()) throw new Error('Spoken playback is unavailable in this browser. You can still read the response on screen.');
      if (typeof text !== 'string' || !text.trim()) return false;

      stop();
      const currentId = ++utteranceId;
      const utterance = new window.SpeechSynthesisUtterance(text);
      const selectedVoice = getVoices().find((voice) => voice.voiceURI === options.voiceURI);
      if (selectedVoice) utterance.voice = selectedVoice;
      utterance.rate = Math.max(0.7, Math.min(1.3, Number(options.rate) || 1));
      currentCallbacks = callbacks;

      utterance.onstart = () => {
        if (currentId === utteranceId) callbacks.onStart?.();
      };
      utterance.onend = () => {
        if (currentId !== utteranceId) return;
        currentCallbacks = null;
        callbacks.onEnd?.();
      };
      utterance.onerror = (event) => {
        if (currentId !== utteranceId || event.error === 'canceled' || event.error === 'interrupted') return;
        currentCallbacks = null;
        callbacks.onError?.('Speech playback stopped. The response is still available to read.');
      };

      try {
        synthesis.speak(utterance);
        return true;
      } catch {
        currentCallbacks = null;
        throw new Error('Could not start speech playback. The response is still available to read.');
      }
    }

    function stop() {
      utteranceId += 1;
      currentCallbacks = null;
      if (isSupported()) synthesis.cancel();
    }

    return Object.freeze({ isSupported, getVoices, speak, stop });
  }

  const listeningModes = Object.freeze({
    DISABLED: 'disabled',
    PUSH_TO_TALK: 'push-to-talk',
    WAKE_WORD: 'wake-word-listening',
    ACTIVE_CONVERSATION: 'active-conversation'
  });

  function createListeningModeManager() {
    let mode = listeningModes.DISABLED;
    const listeners = new Set();

    function setMode(nextMode, detail = {}) {
      if (!Object.values(listeningModes).includes(nextMode)) {
        throw new Error(`Unknown listening mode: ${nextMode}`);
      }
      if (mode === nextMode) return;
      const previousMode = mode;
      mode = nextMode;
      listeners.forEach((listener) => listener(mode, previousMode, detail));
    }

    function subscribe(listener) {
      if (typeof listener !== 'function') throw new TypeError('A listening-mode listener must be a function.');
      listeners.add(listener);
      return () => listeners.delete(listener);
    }

    return Object.freeze({
      modes: listeningModes,
      getMode: () => mode,
      setMode,
      subscribe
    });
  }

  function createWakeWordService(nativeEngine = window.ZeroGravityNativeWakeWord) {
    let listening = false;
    let callbacks = null;

    function isSupported() {
      if (!nativeEngine
        || typeof nativeEngine.start !== 'function'
        || typeof nativeEngine.stop !== 'function') return false;
      try {
        return typeof nativeEngine.isAvailable === 'function'
          ? nativeEngine.isAvailable() === true
          : nativeEngine.isAvailable === true;
      } catch {
        return false;
      }
    }

    function getCapabilities() {
      if (!isSupported()) {
        return Object.freeze({ available: false, source: 'none', sensitivity: false, batteryAware: false });
      }
      let capabilities = {};
      try {
        if (typeof nativeEngine.getCapabilities === 'function') {
          capabilities = nativeEngine.getCapabilities() || {};
        }
      } catch {
        capabilities = {};
      }
      return Object.freeze({
        available: true,
        source: 'native',
        sensitivity: capabilities?.sensitivity === true,
        batteryAware: capabilities?.batteryAware === true
      });
    }

    async function getPermissionStatus() {
      if (isSupported() && typeof nativeEngine.getPermissionStatus === 'function') {
        try {
          return await nativeEngine.getPermissionStatus();
        } catch {
          return 'unknown';
        }
      }
      if (!navigator.permissions || typeof navigator.permissions.query !== 'function') return 'unknown';
      try {
        const permission = await navigator.permissions.query({ name: 'microphone' });
        return permission.state;
      } catch {
        return 'unknown';
      }
    }

    async function start(options = {}, nextCallbacks = {}) {
      if (!isSupported()) {
        nextCallbacks.onError?.('Wake-word listening needs a supported local detector or native Android service. Browser speech recognition is not a reliable wake-word detector. Push-to-talk remains available.');
        return false;
      }
      if (listening) await stop();
      const startCallbacks = nextCallbacks;
      callbacks = startCallbacks;
      let failed = false;
      try {
        const result = await nativeEngine.start({
          phrase: options.phrase,
          sensitivity: options.sensitivity,
          onWakeWord: (detail) => {
            if (callbacks === startCallbacks) startCallbacks.onWakeWord?.(detail);
          },
          onState: (state) => {
            if (callbacks !== startCallbacks) return;
            if (state === 'idle') listening = false;
            startCallbacks.onState?.(state);
          },
          onError: (error) => {
            if (callbacks !== startCallbacks) return;
            failed = true;
            listening = false;
            callbacks = null;
            const message = error instanceof Error ? error.message : String(error);
            startCallbacks.onError?.(message);
            Promise.resolve()
              .then(() => nativeEngine.stop())
              .catch((stopError) => startCallbacks.onError?.(
                `${message} The engine also reported a stop error: ${stopError?.message || 'unknown error'}.`
              ));
          }
        });
        if (result === false || failed || callbacks !== startCallbacks) {
          callbacks = null;
          if (!failed) {
            try {
              await nativeEngine.stop();
            } catch (stopError) {
              startCallbacks.onError?.(`The wake-word engine did not start and could not confirm cleanup: ${stopError?.message || 'unknown error'}.`);
            }
          }
          if (result === false && !failed) {
            startCallbacks.onError?.('The native wake-word engine could not start listening.');
          }
          return false;
        }
        listening = true;
        startCallbacks.onState?.('listening');
        return true;
      } catch (error) {
        callbacks = null;
        listening = false;
        const message = error?.message || 'The native wake-word service could not start.';
        startCallbacks.onError?.(message);
        try {
          await nativeEngine.stop();
        } catch (stopError) {
          startCallbacks.onError?.(`${message} The engine also reported a stop error: ${stopError?.message || 'unknown error'}.`);
        }
        return false;
      }
    }

    async function stop() {
      const previousCallbacks = callbacks;
      callbacks = null;
      listening = false;
      if (!isSupported()) return;
      try {
        await nativeEngine.stop();
        previousCallbacks?.onState?.('idle');
      } catch (error) {
        previousCallbacks?.onError?.(error?.message || 'The wake-word service could not stop cleanly.');
        throw error;
      }
    }

    return Object.freeze({
      isSupported,
      getCapabilities,
      getPermissionStatus,
      start,
      stop,
      get isListening() { return listening; }
    });
  }

  window.ZeroGravityVoice = Object.freeze({
    createSpeechRecognitionService,
    createSpeechSynthesisService,
    createListeningModeManager,
    createWakeWordService
  });
})();
