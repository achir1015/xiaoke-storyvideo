// Android 實機測試：python android/build.py debug 建除錯版後執行 node --experimental-websocket e2e/android.mjs
// 會自動 adb 安裝、啟動、轉接 WebView 除錯埠，然後在手機上：範例故事 → 九宮格 → 快速分鏡 → 九宮格畫面＋測試配音 →
// 手機上算深度＋ffmpeg.wasm 合成 MP4 → 存到「影片/小柯故事影音」→ 檢查更新。
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const ADB = process.env.ADB || 'E:/小米觸控音箱/tools/android-sdk/platform-tools/adb.exe';
const SERIAL = process.env.ANDROID_SERIAL || 'R5CY236CQ3B';
const PKG = 'com.achir.xiaokestoryvideo';
const PORT = 9336;
const APK = join(process.cwd(), 'android', 'build', 'XiaokeStoryVideo.apk');
const FF = join(process.cwd(), 'node_modules', 'ffmpeg-static', process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg');
const adb = (...a) => execFileSync(ADB, ['-s', SERIAL, ...a], { encoding: 'utf8', env: { ...process.env, MSYS_NO_PATHCONV: '1' } });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const work = mkdtempSync(join(tmpdir(), 'xksv-android-'));

let ok = 0;
let fail = 0;
const check = (name, cond, info = '') => {
  if (cond) ok++;
  else fail++;
  console.log(`${cond ? '✔' : '✘'} ${name}${info ? ` — ${info}` : ''}`);
};

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

if (!process.argv.includes('--no-install')) {
  console.log(adb('install', '-r', APK).trim().split('\n').pop());
  adb('shell', 'pm', 'clear', PKG);
}
adb('shell', 'am', 'start', '-n', `${PKG}/.MainActivity`);
await sleep(4000);
const pid = adb('shell', 'pidof', PKG).trim();
adb('forward', `tcp:${PORT}`, `localabstract:webview_devtools_remote_${pid}`);

let ws;
let seq = 0;
const pending = new Map();
const evaluate = async (expr) => {
  const r = await new Promise((res) => {
    const id = ++seq;
    pending.set(id, res);
    ws.send(JSON.stringify({ id, method: 'Runtime.evaluate', params: { expression: `(async () => { ${expr} })()`, awaitPromise: true, returnByValue: true } }));
  });
  if (r.result?.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails).slice(0, 600));
  return r.result?.result?.value;
};
const waitFor = async (expr, ms = 60000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await evaluate(`return !!(${expr})`).catch(() => false)) return true;
    await sleep(400);
  }
  return false;
};

