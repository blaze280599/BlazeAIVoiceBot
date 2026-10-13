import { test } from 'node:test';
import assert from 'node:assert/strict';
import { characterName, extractVoiceId, stripAsteriskActions, stripCues, toParenCues } from '../src/text.js';

const ID = '0123456789abcdef0123456789abcdef';

test('extractVoiceId finds bare IDs and IDs inside links', () => {
  assert.equal(extractVoiceId(ID), ID);
  assert.equal(extractVoiceId(`https://fish.audio/app/m/${ID.toUpperCase()}/`), ID);
  assert.equal(extractVoiceId('trump'), null);
  assert.equal(extractVoiceId(null), null);
});

test('stripCues removes cues and tidies spacing', () => {
  assert.equal(stripCues('[excited] We won! [laughing] Ha ha!'), 'We won! Ha ha!');
  assert.equal(stripCues('Oh [sighing] , fine.'), 'Oh, fine.');
  assert.equal(stripCues('No cues here.'), 'No cues here.');
});

test('stripAsteriskActions drops *actions* but keeps the rest', () => {
  assert.equal(stripAsteriskActions('*adjusts tie* Folks, it is huge.'), 'Folks, it is huge.');
  assert.equal(stripAsteriskActions('Plain text.'), 'Plain text.');
});

test('toParenCues converts cue syntax for the S1 model', () => {
  assert.equal(toParenCues('[excited] Yes!'), '(excited) Yes!');
});

test('characterName strips junk from voice titles', () => {
  assert.equal(characterName('Donald Trump (Noise reduction) [v2]'), 'Donald Trump');
  assert.equal(characterName('(only junk)'), '(only junk)');
});
