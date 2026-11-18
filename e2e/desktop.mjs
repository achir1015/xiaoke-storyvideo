// 桌面版端對端測試（免費模式，不需 Gemini 金鑰）：啟動 Electron（或 XK_EXE 指定的打包版），
// 透過 CDP 操作：範例故事 → 角色九宮格 → 自動分鏡 → 動態照片＋微軟語音 → 合成 MP4＋SRT。
// 用法：node e2e/desktop.mjs [--guide]
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

const PORT = 9377;
const exe = process.env.XK_EXE;
const MAC = process.platform === 'darwin';
const WANT_GUIDE = process.argv.includes('--guide');
const electron = MAC
  ? join(process.cwd(), 'node_modules', 'electron', 'dist', 'Electron.app', 'Contents', 'MacOS', 'Electron')
  : join(process.cwd(), 'node_modules', 'electron', 'dist', 'electron.exe');
const FF = process.env.XK_FF
  || (exe ? (MAC ? join(dirname(exe), '..', 'Resources', 'bin', 'ffmpeg') : join(dirname(exe), 'resources', 'bin', 'ffmpeg.exe'))
    : join(process.cwd(), 'node_modules', 'ffmpeg-static', MAC ? 'ffmpeg' : 'ffmpeg.exe'));
const work = mkdtempSync(join(tmpdir(), 'xksv-e2e-'));
const shots = process.env.XK_SHOTS || work;
mkdirSync(shots, { recursive: true });
const env = { ...process.env, XK_USER_DATA: join(work, 'userdata'), XK_PROJECTS: join(work, '專案'), XK_QUERY: WANT_GUIDE ? 'noguide&fastguide&mute' : 'noguide' };

// 測試用九宮格（3×3 不同顏色＋圖樣）
const grids = ['阿海伯', '小葵', '美玲'].map((n, i) => {
  const f = join(work, `${n}-九宮格.png`);
  const r = spawnSync(FF, ['-hide_banner', '-y', '-loglevel', 'error', '-f', 'lavfi', '-i', `testsrc2=s=1200x1200,hue=h=${i * 120}`, '-frames:v', '1', f]);
  if (r.status !== 0) throw new Error('無法產生測試圖片');
  return f;
});

const child = exe
  ? spawn(exe, [`--remote-debugging-port=${PORT}`], { stdio: 'ignore', env })
  : spawn(electron, ['.', `--remote-debugging-port=${PORT}`], { stdio: 'ignore', env });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let ok = 0;
let fail = 0;
const check = (name, cond, info = '') => {
  if (cond) ok++;
  else fail++;
  console.log(`${cond ? '✔' : '✘'} ${name}${info ? ` — ${info}` : ''}`);
};

async function target() {
  for (let i = 0; i < 60; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      const page = list.find((t) => t.type === 'page' && t.url.startsWith('xkstory://'));
      if (page) return page;
    } catch {
      // 還沒啟動
    }
    await sleep(500);
  }
  throw new Error('找不到視窗');
}

const page = await target();
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener('open', r, { once: true }));
let seq = 0;
const pending = new Map();
ws.addEventListener('message', (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) {
    pending.get(m.id)(m);
    pending.delete(m.id);
  }
});
const send = (method, params = {}) => new Promise((r) => {
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
    if (await evaluate(`return !!(${expr})`)) return true;
    await sleep(300);
  }
  return false;
};
const shot = async (name) => {
  const r = await send('Page.captureScreenshot', { format: 'png' });
  if (r.result?.data) writeFileSync(join(shots, name), Buffer.from(r.result.data, 'base64'));
};
// 確認對話框自動按「確定」
const autoConfirm = () => evaluate(`
  if (window.__autoConfirm) return;
  window.__autoConfirm = true;
  new MutationObserver(() => {
    const d = document.querySelector('dialog.xk-dialog[open] button[value="yes"]');
    if (d) d.click();
  }).observe(document.body, { childList: true, subtree: true });
`);

