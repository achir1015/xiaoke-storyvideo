// 手機／平板版面檢查：無頭 Chrome 模擬 iPhone（393×852）與 iPad（820×1180），
// 五個步驟與設定都截圖，並找出超出螢幕寬度的元素。用法：npm run build 後 node --experimental-websocket e2e/phone-layout.mjs [網址]
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const PORT = 4180;
const CDP = 9380;
const URL_ARG = process.argv[2];
const BROWSER = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'].find(existsSync);
const work = mkdtempSync(join(tmpdir(), 'xksv-phone-'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const server = URL_ARG ? null : spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'preview', '--port', String(PORT), '--strictPort', '--host', '127.0.0.1'], { stdio: 'ignore' });
const browser = spawn(BROWSER, ['--headless=new', `--remote-debugging-port=${CDP}`, `--user-data-dir=${join(work, 'profile')}`, '--no-first-run', 'about:blank'], { stdio: 'ignore' });

let ws;
let seq = 0;
const pending = new Map();
const send = (method, params = {}) =>
  new Promise((r) => {
    const id = ++seq;
    pending.set(id, r);
    ws.send(JSON.stringify({ id, method, params }));
  });
const evaluate = async (expr) => {
  const r = await send('Runtime.evaluate', { expression: `(async () => { ${expr} })()`, awaitPromise: true, returnByValue: true });
  if (r.result?.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails).slice(0, 600));
  return r.result?.result?.value;
};
const overflow = () =>
  evaluate(`const W = document.documentElement.clientWidth; const out = [];
    for (const el of document.querySelectorAll('body *')) {
      const cs = getComputedStyle(el); if (cs.display === 'none' || cs.visibility === 'hidden') continue;
      const r = el.getBoundingClientRect(); if (!r.width || r.right <= W + 1 || r.left > W) continue;
      let p = el.parentElement, clipped = false;
      while (p && p !== document.body) { const s = getComputedStyle(p); if (/(auto|scroll|hidden)/.test(s.overflowX)) { clipped = true; break; } p = p.parentElement; }
      if (!clipped) out.push((el.id ? '#' + el.id : el.tagName.toLowerCase() + (el.className && typeof el.className === 'string' ? '.' + el.className.split(' ')[0] : '')) + ' ' + Math.round(r.left) + '→' + Math.round(r.right));
    }
    return [...new Set(out)].slice(0, 12);`);

let problems = 0;
try {
  let page;
  for (let i = 0; i < 60 && !page; i++) {
    try {
      page = (await (await fetch(`http://127.0.0.1:${CDP}/json/list`)).json()).find((t) => t.type === 'page');
    } catch {}
    await sleep(500);
  }
  ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((r) => ws.addEventListener('open', r, { once: true }));
  ws.addEventListener('message', (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) {
      pending.get(m.id)(m);
      pending.delete(m.id);
    }
  });
  await send('Page.enable');
  if (server)
    for (let i = 0; i < 40; i++) {
      try {
        if ((await fetch(`http://127.0.0.1:${PORT}/`)).ok) break;
      } catch {}
      await sleep(500);
    }
  const base = URL_ARG ?? `http://127.0.0.1:${PORT}/`;
  for (const dev of [
    { name: 'iPhone', width: 393, height: 852, scale: 3 },
    { name: 'iPad', width: 820, height: 1180, scale: 2 },
  ]) {
    await send('Emulation.setDeviceMetricsOverride', { width: dev.width, height: dev.height, deviceScaleFactor: 1, mobile: true });
    await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
    await send('Emulation.setUserAgentOverride', { userAgent: `Mozilla/5.0 (${dev.name === 'iPad' ? 'iPad' : 'iPhone'}; CPU OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1` });
    await send('Page.navigate', { url: `${base}?noguide` });
    await sleep(2500);
    await evaluate(`for (let i = 0; i < 50 && !window.xkApp?.project(); i++) await new Promise(r => setTimeout(r, 200)); if (!xkApp.project().story) await xkApp.useSample(); return true`);
    await evaluate(`new MutationObserver(() => { const d = document.querySelector('dialog.xk-dialog[open] button[value="yes"]'); if (d) d.click(); }).observe(document.body, { childList: true, subtree: true }); return true`);
    if (!(await evaluate(`return xkApp.project().shots.length`))) await evaluate(`xkApp.setStep('board'); xkApp.setBoardEngine('rule'); await xkApp.autoBoard(); return true`);
    for (const st of ['story', 'cast', 'board', 'make', 'out', 'settings']) {
      if (st === 'settings') await evaluate(`document.querySelector('#settings-btn').click(); return true`);
      else await evaluate(`xkApp.setStep('${st}'); return true`);
      await sleep(600);
      const o = await overflow();
      if (o.length) problems++;
      console.log(`${o.length ? '✘' : '✔'} ${dev.name} ${st}${o.length ? ' 超出：' + o.join('、') : ''}`);
      const r = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
      writeFileSync(join(work, `${dev.name}-${st}.png`), Buffer.from(r.result.data, 'base64'));
      if (st === 'settings') await evaluate(`document.querySelector('#settings-dlg').close(); return true`);
    }
  }
} catch (e) {
  problems++;
  console.log('✘ 例外：', e.message);
} finally {
  console.log(`\n${problems ? `${problems} 個畫面有問題` : '全部畫面寬度正常'}　截圖：${work}`);
  browser.kill();
  server?.kill();
  process.exit(problems ? 1 : 0);
}
