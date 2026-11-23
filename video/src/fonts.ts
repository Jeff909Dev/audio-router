// Fonts are bundled from @fontsource (latin subset only), so rendering never touches the network.
import { loadFont } from '@remotion/fonts';
import mono400 from '@fontsource/ibm-plex-mono/files/ibm-plex-mono-latin-400-normal.woff2';
import mono500 from '@fontsource/ibm-plex-mono/files/ibm-plex-mono-latin-500-normal.woff2';
import sans400 from '@fontsource/ibm-plex-sans-condensed/files/ibm-plex-sans-condensed-latin-400-normal.woff2';
import sans500 from '@fontsource/ibm-plex-sans-condensed/files/ibm-plex-sans-condensed-latin-500-normal.woff2';
import sans600 from '@fontsource/ibm-plex-sans-condensed/files/ibm-plex-sans-condensed-latin-600-normal.woff2';

const faces = [
  { family: 'IBM Plex Sans Condensed', url: sans400, weight: '400' },
  { family: 'IBM Plex Sans Condensed', url: sans500, weight: '500' },
  { family: 'IBM Plex Sans Condensed', url: sans600, weight: '600' },
  { family: 'IBM Plex Mono', url: mono400, weight: '400' },
  { family: 'IBM Plex Mono', url: mono500, weight: '500' },
];

for (const face of faces) void loadFont({ ...face, format: 'woff2' });
