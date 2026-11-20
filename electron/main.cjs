'use strict';
// 小柯機器人文字與圖像轉影音工具：桌面版主程式
// 網頁本體（dist/）由 xkstory:// 載入；專案檔案（圖片、影片、語音）由 xkmedia:// 提供（支援 Range）。
// AI 連線由主程式代送（沒有 CORS 與逾時問題），合成用內建 FFmpeg；關閉視窗即停止所有工作並結束程式。
const { app, BrowserWindow, ipcMain, protocol, shell, dialog, Menu, screen, net, safeStorage } = require('electron');
const path = require('path');
const fs = require('fs');
const { Readable } = require('stream');
const { Updater } = require('./updater.cjs');
const ff = require('./ffmpeg.cjs');
const edge = require('./edge-tts.cjs');

const SCHEME = 'xkstory';
const MEDIA = 'xkmedia';
const DIST = path.join(__dirname, '..', 'dist');
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.wasm': 'application/wasm',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.bmp': 'image/bmp',
  '.woff2': 'font/woff2',
  '.mp4': 'video/mp4',
  '.mov': 'video/quicktime',
  '.webm': 'video/webm',
  '.mp3': 'audio/mpeg',
  '.m4a': 'audio/mp4',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
  '.srt': 'text/plain; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
};

protocol.registerSchemesAsPrivileged([
  { scheme: SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } },
  { scheme: MEDIA, privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true, bypassCSP: true } },
]);

if (process.env.XK_USER_DATA) app.setPath('userData', process.env.XK_USER_DATA);

if (!app.requestSingleInstanceLock()) {
  app.quit();
  process.exit(0);
}

const updater = new Updater();
let win = null;

// --- 設定（Gemini 金鑰用作業系統加密保存） ----------------------------------------------
const settingsFile = () => path.join(app.getPath('userData'), 'xiaoke-settings.json');
function readSettings() {
  try {
    return JSON.parse(fs.readFileSync(settingsFile(), 'utf8').replace(/^﻿/, ''));
  } catch {
    return {};
  }
}
function writeSettings(s) {
  fs.mkdirSync(path.dirname(settingsFile()), { recursive: true });
  const tmp = settingsFile() + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(s, null, 2));
  fs.renameSync(tmp, settingsFile());
}
function encKey(k) {
  if (!k) return '';
  try {
    if (safeStorage.isEncryptionAvailable()) return 'enc:' + safeStorage.encryptString(k).toString('base64');
  } catch {}
  return 'b64:' + Buffer.from(k).toString('base64');
}
function decKey(v) {
  if (!v) return '';
  try {
    if (v.startsWith('enc:')) return safeStorage.decryptString(Buffer.from(v.slice(4), 'base64'));
    if (v.startsWith('b64:')) return Buffer.from(v.slice(4), 'base64').toString();
  } catch {}
  return '';
}

// --- 專案資料夾 -------------------------------------------------------------------------
function projectsRoot() {
  const s = readSettings();
  const dir = process.env.XK_PROJECTS || s.projectsRoot || path.join(app.getPath('documents'), '小柯文字圖像轉影音');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}
