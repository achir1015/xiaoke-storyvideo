// 本機小模型分鏡實測：用範例故事跑「本機小模型」分鏡，印出速度與每個鏡頭的結果。
// 模型會下載到固定的 userData（XK_LLM_DATA，預設暫存資料夾），第二次起從快取載入。
// 用法：node e2e/local-board.mjs [Qwen3.5-2B|Qwen3.5-4B]；XK_EXE 指定打包版
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const PORT = 9376;
const MAC = process.platform === 'darwin';
const model = process.argv[2] || 'Qwen3.5-2B';
const exe = process.env.XK_EXE;
const electron = MAC
  ? join(process.cwd(), 'node_modules', 'electron', 'dist', 'Electron.app', 'Contents', 'MacOS', 'Electron')
  : join(process.cwd(), 'node_modules', 'electron', 'dist', 'electron.exe');
const userData = process.env.XK_LLM_DATA || join(tmpdir(), 'xksv-llm-userdata');
mkdirSync(userData, { recursive: true });
const env = { ...process.env, XK_USER_DATA: userData, XK_PROJECTS: mkdtempSync(join(tmpdir(), 'xksv-llm-proj-')), XK_QUERY: 'noguide' };
const child = exe ? spawn(exe, [`--remote-debugging-port=${PORT}`], { stdio: 'ignore', env }) : spawn(electron, ['.', `--remote-debugging-port=${PORT}`], { stdio: 'ignore', env });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let page;
for (let i = 0; i < 60 && !page; i++) {
  try {
    page = (await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()).find((t) => t.type === 'page' && t.url.startsWith('xkstory://'));
  } catch {
    // 還沒啟動
  }
  if (!page) await sleep(500);
}
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener('open', r, { once: true }));
// 印出程式的警告與錯誤（本機分鏡失敗原因）
ws.addEventListener('message', (e) => {
  const m = JSON.parse(e.data);
  if (m.method === 'Runtime.consoleAPICalled' && /warn|error/.test(m.params.type)) console.log('  [console]', m.params.args.map((a) => a.value ?? a.description).join(' ').slice(0, 300));
});
ws.send(JSON.stringify({ id: 99999, method: 'Runtime.enable' }));
let seq = 0;
const ev = (expression) =>
  new Promise((resolve) => {
    const id = ++seq;
    const h = (e) => {
      const m = JSON.parse(e.data);
      if (m.id !== id) return;
      ws.removeEventListener('message', h);
      resolve(m.result?.exceptionDetails ? { error: m.result.exceptionDetails.exception?.description } : m.result?.result?.value);
    };
    ws.addEventListener('message', h);
    ws.send(JSON.stringify({ id, method: 'Runtime.evaluate', params: { expression, awaitPromise: true, returnByValue: true } }));
  });

for (let i = 0; i < 60 && !(await ev(`!!(window.xkApp && window.xkApp.studio && window.xkApp.studio())`)); i++) await sleep(500);
await sleep(1000);
console.log('WebGPU', JSON.stringify(await ev(`(async () => { const a = await navigator.gpu?.requestAdapter(); return a ? { f16: a.features.has('shader-f16'), info: a.info?.description || a.info?.vendor } : null })()`)));
await ev(`window.xkApp.useSample()`);
await ev(`window.xkApp.setBoardEngine('local', ${JSON.stringify(model)})`);
await ev(`window.xkApp.setStep('board')`);
const t0 = Date.now();
ev(`window.xkApp.autoBoard()`);
let last = '';
let started = false;
for (let i = 0; i < 3600; i++) {
  await sleep(1000);
  // 自動按下「開始下載」「重新分鏡」等確認框
  const msg = await ev(`(() => { const d = document.querySelector('dialog[open]:not(#settings-dlg):not(#proj-dlg)'); if (!d) return ''; const t = d.innerText.replace(/\\s+/g, ' ').slice(0, 300); const b = d.querySelector('button[value=yes]'); if (b) b.click(); else d.querySelector('button.primary')?.click(); return t; })()`);
  if (msg) console.log(`${Math.round((Date.now() - t0) / 1000)}s 對話框：${msg}`);
  const st = await ev(`({ busy: window.xkApp.busy(), txt: document.querySelector('#board-progress .txt')?.textContent || '', hidden: document.querySelector('#board-progress').hidden })`);
  if (st.busy) started = true;
  if (st.txt && st.txt !== last && (i % 5 === 0 || /分鏡/.test(st.txt))) {
    console.log(`${Math.round((Date.now() - t0) / 1000)}s`, st.txt);
    last = st.txt;
  }
  if (started && !st.busy) break;
}
const sec = Math.round((Date.now() - t0) / 1000);
const shots = await ev(`window.xkApp.project().shots.map(s => ({ t: s.shotType, scene: s.scene, tod: s.timeOfDay, k: s.kelvin, lens: s.lens, move: s.move, amb: s.ambience, visual: s.visual, prompt: (s.prompt||'').slice(0, 160), lines: s.lines.map(l => (l.emotion ? '[' + l.emotion + ']' : '') + l.text.slice(0, 14)).join(' / ') }))`);
const toast = await ev(`document.querySelector('#toast')?.textContent`);
console.log(`\n總共 ${sec} 秒・${toast}`);
for (const [i, s] of (shots || []).entries()) console.log(`\n#${i + 1} ${s.t}｜${s.scene}｜${s.tod}｜${s.k}K｜${s.lens}mm｜${s.move}｜${s.amb}\n   ${s.visual}\n   ${s.prompt}\n   ${s.lines}`);
ws.close();
child.kill();
process.exit(0);
