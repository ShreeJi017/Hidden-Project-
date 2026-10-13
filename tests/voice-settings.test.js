const assert = require('node:assert/strict');
const { test } = require('node:test');
const voiceSettings = require('../voice-settings.js');

test('recognizes natural English, Hindi, and Hinglish voice requests', () => {
  assert.deepEqual(voiceSettings.parseIntent('Switch to a male voice.'), { type: 'voice-gender', gender: 'male' });
  assert.deepEqual(voiceSettings.parseIntent('Ab male voice mein baat karo'), { type: 'voice-gender', gender: 'male' });
  assert.deepEqual(voiceSettings.parseIntent('I want a female voice'), { type: 'voice-gender', gender: 'female' });
  assert.deepEqual(voiceSettings.parseIntent('Change your voice to a softer female voice'), { type: 'voice-gender', gender: 'female' });
  assert.deepEqual(voiceSettings.parseIntent('Use a deeper male voice'), { type: 'voice-gender', gender: 'male' });
  assert.deepEqual(voiceSettings.parseIntent('Go back to your previous voice'), { type: 'voice-previous' });
  assert.deepEqual(voiceSettings.parseIntent('Speak in a different available voice'), { type: 'voice-next' });
  assert.deepEqual(voiceSettings.parseIntent('महिला आवाज़ में बोलो'), { type: 'voice-gender', gender: 'female' });
});

test('does not treat incidental gender mentions or mixed questions as voice commands', () => {
  assert.equal(voiceSettings.parseIntent('Explain male and female voices to me'), null);
  assert.equal(voiceSettings.parseIntent('Write a story about a female pilot'), null);
  assert.deepEqual(voiceSettings.parseIntent('Switch to a male voice and explain photosynthesis'), {
    type: 'voice-gender',
    gender: 'male',
    followUp: 'explain photosynthesis'
  });
  assert.equal(voiceSettings.parseIntent('What is the speed of sound?'), null);
});

test('changes actual playback rate for relative, explicit, Hindi, and reset requests', () => {
  assert.equal(voiceSettings.parseIntent('Speak faster', 1).rate, 1.2);
  assert.equal(voiceSettings.parseIntent('Increase your speed a little', 1).rate, 1.1);
  assert.equal(voiceSettings.parseIntent('Thoda dheere bolo', 1).rate, 0.9);
  assert.equal(voiceSettings.parseIntent('Speak at half speed', 1).rate, 0.5);
  assert.equal(voiceSettings.parseIntent('Speak twice as fast', 1).rate, 2);
  assert.equal(voiceSettings.parseIntent('Return to normal speed', 1.5).rate, 1);
  assert.equal(voiceSettings.parseIntent('Speak faster', 2).rate, 2);
  assert.equal(voiceSettings.parseIntent('Slow down your speech', 0.5).rate, 0.5);
  assert.deepEqual(voiceSettings.parseIntent('Stop speaking'), { type: 'stop' });
});

test('matches only explicitly gender-labelled voices and cycles installed voices', () => {
  const voices = [
    { name: 'English Male', lang: 'en-US', voiceURI: 'en-male' },
    { name: 'Hindi Female', lang: 'hi-IN', voiceURI: 'hi-female' },
    { name: 'Asha', lang: 'hi-IN', voiceURI: 'hi-unknown' }
  ];
  assert.equal(voiceSettings.findGenderVoice(voices, 'male').voiceURI, 'en-male');
  assert.equal(voiceSettings.findGenderVoice(voices, 'female').voiceURI, 'hi-female');
  assert.equal(voiceSettings.findGenderVoice(voices, 'unknown'), null);
  assert.equal(voiceSettings.findNextVoice(voices, 'en-male').voiceURI, 'hi-female');
  assert.equal(voiceSettings.findPreviousVoice(voices, 'en-male'), voices[0]);
  assert.equal(voiceSettings.getVoiceLabel(voices[1]), 'Hindi Female (hi-IN)');
});

test('applies the selected speed to the actual spoken utterance', () => {
  const originalWindow = global.window;
  const spoken = [];
  global.window = {
    SpeechSynthesisUtterance: class {
      constructor(text) {
        this.text = text;
      }
    },
    speechSynthesis: {
      getVoices: () => [],
      speak(utterance) {
        spoken.push(utterance);
      },
      cancel() {}
    }
  };
  try {
    delete require.cache[require.resolve('../voice-services.js')];
    require('../voice-services.js');
    const voiceServices = global.window.ZeroGravityVoice;
    const service = voiceServices.createSpeechSynthesisService();
    service.speak('Speed test', { rate: 1.7 });
    assert.equal(spoken[0].rate, 1.7);
  } finally {
    if (originalWindow === undefined) delete global.window;
    else global.window = originalWindow;
  }
});