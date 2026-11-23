import { Composition } from 'remotion';
import './fonts';
import { Explainer } from './Explainer';
import { DURATION, FPS } from './timeline';

export const RemotionRoot = () => (
  <Composition id="AudioRouter" component={Explainer} durationInFrames={DURATION} fps={FPS} width={1920} height={1080} />
);