/** 網頁只能讀寫專案資料夾裡的檔案，與使用者選過的檔案 */
const allowedFiles = new Set();
const allowedDirs = new Set();
const norm = (p) => path.resolve(p).toLowerCase();
function inside(p) {
  const n = norm(p);
  if (allowedFiles.has(n)) return true;
  if (n.startsWith(norm(projectsRoot()) + path.sep)) return true;
  for (const d of allowedDirs) if (n === d || n.startsWith(d + path.sep)) return true;
  return false;
}
function projPath(dir, rel) {
  const full = path.resolve(dir, rel || '');
  if (!inside(dir) || !full.toLowerCase().startsWith(norm(dir))) throw new Error('路徑不在專案資料夾內');
  return full;
}
const safeName = (s) => String(s || '未命名').replace(/[\\/:*?"<>|\x00-\x1f]/g, '_').trim().slice(0, 60) || '未命名';
function uniqueDir(root, name) {
  let p = path.join(root, name);
  for (let i = 2; fs.existsSync(p); i++) p = path.join(root, `${name} (${i})`);
  return p;
}

// --- 視窗 ---------------------------------------------------------------------------------
const DESIGN_W = 1280;
const DESIGN_H = 760;
function fitZoom() {
  if (!win || win.isDestroyed()) return;
  const [w, h] = win.getContentSize();
  win.webContents.setZoomFactor(Math.max(0.55, Math.min(1, w / DESIGN_W, h / DESIGN_H)));
}

function createWindow() {
  const s = readSettings();
  const wa = screen.getPrimaryDisplay().workAreaSize;
  win = new BrowserWindow({
    width: Math.min(s.bounds?.width || 1440, wa.width),
    height: Math.min(s.bounds?.height || 920, wa.height),
    x: s.bounds?.x,
    y: s.bounds?.y,
    minWidth: 760,
    minHeight: 500,
    title: '小柯機器人文字與圖像轉影音工具',
    icon: path.join(__dirname, '..', 'build', 'icon.png'),
    backgroundColor: '#f1eee8',
    autoHideMenuBar: true,
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  if (s.maximized) win.maximize();
  win.loadURL(`${SCHEME}://app/index.html${process.env.XK_QUERY ? `?${process.env.XK_QUERY}` : ''}`);
  win.webContents.on('did-finish-load', fitZoom);
  win.on('resize', fitZoom);
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith(`${SCHEME}://`)) {
      e.preventDefault();
      if (/^https?:/i.test(url)) shell.openExternal(url);
    }
  });
  win.on('close', () => {
    if (!win || win.isDestroyed()) return;
    const cur = readSettings();
    cur.maximized = win.isMaximized();
    if (!cur.maximized && !win.isMinimized()) cur.bounds = win.getBounds();
    writeSettings(cur);
  });
  win.on('closed', () => (win = null));
}

async function serveApp(req) {
  const url = new URL(req.url);
  const rel = decodeURIComponent(url.pathname).replace(/^\/+/, '') || 'index.html';
  const file = path.normalize(path.join(DIST, rel));
  if (!file.startsWith(DIST)) return new Response('forbidden', { status: 403 });
  try {
    const data = await fs.promises.readFile(file);
    return new Response(data, { headers: { 'content-type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream', 'cache-control': 'no-cache' } });
  } catch {
    return new Response('not found', { status: 404 });
  }
}

async function serveMedia(req) {
  const url = new URL(req.url);
  const file = url.searchParams.get('p') || '';
  if (!file || !inside(file)) return new Response('forbidden', { status: 403 });
  let st;
  try {
    st = await fs.promises.stat(file);
  } catch {
    return new Response('not found', { status: 404 });
  }
  const type = MIME[path.extname(file).toLowerCase()] || 'application/octet-stream';
  const range = /bytes=(\d*)-(\d*)/.exec(req.headers.get('range') || '');
  if (range && st.size > 0) {
    let start = range[1] ? +range[1] : st.size - +range[2];
    let end = range[1] && range[2] ? +range[2] : st.size - 1;
    start = Math.max(0, Math.min(start, st.size - 1));
    end = Math.max(start, Math.min(end, st.size - 1));
    return new Response(Readable.toWeb(fs.createReadStream(file, { start, end })), {
      status: 206,
      headers: { 'content-type': type, 'content-length': String(end - start + 1), 'content-range': `bytes ${start}-${end}/${st.size}`, 'accept-ranges': 'bytes', 'cache-control': 'no-cache', 'access-control-allow-origin': '*' },
    });
  }
  return new Response(Readable.toWeb(fs.createReadStream(file)), { headers: { 'content-type': type, 'content-length': String(st.size), 'accept-ranges': 'bytes', 'cache-control': 'no-cache', 'access-control-allow-origin': '*' } });
}

/** AI 連線：用 Chromium 網路堆疊（支援系統 Proxy），可設定逾時 */
const aborts = new Set();
async function netRequest(url, init) {
  // 只允許 Gemini 與 AI Horde（免費雲端畫面）
  if (!/^https:\/\/(generativelanguage\.googleapis\.com|aihorde\.net)\//.test(url)) throw new Error('不允許的網址');
  const ctl = new AbortController();
  aborts.add(ctl);
  const timer = init.timeoutMs ? setTimeout(() => ctl.abort(), init.timeoutMs) : null;
  try {
    const res = await net.fetch(url, { method: init.method, headers: init.headers, body: init.body, signal: ctl.signal });
    return { status: res.status, text: await res.text() };
  } catch (e) {
    if (ctl.signal.aborted) throw new Error('等待逾時');
    throw e;
  } finally {
    if (timer) clearTimeout(timer);
    aborts.delete(ctl);
  }
}

async function netDownload(url, headers, dest) {
  if (!/^https:\/\//.test(url)) throw new Error('不允許的網址');
  const res = await net.fetch(url, { headers, redirect: 'follow' });
  if (!res.ok || !res.body) throw new Error(`下載影片失敗（${res.status}）`);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  const tmp = dest + '.part';
  const out = fs.createWriteStream(tmp);
  const reader = res.body.getReader();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!out.write(Buffer.from(value))) await new Promise((r) => out.once('drain', r));
    }
  } finally {
    await new Promise((r) => out.end(r));
  }
  fs.renameSync(tmp, dest);
  return fs.statSync(dest).size;
}

