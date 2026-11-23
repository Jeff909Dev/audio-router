# Audio Router explainer video

A 48-second motion-graphics explainer for the README and the release page, built with [Remotion](https://www.remotion.dev). It has no audio track.

## Render

```sh
npm install
npm run render
```

`npm run render` writes three files to `../docs/media/`:

- `audio-router.mp4`: 1920x1080, 30 fps, H.264, yuv420p, faststart.
- `audio-router-poster.png`: the frame at 20.5 s, for a clickable thumbnail.
- `audio-router-preview.gif`: 7.5 s of the Listen on split, 800 px wide.

It uses Remotion's bundled ffmpeg, so you don't need a separate install. The first render downloads Chrome Headless Shell into `node_modules`.

To preview and scrub the timeline in a browser, run `npm run studio`.

## Where things are

- `src/timeline.ts`: every beat and key moment, in seconds.
- `src/scene.ts`: the state of the picture at any frame, including cables, signal, LEDs and camera.
- `src/Diagram.tsx` and `src/parts.tsx`: the rack units and the patch cable, redrawn from `app/src/components/PatchCable.tsx` with the tokens in `app/src/styles.css`.
- `src/SetupPanel.tsx`: the four setup steps. Steps 2 to 4 zoom into `public/app-listening.png`, a copy of `docs/images/app-listening.png`.
- Fonts are IBM Plex Sans Condensed and IBM Plex Mono from `@fontsource`, loaded from `node_modules`. Nothing is fetched at render time.

## License

Remotion is free for individuals and small companies, and larger companies need a company license. See https://www.remotion.dev/license.
