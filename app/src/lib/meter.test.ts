import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FLOOR_DB, nextPeakHold, peakOf, toDb, zoneOf } from './meter.ts';

test('toDb maps full scale to 0 dBFS and silence to the floor', () => {
  assert.equal(toDb(1), 0);
  assert.equal(Math.round(toDb(0.5)), -6);
  assert.equal(toDb(0), FLOOR_DB);
  assert.equal(toDb(Number.NaN), FLOOR_DB);
  assert.equal(toDb(1e-9), FLOOR_DB);
});

test('peakOf takes the absolute peak', () => {
  assert.equal(peakOf(new Float32Array([0.1, -0.75, 0.5])), 0.75);
  assert.equal(peakOf(new Float32Array(0)), 0);
});

test('zones follow console conventions', () => {
  assert.equal(zoneOf(-20), 'safe');
  assert.equal(zoneOf(-12), 'hot');
  assert.equal(zoneOf(-1), 'clip');
});

test('peak hold sticks, then falls at the configured rate', () => {
  let p = nextPeakHold({ db: FLOOR_DB, heldMs: 0 }, -6, 16);
  assert.deepEqual(p, { db: -6, heldMs: 0 });
  p = nextPeakHold(p, -30, 1000);
  assert.equal(p.db, -6, 'still holding inside the hold window');
  p = nextPeakHold(p, -30, 500);
  assert.ok(p.db < -6 && p.db > -30, 'falling after the hold window');
  p = nextPeakHold(p, -3, 16);
  assert.deepEqual(p, { db: -3, heldMs: 0 }, 'a louder peak resets the hold');
});