try {
  check('畫面載入', await waitFor(`window.xkApp && document.querySelector('#proj-title').value`, 30000));
  check('標題', (await evaluate(`return document.querySelector('h1').textContent`)) === '小柯機器人文字與圖像轉影音工具');
  check('版本號', /^v\d+\.\d+\.\d+$/.test(await evaluate(`return document.querySelector('#ver').textContent`)));
  const info = await evaluate(`return await window.xk.info()`);
  check('內建 FFmpeg', !!info.ffmpeg, info.ffmpeg);
  check('自動建立第一個專案', (await evaluate(`return xkApp.project().title`)) === '我的第一個故事');
  check('免費模式提示', /尚未設定/.test(await evaluate(`return document.querySelector('#ai-state').textContent`)));
  await autoConfirm();

  // 1 故事
  await evaluate(`return await xkApp.useSample()`);
  check('範例故事', (await evaluate(`return xkApp.project().story.length`)) > 200);
  check('專案改名（資料夾一起改）', await waitFor(`xkApp.project().title === '漁港的早晨'`, 5000));
  await shot('1-故事.png');

  // 2 角色：放入九宮格
  await evaluate(`xkApp.setStep('cast')`);
  const n = await evaluate(`
    const s = xkApp.studio(); const files = ${JSON.stringify(grids)};
    for (const [i, c] of s.p.characters.entries()) { await window.xk.allow(files[i]); c.sheet = await window.xk.proj.import(s.dir, files[i], '角色', c.id + '-九宮格'); }
    s.touch(); xkApp.rerender(); return s.p.characters.filter(c => c.sheet).length`);
  check('三位角色都有九宮格', n === 3);
  check('九宮格縮圖顯示', await waitFor(`document.querySelectorAll('#cast .sheet[style*="xkmedia"]').length === 3`, 10000));
  await shot('2-角色.png');

  // 3 分鏡（沒有金鑰：規則式）
  await evaluate(`xkApp.setStep('board')`);
  await evaluate(`await xkApp.autoBoard()`);
  const shotsN = await evaluate(`return xkApp.project().shots.length`);
  check('自動分鏡', shotsN >= 5, `${shotsN} 個鏡頭`);
  const kuiLine = await evaluate(`const p = xkApp.project(); const k = p.characters.find(c => c.name === '小葵'); return p.shots.flatMap(s => s.lines).some(l => l.speaker === k.id && l.text.includes('大魚'))`);
  check('台詞歸給說話的角色', kuiLine);
  check('分鏡卡片', (await evaluate(`return document.querySelectorAll('#shots .shot').length`)) === shotsN);
  await shot('3-分鏡.png');

  // 只保留前 4 個鏡頭，測試比較快
  await evaluate(`const p = xkApp.project(); p.shots = p.shots.slice(0, 4); xkApp.studio().touch(); return true`);

  // 4 畫面與配音：動態照片＋微軟語音
  await evaluate(`xkApp.setStep('make'); xkApp.setVideoEngine('photo')`);
  const t0 = Date.now();
  await evaluate(`await xkApp.makeAll('all')`);
  const st = await evaluate(`const s = xkApp.studio(); return s.p.shots.map(x => s.shotState(x))`);
  check('每個鏡頭都有畫面', st.every((x) => x.stillOk), JSON.stringify(st.map((x) => x.stillOk)));
  check('每句都配好音（微軟語音）', st.every((x) => x.voicesOk), `${((Date.now() - t0) / 1000).toFixed(1)} 秒`);
  const durs = await evaluate(`return xkApp.project().shots.flatMap(s => s.lines.map(l => l.dur))`);
  check('語音長度已量測', durs.every((d) => d > 0.5), durs.join(', '));
  const voicesUsed = await evaluate(`return xkApp.project().shots.flatMap(s => s.lines.map(l => l.audio))`);
  check('配音存在專案資料夾', voicesUsed.every((a) => /^語音\//.test(a)));
  await shot('4-製作.png');

  // 5 合成
  await evaluate(`xkApp.setStep('out')`);
  await evaluate(`await xkApp.render()`);
  const out = await evaluate(`return xkApp.project().output`);
  check('合成影片', !!out.lastVideo, out.lastVideo);
  const proj = await evaluate(`return xkApp.studio().dir`);
  const mp4 = join(proj, out.lastVideo);
  const srt = join(proj, out.lastSrt);
  check('MP4 檔存在', existsSync(mp4));
  check('SRT 檔存在', existsSync(srt) && /-->/.test(readFileSync(srt, 'utf8')));
  const probe = spawnSync(FF, ['-hide_banner', '-i', mp4], { encoding: 'utf8' }).stderr;
  check('影片含 H.264＋AAC＋字幕軌', /Video: h264/.test(probe) && /Audio: aac/.test(probe) && /Subtitle: mov_text/.test(probe));
  const total = await evaluate(`return xkApp.studio().timeline().total`);
  const dur = +(/Duration: 00:(\d+):(\d+\.\d+)/.exec(probe) ?? []).slice(1).reduce((a, x, i) => a + (i ? +x : +x * 60), 0);
  check('影片長度等於時間軸', Math.abs(dur - total) < 0.4, `${dur.toFixed(2)} / ${total.toFixed(2)} 秒`);
  // 有聲音：音量不是靜音
  const vol = spawnSync(FF, ['-hide_banner', '-i', mp4, '-af', 'volumedetect', '-f', 'null', '-'], { encoding: 'utf8' }).stderr;
  const mean = +(/mean_volume: (-?[\d.]+)/.exec(vol) ?? [0, -99])[1];
  check('影片有配音', mean > -40, `平均音量 ${mean} dB`);
  check('播放器載入影片', await waitFor(`document.querySelector('#player').src.startsWith('xkmedia://')`, 10000));
  await shot('5-輸出.png');

  // 專案存檔與重開
  await evaluate(`await xkApp.save()`);
  const saved = JSON.parse(readFileSync(join(proj, 'project.json'), 'utf8'));
  check('專案檔已存', saved.shots.length === 4 && saved.output.lastVideo === out.lastVideo);

  if (WANT_GUIDE) {
    await evaluate(`document.querySelector('#guide-btn').click(); return true`);
    check('語音教學開始', await waitFor(`document.querySelector('.xk-guide')`, 5000));
    check('語音教學跑完', await waitFor(`!document.querySelector('.xk-guide')`, 90000));
  }
} catch (e) {
  fail++;
  console.log('✘ 例外：', e.message);
  await shot('error.png').catch(() => {});
} finally {
  console.log(`\n${ok} 項通過、${fail} 項失敗　截圖：${shots}`);
  child.kill();
  process.exit(fail ? 1 : 0);
}
