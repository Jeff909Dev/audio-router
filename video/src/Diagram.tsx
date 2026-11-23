// The one picture: DAW, headphones, recorder, Audio Router and the split device, patched with cables.
import type { ReactElement } from 'react';
import { useCurrentFrame } from 'remotion';
import { type CardId, CARD, PORT } from './layout';
import { Cable, Divider, Jack, Label, Led, Meter, MinorOpacity, Unit } from './parts';
import { type CableId, type Scene, sceneAt } from './scene';
import { lerp } from './timeline';
import { C } from './theme';

const DIM = 0.3;

// How visible a card is: its entrance, setup focus dimming and the end-card fade.
function cardOpacity(scene: Scene, id: CardId): number {
  const dim = lerp(1, DIM, scene.focusMode * (1 - scene.focus[id]));
  const end = id === 'router' ? 1 : 1 - scene.endFade;
  return scene.show[id] * dim * end;
}

function cableOpacity(scene: Scene, id: CableId): number {
  const dim = lerp(1, DIM, scene.focusMode * (1 - scene.cableFocus[id]));
  const end = id === 'loop' ? 1 : 1 - scene.endFade;
  return dim * end;
}

function Daw({ scene }: { scene: Scene }) {
  const b = CARD.daw;
  const { level, micTrack, micLevel } = scene.daw;
  return (
    <Unit box={b}>
      <Label x={166} y={482} size={36} weight={600}>
        Ableton Live
      </Label>
      <Label minor x={166} y={514} size={22} weight={500} spacing={2.6} fill={C.legend3} upper>
        Your DAW
      </Label>
      <Led x={396} y={481} state="ok" label="Playing" />
      <Divider x1={b.x + 28} x2={b.x + b.w - 28} y={540} />
      <Label minor x={166} y={592} size={20} mono fill={C.legend3}>
        1
      </Label>
      <Label minor x={194} y={592} size={26} weight={500} fill={C.legend2}>
        Music
      </Label>
      <Meter x={282} y={576} w={170} h={15} level={level} segments={14} />
      <g opacity={micTrack}>
        <Label minor x={166} y={652} size={20} mono fill={C.legend3}>
          2
        </Label>
        <Label minor x={194} y={652} size={26} weight={500} fill={C.legend2}>
          Mic
        </Label>
        <Meter x={282} y={636} w={170} h={15} level={micLevel} segments={14} />
        <Jack at={PORT.dawMic} />
      </g>
      <Label minor x={PORT.dawOut.x} y={566} size={20} weight={600} spacing={3.2} fill={C.legend2} anchor="middle">
        OUT
      </Label>
      <Jack at={PORT.dawOut} />
    </Unit>
  );
}

function Mic({ scene }: { scene: Scene }) {
  return (
    <Unit box={CARD.mic}>
      <Label x={166} y={856} size={34} weight={600}>
        Microphone
      </Label>
      <Label minor x={166} y={890} size={22} weight={500} spacing={2.6} fill={C.legend3} upper>
        Your voice
      </Label>
      <Meter x={330} y={874} w={128} h={14} level={scene.daw.micLevel} segments={10} />
      <Jack at={PORT.micOut} />
    </Unit>
  );
}

function Split({ scene }: { scene: Scene }) {
  const b = CARD.split;
  const s = scene.splitSignal;
  const trace = s > 0.02 ? C.amber : C.cableOff;
  return (
    <g>
      <Label minor x={b.x + b.w / 2} y={274} size={22} mono weight={500} fill={C.legend2} anchor="middle">
        Headphones + Audio Router 2ch
      </Label>
      <Unit box={b} ear={20}>
        <Label minor x={b.x + b.w / 2} y={327} size={18} weight={600} spacing={2.8} fill={C.legend3} anchor="middle">
          MULTI-OUTPUT
        </Label>
        <path
          d={`M ${PORT.splitIn.x + 22} ${PORT.splitIn.y} H 770 M 770 ${PORT.splitHp.y} V ${PORT.splitRouter.y} M 770 ${PORT.splitHp.y} H ${PORT.splitHp.x - 22} M 770 ${PORT.splitRouter.y} H ${PORT.splitRouter.x - 22}`}
          fill="none"
          stroke={trace}
          strokeOpacity={s > 0.02 ? 0.5 + 0.5 * s : 1}
          strokeWidth={3}
          strokeLinecap="round"
        />
        <Jack at={PORT.splitIn} />
        <Jack at={PORT.splitHp} />
        <Jack at={PORT.splitRouter} />
      </Unit>
    </g>
  );
}

