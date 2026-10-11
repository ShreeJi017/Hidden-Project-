(function exposePhoneActions() {
  const CAPABILITIES = Object.freeze([
    { id: 'OPEN_INSTALLED_APP', label: 'Open installed app', permission: 'Not required', nativeOnly: true },
    { id: 'OPEN_ANDROID_SETTINGS', label: 'Open Android Settings', permission: 'Not required', nativeOnly: true },
    { id: 'SET_ALARM', label: 'Set an alarm', permission: 'Android clock app', nativeOnly: true, confirmation: true },
    { id: 'SET_TIMER', label: 'Set a timer', permission: 'Android clock app', nativeOnly: true, confirmation: true },
    { id: 'START_CALL', label: 'Place a phone call', permission: 'CALL_PHONE', nativeOnly: true, confirmation: true },
    { id: 'OPEN_SMS_COMPOSER', label: 'Open SMS draft', permission: 'SMS app; you send it', nativeOnly: true, confirmation: true },
    { id: 'CREATE_CALENDAR_EVENT', label: 'Create calendar event draft', permission: 'Calendar app; you save it', nativeOnly: true, confirmation: true },
    { id: 'CONTROL_MEDIA', label: 'Control active media session', permission: 'Notification access may be required', nativeOnly: true },
    { id: 'READ_NOTIFICATIONS', label: 'Read notifications', permission: 'Notification access', nativeOnly: true },
    { id: 'OPEN_NOTIFICATION_ACCESS_SETTINGS', label: 'Grant notification access', permission: 'Explicit Android Settings approval', nativeOnly: true }
  ]);

  function parsePhoneCommand(text, now = new Date()) {
    if (typeof text !== 'string') return null;
    const input = text.trim();
    if (!input || input.length > 2000) return null;

    if (/^(?:open\s+)?android\s+settings$|^open\s+settings$/i.test(input)) {
      return { action: 'OPEN_ANDROID_SETTINGS', arguments: { screen: 'general' }, requiresConfirmation: false };
    }
    const settingsMatch = input.match(/^open\s+(wifi|wi-fi|sound|display|bluetooth|app)\s+settings$/i);
    if (settingsMatch) {
      const screen = settingsMatch[1].toLowerCase().replace('-', '');
      return { action: 'OPEN_ANDROID_SETTINGS', arguments: { screen }, requiresConfirmation: false };
    }
    const appMatch = input.match(/^open\s+(?:the\s+)?(?:app\s+)?(.+?)\s+app$/i)
      || input.match(/^open\s+app\s+(.+)$/i);
    if (appMatch && !/^(?:settings|sms|messages|phone)$/i.test(appMatch[1].trim())) {
      return { action: 'OPEN_INSTALLED_APP', arguments: { appName: appMatch[1].trim() }, requiresConfirmation: false };
    }

    if (/^(?:read|show)\s+(?:my\s+)?notifications$/i.test(input)) {
      return { action: 'READ_NOTIFICATIONS', arguments: {}, requiresConfirmation: false };
    }
    if (/^(?:enable|grant|open)\s+notification\s+access$/i.test(input)) {
      return { action: 'OPEN_NOTIFICATION_ACCESS_SETTINGS', arguments: {}, requiresConfirmation: false };
    }

    const timerMatch = input.match(/^(?:set|start)\s+(?:a\s+)?timer\s+(?:for\s+)?(\d{1,4})\s*(seconds?|secs?|minutes?|mins?|hours?|hrs?)(?:\s+(?:called|named)\s+(.+))?$/i);
    if (timerMatch) {
      const amount = Number(timerMatch[1]);
      const unit = timerMatch[2].toLowerCase();
      const multiplier = unit.startsWith('h') ? 3600 : unit.startsWith('m') ? 60 : 1;
      const seconds = amount * multiplier;
      if (!Number.isSafeInteger(seconds) || seconds < 1 || seconds > 86400) return null;
      return {
        action: 'SET_TIMER',
        arguments: { seconds: String(seconds), label: (timerMatch[3] || 'ZeroGravity timer').trim() },
        requiresConfirmation: true
      };
    }

    const alarmMatch = input.match(/^(?:set|create)\s+(?:an?\s+)?alarm\s+(?:for\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)?(?:\s+(?:called|named)\s+(.+))?$/i);
    if (alarmMatch) {
      let hour = Number(alarmMatch[1]);
      const minute = Number(alarmMatch[2] || '0');
      const meridiem = alarmMatch[3]?.toLowerCase();
      if (minute > 59 || (meridiem && (hour < 1 || hour > 12)) || (!meridiem && hour > 23)) return null;
      if (meridiem) hour = (hour % 12) + (meridiem === 'pm' ? 12 : 0);
      return {
        action: 'SET_ALARM',
        arguments: { hour: String(hour), minute: String(minute), label: (alarmMatch[4] || 'ZeroGravity alarm').trim() },
        requiresConfirmation: true
      };
    }

    const callMatch = input.match(/^(?:call|phone|start a call with)\s+(.+)$/i);
    if (callMatch) {
      const number = callMatch[1].trim();
      if (!/^\+?[\d][\d\s().-]{5,23}$/.test(number) || number.replace(/\D/g, '').length < 7) {
        return {
          action: 'START_CALL',
          arguments: {},
          requiresConfirmation: true,
          validationError: 'For safety, provide a phone number with at least seven digits. Contact-name lookup is not implemented.'
        };
      }
      return {
        action: 'START_CALL',
        arguments: { phoneNumber: number.replace(/[^\d+]/g, '') },
        requiresConfirmation: true
      };
    }

    const smsMatch = input.match(/^(?:text|send (?:a )?text|draft (?:an? )?sms)\s+(?:message\s+)?to\s+(\+?[\d][\d\s().-]{5,23})\s+(?:saying|that|message|:)\s+([\s\S]+)$/i)
      || input.match(/^open\s+(?:the\s+)?(?:sms|messages?)\s+app\s+with\s+(?:recipient\s+)?(\+?[\d][\d\s().-]{5,23})\s+(?:and\s+)?(?:draft(?:\s+message)?|message|saying|:)\s+([\s\S]+)$/i);
    if (smsMatch) {
      const recipient = smsMatch[1].trim();
      const body = smsMatch[2].trim();
      if (recipient.replace(/\D/g, '').length < 7 || !body) return null;
      return {
        action: 'OPEN_SMS_COMPOSER',
        arguments: { recipient: recipient.replace(/[^\d+]/g, ''), body },
        requiresConfirmation: true
      };
    }

    const eventMatch = input.match(/^create calendar event\s+(.+?)\s+on\s+(\d{4}-\d{2}-\d{2})\s+at\s+(\d{1,2}):(\d{2})$/i);
    if (eventMatch) {
      const [, title, date, hourText, minuteText] = eventMatch;
      const hour = Number(hourText);
      const minute = Number(minuteText);
      const [year, month, day] = date.split('-').map(Number);
      if (hour > 23 || minute > 59) return null;
      const start = new Date(year, month - 1, day, hour, minute);
      if (start.getFullYear() !== year || start.getMonth() !== month - 1 || start.getDate() !== day || start.getHours() !== hour || start.getMinutes() !== minute) return null;
      if (start.getTime() < now.getTime()) {
        return { action: 'CREATE_CALENDAR_EVENT', arguments: {}, requiresConfirmation: true, validationError: 'Choose a future date and time for the calendar event.' };
      }
      return {
        action: 'CREATE_CALENDAR_EVENT',
        arguments: { title: title.trim(), beginTimeMillis: String(start.getTime()), endTimeMillis: String(start.getTime() + 3600000) },
        requiresConfirmation: true
      };
    }

    const reminderMatch = input.match(/^remind me to\s+(.+?)\s+in\s+(\d{1,4})\s*(seconds?|secs?|minutes?|mins?|hours?|hrs?)$/i);
    if (reminderMatch) {
      const amount = Number(reminderMatch[2]);
      const unit = reminderMatch[3].toLowerCase();
      const seconds = amount * (unit.startsWith('h') ? 3600 : unit.startsWith('m') ? 60 : 1);
      if (!Number.isSafeInteger(seconds) || seconds < 1 || seconds > 86400) return null;
      return {
        action: 'SET_TIMER',
        arguments: { seconds: String(seconds), label: reminderMatch[1].trim() },
        requiresConfirmation: true
      };
    }

    const plainAppMatch = input.match(/^open\s+(?!android settings$|settings$|wifi settings$|wi-fi settings$|sound settings$|display settings$|bluetooth settings$|app settings$)(.+)$/i);
    if (plainAppMatch && !/^(?:app|the app)$/i.test(plainAppMatch[1].trim())) {
      return { action: 'OPEN_INSTALLED_APP', arguments: { appName: plainAppMatch[1].trim() }, requiresConfirmation: false };
    }

    if (/^(?:play|pause|skip|next|previous|prev)(?:\s+(?:the\s+)?(?:music|media|track|song))?$/i.test(input)) {
      const action = input.toLowerCase().startsWith('play')
        ? 'PLAY'
        : input.toLowerCase().startsWith('pause')
          ? 'PAUSE'
          : /^(?:previous|prev)/i.test(input)
            ? 'PREVIOUS'
            : input.toLowerCase().startsWith('skip')
              ? 'SKIP'
              : 'NEXT';
      return { action: 'CONTROL_MEDIA', arguments: { operation: action }, requiresConfirmation: false };
    }

    return null;
  }

  function createPhoneActionBridge(nativeBridge = window.ZeroGravityNativePhoneActions || null) {
    function isSupported() {
      return Boolean(nativeBridge
        && typeof nativeBridge.execute === 'function'
        && typeof nativeBridge.getCapabilities === 'function');
    }

    function invoke(method, args = []) {
      if (!isSupported()) {
        return Promise.resolve({
          status: 'unsupported',
          message: 'Phone actions require the ZeroGravity Android app. A browser cannot control Android apps or phone features.'
        });
      }
      return new Promise((resolve) => {
        const callbackId = `zg-phone-${Date.now()}-${Math.random().toString(36).slice(2)}`;
        const timeoutId = window.setTimeout(() => {
          delete window.ZeroGravityPhoneActionCallbacks?.[callbackId];
          resolve({ status: 'failure', message: 'Android did not respond to the phone-action request.' });
        }, 15000);
        window.ZeroGravityPhoneActionCallbacks ||= {};
        window.ZeroGravityPhoneActionCallbacks[callbackId] = (result) => {
          window.clearTimeout(timeoutId);
          delete window.ZeroGravityPhoneActionCallbacks[callbackId];
          if (!result || typeof result.status !== 'string' || typeof result.message !== 'string') {
            resolve({ status: 'failure', message: 'Android returned an invalid phone-action result.' });
            return;
          }
          resolve(result);
        };
        try {
          nativeBridge[method](...args, callbackId);
        } catch {
          window.clearTimeout(timeoutId);
          delete window.ZeroGravityPhoneActionCallbacks[callbackId];
          resolve({ status: 'failure', message: 'The Android phone-action bridge failed to respond.' });
        }
      });
    }

    return Object.freeze({
      isSupported,
      getCapabilities: () => invoke('getCapabilities'),
      execute: (action, args) => invoke('execute', [action, JSON.stringify(args || {})])
    });
  }

  const phoneActions = Object.freeze({
    capabilities: CAPABILITIES,
    parse: parsePhoneCommand,
    createBridge: createPhoneActionBridge
  });
  if (typeof window !== 'undefined') window.ZeroGravityPhoneActions = phoneActions;
  if (typeof module !== 'undefined' && module.exports) module.exports = phoneActions;
})();
