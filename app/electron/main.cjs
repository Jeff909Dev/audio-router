// Electron main process: owns everything that needs the system — installing
// the driver (admin prompt via osascript) and talking to CoreAudio via arctl.
const { app, BrowserWindow, ipcMain, session, systemPreferences } = require('electron');
const { execFile } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..');
const HAL_DIR = '/Library/Audio/Plug-Ins/HAL';
const ARCTL = app.isPackaged
  ? path.join(process.resourcesPath, 'arctl')
  : path.join(ROOT, 'helper', 'build', 'arctl');
const DRIVER_BUILD_DIR = app.isPackaged ? process.resourcesPath : path.join(ROOT, 'driver', 'build');
const DEMO = process.env.AR_DEMO === '1';

const VARIANTS = [
  { id: '2ch', channels: 2 },
  { id: '16ch', channels: 16 },
].map((v) => ({
  ...v,
  name: `Audio Router ${v.id}`,
  uid: `AudioRouter${v.id}_UID`,
  bundle: `AudioRouter${v.id}.driver`,
}));

function run(file, args, timeout = 30000) {
  return new Promise((resolve, reject) => {
    execFile(file, args, { timeout }, (err, stdout, stderr) => {
      if (err) reject(Object.assign(err, { stderr: String(stderr).trim() }));
      else resolve(String(stdout));
    });
  });
}

async function arctl(...args) {
  if (DEMO) return demoArctl(...args);
  return JSON.parse(await run(ARCTL, args));
}

async function getState() {
  let devices = [];
  let error = null;
  try {
    devices = await arctl('list');
  } catch (e) {
    error = fs.existsSync(ARCTL) ? `arctl failed: ${e.stderr || e.message}` : 'helper/build/arctl is missing — run `make` in the repo root';
  }
  const variants = VARIANTS.map((v) => ({
    id: v.id,
    channels: v.channels,
    name: v.name,
    uid: v.uid,
    built: DEMO || fs.existsSync(path.join(DRIVER_BUILD_DIR, v.bundle)),
    installed: DEMO ? v.id === '2ch' : fs.existsSync(path.join(HAL_DIR, v.bundle)),
  }));
  return { variants, devices, error, demo: DEMO };
}

// Runs a shell command as root through the standard macOS password prompt.
// No timeout: the user may take a while to type their password.
function runAsAdmin(command) {
  const script = `do shell script "${command.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}" with administrator privileges`;
  return run('/usr/bin/osascript', ['-e', script], 0);
}

const quote = (p) => {
  if (p.includes("'")) throw new Error(`unsupported path: ${p}`);
  return `'${p}'`;
};

async function waitForDevice(uid, present, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const devices = await arctl('list');
      if (devices.some((d) => d.uid === uid) === present) return true;
    } catch {
      // coreaudiod is restarting; keep polling
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}

async function changeDriver(id, install) {
  const v = VARIANTS.find((x) => x.id === id);
  if (!v) throw new Error(`unknown variant ${id}`);
  if (DEMO) return { ok: true };
  const src = path.join(DRIVER_BUILD_DIR, v.bundle);
  const dest = path.join(HAL_DIR, v.bundle);
  if (install && !fs.existsSync(src)) {
    return { ok: false, message: `${v.bundle} is not built. Run \`make\` in the repo root.` };
  }
  const steps = [`rm -rf ${quote(dest)}`];
  // xattr -cr: a driver copied out of a downloaded app would keep com.apple.quarantine.
  if (install) steps.push(`cp -R ${quote(src)} ${quote(HAL_DIR + '/')}`, `chown -R root:wheel ${quote(dest)}`, `xattr -cr ${quote(dest)}`);
  steps.push('killall coreaudiod');
  try {
    await runAsAdmin(steps.join(' && '));
  } catch (e) {
    if (String(e.stderr || e.message).includes('-128')) return { ok: false, cancelled: true };
    return { ok: false, message: e.stderr || e.message };
  }
  const settled = await waitForDevice(v.uid, install);
  return settled
    ? { ok: true }
    : { ok: false, message: install ? 'Installed, but Core Audio has not published the device yet.' : 'Removed, but the device is still listed.' };
}

async function callArctl(args) {
  try {
    await arctl(...args);
    return { ok: true };
  } catch (e) {
    return { ok: false, message: e.stderr || e.message };
  }
}

