// The state of the picture at any frame. Rendering reads this and decides nothing on its own.
import { random } from 'remotion';
import { type CardId, nearby, type Port, PORT, travel, VIA } from './layout';
import { FPS, lerp, ramp, T } from './timeline';

export type LedState = 'off' | 'ok' | 'fault';
export type CableId = 'daw' | 'splitHp' | 'splitRouter' | 'loop' | 'rec' | 'mic';
export type CableState = { id: CableId; a: Port; b: Port; signal: number; reach?: number; sag?: number };
export type Camera = { s: number; x: number; y: number };

export type Scene = {
  show: Record<CardId, number>;
  cables: CableState[];
  daw: { level: number; micTrack: number; micLevel: number };
  hp: { led: LedState; label: string; level: number };
  rec: { led: LedState; label: string; level: number };
  splitSignal: number;
  listen: { open: number; hover: number; picked: number };
  // Setup beat: how far the picture is in "focus mode", and which cards and cables each step points at.
  focusMode: number;
  focus: Record<CardId, number>;
  cableFocus: Record<CableId, number>;
  camera: Camera;
  endFade: number;
};

const STEP_CARDS: CardId[][] = [['router'], ['split', 'hp'], ['daw', 'split'], ['router', 'rec']];
const STEP_CABLES: CableId[][] = [['loop'], ['splitHp'], ['daw'], ['rec']];

const FULL: Camera = { s: 1, x: 0, y: 0 };
// Diagram parked bottom-left during setup, under the step list.
const MINI: Camera = { s: 0.46, x: 59, y: 525 };
// End card: push in on the router unit.
const END: Camera = { s: 1.25, x: -465, y: -515 };

// A music-like level: a kick every half second, a slow swell and a little jitter. Deterministic per frame.
export function music(frame: number, seed: number): number {
  const t = frame / FPS + seed * 0.37;
  const kick = Math.pow(1 - ((t * 2) % 1), 2.2);
  const swell = 0.5 + 0.5 * Math.sin(t * 1.3 + seed);
  const jitter = random(`level-${seed}-${Math.floor(frame / 2)}`);
  return Math.min(1, 0.48 + 0.26 * kick + 0.1 * swell + 0.12 * jitter);
}

// 1 while a connection is made: rises at `on`, drops at `off`.
const live = (frame: number, on: number, off?: number) =>
  ramp(frame, on, 0.2, 'out') * (off === undefined ? 1 : 1 - ramp(frame, off, 0.08, 'linear'));

const mix = (a: Camera, b: Camera, t: number): Camera => ({ s: lerp(a.s, b.s, t), x: lerp(a.x, b.x, t), y: lerp(a.y, b.y, t) });

