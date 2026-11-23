import { AbsoluteFill } from 'remotion';
import { Captions } from './Captions';
import { Diagram } from './Diagram';
import { EndCard } from './EndCard';
import { SetupPanel } from './SetupPanel';
import { C } from './theme';

export function Explainer() {
  return (
    <AbsoluteFill style={{ background: C.rack }}>
      <Diagram />
      <Captions />
      <SetupPanel />
      <EndCard />
    </AbsoluteFill>
  );
}
