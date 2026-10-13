(function exposeVoiceSettings(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.ZeroGravityVoiceSettings = api;
})(typeof window === 'undefined' ? globalThis : window, function createVoiceSettings() {
  const DEFAULT_RATE = 1;
  const MIN_RATE = 0.5;
  const MAX_RATE = 2;

  function normalize(text) {
    return String(text || '').toLowerCase().replace(/[.,!?;:]/g, ' ').replace(/\s+/g, ' ').trim();
  }

  function parseIntent(text, currentRate = DEFAULT_RATE) {
    const value = normalize(text);
    if (!value) return null;
    const followUpMatch = value.match(/\s+(?:and then|and|then)\s+(?=(?:tell me|explain|what|why|how|when|where|who|calculate|summari[sz]e|can you explain)\b)/);
    if (followUpMatch) {
      const splitAt = followUpMatch.index;
      const intent = parseIntent(value.slice(0, splitAt), currentRate);
      return intent
        ? { ...intent, followUp: value.slice(splitAt + followUpMatch[0].length).trim() }
        : null;
    }
    if (/^(?:please )?(?:stop speaking|stop talking|stop speech|stop voice|be quiet|chup(?: ho jao| karo)?)$/.test(value)) {
      return { type: 'stop' };
    }
    if (/\b(?:and then|also|tell me|explain|what|why|how|when|where|who|calculate|summari[sz]e)\b/.test(value)) return null;

    const hasVoice = /\bvoice\b|\bawaaz\b|आवाज़|आवाज/.test(value);
    const hasVoiceIntent = /\b(?:switch|change|use|select|choose|want|speak|talk|go back|return|ab|baat|bolo|karo|kar do)\b|बोलो|बोलिए|करो|करिए/.test(value);
    if (hasVoice && hasVoiceIntent) {
      if (/\b(?:previous|earlier|old) voice\b|\bgo back to (?:the )?(?:last|previous) voice\b|\bwapas\b.*\bvoice\b/.test(value)) {
        return { type: 'voice-previous' };
      }
      if (/\b(?:different|another|next|available) voice\b|\bvoice\b.*\b(?:different|another|next)\b/.test(value)) {
        return { type: 'voice-next' };
      }
      if (/\b(?:male|man|masculine|deeper|deep)\b|पुरुष/.test(value)) return { type: 'voice-gender', gender: 'male' };
      if (/\b(?:female|woman|feminine|softer|soft)\b|महिला|स्त्री/.test(value)) return { type: 'voice-gender', gender: 'female' };
    }

    const hasSpeedIntent = /\b(?:speak|talk|speech|voice|say|speed|increase|decrease|return|slow down|speed up|bolo|bolna)\b|बोलो|बोलिए|बढ़ाओ/.test(value);
    const hasSpeed = /\b(?:faster|slower|slow|fast|speed|quickly|quick|normal|half|twice|double|little|bit|dheere|tez|jaldi)\b|धीरे|तेज़|तेज|आधी|गति/.test(value);
    if (!hasSpeedIntent || !hasSpeed) return null;
    if (/\b(?:normal|usual|default) speed\b|\bback to normal\b|\bnormal(?: speed)?\b|सामान्य गति/.test(value)) {
      return { type: 'speed-set', rate: DEFAULT_RATE };
    }
    if (/\bhalf speed\b|\bhalf as fast\b|आधी गति/.test(value)) return { type: 'speed-set', rate: 0.5 };
    if (/\b(?:twice|double) as fast\b|\bdouble (?:the )?speed\b/.test(value)) {
      return { type: 'speed-set', rate: Math.min(MAX_RATE, Math.max(MIN_RATE, currentRate * 2)) };
    }
    const step = /\b(?:a little|a bit|slightly|thoda|thodi)\b/.test(value) ? 0.1 : 0.2;
    if (/\b(?:faster|speed up|increase|quickly|tez|jaldi)\b|तेज़|तेज/.test(value)) {
      return { type: 'speed-set', rate: Math.min(MAX_RATE, currentRate + step) };
    }
    if (/\b(?:slower|slow down|decrease|dheere)\b|धीरे/.test(value)) {
      return { type: 'speed-set', rate: Math.max(MIN_RATE, currentRate - step) };
    }
    return null;
  }

  function voiceGender(voice) {
    const identity = `${voice?.name || ''} ${voice?.voiceURI || ''}`.toLowerCase();
    if (/\b(?:male|masculine)\b/.test(identity)) return 'male';
    if (/\b(?:female|feminine)\b/.test(identity)) return 'female';
    return '';
  }

  function findGenderVoice(voices, gender) {
    return voices.find((voice) => voiceGender(voice) === gender) || null;
  }

  function findNextVoice(voices, currentVoiceURI) {
    if (!voices.length) return null;
    const currentIndex = voices.findIndex((voice) => voice.voiceURI === currentVoiceURI);
    return voices[(currentIndex + 1 + voices.length) % voices.length];
  }

  function findPreviousVoice(voices, previousVoiceURI) {
    return voices.find((voice) => voice.voiceURI === previousVoiceURI) || null;
  }

  function getVoiceLabel(voice) {
    return `${voice.name}${voice.lang ? ` (${voice.lang})` : ''}`;
  }

  return Object.freeze({
    DEFAULT_RATE,
    MIN_RATE,
    MAX_RATE,
    parseIntent,
    voiceGender,
    findGenderVoice,
    findNextVoice,
    findPreviousVoice,
    getVoiceLabel
  });
});