export function sceneAt(frame: number): Scene {
  const t = frame / FPS;
  const daw = music(frame, 1);
  const voice = music(frame + 7, 4) * (0.6 + 0.4 * Math.abs(Math.sin(t * 2.7)));

  // The DAW's output cable gets re-patched twice: headphones, then the router, then the split device.
  const toHp = ramp(frame, T.dawToHp, 0.8);
  const toRouter = ramp(frame, T.replugToRouter, 1.2);
  const toSplit = ramp(frame, T.replugToSplit, 0.9);
  const dawEnd =
    t < T.replugToRouter
      ? travel(nearby(PORT.dawOut), PORT.hpIn, toHp, [{ x: 1000, y: 470 }])
      : t < T.replugToSplit
        ? travel(PORT.hpIn, PORT.routerOutExt, toRouter, VIA.hpToRouter)
        : travel(PORT.routerOutExt, PORT.splitIn, toSplit, VIA.routerToSplit);

  const hpFromDaw = live(frame, T.dawToHp + 0.8, T.replugToRouter);
  const routerFromDaw = live(frame, T.replugToRouter + 1.2, T.replugToSplit);
  const splitFromDaw = live(frame, T.replugToSplit + 0.9);

  const splitHpEnd = travel(nearby(PORT.splitHp), PORT.hpIn, ramp(frame, T.splitOuts, 0.8), [{ x: 1200, y: 330 }]);
  const splitRouterEnd = travel(nearby(PORT.splitRouter), PORT.routerOutExt, ramp(frame, T.splitOuts + 0.15, 0.8), VIA.splitToRouter);
  const splitHpOn = live(frame, T.splitOuts + 0.8);
  const splitRouterOn = live(frame, T.splitOuts + 0.95);

  const recEnd = travel(nearby(PORT.routerInExt), PORT.recIn, ramp(frame, T.inToRec, 0.8), [{ x: 1400, y: 720 }]);
  const recOn = live(frame, T.inToRec + 0.8);

  const micEnd = travel(nearby(PORT.micOut), PORT.dawMic, ramp(frame, T.micCable, 0.7));
  const micOn = live(frame, T.micCable + 0.7);

  const dawOut = Math.min(1, daw + micOn * 0.08);
  const hpSignal = (hpFromDaw + splitFromDaw * splitHpOn) * dawOut;
  const loopSignal = (routerFromDaw + splitFromDaw * splitRouterOn) * dawOut;
  const recSignal = loopSignal * recOn;

  const cables: CableState[] = [
    { id: 'loop', a: PORT.routerOutLoop, b: PORT.routerInLoop, signal: loopSignal, reach: 110, sag: 0 },
    { id: 'daw', a: PORT.dawOut, b: dawEnd, signal: (hpFromDaw + routerFromDaw + splitFromDaw) * dawOut },
  ];
  if (t >= T.splitOuts) {
    cables.push({ id: 'splitHp', a: PORT.splitHp, b: splitHpEnd, signal: splitFromDaw * splitHpOn * dawOut });
    cables.push({ id: 'splitRouter', a: PORT.splitRouter, b: splitRouterEnd, signal: splitFromDaw * splitRouterOn * dawOut });
  }
  if (t >= T.inToRec) cables.push({ id: 'rec', a: PORT.routerInExt, b: recEnd, signal: recSignal });
  if (t >= T.micCable) cables.push({ id: 'mic', a: PORT.micOut, b: micEnd, signal: micOn * voice });

  const hpLive = hpSignal > 0.05;
  const recording = t >= T.inToRec + 0.8;

  // Setup: one step at a time points at part of the picture.
  const focusMode = ramp(frame, T.shrink, 1.0) * (1 - ramp(frame, T.stepsEnd, 1.0));
  const focus: Record<CardId, number> = { daw: 0, mic: 0, split: 0, router: 0, hp: 0, rec: 0 };
  const cableFocus: Record<CableId, number> = { daw: 0, splitHp: 0, splitRouter: 0, loop: 0, rec: 0, mic: 0 };
  T.steps.forEach((start, i) => {
    const end = T.steps[i + 1] ?? T.stepsEnd;
    const w = ramp(frame, start, 0.3, 'out') * (1 - ramp(frame, end - 0.15, 0.3, 'in'));
    for (const id of STEP_CARDS[i]) focus[id] = Math.max(focus[id], w);
    for (const id of STEP_CABLES[i]) cableFocus[id] = Math.max(cableFocus[id], w);
  });

  const parked = ramp(frame, T.shrink, 1.0) - ramp(frame, T.stepsEnd, 1.0);
  const camera = mix(mix(FULL, MINI, parked), END, ramp(frame, T.endZoom, 1.3));

  return {
    show: {
      daw: ramp(frame, T.cardsIn, 0.5, 'out'),
      hp: ramp(frame, T.cardsIn + 0.1, 0.5, 'out'),
      rec: ramp(frame, T.cardsIn + 0.2, 0.5, 'out'),
      router: ramp(frame, T.routerIn, 0.7, 'out'),
      split: ramp(frame, T.splitIn, 0.5, 'out'),
      mic: ramp(frame, T.micIn, 0.5, 'out'),
    },
    cables,
    daw: { level: daw, micTrack: ramp(frame, T.micCable + 0.5, 0.4), micLevel: micOn * voice },
    hp: {
      led: hpLive ? 'ok' : t < T.dawToHp + 0.8 ? 'off' : 'fault',
      label: hpLive ? 'Hearing DAW' : 'Silent',
      level: hpSignal,
    },
    rec: {
      led: recording ? 'ok' : 'fault',
      label: !recording ? 'No DAW audio' : t >= T.micCable + 0.7 ? 'Voice + music' : 'Recording DAW',
      level: recSignal,
    },
    splitSignal: splitFromDaw * dawOut,
    listen: {
      open: ramp(frame, T.listenOpen, 0.2, 'out') * (1 - ramp(frame, T.listenPick, 0.2, 'in')),
      hover: ramp(frame, T.listenHover, 0.3),
      picked: ramp(frame, T.listenPick, 0.15),
    },
    focusMode,
    focus,
    cableFocus,
    camera,
    endFade: ramp(frame, T.endZoom, 0.5),
  };
}
