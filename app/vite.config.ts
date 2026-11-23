import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

// Strict CSP for the packaged page only: the dev server needs an inline
// script for React Fast Refresh.
const CSP = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self' data:";
const cspInBuild: Plugin = {
  name: 'csp-in-build',
  apply: 'build',
  transformIndexHtml: (html) =>
    html.replace('<head>', `<head>\n    <meta http-equiv="Content-Security-Policy" content="${CSP}" />`),
};

// base './' so the built index.html works from file:// inside Electron.
export default defineConfig({
  base: './',
  plugins: [react(), cspInBuild],
  server: { port: 5173, strictPort: true },
  build: { outDir: 'dist', emptyOutDir: true },
});
