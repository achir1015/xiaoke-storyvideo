// 檢查更新實測：啟動 XK_EXE（預設已安裝版），呼叫程式內的檢查更新，印出 GitHub 上讀到的版本與安裝檔
import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const PORT = 9378;
const exe = process.env.XK_EXE || join(process.env.LOCALAPPDATA || '', 'Programs', 'XiaokeStoryVideo', 'XiaokeStoryVideo.exe');
const env = { ...process.env, XK_USER_DATA: mkdtempSync(join(tmpdir(), 'xksv-upd-')), XK_QUERY: 'noguide' };
const child = spawn(exe, [`--remote-debugging-port=${PORT}`], { stdio: 'ignore', env });
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
let seq = 0;
const ask = (expression) => new Promise((resolve) => {
  const id = ++seq;
  const h = (e) => {
    const m = JSON.parse(e.data);
    if (m.id !== id) return;
    ws.removeEventListener('message', h);
    resolve(m.result?.result?.value);
  };
  ws.addEventListener('message', h);
  ws.send(JSON.stringify({ id, method: 'Runtime.evaluate', params: { expression, awaitPromise: true, returnByValue: true } }));
});
// 等網頁載入完成（剛連上時可能還在換頁）
for (let i = 0; i < 40 && !(await ask(`!!(window.xkApp && window.xk && document.readyState === 'complete')`)); i++) await sleep(500);
await sleep(1000);
const res = await ask(`(async () => { try { return await window.xk.update.check(); } catch (e) { return { error: e.message }; } })()`);
console.log(JSON.stringify({ ...res, notes: res?.notes ? `${res.notes.slice(0, 40)}…` : '' }, null, 2));
ws.close();
child.kill();
process.exit(res && !res.error && res.latest ? 0 : 1);
