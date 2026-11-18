// 免費雲端畫面（AI Horde）實測：範例故事 → 快速切段 → 用 AI Horde 產生兩個鏡頭的畫面
// （遠景用文字產生、近景／特寫用九宮格當參考）→ 立體動態照片合成。會真的排隊，通常 5–20 分鐘。
// 用法：node e2e/horde-still.mjs [模型]；XK_EXE 指定打包版
import { spawn, spawnSync } from 'node:child_process';
import { copyFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const PORT = 9374;
const MAC = process.platform === 'darwin';
const model = process.argv[2] || '';
const exe = process.env.XK_EXE;
const electron = MAC
  ? join(process.cwd(), 'node_modules', 'electron', 'dist', 'Electron.app', 'Contents', 'MacOS', 'Electron')
  : join(process.cwd(), 'node_modules', 'electron', 'dist', 'electron.exe');
const FF = join(process.cwd(), 'node_modules', 'ffmpeg-static', MAC ? 'ffmpeg' : 'ffmpeg.exe');
const work = mkdtempSync(join(tmpdir(), 'xksv-horde-'));
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
await ev(`const st = xkApp.studio(); for (const c of xkApp.project().characters) { await window.xk.allow(${JSON.stringify(grid)}); c.sheet = await window.xk.proj.import(st.dir, ${JSON.stringify(grid)}, '角色', c.id + '-九宮格'); } st.touch();`);
await ev(`xkApp.setBoardEngine('rule'); await xkApp.autoBoard();`);
await ev(`xkApp.setStillEngine('horde'${model ? `, ${JSON.stringify(model)}` : ''})`);
const pick = await ev(`
  const shots = xkApp.project().shots;
  const st = xkApp.studio();
  const wide = shots.findIndex((s) => s.shotType === '遠景');
  const close = shots.findIndex((s) => (s.shotType === '近景' || s.shotType === '特寫') && st.castOf(s).length === 1);
  if (close >= 0) shots[close].shotType = '特寫';
  return [wide, close >= 0 ? close : 1];
`);
console.log('測試鏡頭', JSON.stringify(pick));
const t0 = Date.now();
const results = await Promise.all(
  pick.map((i) =>
    ev(`
      const s = xkApp.project().shots[${i}];
      const t = Date.now();
      let last = '';
      try {
        await xkApp.studio().genStillHorde(s, (h) => { last = JSON.stringify(h); });
        return { ok: true, sec: Math.round((Date.now() - t) / 1000), still: s.still, key: s.stillKey, type: s.shotType };
      } catch (e) { return { ok: false, err: e.message, last }; }
    `),
  ),
);
for (const [k, r] of results.entries()) check(`鏡頭 ${pick[k] + 1} 免費雲端畫面`, r?.ok, r?.ok ? `${r.type}・${r.sec} 秒・${r.still}` : JSON.stringify(r));
console.log(`畫面總共 ${Math.round((Date.now() - t0) / 1000)} 秒`);
const state = await ev(`return xkApp.project().shots.filter((s, i) => ${JSON.stringify(pick)}.includes(i)).map((s) => xkApp.studio().shotState(s).stillOk)`);
check('畫面狀態為最新', Array.isArray(state) && state.every(Boolean), JSON.stringify(state));

// 只留這兩鏡合成（其他鏡頭沒有畫面會是空白），用立體動態照片
await ev(`const p = xkApp.project(); p.shots = p.shots.filter((s, i) => ${JSON.stringify(pick)}.includes(i)); xkApp.setVideoEngine('photo'); xkApp.studio().touch();`);
await ev(`await xkApp.makeAll('voices')`);
const r = await ev(`try { await xkApp.render(); return xkApp.project().output.lastVideo; } catch (e) { return 'ERR ' + e.message; }`);
check('立體動態照片合成', typeof r === 'string' && !r.startsWith('ERR'), r);
const depths = await ev(`return xkApp.project().shots.map((s) => !!s.depth && s.depthKey === xkApp.studio().depthKeyOf(s))`);
check('每個畫面都有深度圖', Array.isArray(depths) && depths.every(Boolean), JSON.stringify(depths));
const dir = await ev(`return xkApp.studio().dir`);
for (const [k, res] of results.entries()) {
  if (!res?.ok) continue;
  copyFileSync(join(dir, res.still), join(out, `horde-${k + 1}.webp`));
}
if (typeof r === 'string' && !r.startsWith('ERR')) copyFileSync(join(dir, r), join(out, 'horde-render.mp4'));
console.log(`\n${ok} 項通過、${fail} 項失敗　檔案：${out}`);
ws.close();
child.kill();
process.exit(fail ? 1 : 0);