function stopAll() {
  ff.cancel();
  for (const a of aborts) a.abort();
}

app.whenReady().then(() => {
  Menu.setApplicationMenu(process.platform === 'darwin' ? Menu.buildFromTemplate([{ role: 'appMenu' }, { role: 'editMenu' }, { role: 'windowMenu' }]) : null);
  protocol.handle(SCHEME, serveApp);
  protocol.handle(MEDIA, serveMedia);

  const h = (ch, fn) => ipcMain.handle(ch, (e, ...a) => fn(...a, e));

  h('app:info', async () => ({ version: app.getVersion(), platform: process.platform, arch: process.arch, ffmpeg: await ff.version().catch(() => ''), projectsRoot: projectsRoot() }));

  // 設定
  h('settings:get', () => {
    const s = readSettings();
    return { ...(s.app || {}), geminiKey: decKey(s.geminiKey) };
  });
  h('settings:set', (obj) => {
    const s = readSettings();
    const { geminiKey, ...rest } = obj || {};
    s.app = rest;
    if (geminiKey !== undefined) s.geminiKey = encKey(geminiKey);
    writeSettings(s);
    return true;
  });

  // 網路
  h('net:request', (url, init) => netRequest(url, init || {}));
  h('net:download', async (url, headers, dir, rel) => netDownload(url, headers || {}, projPath(dir, rel)));

  // 專案
  h('proj:root', () => projectsRoot());
  h('proj:list', async () => {
    const root = projectsRoot();
    const out = [];
    for (const n of await fs.promises.readdir(root).catch(() => [])) {
      const f = path.join(root, n, 'project.json');
      try {
        const st = await fs.promises.stat(f);
        const j = JSON.parse(await fs.promises.readFile(f, 'utf8'));
        out.push({ dir: path.join(root, n), title: j.title || n, updated: j.updated || st.mtime.toISOString(), shots: (j.shots || []).length, characters: (j.characters || []).length });
      } catch {}
    }
    return out.sort((a, b) => String(b.updated).localeCompare(String(a.updated)));
  });
  h('proj:create', (title) => {
    const dir = uniqueDir(projectsRoot(), safeName(title));
    for (const sub of ['角色', '鏡頭', '語音', '輸出']) fs.mkdirSync(path.join(dir, sub), { recursive: true });
    allowedDirs.add(norm(dir));
    return dir;
  });
  h('proj:load', async (dir) => {
    allowedDirs.add(norm(dir));
    return JSON.parse((await fs.promises.readFile(path.join(dir, 'project.json'), 'utf8')).replace(/^﻿/, ''));
  });
  h('proj:save', async (dir, data) => {
    const f = projPath(dir, 'project.json');
    const tmp = f + '.tmp';
    await fs.promises.writeFile(tmp, JSON.stringify(data, null, 2));
    await fs.promises.rename(tmp, f);
    return true;
  });
  h('proj:rename', (dir, title) => {
    const target = uniqueDir(path.dirname(dir), safeName(title));
    if (path.basename(dir) === safeName(title)) return dir;
    fs.renameSync(dir, target);
    allowedDirs.add(norm(target));
    return target;
  });
  h('proj:write', async (dir, rel, b64) => {
    const f = projPath(dir, rel);
    await fs.promises.mkdir(path.dirname(f), { recursive: true });
    await fs.promises.writeFile(f, Buffer.from(b64, 'base64'));
    return f;
  });
  h('proj:writeText', async (dir, rel, text) => {
    const f = projPath(dir, rel);
    await fs.promises.mkdir(path.dirname(f), { recursive: true });
    await fs.promises.writeFile(f, text);
    return f;
  });
  h('proj:read', async (dir, rel) => (await fs.promises.readFile(projPath(dir, rel))).toString('base64'));
  h('proj:exists', (dir, rel) => {
    try {
      return fs.existsSync(projPath(dir, rel));
    } catch {
      return false;
    }
  });
  h('proj:remove', async (dir, rel) => {
    const f = projPath(dir, rel);
    if (fs.existsSync(f)) await shell.trashItem(f).catch(() => fs.promises.rm(f, { force: true }));
    return true;
  });
  /** 把使用者選的檔案複製進專案（回傳相對路徑） */
  h('proj:import', async (dir, src, relDir, base) => {
    if (!inside(src)) throw new Error('沒有這個檔案的存取權');
    const ext = path.extname(src).toLowerCase() || '.png';
    let rel = path.join(relDir, `${safeName(base)}${ext}`);
    for (let i = 2; fs.existsSync(projPath(dir, rel)); i++) rel = path.join(relDir, `${safeName(base)}-${i}${ext}`);
    await fs.promises.mkdir(path.dirname(projPath(dir, rel)), { recursive: true });
    await fs.promises.copyFile(src, projPath(dir, rel));
    return rel.split(path.sep).join('/');
  });
  h('proj:abs', (dir, rel) => projPath(dir, rel));

  // 對話框
  h('dlg:images', async (multi) => {
    const r = await dialog.showOpenDialog(win, {
      title: '選擇圖片',
      properties: multi ? ['openFile', 'multiSelections'] : ['openFile'],
      filters: [{ name: '圖片', extensions: ['png', 'jpg', 'jpeg', 'webp', 'bmp'] }],
    });
    if (r.canceled) return [];
    r.filePaths.forEach((p) => allowedFiles.add(norm(p)));
    return r.filePaths;
  });
  h('dlg:story', async () => {
    const r = await dialog.showOpenDialog(win, { title: '開啟故事文案', properties: ['openFile'], filters: [{ name: '文字檔', extensions: ['txt', 'docx', 'md'] }] });
    if (r.canceled) return null;
    const p = r.filePaths[0];
    return { name: path.basename(p), b64: (await fs.promises.readFile(p)).toString('base64') };
  });
  h('dlg:project', async () => {
    const r = await dialog.showOpenDialog(win, { title: '開啟專案（選擇專案資料夾裡的 project.json）', defaultPath: projectsRoot(), properties: ['openFile'], filters: [{ name: '小柯影音專案', extensions: ['json'] }] });
    if (r.canceled) return null;
    const dir = path.dirname(r.filePaths[0]);
    allowedDirs.add(norm(dir));
    return dir;
  });
  h('file:allow', (p) => {
    allowedFiles.add(norm(p));
    return true;
  });

  // 語音（微軟免費神經語音）
  h('tts:edge', async (text, voice, pitch, rate, dir, rel) => {
    const dest = projPath(dir, rel);
    await edge.synth(text, voice, pitch, rate, dest);
    return dest;
  });

  // FFmpeg
  h('ff:probe', (file) => {
    if (!inside(file)) throw new Error('沒有這個檔案的存取權');
    return ff.probe(file);
  });
  h('ff:render', async (dir, plan, outRel, e) => {
    // 暫存放系統暫存區：專案若在 OneDrive，同步程式會鎖住暫存檔，刪除時出現 EPERM
    const tidy = (d) => {
      try {
        fs.rmSync(d, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 });
      } catch {}
    };
    tidy(projPath(dir, '輸出/_合成暫存')); // 舊版留下的暫存資料夾
    const work = fs.mkdtempSync(path.join(app.getPath('temp'), 'xiaoke-storyvideo-'));
    try {
      await ff.render(work, plan, (p, label) => {
        if (!e.sender.isDestroyed()) e.sender.send('ff:progress', { p, label });
      });
      const out = projPath(dir, outRel);
      fs.mkdirSync(path.dirname(out), { recursive: true });
      fs.copyFileSync(path.join(work, plan.outName), out);
      const srtOut = out.replace(/\.mp4$/i, '.srt');
      fs.writeFileSync(srtOut, '﻿' + plan.srt);
      return { video: out, srt: srtOut, size: fs.statSync(out).size };
    } finally {
      tidy(work);
    }
  });
  h('ff:cancel', () => ff.cancel());

  h('shell:reveal', (file) => {
    if (fs.existsSync(file)) shell.showItemInFolder(file);
    else shell.openPath(path.dirname(file));
  });
  h('shell:open', (file) => shell.openPath(file));
  h('shell:external', (url) => {
    if (/^https:\/\//.test(url)) shell.openExternal(url);
  });

  h('update:check', () => updater.check());
  h('update:download', (e) =>
    updater.download((got, total) => {
      if (!e.sender.isDestroyed()) e.sender.send('update:progress', { got, total });
    }),
  );
  h('update:install', (file) => {
    stopAll();
    return updater.install(file);
  });
  h('update:openPage', () => shell.openExternal(updater.info?.page || 'https://github.com/achir1015/xiaoke-storyvideo/releases/latest'));

  createWindow();
});

app.on('second-instance', () => {
  if (win) {
    if (win.isMinimized()) win.restore();
    win.focus();
  }
});

// 關閉視窗：停止所有 AI 連線與 FFmpeg，結束程式
app.on('before-quit', stopAll);
app.on('window-all-closed', () => {
  stopAll();
  app.quit();
});