function Router({ scene }: { scene: Scene }) {
  const b = CARD.router;
  const { picked } = scene.listen;
  return (
    <Unit box={b}>
      <rect x={936} y={546} width={78} height={38} rx={4} fill="none" stroke={C.seamStrong} strokeWidth={1.5} />
      <Label minor x={975} y={573} size={21} mono weight={500} spacing={0.8} fill={C.legend2} anchor="middle">
        AR·2
      </Label>
      <Label x={1036} y={563} size={32} weight={600}>
        Audio Router 2ch
      </Label>
      <Label minor x={1036} y={592} size={19} weight={500} spacing={2.2} fill={C.legend3} upper>
        2 in · 2 out · loopback
      </Label>
      <Divider x1={b.x + 28} x2={b.x + b.w - 28} y={606} />

      <Label minor x={PORT.routerOutLoop.x} y={650} size={21} weight={600} spacing={3.4} fill={C.legend2} anchor="middle">
        OUT
      </Label>
      <Label minor x={PORT.routerOutLoop.x} y={681} size={22} fill={C.legend3} anchor="middle">
        apps play here
      </Label>
      <Label minor x={PORT.routerInLoop.x} y={650} size={21} weight={600} spacing={3.4} fill={C.legend2} anchor="middle">
        IN
      </Label>
      <Label minor x={PORT.routerInLoop.x} y={681} size={22} fill={C.legend3} anchor="middle">
        apps record here
      </Label>
      <Jack at={PORT.routerOutLoop} />
      <Jack at={PORT.routerInLoop} />

      <Divider x1={b.x + 28} x2={b.x + b.w - 28} y={885} />
      <Label minor x={936} y={938} size={20} weight={500} spacing={2.6} fill={C.legend3} upper>
        Listen on
      </Label>
      <rect x={1080} y={905} width={264} height={50} rx={4} fill={C.well} stroke={picked > 0.5 ? C.amberEdge : C.seam} strokeWidth={1.5} />
      <Label minor x={1100} y={939} size={24} fill={picked > 0.5 ? C.amber : C.legend2}>
        {picked > 0.5 ? 'Headphones' : 'Off'}
      </Label>
      <path d="M 1311 925 L 1319 933 L 1327 925" fill="none" stroke={picked > 0.5 ? C.amber : C.legend3} strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" />

    </Unit>
  );
}

// The Listen on dropdown opens upward over the cable, like the app's picker list.
function ListenMenu({ scene }: { scene: Scene }) {
  const { open, hover } = scene.listen;
  if (open < 0.01) return null;
  const items = ['Off', 'Speakers', 'Headphones'];
  const itemH = 42;
  const listTop = 905 - 8 - items.length * itemH - 8;
  const hoverIndex = lerp(0, 2, hover);
  return (
    <g opacity={open} transform={`translate(0 ${(1 - open) * 10})`}>
      <rect
        x={1080}
        y={listTop}
        width={264}
        height={items.length * itemH + 8}
        rx={8}
        fill={C.raised}
        stroke={C.seamStrong}
        strokeWidth={1.5}
        style={{ filter: 'drop-shadow(0 10px 28px rgba(0, 0, 0, 0.5))' }}
      />
      <rect x={1084} y={listTop + 4 + hoverIndex * itemH} width={256} height={itemH} rx={4} fill="rgba(255, 255, 255, 0.06)" />
      {items.map((item, i) => (
        <Label key={item} x={1100} y={listTop + 4 + i * itemH + 29} size={23} fill={Math.round(hoverIndex) === i ? C.legend : C.legend2}>
          {item}
        </Label>
      ))}
    </g>
  );
}