try {
  let page;
  for (let i = 0; i < 30 && !page; i++) {
    try {
      page = (await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()).find((t) => t.type === 'page');
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

  check('畫面載入', await waitFor(`window.xkApp && xkApp.project()`, 30000));
  // 第一次開啟會自動開始語音教學：關掉
  await waitFor(`document.querySelector('.xk-guide')`, 4000);
  await evaluate(`document.querySelector('.xk-guide .xk-close, .xk-guide [data-act="close"], .xk-guide button:last-child')?.click(); return 1`);
  check('Android 橋接', await evaluate(`return typeof window.XiaokeAndroid?.beginSave === 'function' && typeof window.XiaokeAndroid.keepAwake === 'function'`));
  check('系統語音可用（語音教學）', await evaluate(`return window.XiaokeAndroid.ttsAvailable()`));
  check('線上版模式＋Android 標記', await evaluate(`return document.body.classList.contains('web') && document.body.classList.contains('android-app')`));
  check('沒有超出螢幕寬度', await evaluate(`return document.documentElement.scrollWidth <= innerWidth + 1`), await evaluate(`return document.documentElement.scrollWidth + ' / ' + innerWidth`));
  await evaluate(`new MutationObserver(() => { const d = document.querySelector('dialog.xk-dialog[open] button[value="yes"]'); if (d) d.click(); }).observe(document.body, { childList: true, subtree: true }); return 1`);

  await evaluate(`return await xkApp.useSample()`);
  check('範例故事', await waitFor(`xkApp.project().title === '漁港的早晨'`, 8000));
  await evaluate(`xkApp.setStep('cast'); const s = xkApp.studio(); const g = ${JSON.stringify(grids)};
    for (const [i, c] of s.p.characters.entries()) c.sheet = await s.writeMedia('角色/' + c.id + '-九宮格.png', { mime: 'image/png', data: g[i % 3] });
    s.touch(); xkApp.rerender(); return 1`);
  check('九宮格縮圖', await waitFor(`document.querySelectorAll('#cast .sheet[style*="blob:"]').length === 3`, 10000));
  await evaluate(`xkApp.setStep('board'); xkApp.setBoardEngine('rule'); await xkApp.autoBoard(); const p = xkApp.project(); p.shots = p.shots.slice(0, 2); xkApp.studio().touch(); return 1`);
  check('分鏡', (await evaluate(`return xkApp.project().shots.length`)) === 2);
  await evaluate(`xkApp.setStep('make'); xkApp.setVideoEngine('photo'); xkApp.setStillEngine('sheet'); await xkApp.makeAll('stills'); return 1`);
  check('畫面', await evaluate(`const s = xkApp.studio(); return s.p.shots.every(x => s.shotState(x).stillOk)`));
  const tones = Array.from({ length: 8 }, (_, i) => tone(i));
  await evaluate(`const s = xkApp.studio(); const t = ${JSON.stringify(tones)}; let k = 0;
    for (const sh of s.p.shots) for (const [i, l] of sh.lines.entries()) {
      l.audio = await s.writeMedia('語音/' + sh.id + '-' + (i + 1) + '.wav', { mime: 'audio/wav', data: t[k++ % t.length] });
      l.dur = (await window.xk.ff.probe(await s.abs(l.audio))).dur; l.audioKey = s.audioKey(l);
    }
    s.touch(); return 1`);
  check('配音（測試音）長度已量測', await evaluate(`const s = xkApp.studio(); return s.p.shots.every(x => s.shotState(x).voicesOk)`));

  await evaluate(`xkApp.setStep('out'); xkApp.project().output.burnSubs = true; return 1`);
  const t0 = Date.now();
  const err = await evaluate(`try { await xkApp.render(); return ''; } catch (e) { return String(e.message || e); }`);
  const out = await evaluate(`return xkApp.project().output`);
  const dialog = await evaluate(`return document.querySelector('dialog[open]')?.textContent?.slice(0, 300) ?? ''`);
  check('手機上合成影片（深度＋ffmpeg.wasm＋字幕）', !err && !!out.lastVideo, err || dialog || `${out.lastVideo}・${((Date.now() - t0) / 1000).toFixed(0)} 秒`);
  check('播放器載入影片', await waitFor(`document.querySelector('#player').src.startsWith('blob:')`, 10000));

  const name = await evaluate(`return xkApp.project().output.lastVideo.split('/').pop()`);
  await evaluate(`document.querySelector('#open-video').click(); return 1`);
  await sleep(3000);
  const ls = adb('shell', 'ls', '-l', '/sdcard/Movies/小柯故事影音/');
  check('影片存到「影片/小柯故事影音」', ls.includes(name), ls.trim().split('\n').pop());
  check('按鈕文字「存影片」', /存影片/.test(await evaluate(`return document.querySelector('#open-video').textContent`)));

  const upd = JSON.parse(await evaluate(`return window.XiaokeAndroid.checkUpdate()`));
  check('檢查更新（GitHub）', upd.status === 'ok' && !!upd.latest, `目前 ${upd.current}，最新 ${upd.latest}`);
  check('返回鍵回上一步', (await evaluate(`return window.__xkBack()`)) === true && (await evaluate(`return document.querySelector('#steps button.on, #steps button.active')?.dataset.step ?? ''`)) !== 'out');
} catch (e) {
  fail++;
  console.log('✘ 例外：', e.message);
} finally {
  console.log(`\n${ok} 項通過、${fail} 項失敗`);
  ws?.close();
  process.exit(fail ? 1 : 0);
}
