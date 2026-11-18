// 線上版端對端測試：vite preview ＋ 無頭 Chrome（CDP）
// 範例故事 → 九宮格 → 快速分鏡 → 九宮格畫面＋台灣口音雲端語音（1 句真的，其餘用測試音）→
// 瀏覽器裡算深度＋ffmpeg.wasm 合成 MP4＋SRT（燒錄字幕）→ 存在 IndexedDB、重新整理後還在。
// 用法：npm run build 後 node e2e/web.mjs [--cloud]（--cloud：多測一張 AI Horde 免費畫面）
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const PORT = 4179;
const CDP = 9378;
const CLOUD = process.argv.includes('--cloud');
const FF = join(process.cwd(), 'node_modules', 'ffmpeg-static', process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg');
const BROWSER =
  process.env.XK_BROWSER ||
  ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'].find(existsSync);
const work = mkdtempSync(join(tmpdir(), 'xksv-web-'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const tone = (i) => {
  const f = join(work, `t${i}.wav`);
  spawnSync(FF, ['-hide_banner', '-y', '-loglevel', 'error', '-f', 'lavfi', '-i', `sine=f=${300 + i * 40}:d=${1.5 + (i % 3) * 0.5}`, '-ar', '24000', '-ac', '1', f]);
  return readFileSync(f).toString('base64');
};
const grids = [0, 1, 2].map((i) => {
  const f = join(work, `g${i}.png`);
  spawnSync(FF, ['-hide_banner', '-y', '-loglevel', 'error', '-f', 'lavfi', '-i', `testsrc2=s=1200x1200,hue=h=${i * 120}`, '-frames:v', '1', f]);
  return readFileSync(f).toString('base64');
});

const server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'preview', '--port', String(PORT), '--strictPort', '--host', '127.0.0.1'], { stdio: 'ignore' });
const browser = spawn(BROWSER, ['--headless=new', `--remote-debugging-port=${CDP}`, `--user-data-dir=${join(work, 'profile')}`, '--no-first-run', '--autoplay-policy=no-user-gesture-required', '--window-size=1400,900', 'about:blank'], { stdio: 'ignore' });

let ok = 0;
let fail = 0;
const check = (name, cond, info = '') => {
  if (cond) ok++;
  else fail++;
  console.log(`${cond ? '✔' : '✘'} ${name}${info ? ` — ${info}` : ''}`);
};

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
  if (r.result?.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails).slice(0, 800));
  return r.result?.result?.value;
};
const waitFor = async (expr, ms = 60000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await evaluate(`return !!(${expr})`).catch(() => false)) return true;
    await sleep(300);
  }
  return false;
};
const shot = async (name) => {
  const r = await send('Page.captureScreenshot', { format: 'png' });
  if (r.result?.data) writeFileSync(join(work, name), Buffer.from(r.result.data, 'base64'));
};
const logs = [];

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
    if (m.method === 'Runtime.exceptionThrown') logs.push(m.params.exceptionDetails?.exception?.description ?? m.params.exceptionDetails?.text);
    if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') logs.push(m.params.args.map((a) => a.value ?? a.description).join(' '));
  });
  await send('Runtime.enable');
  await send('Page.enable');
  for (let i = 0; i < 40; i++) {
    try {
      if ((await fetch(`http://127.0.0.1:${PORT}/`)).ok) break;
    } catch {}
    await sleep(500);
  }
  await send('Page.navigate', { url: `http://127.0.0.1:${PORT}/?noguide` });

  check('畫面載入', await waitFor(`window.xkApp && document.querySelector('#proj-title').value`, 30000));
  check('線上版模式', await evaluate(`return document.body.classList.contains('web') && window.xk.web === true`));
  check('自動建立第一個專案', (await evaluate(`return xkApp.project().title`)) === '我的第一個故事');
  check('隱藏桌面版專用按鈕', await evaluate(`return getComputedStyle(document.querySelector('#proj-root')).display === 'none'`));
  await evaluate(`new MutationObserver(() => { const d = document.querySelector('dialog.xk-dialog[open] button[value="yes"]'); if (d) d.click(); }).observe(document.body, { childList: true, subtree: true }); return true`);

  await evaluate(`return await xkApp.useSample()`);
  check('範例故事＋專案改名', await waitFor(`xkApp.project().title === '漁港的早晨'`, 5000));

  await evaluate(`xkApp.setStep('cast')`);
  const n = await evaluate(`
    const s = xkApp.studio(); const g = ${JSON.stringify(grids)};
    for (const [i, c] of s.p.characters.entries()) c.sheet = await s.writeMedia('角色/' + c.id + '-九宮格.png', { mime: 'image/png', data: g[i % 3] });
    s.touch(); xkApp.rerender(); return s.p.characters.filter(c => c.sheet).length`);
  check('九宮格存進瀏覽器', n === 3);
  check('九宮格縮圖顯示（blob 網址）', await waitFor(`document.querySelectorAll('#cast .sheet[style*="blob:"]').length === 3`, 10000));

  await evaluate(`xkApp.setStep('board'); xkApp.setBoardEngine('rule')`);
  await evaluate(`await xkApp.autoBoard()`);
  const shotsN = await evaluate(`return xkApp.project().shots.length`);
  check('自動分鏡', shotsN >= 5, `${shotsN} 個鏡頭`);
  await evaluate(`const p = xkApp.project(); p.shots = p.shots.slice(0, 3); xkApp.studio().touch(); return true`);

  // 畫面：九宮格
  await evaluate(`xkApp.setStep('make'); xkApp.setVideoEngine('photo'); xkApp.setStillEngine('sheet')`);
  await evaluate(`await xkApp.makeAll('stills')`);
  const stillOk = await evaluate(`const s = xkApp.studio(); return s.p.shots.map(x => s.shotState(x).stillOk)`);
  check('每個鏡頭都有畫面', stillOk.every(Boolean), JSON.stringify(stillOk));
  check('配音選項顯示台灣口音、隱藏微軟語音', await evaluate(`const b = [...document.querySelectorAll('#voice-seg button')]; return b.find(x => x.dataset.v === 'taiwan').classList.contains('on') && getComputedStyle(b.find(x => x.dataset.v === 'edge')).display === 'none'`));

  // 配音：第一句真的用台灣口音雲端語音，其餘放測試音
  const t0 = Date.now();
  const real = await evaluate(`
    const s = xkApp.studio(); const sh = s.p.shots.find(x => x.lines.length);
    try { await s.genVoice(sh, 0); } catch (e) { return { err: String(e.message || e) }; }
    return { engine: s.engineFor(s.speakerOf(sh.lines[0].speaker)), audio: sh.lines[0].audio, dur: sh.lines[0].dur }`);
  check('台灣口音雲端語音（真的連線）', !real.err && real.engine === 'taiwan' && real.dur > 0.5, real.err ?? `${real.audio}・${real.dur} 秒・${((Date.now() - t0) / 1000).toFixed(0)} 秒`);
  const tones = Array.from({ length: 12 }, (_, i) => tone(i));
  await evaluate(`
    const s = xkApp.studio(); const t = ${JSON.stringify(tones)}; let k = 0;
    for (const sh of s.p.shots) for (const [i, l] of sh.lines.entries()) {
      if (l.audio && l.audioKey === s.audioKey(l)) continue;
      l.audio = await s.writeMedia('語音/' + sh.id + '-' + (i + 1) + '.wav', { mime: 'audio/wav', data: t[k++ % t.length] });
      l.dur = (await window.xk.ff.probe(await s.abs(l.audio))).dur; l.audioKey = s.audioKey(l);
    }
    s.touch(); return true`);
  const voicesOk = await evaluate(`const s = xkApp.studio(); return s.p.shots.every(x => s.shotState(x).voicesOk)`);
  check('每句都有配音、長度已量測', voicesOk);

  if (CLOUD) {
    const t1 = Date.now();
    const h = await evaluate(`
      const s = xkApp.studio(); const sh = s.p.shots[0]; xkApp.setStillEngine('horde');
      try { await s.genStillHorde(sh, () => {}, { canceled: false }); } catch (e) { return { err: String(e.message || e) }; }
      return { still: sh.still, ok: s.shotState(sh).stillOk }`);
    check('AI Horde 免費畫面（線上版）', !h.err && h.ok, h.err ?? `${h.still}・${((Date.now() - t1) / 1000).toFixed(0)} 秒`);
  }
  await shot('web-4-製作.png');

  // 合成（含深度估計、立體動態照片、燒錄字幕）
  await evaluate(`xkApp.setStep('out'); xkApp.project().output.burnSubs = true; return true`);
  const t2 = Date.now();
  const err = await evaluate(`try { await xkApp.render(); return ''; } catch (e) { return String(e.message || e); }`);
  const out = await evaluate(`return xkApp.project().output`);
  check('合成影片', !err && !!out.lastVideo, err || `${out.lastVideo}・${((Date.now() - t2) / 1000).toFixed(0)} 秒`);
  const depthN = await evaluate(`return xkApp.project().shots.filter(s => s.depth).length`);
  check('瀏覽器算出深度圖', depthN === 3, `${depthN} 張`);
  if (out.lastVideo) {
    const b64 = await evaluate(`return await window.xk.proj.read(xkApp.studio().dir, xkApp.project().output.lastVideo)`);
    const mp4 = join(work, 'out.mp4');
    writeFileSync(mp4, Buffer.from(b64, 'base64'));
    const probe = spawnSync(FF, ['-hide_banner', '-i', mp4], { encoding: 'utf8' }).stderr;
    check('影片含 H.264＋AAC＋字幕軌', /Video: h264/.test(probe) && /Audio: aac/.test(probe) && /Subtitle: mov_text/.test(probe));
    const total = await evaluate(`return xkApp.studio().timeline().total`);
    const dur = +(/Duration: 00:(\d+):(\d+\.\d+)/.exec(probe) ?? []).slice(1).reduce((a, x, i) => a + (i ? +x : +x * 60), 0);
    check('影片長度等於時間軸', Math.abs(dur - total) < 0.4, `${dur.toFixed(2)} / ${total.toFixed(2)} 秒`);
    spawnSync(FF, ['-hide_banner', '-y', '-loglevel', 'error', '-ss', '1.5', '-i', mp4, '-frames:v', '1', join(work, 'frame.png')]);
    const srt = await evaluate(`return atob(await window.xk.proj.read(xkApp.studio().dir, xkApp.project().output.lastSrt))`);
    check('SRT 逐字稿', /-->/.test(srt));
    check('播放器載入影片', await waitFor(`document.querySelector('#player').src.startsWith('blob:')`, 10000));
  }
  await shot('web-5-輸出.png');

  // 重新整理後專案還在
  await evaluate(`await xkApp.save(); return true`);
  await send('Page.reload');
  await sleep(1500);
  check('重新整理後專案還在', await waitFor(`window.xkApp && xkApp.project().title === '漁港的早晨' && xkApp.project().output.lastVideo`, 30000));
} catch (e) {
  fail++;
  console.log('✘ 例外：', e.message);
  await shot('error.png').catch(() => {});
} finally {
  if (logs.length) console.log('頁面錯誤：\n  ' + logs.slice(0, 10).join('\n  '));
  console.log(`\n${ok} 項通過、${fail} 項失敗　截圖與輸出：${work}`);
  browser.kill();
  server.kill();
  process.exit(fail ? 1 : 0);
}
