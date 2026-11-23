// Renders the explainer, its poster frame and the README preview gif into ../docs/media.
// Uses Remotion's bundled ffmpeg, so nothing beyond `npm install` is needed.
import { execFileSync } from 'node:child_process';
import { mkdirSync, statSync } from 'node:fs';
import path from 'node:path';

const MEDIA = path.join('..', 'docs', 'media');
const RAW = path.join('out', 'raw.mp4');
const FPS = 30;
const POSTER_AT = 20.5; // seconds: the split, fully lit
const GIF = { start: 14.3, seconds: 6.3, width: 800, fps: 15 }; // the Listen on beat, before the setup starts

const remotion = (...args) => execFileSync(path.join('node_modules', '.bin', 'remotion'), args, { stdio: 'inherit' });

mkdirSync('out', { recursive: true });
mkdirSync(MEDIA, { recursive: true });

remotion('render', 'src/index.ts', 'AudioRouter', RAW);
// +faststart moves the index to the front so browsers can start playing before the download ends.
remotion('ffmpeg', '-y', '-loglevel', 'error', '-i', RAW, '-c', 'copy', '-movflags', '+faststart', path.join(MEDIA, 'audio-router.mp4'));

remotion('still', 'src/index.ts', 'AudioRouter', path.join(MEDIA, 'audio-router-poster.png'), `--frame=${Math.round(POSTER_AT * FPS)}`, '--image-format=png');

// The bundled ffmpeg has no fps filter, so the output -r drops to 15 fps instead.
const filter =
  `scale=${GIF.width}:-1:flags=lanczos,split[a][b];` +
  '[a]palettegen=max_colors=128:stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=4:diff_mode=rectangle';
const gifArgs = ['-ss', String(GIF.start), '-t', String(GIF.seconds), '-i', RAW, '-vf', filter, '-r', String(GIF.fps), '-loop', '0'];
remotion('ffmpeg', '-y', '-loglevel', 'error', ...gifArgs, path.join(MEDIA, 'audio-router-preview.gif'));

for (const file of ['audio-router.mp4', 'audio-router-poster.png', 'audio-router-preview.gif']) {
  const { size } = statSync(path.join(MEDIA, file));
  console.log(`${file}  ${(size / 1024 / 1024).toFixed(2)} MB`);
}
