// Meter math: dBFS conversion, zones and ballistics for the LED ladders.

export const FLOOR_DB = -60;

/** Linear amplitude (0..1+) → dBFS, clamped to FLOOR_DB. */
export function toDb(amplitude: number): number {
  if (!(amplitude > 0)) return FLOOR_DB;
  return Math.max(FLOOR_DB, 20 * Math.log10(amplitude));
}

/** Absolute peak of one block of samples. */
export function peakOf(samples: Float32Array): number {
  let peak = 0;
  for (let i = 0; i < samples.length; i++) {
    const v = Math.abs(samples[i]);
    if (v > peak) peak = v;
  }
  return peak;
}

export type Zone = 'safe' | 'hot' | 'clip';

/** Colour zone of an LED segment, like a console peak meter. */
export function zoneOf(db: number): Zone {
  if (db >= -3) return 'clip';
  if (db >= -12) return 'hot';
  return 'safe';
}

/**
 * Ballistics: the level the ladder should *display* this frame, given what it
 * showed last frame and what the analyser measured now.
 *
 * Called ~60 times per second per channel.
 *   prevDb      level displayed in the previous frame (dBFS, >= FLOOR_DB)
 *   measuredDb  peak measured in this frame (dBFS, >= FLOOR_DB)
 *   dtMs        time since the previous frame, in milliseconds
 * Returns a dBFS value between FLOOR_DB and 0.
 */
export function smoothLevel(prevDb: number, measuredDb: number, dtMs: number): number {
  // TODO(you): decide how the meter moves. Right now it follows the signal
  // raw, so it flickers on every frame. Consider:
  //  - attack: rise instantly to a louder peak (digital peak meter), or ease up?
  //  - release: fall back at a fixed rate in dB per second (e.g. 20–40 dB/s),
  //    so the eye can read the level instead of chasing noise.
  //  - use dtMs, not "per frame", so it behaves the same at 60 Hz or 120 Hz.
  void prevDb;
  void dtMs;
  return measuredDb;
}

export type PeakHold = { db: number; heldMs: number };

/** Peak-hold marker: sticks at the loudest recent peak, then falls. */
export function nextPeakHold(prev: PeakHold, levelDb: number, dtMs: number, holdMs = 1200, fallDbPerSec = 18): PeakHold {
  if (levelDb >= prev.db) return { db: levelDb, heldMs: 0 };
  const heldMs = prev.heldMs + dtMs;
  if (heldMs < holdMs) return { db: prev.db, heldMs };
  return { db: Math.max(levelDb, prev.db - (fallDbPerSec * dtMs) / 1000), heldMs };
}
