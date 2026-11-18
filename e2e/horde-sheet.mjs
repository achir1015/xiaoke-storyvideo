// 免費雲端九宮格（AI Horde）實測：範例故事的第一位角色（只有外觀文字）→ 畫九個角度 → 拼成九宮格。
// 用法：node e2e/horde-sheet.mjs [模型]；XK_EXE 指定打包版
import { spawn, spawnSync } from 'node:child_process';
import { copyFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const PORT = 9373;
const MAC = process.platform === 'darwin';
const model = process.argv[2] || '';
const exe = process.env.XK_EXE;
const electron = MAC
  ? join(process.cwd(), 'node_modules', 'electron', 'dist', 'Electron.app', 'Contents', 'MacOS', 'Electron')
  : join(process.cwd(), 'node_modules', 'electron', 'dist', 'electron.exe');
const FF = join(process.cwd(), 'node_modules', 'ffmpeg-static', MAC ? 'ffmpeg' : 'ffmpeg.exe');
const work = mkdtempSync(join(tmpdir(), 'xksv-sheet-'));
const out = process.env.XK_SHOTS || work;
const env = { ...process.env, XK_USER_DATA: join(work, 'userdata'), XK_PROJECTS: join(work, '專案'), XK_QUERY: 'noguide' };
const child = exe ? spawn(exe, [`--remote-debugging-port=${PORT}`], { stdio: 'ignore', env }) : spawn(electron, ['.', `--remote-debugging-port=${PORT}`], { stdio: 'ignore', env });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let ok = 0;
let fail = 0;
const check = (name, cond, info = '') => {
  if (cond) ok++;
  else fail++;
  console.log(`${cond ? '✔' : '✘'} ${name}${info ? ` — ${info}` : ''}`);
};

// 測試用九宮格：用 FFmpeg 畫的人像替代品（只是測流程）
const grid = join(work, 'grid.png');
spawnSync(FF, ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=s=1200x1200', '-frames:v', '1', grid]);

let page;
for (let i = 0; i < 60 && !page; i++) {
  try {
    page = (await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()).find((t) => t.type === 'page' && t.url.startsWith('xkstory://'));
  } catch {}
  if (!page) await sleep(500);
}
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener('open', r, { once: true }));
let seq = 0;
const ev = (expression) =>
  new Promise((resolve) => {
    const id = ++seq;
    const h = (e) => {
      const m = JSON.parse(e.data);
      if (m.id !== id) return;
      ws.removeEventListener('message', h);
      resolve(m.result?.exceptionDetails ? { error: m.result.exceptionDetails.exception?.description?.slice(0, 500) } : m.result?.result?.value);
    };
    ws.addEventListener('message', h);
    ws.send(JSON.stringify({ id, method: 'Runtime.evaluate', params: { expression: `(async () => { ${expression} })()`, awaitPromise: true, returnByValue: true } }));
  });

for (let i = 0; i < 60 && !(await ev(`return !!(window.xkApp && window.xkApp.studio && window.xkApp.studio().dir)`)); i++) await sleep(500);
await ev(`await xkApp.useSample()`);
await ev(`xkApp.setStillEngine('horde'${model ? `, ${JSON.stringify(model)}` : ''})`);
const t0 = Date.now();
const r = await ev(`
  const c = xkApp.project().characters[0];
  c.sheet = undefined;
  let last = '';
  try {
    const rel = await xkApp.studio().genSheetHorde(c, (d, t, st) => { last = d + '/' + t + ' ' + JSON.stringify(st || {}); });
    return { ok: true, rel, name: c.name, look: c.look };
  } catch (e) { return { ok: false, err: e.message, last }; }
`);
check('免費雲端九宮格', r?.ok, r?.ok ? `${r.name}・${Math.round((Date.now() - t0) / 1000)} 秒・${r.rel}` : JSON.stringify(r));
if (r?.ok) {
  const dir = await ev(`return xkApp.studio().dir`);
  copyFileSync(join(dir, r.rel), join(out, 'sheet.jpg'));
  const cells = await ev(`return (await xkApp.studio().gridCells(${JSON.stringify(r.rel)})).length`);
  check('切得出九格', cells === 9, String(cells));
  const left = await ev(`return (await window.xk.proj.list()).length >= 0 && !(await window.xk.proj.exists(xkApp.studio().dir, '角色/' + xkApp.project().characters[0].id + '-格1.webp'))`);
  check('暫存的單張已刪除', left === true);
}
console.log(`\n${ok} 項通過、${fail} 項失敗　檔案：${out}`);
ws.close();
child.kill();
process.exit(fail ? 1 : 0);
