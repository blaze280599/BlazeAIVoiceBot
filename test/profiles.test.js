import { test } from 'node:test';
import assert from 'node:assert/strict';
import { factsFrom } from '../src/profiles.js';

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const NOW = Date.UTC(2026, 10, 3, 12);

function profile(overrides = {}) {
  return { since: NOW - 10 * DAY, games: {}, artists: {}, songs: {}, joinHours: Array(24).fill(0), ...overrides };
}

test('factsFrom has nothing to say about a new or opted-out profile', () => {
  assert.deepEqual(factsFrom(undefined, undefined, NOW), []);
  assert.deepEqual(factsFrom({ optedOut: true }, undefined, NOW), []);
  assert.deepEqual(factsFrom(profile(), undefined, NOW), []);
});

test('factsFrom calls out the most played game and binges', () => {
  const p = profile({
    games: {
      'Arena Breakout Infinite': { minutes: 42 * 60, sessions: 20, firstSeen: NOW - 10 * DAY },
      Valorant: { minutes: 30, sessions: 2, firstSeen: NOW - 10 * DAY },
    },
  });
  const facts = factsFrom(p, { game: 'Arena Breakout Infinite', startedAt: NOW - 5 * HOUR }, NOW);
  assert.ok(facts.includes("they've sunk 42 hours into Arena Breakout Infinite in the last 10 days"));
  assert.ok(facts.includes("they've been playing Arena Breakout Infinite for 5 hours straight"));
  // Under two hours isn't a binge.
  assert.ok(!factsFrom(p, { game: 'Valorant', startedAt: NOW - HOUR }, NOW).some((f) => f.includes('straight')));
});

test('factsFrom spots new games only once it has known someone a week', () => {
  const games = { Fortnite: { minutes: 120, sessions: 3, firstSeen: NOW - DAY } };
  assert.ok(factsFrom(profile({ games }), undefined, NOW).includes('they just started playing Fortnite, their new obsession'));
  const newcomer = profile({ since: NOW - 2 * DAY, games });
  assert.ok(!factsFrom(newcomer, undefined, NOW).some((f) => f.includes('new obsession')));
});

test('factsFrom catches games launched and quit within minutes', () => {
  const games = { 'Rage Game': { minutes: 15, sessions: 4, firstSeen: NOW - 9 * DAY } };
  assert.ok(factsFrom(profile({ games }), undefined, NOW).includes('they keep launching Rage Game and quitting within minutes'));
});

test('factsFrom covers music and late nights', () => {
  const joinHours = Array(24).fill(0);
  joinHours[2] = 6;
  joinHours[20] = 6;
  const p = profile({
    artists: { 'Sabrina Carpenter': 31, 'Taylor Swift': 2 },
    songs: { '"Espresso" by Sabrina Carpenter': 9 },
    joinHours,
  });
  const facts = factsFrom(p, undefined, NOW);
  assert.ok(facts.includes("they've played Sabrina Carpenter 31 times in the last 10 days"));
  assert.ok(facts.includes('they\'ve listened to "Espresso" by Sabrina Carpenter 9 times in the last 10 days'));
  assert.ok(facts.includes('they usually hop on voice after midnight'));
});