function Headphones({ scene }: { scene: Scene }) {
  const { led, label, level } = scene.hp;
  return (
    <Unit box={CARD.hp}>
      <Label minor x={PORT.hpIn.x} y={325} size={20} weight={600} spacing={3} fill={C.legend2} anchor="middle">
        IN
      </Label>
      <Jack at={PORT.hpIn} />
      <Label x={1556} y={352} size={34} weight={600}>
        Headphones
      </Label>
      <Led x={1556} y={392} state={led} label={label} />
      <Meter x={1556} y={410} w={234} h={14} level={level} segments={18} />
    </Unit>
  );
}

function Recorder({ scene }: { scene: Scene }) {
  const { led, label, level } = scene.rec;
  return (
    <Unit box={CARD.rec}>
      <Label minor x={PORT.recIn.x} y={763} size={20} weight={600} spacing={3} fill={C.legend2} anchor="middle">
        MIC
      </Label>
      <Jack at={PORT.recIn} />
      <Label x={1556} y={788} size={32} weight={600}>
        Screen recorder
      </Label>
      <Led x={1556} y={828} state={led} label={label} />
      <Meter x={1556} y={848} w={234} h={14} level={level} segments={18} />
    </Unit>
  );
}

// Amber ring around the cards the current setup step is about.
function FocusRing({ scene, id }: { scene: Scene; id: CardId }) {
  const v = scene.focusMode * scene.focus[id];
  if (v < 0.01) return null;
  const b = CARD[id];
  const pad = 10;
  return (
    <rect
      x={b.x - pad}
      y={b.y - pad}
      width={b.w + pad * 2}
      height={b.h + pad * 2}
      rx={16}
      fill="none"
      stroke={C.amber}
      strokeWidth={5}
      opacity={v}
      style={{ filter: 'drop-shadow(0 0 14px rgba(240, 164, 60, 0.6))' }}
    />
  );
}

export function Diagram() {
  const frame = useCurrentFrame();
  const scene = sceneAt(frame);
  const { s, x, y } = scene.camera;
  const flow = frame * 5;
  const cards: [CardId, ReactElement][] = [
    ['router', <Router scene={scene} />],
    ['daw', <Daw scene={scene} />],
    ['mic', <Mic scene={scene} />],
    ['split', <Split scene={scene} />],
    ['hp', <Headphones scene={scene} />],
    ['rec', <Recorder scene={scene} />],
  ];
  return (
    <MinorOpacity.Provider value={1 - scene.focusMode}>
      <svg width={1920} height={1080} viewBox="0 0 1920 1080" style={{ position: 'absolute', inset: 0 }}>
        <g transform={`translate(${x} ${y}) scale(${s})`}>
          {cards.map(([id, el]) => {
            const o = cardOpacity(scene, id);
            const rise = (1 - scene.show[id]) * 24;
            return o > 0.001 ? (
              <g key={id} opacity={o} transform={`translate(0 ${rise})`}>
                {el}
              </g>
            ) : null;
          })}
          {scene.cables.map((c) => {
            // The loop is part of the router unit, so it enters with it.
            const gate = c.id === 'loop' ? scene.show.router : c.id === 'mic' ? scene.show.mic : 1;
            const rise = c.id === 'loop' ? (1 - scene.show.router) * 24 : 0;
            return (
              <g key={c.id} transform={`translate(0 ${rise})`}>
                <Cable a={c.a} b={c.b} signal={c.signal} flow={flow} reach={c.reach} sag={c.sag} opacity={cableOpacity(scene, c.id) * gate} />
              </g>
            );
          })}
          <ListenMenu scene={scene} />
          {(['router', 'daw', 'split', 'hp', 'rec'] as CardId[]).map((id) => (
            <FocusRing key={id} scene={scene} id={id} />
          ))}
        </g>
      </svg>
    </MinorOpacity.Provider>
  );
}