ipcMain.handle('state:get', () => getState());
ipcMain.handle('driver:install', (_e, id) => changeDriver(id, true));
ipcMain.handle('driver:uninstall', (_e, id) => changeDriver(id, false));
ipcMain.handle('device:set-default', (_e, kind, uid) => callArctl(['set-default', kind, uid]));
ipcMain.handle('device:set-rate', (_e, uid, rate) => callArctl(['set-rate', uid, String(rate)]));
ipcMain.handle('device:multi-output', (_e, listenUid, routerUid) => callArctl(['multi-output', listenUid, routerUid]));
ipcMain.handle('device:remove-multi-output', (_e, uid) => callArctl(['remove', uid]));
ipcMain.handle('media:request-mic', () =>
  DEMO ? true : systemPreferences.askForMediaAccess('microphone'),
);

function createWindow() {
  const win = new BrowserWindow({
    width: 980,
    height: 760,
    minWidth: 820,
    minHeight: 560,
    title: 'Audio Router',
    titleBarStyle: 'hiddenInset',
    backgroundColor: '#0e0f10',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  const devUrl = process.env.VITE_DEV_SERVER_URL;
  if (devUrl) win.loadURL(devUrl);
  else win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));

  // AR_SCREENSHOT=/path.png captures the window once and quits (used to check the UI).
  const shot = process.env.AR_SCREENSHOT;
  if (shot) {
    win.webContents.once('did-finish-load', () => {
      setTimeout(async () => {
        const image = await win.webContents.capturePage();
        fs.writeFileSync(shot, image.toPNG());
        app.quit();
      }, Number(process.env.AR_SCREENSHOT_DELAY || 2500));
    });
  }
}

app.whenReady().then(() => {
  // The renderer captures the loopback input for the meters; allow media
  // access for our own window only.
  session.defaultSession.setPermissionRequestHandler((_wc, permission, cb) => cb(permission === 'media'));
  session.defaultSession.setPermissionCheckHandler((_wc, permission) => permission === 'media');
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => app.quit());

// ---- demo mode: lets the UI run without the driver installed --------------
let demoDefaults = { output: process.env.AR_DEMO_OUTPUT || 'BuiltInSpeakerDevice', input: 'BuiltInMicrophoneDevice' };
let demoRate = 48000;
// Multi-outputs by uid, as [listen uid, router uid]. AR_DEMO_LISTEN=<uid> starts with one for Audio Router 2ch.
const demoMultis = new Map();
const addDemoMulti = (listen, router) => demoMultis.set(`AudioRouter.multi.${listen}+${router}`, [listen, router]);
if (process.env.AR_DEMO_LISTEN) addDemoMulti(process.env.AR_DEMO_LISTEN, 'AudioRouter2ch_UID');
function demoArctl(cmd, a, b) {
  if (cmd === 'set-default') demoDefaults[a === 'system' ? 'output' : a] = b;
  if (cmd === 'set-rate') demoRate = Number(b);
  if (cmd === 'multi-output') addDemoMulti(a, b);
  if (cmd === 'remove') demoMultis.delete(a);
  if (cmd !== 'list') return { ok: true };
  const dev = (uid, name, transport, inputChannels, outputChannels, sampleRate) => ({
    id: 0, uid, name, manufacturer: 'Demo', transport, inputChannels, outputChannels, sampleRate,
    sampleRates: [44100, 48000, 88200, 96000, 176400, 192000],
    isDefaultInput: demoDefaults.input === uid, isDefaultOutput: demoDefaults.output === uid,
    isDefaultSystemOutput: demoDefaults.output === uid,
  });
  const devices = [
    dev('BuiltInMicrophoneDevice', 'MacBook Pro Microphone', 'built-in', 1, 0, 48000),
    dev('BuiltInSpeakerDevice', 'MacBook Pro Speakers', 'built-in', 0, 2, 48000),
    dev('AudioRouter2ch_UID', 'Audio Router 2ch', 'virtual', 2, 2, demoRate),
    dev('usb-interface', 'Scarlett 2i2 USB', 'usb', 2, 2, 48000),
  ];
  // An unknown listen uid stands for unplugged headphones: the multi-output stays, named after the uid.
  const nameOf = (uid) => devices.find((d) => d.uid === uid)?.name ?? uid;
  const multis = [...demoMultis].map(([uid, [listen, router]]) =>
    dev(uid, `${nameOf(listen)} + ${nameOf(router)}`, 'aggregate', 0, 2, 48000),
  );
  return [...devices, ...multis];
}
