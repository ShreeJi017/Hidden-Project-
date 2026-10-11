const assert = require('node:assert/strict');
const { afterEach, test } = require('node:test');
const phoneActions = require('../phone-actions.js');

const originalWindow = global.window;

afterEach(() => {
  if (originalWindow === undefined) delete global.window;
  else global.window = originalWindow;
});

test('recognizes supported Android commands and confirmation requirements', () => {
  assert.equal(phoneActions.parse('open android settings').action, 'OPEN_ANDROID_SETTINGS');
  assert.equal(phoneActions.parse('open Calendar app').arguments.appName, 'Calendar');
  assert.equal(phoneActions.parse('open Maps').arguments.appName, 'Maps');
  assert.equal(phoneActions.parse('set a timer for 5 minutes').arguments.seconds, '300');
  assert.equal(phoneActions.parse('call +1 (555) 123-4567').requiresConfirmation, true);
  assert.equal(phoneActions.parse('text to 5551234567 saying Hello').action, 'OPEN_SMS_COMPOSER');
  assert.equal(phoneActions.parse('open SMS app with recipient 5551234567 and draft message Hello').action, 'OPEN_SMS_COMPOSER');
  assert.equal(phoneActions.parse('create calendar event Dentist on 2030-01-02 at 13:30').action, 'CREATE_CALENDAR_EVENT');
  assert.equal(phoneActions.parse('read my notifications').action, 'READ_NOTIFICATIONS');
  assert.equal(phoneActions.parse('pause music').arguments.operation, 'PAUSE');
});

test('rejects unsafe or invalid action inputs without creating a native call', () => {
  assert.equal(phoneActions.parse('set a timer for 0 minutes'), null);
  assert.equal(phoneActions.parse('call the dentist').validationError.includes('Contact-name lookup'), true);
  assert.equal(phoneActions.parse('create calendar event Past on 2000-01-01 at 12:00').validationError.includes('future'), true);
  assert.equal(phoneActions.parse(`open ${'a'.repeat(2001)} app`), null);
  assert.equal(phoneActions.parse('send a text to 5551234567 saying'), null);
});

test('reports unsupported browser actions without pretending success', async () => {
  const bridge = phoneActions.createBridge(null);
  const result = await bridge.execute('OPEN_ANDROID_SETTINGS', {});
  assert.equal(result.status, 'unsupported');
  assert.match(result.message, /browser cannot control Android/);
});

test('forwards native permission and confirmation outcomes unchanged', async () => {
  global.window = { setTimeout, clearTimeout, ZeroGravityPhoneActionCallbacks: {} };
  const nativeBridge = {
    getCapabilities(callbackId) {
      window.ZeroGravityPhoneActionCallbacks[callbackId]({
        status: 'success',
        message: 'Capabilities loaded',
        capabilities: [{ id: 'READ_NOTIFICATIONS', available: false }]
      });
    },
    execute(action, args, callbackId) {
      if (action === 'READ_NOTIFICATIONS') {
        assert.deepEqual(JSON.parse(args), {});
        window.ZeroGravityPhoneActionCallbacks[callbackId]({
          status: 'permission-required',
          message: 'Grant access in Android Settings.'
        });
        return;
      }
      window.ZeroGravityPhoneActionCallbacks[callbackId]({
        status: 'confirmation-required',
        message: 'Confirm the sensitive action.'
      });
    }
  };
  const bridge = phoneActions.createBridge(nativeBridge);
  assert.equal((await bridge.getCapabilities()).capabilities[0].available, false);
  assert.equal((await bridge.execute('READ_NOTIFICATIONS', {})).status, 'permission-required');
  assert.equal((await bridge.execute('START_CALL', { phoneNumber: '+15551234567' })).status, 'confirmation-required');
});

test('preserves native unsupported-action results', async () => {
  global.window = { setTimeout, clearTimeout, ZeroGravityPhoneActionCallbacks: {} };
  const nativeBridge = {
    getCapabilities() {},
    execute(action, args, callbackId) {
      window.ZeroGravityPhoneActionCallbacks[callbackId]({
        status: 'unsupported',
        message: 'No active media session supports this action.'
      });
    }
  };
  const result = await phoneActions.createBridge(nativeBridge).execute('CONTROL_MEDIA', { operation: 'NEXT' });
  assert.equal(result.status, 'unsupported');
  assert.match(result.message, /No active media session/);
});

test('converts bridge exceptions and malformed native responses to failures', async () => {
  global.window = { setTimeout, clearTimeout, ZeroGravityPhoneActionCallbacks: {} };
  const throwingBridge = {
    getCapabilities() {},
    execute() {
      throw new Error('native failure');
    }
  };
  assert.equal((await phoneActions.createBridge(throwingBridge).execute('OPEN_ANDROID_SETTINGS')).status, 'failure');

  const malformedBridge = {
    getCapabilities(callbackId) {
      window.ZeroGravityPhoneActionCallbacks[callbackId]({ status: 'success' });
    },
    execute(action, args, callbackId) {
      window.ZeroGravityPhoneActionCallbacks[callbackId](null);
    }
  };
  const result = await phoneActions.createBridge(malformedBridge).execute('OPEN_ANDROID_SETTINGS');
  assert.equal(result.status, 'failure');
  assert.match(result.message, /invalid phone-action result/);
});

test('fails when the Android bridge does not answer', async () => {
  const timers = new Map();
  let timerId = 0;
  global.window = {
    ZeroGravityPhoneActionCallbacks: {},
    setTimeout(callback) {
      timerId += 1;
      timers.set(timerId, callback);
      return timerId;
    },
    clearTimeout(id) {
      timers.delete(id);
    }
  };
  const bridge = phoneActions.createBridge({
    getCapabilities() {},
    execute() {}
  });
  const pending = bridge.execute('OPEN_ANDROID_SETTINGS');
  timers.get(timerId)();
  const result = await pending;
  assert.equal(result.status, 'failure');
  assert.match(result.message, /did not respond/);
});
