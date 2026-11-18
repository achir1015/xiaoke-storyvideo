// 小柯機器人文字與圖像轉影音工具：畫面與操作
import './style.css';
import { desktop, type DesktopBridge } from './bridge';
import { SAMPLE_CAST, SAMPLE_STORY, SAMPLE_TITLE } from './sample';
import { appearances, estimateSec, guessAge, guessCharacters } from './storyboard';
import { Studio, friendly } from './studio';
import { LocalLLM, LOCAL_MODELS, gpuStatus, localModelOf } from './local-llm';
import { HORDE_MODELS, hordeModelOf } from './horde';
import { aiVideoSeconds, buildSrt, fmtDur, shotDuration } from './timeline';
import {
  type Character,
  DEFAULT_SETTINGS,
  GRID_VIEWS,
  type Line,
  MAX_CHARACTERS,
  ROLES,
  type Role,
  SHOT_TYPES,
  type Settings,
  type Shot,
  type ShotType,
  newCharacter,
  newProject,
  newShot,
} from './types';
import { AGE_LABEL, ageBand, speakerLabel } from './voices';
import { ROBOT_SVG, checkUpdate, guideOnFirstRun, initUpdateButton, startGuide } from './xiaoke';

declare const __APP_VERSION__: string;

const $ = <T extends HTMLElement = HTMLElement>(sel: string, root: ParentNode = document) => root.querySelector<T>(sel)!;
const $$ = <T extends HTMLElement = HTMLElement>(sel: string, root: ParentNode = document) => [...root.querySelectorAll<T>(sel)];
const esc = (s: string) => String(s ?? '').replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

let toastTimer = 0;
function toast(msg: string, ms = 3200) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => t.classList.remove('show'), ms);
}

function alertBox(title: string, html: string) {
  const d = document.createElement('dialog');
  d.className = 'xk-dialog';
  d.innerHTML = `<form method="dialog"><h2>${esc(title)}</h2><div>${html}</div><div class="xk-row"><button class="primary">知道了</button></div></form>`;
  document.body.append(d);
  d.addEventListener('close', () => d.remove());
  d.showModal();
}

function confirmBox(title: string, html: string, ok = '確定'): Promise<boolean> {
  return new Promise((resolve) => {
    const d = document.createElement('dialog');
    d.className = 'xk-dialog';
    d.innerHTML = `<form method="dialog"><h2>${esc(title)}</h2><div>${html}</div><div class="xk-row"><button value="no" class="ghost">取消</button><button value="yes" class="primary">${esc(ok)}</button></div></form>`;
    document.body.append(d);
    d.addEventListener('close', () => {
      resolve(d.returnValue === 'yes');
      d.remove();
    });
    d.showModal();
  });
}

// --- 狀態 ---------------------------------------------------------------------------------

let xk: DesktopBridge;
let settings: Settings = { ...DEFAULT_SETTINGS };
let studio: Studio;
let step = 'story';
/** 正在處理中的項目（顯示「產生中」） */
const busyKeys = new Set<string>();
/** 免費雲端畫面排隊狀態（鏡頭 id → 文字）與取消 */
const hordeWait = new Map<string, string>();
const hordeCancel = { canceled: false };
let making = false;
let stopMaking = false;
let rendering = false;

const P = () => studio.p;

// --- 步驟 ---------------------------------------------------------------------------------

function setStep(s: string) {
  step = s;
  $$('#steps > button').forEach((b) => b.classList.toggle('on', b.dataset.step === s));
  $$('.page').forEach((p) => p.classList.toggle('on', p.dataset.page === s));
  $('#stage').scrollTop = 0;
  if (s === 'story') renderStory();
  if (s === 'cast') renderCast();
  if (s === 'board') renderBoard();
  if (s === 'make') renderMake();
  if (s === 'out') renderOut();
}

function renderSteps() {
  const p = P();
  const n = [...p.story.replace(/\s/g, '')].length;
  $('#st-story').textContent = n ? `${n} 字` : '';
  const sheets = p.characters.filter((c) => c.sheet).length;
  const cs = $('#st-cast');
  cs.textContent = p.characters.length ? `${sheets}/${p.characters.length}` : '';
  cs.classList.toggle('warn', sheets < p.characters.length);
  $('#st-board').textContent = p.shots.length ? `${p.shots.length} 鏡` : '';
  const ready = p.shots.filter((s) => {
    const st = studio.shotState(s);
    return st.stillOk && st.voicesOk;
  }).length;
  const mk = $('#st-make');
  mk.textContent = p.shots.length ? `${ready}/${p.shots.length}` : '';
  mk.classList.toggle('warn', ready < p.shots.length);
  $('#st-out').textContent = p.output.lastVideo ? '✓' : '';
  const ai = $('#ai-state');
  if (settings.geminiKey) {
    ai.className = 'ai-state ok';
    ai.textContent = '✅ 已設定 Gemini 金鑰：可用 AI 分鏡；付費的寫實畫面、AI 影片在第 4 步選';
  } else {
    ai.className = 'ai-state no';
    ai.textContent = `🆓 全部免費模式：免費雲端畫面、立體動態照片、${xk.web ? '台灣口音雲端語音' : '微軟語音'}。貼上 Google AI Studio 的免費金鑰，分鏡會更好（按這裡設定）。`;
  }
}

// --- 1 故事 -------------------------------------------------------------------------------

function renderStory() {
  const p = P();
  const ta = $<HTMLTextAreaElement>('#story');
  if (ta.value !== p.story) ta.value = p.story;
  storyStat();
  $$('#aspect button').forEach((b) => b.classList.toggle('on', b.dataset.v === p.aspect));
  $<HTMLSelectElement>('#resolution').value = p.resolution;
  $<HTMLInputElement>('#style').value = p.style;
  $$('#nar-gender button').forEach((b) => b.classList.toggle('on', b.dataset.v === p.narrator.gender));
  $<HTMLInputElement>('#nar-age').value = String(p.narrator.age);
  $<HTMLInputElement>('#nar-note').value = p.narrator.voiceNote;
  $('#nar-label').textContent = speakerLabel(p.narrator);
}

function storyStat() {
  const t = P().story;
  const n = [...t.replace(/\s/g, '')].length;
  const quotes = (t.match(/[「『“]/g) ?? []).length;
  $('#story-stat').textContent = n ? `${n} 字・約 ${fmtDur(estimateSec(t) * 1.25)} 影片・${quotes} 句對白` : '';
}

async function openStoryFile() {
  const f = await xk.dlg.story();
  if (!f) return;
  const bytes = Uint8Array.from(atob(f.b64), (c) => c.charCodeAt(0));
  let text = '';
  if (/\.docx$/i.test(f.name)) {
    const mammoth = await import('mammoth');
    const r = await mammoth.extractRawText({ arrayBuffer: bytes.buffer });
    text = r.value;
  } else {
    text = new TextDecoder('utf-8').decode(bytes);
    // 不是 UTF-8（例如舊的 Big5 文字檔）
    if (text.includes('�')) text = new TextDecoder('big5').decode(bytes);
  }
  text = text.replace(/^﻿/, '').replace(/\r\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  if (P().story.trim() && !(await confirmBox('取代故事？', '<p>目前已經有故事內容，要用開啟的檔案取代嗎？</p>', '取代'))) return;
  P().story = text;
  if (/^我的|^未命名|^新專案/.test(P().title)) await renameProject(f.name.replace(/\.[^.]+$/, ''));
  studio.touch();
  renderStory();
  toast(`已讀入「${f.name}」`);
}

async function useSample() {
  const p = P();
  if (p.story.trim() && !(await confirmBox('使用範例故事？', '<p>會取代目前的故事與角色資料。</p>', '使用範例'))) return false;
  p.story = SAMPLE_STORY;
  p.characters = SAMPLE_CAST.map((c, i) => ({ ...newCharacter(i + 1), name: c.name, role: c.role as Role, gender: c.gender, age: c.age, look: c.look, voiceNote: c.voiceNote }));
  p.shots = [];
  p.style = '現代台灣北海岸漁村';
  await renameProject(SAMPLE_TITLE);
  studio.touch();
  renderStory();
  return true;
}

// --- 2 角色 -------------------------------------------------------------------------------

function renderCast() {
  const p = P();
  const box = $('#cast');
  $('#cast-empty').hidden = p.characters.length > 0;
  $('#cast-count').textContent = p.characters.length ? `${p.characters.length} / ${MAX_CHARACTERS} 位・${p.characters.filter((c) => c.sheet).length} 位有九宮格` : '';
  $<HTMLButtonElement>('#add-char').disabled = p.characters.length >= MAX_CHARACTERS;
  box.innerHTML = '';
  p.characters.forEach((c) => box.append(charCard(c)));
}

function charCard(c: Character): HTMLElement {
  const el = document.createElement('div');
  el.className = 'card char';
  el.dataset.id = c.id;
  const busy = busyKeys.has(`sheet:${c.id}`);
  el.innerHTML = `
    <button type="button" class="del" title="刪除角色">✕</button>
    <div>
      <div class="sheet ${c.sheet ? 'has' : ''}" title="點一下選擇九宮格圖，或把圖片拖曳到這裡">
        ${c.sheet ? '' : '<span>＋ 九宮格圖<br/>點選或拖曳<br/>圖片到這裡</span>'}
        <div class="grid9">${GRID_VIEWS.map((v) => `<span>${esc(v.replace(/（.*）/, ''))}</span>`).join('')}</div>
        ${busy ? `<div class="busy">AI 產生中…<br/><span class="sheet-wait">${settings.stillEngine === 'gemini' && settings.geminiKey ? '約 30 秒' : '免費雲端排隊中…'}</span></div>` : ''}
      </div>
      <div class="photos">${c.photos.map((ph, i) => `<img data-i="${i}" alt="照片" title="參考照片（點一下移除）" />`).join('')}</div>
    </div>
    <div class="fields">
      <div class="row"><input class="name" type="text" value="${esc(c.name)}" aria-label="角色名字" />
        <select class="role">${ROLES.map((r) => `<option ${r === c.role ? 'selected' : ''}>${r}</option>`).join('')}</select></div>
      <div class="row">
        <div class="seg small gender"><button type="button" data-v="female" class="${c.gender === 'female' ? 'on' : ''}">女</button><button type="button" data-v="male" class="${c.gender === 'male' ? 'on' : ''}">男</button></div>
        <label class="inline">年齡 <input class="age" type="number" min="1" max="99" value="${c.age}" /></label>
        <span class="voice-label">${AGE_LABEL[ageBand(c.age)]}</span>
      </div>
      <textarea class="look" placeholder="外觀：髮型、服裝、體型、特徵…">${esc(c.look)}</textarea>
      <input class="vnote" type="text" placeholder="聲音特色：例如 沙啞、溫柔、活潑" value="${esc(c.voiceNote)}" />
    </div>
    <div class="acts">
      <button type="button" class="ghost small pick">🖼️ 選九宮格圖</button>
      <button type="button" class="ghost small photo">📷 加參考照片</button>
      <button type="button" class="primary small ai">✨ AI 產生九宮格</button>
      <button type="button" class="ghost small listen">🔊 試聽聲音</button>
      <span class="muted" style="font-size:12px">出場 ${appearances(P().shots, c.id)} 鏡</span>
    </div>`;
  const sheet = $('.sheet', el);
  if (c.sheet) void studio.url(c.sheet).then((u) => (sheet.style.backgroundImage = `url("${u}")`));
  $$<HTMLImageElement>('.photos img', el).forEach((img) => void studio.url(c.photos[+img.dataset.i!]).then((u) => (img.src = u)));
  const upd = () => {
    studio.touch();
    renderSteps();
  };
  $<HTMLInputElement>('.name', el).addEventListener('input', (e) => {
    c.name = (e.target as HTMLInputElement).value.trim();
    upd();
  });
  $<HTMLSelectElement>('.role', el).addEventListener('change', (e) => {
    c.role = (e.target as HTMLSelectElement).value as Role;
    if (c.role === '童星' && c.age > 15) {
      c.age = 9;
      $<HTMLInputElement>('.age', el).value = '9';
    }
    upd();
  });
  $$('.gender button', el).forEach((b) =>
    b.addEventListener('click', () => {
      c.gender = b.dataset.v as Character['gender'];
      $$('.gender button', el).forEach((x) => x.classList.toggle('on', x === b));
      upd();
    }),
  );
  $<HTMLInputElement>('.age', el).addEventListener('input', (e) => {
    c.age = Math.max(1, Math.min(99, parseInt((e.target as HTMLInputElement).value, 10) || c.age));
    $('.voice-label', el).textContent = AGE_LABEL[ageBand(c.age)];
    upd();
  });
  $<HTMLTextAreaElement>('.look', el).addEventListener('input', (e) => {
    c.look = (e.target as HTMLTextAreaElement).value;
    upd();
  });
  $<HTMLInputElement>('.vnote', el).addEventListener('input', (e) => {
    c.voiceNote = (e.target as HTMLInputElement).value;
    upd();
  });
  $('.del', el).addEventListener('click', async () => {
    if (!(await confirmBox('刪除角色？', `<p>要刪除「${esc(c.name)}」嗎？分鏡裡的台詞會改成旁白。</p>`, '刪除'))) return;
    const p = P();
    p.characters = p.characters.filter((x) => x !== c);
    for (const s of p.shots) {
      s.characters = s.characters.filter((id) => id !== c.id);
      for (const l of s.lines) if (l.speaker === c.id) l.speaker = 'narrator';
    }
    studio.touch();
    renderCast();
    renderSteps();
  });
  const setSheet = async (src: string) => {
    await xk.allow(src);
    c.sheet = await xk.proj.import(studio.dir, src, '角色', `${c.id}-九宮格`);
    studio.touch();
    renderCast();
    renderSteps();
  };
  const pick = async () => {
    const [f] = await xk.dlg.images(false);
    if (f) await setSheet(f);
  };
  sheet.addEventListener('click', () => void pick());
  $('.pick', el).addEventListener('click', () => void pick());
  sheet.addEventListener('dragover', (e) => {
    e.preventDefault();
    sheet.classList.add('drag');
  });
  sheet.addEventListener('dragleave', () => sheet.classList.remove('drag'));
  sheet.addEventListener('drop', (e) => {
    e.preventDefault();
    sheet.classList.remove('drag');
    const f = e.dataTransfer?.files[0];
    const path = f ? xk.pathOf(f) : '';
    if (path && /\.(png|jpe?g|webp|bmp)$/i.test(path)) void setSheet(path);
    else toast('請拖曳 PNG、JPG 或 WebP 圖片');
  });
  $('.photo', el).addEventListener('click', async () => {
    const files = await xk.dlg.images(true);
    for (const f of files.slice(0, Math.max(0, 3 - c.photos.length))) c.photos.push(await xk.proj.import(studio.dir, f, '角色', `${c.id}-照片`));
    if (files.length > 3) toast('參考照片最多 3 張');
    studio.touch();
    renderCast();
  });
  $$<HTMLImageElement>('.photos img', el).forEach((img) =>
    img.addEventListener('click', () => {
      c.photos.splice(+img.dataset.i!, 1);
      studio.touch();
      renderCast();
    }),
  );
  $('.ai', el).addEventListener('click', () => void aiSheet(c));
  $('.listen', el).addEventListener('click', () => void listen(c.id, `大家好，我是${c.name || '這個角色'}。很高興認識你！`));
  return el;
}

async function aiSheet(c: Character) {
  // 畫面選 Gemini（付費）且有金鑰才用 Gemini；否則用免費雲端（AI Horde）
  const free = settings.stillEngine !== 'gemini' || !settings.geminiKey;
  if (!c.photos.length && !c.look.trim() && !c.sheet) return alertBox('需要參考資料', '<p>請先「加參考照片」（一到三張），或在外觀欄寫下髮型、服裝與特徵，AI 才知道要畫誰。</p>');
  if (free && !(await confirmBox('用免費雲端 AI 產生九宮格？', '<p>由 AI Horde 志工電腦免費畫九個角度，再拼成九宮格。要排隊，大約 2–10 分鐘，期間可以繼續做其他步驟。</p><p class="muted">免費模型的長相一致性比付費的 Gemini 差一些；最好的方法是自己準備九宮格圖或加一張清楚的正面照當參考。</p>', '開始產生'))) return;
  busyKeys.add(`sheet:${c.id}`);
  renderCast();
  try {
    if (free)
      await studio.genSheetHorde(c, (done, total, st) => {
        const el = document.querySelector(`.char[data-id="${c.id}"] .sheet-wait`);
        if (el) el.textContent = `免費雲端：${done}/${total} 張${st && !st.processing && st.queue ? `・排隊第 ${st.queue} 位` : ''}`;
      });
    else await studio.genSheet(c);
    toast(`「${c.name}」的九宮格完成了`);
  } catch (e) {
    alertBox('九宮格產生失敗', `<p>${esc(friendly(e))}</p>`);
  } finally {
    busyKeys.delete(`sheet:${c.id}`);
    renderCast();
    renderSteps();
  }
}

const VOICE_NAME: Record<string, string> = { edge: '微軟語音', taiwan: '台灣口音雲端語音', gemini: 'Gemini 語音', 'gemini-design': 'Gemini 語音' };

/** 試聽：用目前的配音方式唸一句 */
let player: HTMLAudioElement | null = null;
async function listen(speaker: string, text: string) {
  const fake: Shot = { ...newShot(), id: `試聽-${speaker}`, lines: [{ speaker, text, emotion: '' }] };
  toast(xk.web ? '正在產生試聽聲音（台灣口音雲端語音約 10～30 秒）…' : '正在產生試聽聲音…', 30000);
  try {
    await studio.genVoice(fake, 0);
    player?.pause();
    player = new Audio(await studio.url(fake.lines[0].audio));
    await player.play();
    toast(`試聽：${speakerLabel(studio.speakerOf(speaker))}・${VOICE_NAME[studio.engineFor(studio.speakerOf(speaker))]}`);
  } catch (e) {
    alertBox('試聽失敗', `<p>${esc(friendly(e))}</p>`);
  }
}

async function findCast() {
  const p = P();
  if (!p.story.trim()) return toast('請先在第 1 步輸入故事');
  const found = guessCharacters(p.story, MAX_CHARACTERS);
  const have = new Set(p.characters.map((c) => c.name));
  const add = found.filter((f) => !have.has(f.name)).slice(0, MAX_CHARACTERS - p.characters.length);
  if (!add.length) return toast(found.length ? '故事裡的角色都已經加入了' : '找不到明顯的角色名字，請手動新增');
  for (const f of add) {
    const c = newCharacter(p.characters.length + 1);
    c.name = f.name;
    c.age = guessAge(f.name, f.child);
    c.gender = f.gender ?? (p.characters.length % 2 ? 'male' : 'female');
    c.role = c.age <= 12 ? '童星' : p.characters.length ? '配角' : '主角';
    p.characters.push(c);
  }
  studio.touch();
  renderCast();
  renderSteps();
  toast(`找到 ${add.length} 位角色：${add.map((x) => x.name).join('、')}。請確認性別與年齡。`, 5000);
}

// --- 3 分鏡 -------------------------------------------------------------------------------

const MOVES = ['固定', '緩慢推近', '輕微推近', '拉遠', '緩慢橫搖', '跟拍'];

function kelvinColor(k: number) {
  // 色溫示意色（近似）
  const t = Math.max(0, Math.min(1, (k - 2000) / 6000));
  const r = Math.round(255 - 60 * Math.max(0, t - 0.5) * 2);
  const g = Math.round(150 + 90 * t);
  const b = Math.round(70 + 185 * t);
  return `rgb(${r},${g},${b})`;
}

function renderBoard() {
  const p = P();
  renderBoardEngine();
  const box = $('#shots');
  $('#board-empty').hidden = p.shots.length > 0;
  boardStat();
  box.innerHTML = '';
  p.shots.forEach((s, i) => box.append(shotCard(s, i)));
}

function boardStat() {
  const p = P();
  const total = p.shots.reduce((a, s) => a + shotDuration(s), 0);
  const counts = SHOT_TYPES.map((t) => `${t} ${p.shots.filter((s) => s.shotType === t).length}`).join('・');
  $('#board-stat').textContent = p.shots.length ? `${p.shots.length} 個鏡頭・約 ${fmtDur(total)}・${counts}` : '';
}

function speakerOptions(sel: string) {
  return [`<option value="narrator" ${sel === 'narrator' ? 'selected' : ''}>🎙 旁白</option>`, ...P().characters.map((c) => `<option value="${c.id}" ${sel === c.id ? 'selected' : ''}>${esc(c.name)}</option>`)].join('');
}

function shotCard(s: Shot, i: number): HTMLElement {
  const p = P();
  const el = document.createElement('div');
  el.className = 'card shot';
  el.dataset.id = s.id;
  el.innerHTML = `
    <div class="num">${i + 1}<small class="dur">${shotDuration(s).toFixed(1)} 秒</small>
      <button type="button" class="ghost up" title="上移">▲</button><button type="button" class="ghost down" title="下移">▼</button>
      <button type="button" class="ghost ins" title="在後面插入鏡頭">＋</button><button type="button" class="ghost rm" title="刪除鏡頭">✕</button></div>
    <div class="grid">
      <label>鏡頭<select class="shot-type" data-k="shotType">${SHOT_TYPES.map((t) => `<option ${t === s.shotType ? 'selected' : ''}>${t}</option>`).join('')}</select></label>
      <label>場景<input type="text" data-k="scene" value="${esc(s.scene)}" placeholder="例如：漁港碼頭" /></label>
      <label>出場角色<div class="chips">${p.characters.map((c) => `<button type="button" data-c="${c.id}" class="${s.characters.includes(c.id) ? 'on' : ''}">${esc(c.name)}</button>`).join('') || '<span class="muted">（第 2 步新增角色）</span>'}</div></label>
      <label class="full">畫面描述<textarea data-k="visual" placeholder="場景、人物位置、動作、表情">${esc(s.visual)}</textarea></label>
      <div class="full tech">
        <label>時段<input type="text" data-k="timeOfDay" value="${esc(s.timeOfDay)}" /></label>
        <label>光源<input type="text" data-k="light" value="${esc(s.light)}" /></label>
        <label>色溫 K <span><span class="kelvin-dot" style="background:${kelvinColor(s.kelvin)}"></span> <input type="number" data-k="kelvin" data-n="1" min="1800" max="10000" step="100" value="${s.kelvin}" /></span></label>
        <label>焦段 mm<input type="number" data-k="lens" data-n="1" min="12" max="200" value="${s.lens}" /></label>
        <label>運鏡<select data-k="move">${[...new Set([...MOVES, s.move])].map((m) => `<option ${m === s.move ? 'selected' : ''}>${esc(m)}</option>`).join('')}</select></label>
        <label>環境音<input type="text" data-k="ambience" value="${esc(s.ambience)}" placeholder="海浪、海鷗" /></label>
        <label>秒數（0＝自動）<input type="number" data-k="seconds" data-n="1" min="0" max="60" step="0.5" value="${s.seconds}" /></label>
      </div>
      <div class="lines">${s.lines.map((l, li) => lineRow(l, li)).join('')}<div><button type="button" class="ghost small add-line">＋ 加一句台詞／旁白</button></div></div>
    </div>`;
  const touch = () => {
    studio.touch();
    $('.dur', el).textContent = `${shotDuration(s).toFixed(1)} 秒`;
    boardStat();
  };
  $$<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>('[data-k]', el).forEach((inp) =>
    inp.addEventListener('input', () => {
      const k = inp.dataset.k as keyof Shot;
      const v = inp.dataset.n ? Number(inp.value) || 0 : inp.value;
      (s as unknown as Record<string, unknown>)[k] = v;
      if (k === 'kelvin') $<HTMLElement>('.kelvin-dot', el).style.background = kelvinColor(s.kelvin);
      if (k === 'shotType') s.lens = { 遠景: 24, 中景: 35, 近景: 50, 特寫: 85 }[s.shotType as ShotType];
      touch();
      if (k === 'shotType') $<HTMLInputElement>('[data-k="lens"]', el).value = String(s.lens);
    }),
  );
  $$('.chips button', el).forEach((b) =>
    b.addEventListener('click', () => {
      const id = b.dataset.c!;
      s.characters = s.characters.includes(id) ? s.characters.filter((x) => x !== id) : [...s.characters, id];
      b.classList.toggle('on', s.characters.includes(id));
      touch();
    }),
  );
  $$('.line', el).forEach((row) => {
    const li = +row.dataset.i!;
    const l = s.lines[li];
    $<HTMLSelectElement>('select', row).addEventListener('change', (e) => {
      l.speaker = (e.target as HTMLSelectElement).value;
      if (l.speaker !== 'narrator' && !s.characters.includes(l.speaker)) {
        s.characters.push(l.speaker);
        $(`.chips [data-c="${l.speaker}"]`, el)?.classList.add('on');
      }
      touch();
    });
    $<HTMLInputElement>('.t', row).addEventListener('input', (e) => {
      l.text = (e.target as HTMLInputElement).value;
      l.dur = undefined;
      touch();
    });
    $<HTMLInputElement>('.emo', row).addEventListener('input', (e) => {
      l.emotion = (e.target as HTMLInputElement).value;
      touch();
    });
    $('.x', row).addEventListener('click', () => {
      s.lines.splice(li, 1);
      studio.touch();
      renderBoard();
    });
  });
  $('.add-line', el).addEventListener('click', () => {
    s.lines.push({ speaker: s.characters[0] ?? 'narrator', text: '', emotion: '' });
    studio.touch();
    renderBoard();
    $$<HTMLInputElement>(`.shot[data-id="${s.id}"] .line .t`).pop()?.focus();
  });
  const move = (d: number) => {
    const arr = p.shots;
    const j = i + d;
    if (j < 0 || j >= arr.length) return;
    [arr[i], arr[j]] = [arr[j], arr[i]];
    studio.touch();
    renderBoard();
  };
  $('.up', el).addEventListener('click', () => move(-1));
  $('.down', el).addEventListener('click', () => move(1));
  $('.ins', el).addEventListener('click', () => {
    const n = newShot();
    n.characters = [...s.characters];
    n.scene = s.scene;
    n.timeOfDay = s.timeOfDay;
    n.light = s.light;
    n.kelvin = s.kelvin;
    p.shots.splice(i + 1, 0, n);
    studio.touch();
    renderBoard();
  });
  $('.rm', el).addEventListener('click', async () => {
    if ((s.still || s.lines.some((l) => l.text)) && !(await confirmBox('刪除鏡頭？', `<p>要刪除第 ${i + 1} 個鏡頭嗎？</p>`, '刪除'))) return;
    p.shots.splice(i, 1);
    studio.touch();
    renderBoard();
    renderSteps();
  });
  return el;
}

function lineRow(l: Line, li: number) {
  return `<div class="line" data-i="${li}"><select>${speakerOptions(l.speaker)}</select><input class="t" type="text" value="${esc(l.text)}" placeholder="說的話" /><input class="emo" type="text" value="${esc(l.emotion)}" placeholder="語氣" /><button type="button" class="x" title="刪除這句">✕</button></div>`;
}

const llm = new LocalLLM();
let boarding = false;

function boardProgress(text: string, p: number | null) {
  const el = $('#board-progress');
  el.hidden = p === null;
  el.querySelector<HTMLElement>('.txt')!.textContent = text;
  el.querySelector<HTMLElement>('.bar i')!.style.width = `${Math.round(Math.max(0, Math.min(1, p ?? 0)) * 100)}%`;
}

/** 目前有效的分鏡方式（本機小模型沒開實驗功能時改用 Gemini） */
const boardEngineNow = (): Settings['boardEngine'] => (settings.boardEngine === 'local' && !settings.localExperimental ? 'gemini' : settings.boardEngine);

function renderBoardEngine() {
  document.body.classList.toggle('local-exp', settings.localExperimental);
  const eng = boardEngineNow();
  $$('#board-engine button').forEach((b) => b.classList.toggle('on', b.dataset.v === eng));
}

async function autoBoard() {
  const p = P();
  if (boarding) return;
  if (!p.story.trim()) return toast('請先在第 1 步輸入故事');
  let engine = boardEngineNow();
  if (engine === 'gemini' && !settings.geminiKey) {
    toast('還沒設定 Gemini 金鑰，這次用「快速切段」。到「⚙ 設定」貼上 Google AI Studio 的免費金鑰，就能用 AI 分鏡。', 6500);
    engine = 'rule';
  }
  if (engine === 'local') {
    const g = await gpuStatus();
    if (!g.ok) {
      alertBox('無法使用本機小模型', `<p>${esc(g.reason ?? '')}</p><p>這次改用「快速切段」。</p>`);
      engine = 'rule';
    } else if (!(await llm.isCached(settings.localModel))) {
      const m = localModelOf(settings.localModel);
      const ok = await confirmBox(
        '下載本機小模型',
        `<p>第一次使用要下載「${esc(m.name)}」，約 <b>${m.size} GB</b>（只需下載一次，之後不用網路、也不用金鑰）。</p><p class="muted">${esc(m.note)}。可在「⚙ 設定」換模型或刪除。</p>`,
        '開始下載',
      );
      if (!ok) return;
    }
  }
  if (p.shots.length && !(await confirmBox('重新分鏡？', '<p>會取代目前所有鏡頭（已產生的畫面與配音檔案會保留在資料夾裡，但不再使用）。</p>', '重新分鏡'))) return;
  const b = $<HTMLButtonElement>('#auto-board');
  boarding = true;
  b.disabled = true;
  b.textContent = engine === 'gemini' ? '🎞️ AI 分鏡中…（約 20–60 秒）' : engine === 'local' ? '🎞️ 本機模型分鏡中…' : '🎞️ 分鏡中…';
  try {
    if (engine === 'local') {
      boardProgress('準備本機模型…', 0);
      await llm.load(settings.localModel, (pr) => boardProgress(pr.text, pr.p));
    }
    const t0 = Date.now();
    const r = await studio.storyboard(engine, {
      llm,
      onProgress: (done, total, shots) => {
        const left = done ? ((Date.now() - t0) / done) * (total - done) : 0;
        boardProgress(`本機模型分鏡 ${done}/${total}${done && left > 3000 ? `・約剩 ${Math.ceil(left / 1000)} 秒` : ''}`, total ? done / total : 0);
        p.shots = shots.slice();
        renderBoard();
      },
    });
    p.shots = r.shots;
    studio.touch();
    renderBoard();
    renderSteps();
    const sec = Math.round((Date.now() - t0) / 1000);
    if (r.note && !r.ai) alertBox('改用自動切段', `<p>${esc(r.note)}</p>`);
    else if (r.note) toast(`${r.note}（共 ${r.shots.length} 鏡）`, 6000);
    else if (engine === 'local') toast(`本機模型完成分鏡：${r.shots.length} 個鏡頭（${sec} 秒）`, 5000);
    else toast(r.ai ? `AI 完成分鏡：${r.shots.length} 個鏡頭` : `已自動切成 ${r.shots.length} 個鏡頭`, 5000);
  } catch (e) {
    if ((e as Error).message === '已取消') {
      toast('已停止分鏡');
      studio.touch();
    } else alertBox('分鏡失敗', `<p>${esc(friendly(e))}</p>`);
  } finally {
    boarding = false;
    boardProgress('', null);
    b.disabled = false;
    b.textContent = '🎞️ 自動分鏡';
    // 釋放記憶體給後面的畫面與合成（再分鏡時從快取載入，只要幾秒）
    if (engine === 'local') void llm.unload();
  }
}

// --- 4 畫面與配音 -------------------------------------------------------------------------

function renderMake() {
  const p = P();
  $('#make-empty').hidden = p.shots.length > 0;
  renderEngines();
  const box = $('#make-list');
  box.innerHTML = '';
  p.shots.forEach((s, i) => box.append(makeCard(s, i)));
  makeStat();
}

function renderEngines() {
  $$('#still-engine button').forEach((b) => b.classList.toggle('on', b.dataset.v === settings.stillEngine));
  $$('#video-engine button').forEach((b) => b.classList.toggle('on', b.dataset.v === settings.videoEngine));
  const ve = settings.voiceEngine;
  const voice = ve === 'gemini' ? 'gemini-design' : ve === 'edge' && xk.web ? 'taiwan' : ve;
  $$('#voice-seg button').forEach((b) => b.classList.toggle('on', b.dataset.v === voice));
}

/** 切換第 4 步的做法；付費選項沒有金鑰時提醒 */
function setEngine(kind: 'still' | 'video' | 'voice', v: string) {
  if (v === 'gemini' || v === 'ai' || v === 'gemini-design') {
    if (!settings.geminiKey) {
      alertBox('需要 Gemini 金鑰', `<p>這個選項要用 Google Gemini${v === 'gemini-design' ? '（免費金鑰可試用，額度很少）' : '（需要已綁定付款的金鑰，會產生費用）'}。請先到「⚙ 設定」貼上金鑰。</p><p class="muted">不想花錢就用免費選項：☁️ 免費雲端 AI、🎞️ 立體動態照片、${xk.web ? '🇹🇼 台灣口音' : '🔊 微軟語音'}。</p>`);
      return;
    }
  }
  if (kind === 'still') settings.stillEngine = v as Settings['stillEngine'];
  if (kind === 'video') settings.videoEngine = v as Settings['videoEngine'];
  if (kind === 'voice') settings.voiceEngine = v as Settings['voiceEngine'];
  void saveSettings(settings);
  renderMake();
}

function makeStat() {
  const p = P();
  let stills = 0;
  let videos = 0;
  let voices = 0;
  let lines = 0;
  for (const s of p.shots) {
    const st = studio.shotState(s);
    if (st.stillOk) stills++;
    if (st.videoOk) videos++;
    voices += st.voices.filter(Boolean).length;
    lines += s.lines.length;
  }
  $('#make-stat').textContent = p.shots.length ? `畫面 ${stills}/${p.shots.length}${settings.videoEngine === 'ai' ? `・影片 ${videos}/${p.shots.length}` : ''}・配音 ${voices}/${lines}` : '';
  $<HTMLButtonElement>('#make-stop').hidden = !making;
  for (const id of ['#make-all', '#make-stills', '#make-voices']) $<HTMLButtonElement>(id).disabled = making;
}

function makeCard(s: Shot, i: number): HTMLElement {
  const st = studio.shotState(s);
  const el = document.createElement('div');
  el.className = `card mk ${P().aspect === '9:16' ? 'portrait' : ''}`;
  el.dataset.id = s.id;
  const busy = [...busyKeys].find((k) => k.endsWith(`:${s.id}`));
  const label = (ok: boolean, has: boolean, name: string) => `<span class="${ok ? 'ok' : has ? 'stale' : ''}">${ok ? '✓' : has ? '需更新' : '—'} ${name}</span>`;
  const cast = studio.castOf(s).map((c) => c.name).join('、');
  el.innerHTML = `
    <div class="media"><span>${s.still ? '' : '尚未產生畫面'}</span><span class="tag">${i + 1}・${s.shotType}・${shotDuration(s).toFixed(1)} 秒</span>
      ${busy ? `<div class="busy">${busy.startsWith('video') ? 'AI 影片產生中…<br/>約 1–3 分鐘' : busy.startsWith('still') ? `AI 畫面產生中…${hordeWait.get(s.id) ? `<br/><span class="shot-wait">${esc(hordeWait.get(s.id)!)}</span>` : ''}` : '配音產生中…'}</div>` : ''}</div>
    <div class="st">${label(st.stillOk, !!s.still, '畫面')}${settings.videoEngine === 'ai' ? label(st.videoOk, !!s.video, '影片') : ''}${label(st.voicesOk && s.lines.length > 0, s.lines.some((l) => l.audio), `配音 ${st.voices.filter(Boolean).length}/${s.lines.length}`)}</div>
    <div class="txt">${cast ? `<b>${esc(cast)}</b>：` : ''}${esc(s.visual || s.lines.map((l) => l.text).join(' '))}</div>
    ${s.error ? `<div class="err">${esc(s.error)}</div>` : ''}
    <div class="acts">
      <button type="button" class="g-still">${s.still ? '↻' : '✨'} 畫面</button>
      ${settings.videoEngine === 'ai' ? `<button type="button" class="g-video">${s.video ? '↻' : '🎥'} 影片</button>` : ''}
      <button type="button" class="g-voice">${s.lines.some((l) => l.audio) ? '↻' : '🎙'} 配音</button>
      <button type="button" class="play-voice ghost" ${s.lines.some((l) => l.audio) ? '' : 'disabled'}>🔊 聽</button>
      <button type="button" class="up-still ghost" title="用自己的圖片當這個鏡頭的畫面">⬆ 自備圖</button>
    </div>`;
  const media = $('.media', el);
  if (s.video && settings.videoEngine === 'ai') {
    void studio.url(s.video).then((u) => {
      const v = document.createElement('video');
      v.src = u;
      v.muted = true;
      v.loop = true;
      v.playsInline = true;
      v.preload = 'metadata';
      el.addEventListener('mouseenter', () => void v.play().catch(() => {}));
      el.addEventListener('mouseleave', () => v.pause());
      media.prepend(v);
    });
  } else if (s.still) void studio.url(s.still).then((u) => (media.style.backgroundImage = `url("${u}")`));
  $('.g-still', el).addEventListener('click', () => void runShot(s, { still: true, force: true }));
  el.querySelector('.g-video')?.addEventListener('click', () => void runShot(s, { video: true, force: true }));
  $('.g-voice', el).addEventListener('click', () => void runShot(s, { voices: true, force: true }));
  $('.play-voice', el).addEventListener('click', () => void playShotVoices(s));
  $('.up-still', el).addEventListener('click', async () => {
    const [f] = await xk.dlg.images(false);
    if (!f) return;
    s.still = await xk.proj.import(studio.dir, f, '鏡頭', `${s.id}-自備畫面`);
    s.stillKey = 'sheet';
    s.video = undefined;
    studio.touch();
    refreshShot(s);
  });
  return el;
}

function refreshShot(s: Shot) {
  const i = P().shots.indexOf(s);
  const old = document.querySelector(`#make-list .mk[data-id="${s.id}"]`);
  if (old && i >= 0) old.replaceWith(makeCard(s, i));
  makeStat();
  renderSteps();
}

async function playShotVoices(s: Shot) {
  for (const l of s.lines) {
    if (!l.audio) continue;
    player?.pause();
    player = new Audio(await studio.url(l.audio));
    await player.play().catch(() => {});
    await new Promise((r) => player!.addEventListener('ended', r, { once: true }));
    await sleep(250);
  }
}

interface RunOpts {
  still?: boolean;
  video?: boolean;
  voices?: boolean;
  force?: boolean;
}

/** 處理一個鏡頭：畫面 → 影片；配音 */
async function runShot(s: Shot, o: RunOpts) {
  const st = studio.shotState(s);
  const useAi = !!settings.geminiKey;
  const tag = (k: string) => `${k}:${s.id}`;
  const step = async (k: string, fn: () => Promise<unknown>) => {
    if (stopMaking) return;
    busyKeys.add(tag(k));
    refreshShot(s);
    try {
      await fn();
      s.error = undefined;
    } catch (e) {
      s.error = friendly(e);
      throw e;
    } finally {
      busyKeys.delete(tag(k));
      refreshShot(s);
    }
  };
  try {
    const wantVideo = !!o.video && settings.videoEngine === 'ai';
    if (o.still || (wantVideo && !s.still)) {
      if (o.force || !st.stillOk) {
        if (settings.stillEngine === 'horde') {
          await step('still', () =>
            studio.genStillHorde(
              s,
              (h) => {
                hordeWait.set(s.id, h.processing ? '志工電腦正在畫…' : h.queue ? `排隊中：第 ${h.queue} 位・約 ${Math.max(1, Math.round(h.wait / 60))} 分鐘` : '排隊中…');
                refreshShot(s);
              },
              hordeCancel,
            ).finally(() => hordeWait.delete(s.id)),
          );
        } else if (settings.stillEngine === 'gemini' && useAi) await step('still', () => studio.genStill(s));
        else {
          const ok = await studio.stillFromSheet(s);
          if (!ok) s.error = '沒有 AI 金鑰時，需要角色九宮格圖才能做畫面（或按「自備圖」）。';
          refreshShot(s);
        }
      }
    }
    if (wantVideo && (o.force || !studio.shotState(s).videoOk)) {
      if (!useAi) s.error = 'AI 影片需要 Gemini 金鑰；目前會用動態照片合成。';
      else await step('video', () => studio.genVideo(s));
    }
    if (o.voices) {
      for (let li = 0; li < s.lines.length; li++) {
        if (stopMaking) break;
        if (!o.force && studio.shotState(s).voices[li]) continue;
        if (!s.lines[li].text.trim()) continue;
        await step('voice', () => studio.genVoice(s, li).finally(() => hordeWait.delete(s.id)));
      }
    }
  } catch (e) {
    if (!making) alertBox(`鏡頭 ${P().shots.indexOf(s) + 1} 失敗`, `<p>${esc(friendly(e))}</p>`);
    else throw e;
  }
}

async function makeAll(kind: 'all' | 'stills' | 'voices') {
  const p = P();
  if (!p.shots.length) return toast('請先完成分鏡');
  if (settings.stillEngine === 'sheet' && kind !== 'voices' && !p.characters.some((c) => c.sheet))
    return alertBox('需要角色九宮格', '<p>「九宮格照片」會用角色九宮格裡的照片當畫面。請先在第 2 步放入九宮格圖，或改選「☁️ 免費雲端 AI」。</p>');
  const wantVideo = kind === 'all' && settings.videoEngine === 'ai' && !!settings.geminiKey;
  hordeCancel.canceled = false;
  const todo = p.shots.filter((s) => {
    const st = studio.shotState(s);
    if (kind === 'voices') return !st.voicesOk;
    if (kind === 'stills') return !st.stillOk;
    return !st.stillOk || !st.voicesOk || (wantVideo && !st.videoOk);
  });
  if (!todo.length) return toast('全部都已經產生好了，可以到第 5 步合成影片');
  if (wantVideo) {
    const vids = todo.filter((s) => !studio.shotState(s).videoOk);
    const secs = vids.reduce((a, s) => a + aiVideoSeconds(s), 0);
    const stills = todo.filter((s) => !studio.shotState(s).stillOk).length;
    if (
      vids.length &&
      !(await confirmBox(
        '開始產生 AI 影片？',
        `<p>將產生 <b>${stills}</b> 張寫實畫面、<b>${vids.length}</b> 段 AI 影片（共約 <b>${secs}</b> 秒）與配音。</p><p class="muted">AI 影片依秒數計費，實際費用以 Google 帳單為準。每段影片約需 1–3 分鐘。想省費用可改選「動態照片」。</p>`,
        '開始產生',
      ))
    )
      return;
  }
  making = true;
  stopMaking = false;
  void xk.keepAwake?.(true);
  makeStat();
  const prog = $('#make-progress');
  prog.hidden = false;
  let done = 0;
  const show = () => {
    $<HTMLElement>('div', prog).style.width = `${(done / todo.length) * 100}%`;
    $('span', prog).textContent = `${done} / ${todo.length} 個鏡頭`;
  };
  show();
  const errors: string[] = [];
  const queue = [...todo];
  const worker = async () => {
    while (queue.length && !stopMaking) {
      const s = queue.shift()!;
      try {
        await runShot(s, { still: kind !== 'voices', video: wantVideo, voices: kind !== 'stills' });
      } catch (e) {
        errors.push(`鏡頭 ${p.shots.indexOf(s) + 1}：${friendly(e)}`);
        // 金鑰錯誤或額度用完：其他鏡頭也會失敗，直接停止
        if (/金鑰|額度|上限/.test(friendly(e))) stopMaking = true;
      }
      done++;
      show();
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, settings.parallel) }, worker));
  making = false;
  void xk.keepAwake?.(false);
  prog.hidden = true;
  await studio.saveNow();
  renderMake();
  renderSteps();
  if (errors.length) alertBox('部分鏡頭沒有完成', `<p>${errors.map(esc).join('<br/>')}</p><p class="muted">可以在每個鏡頭按「↻」重試。</p>`);
  else if (!stopMaking) toast('全部產生完成！下一步：合成影片', 5000);
  stopMaking = false;
}

// --- 5 輸出 -------------------------------------------------------------------------------

function renderOut() {
  const p = P();
  $<HTMLInputElement>('#burn-subs').checked = p.output.burnSubs;
  $<HTMLInputElement>('#ambience').value = String(p.output.ambience);
  $('#amb-val').textContent = `${p.output.ambience}%`;
  const missingStill = p.shots.filter((s) => !s.still && !s.video).length;
  const missingVoice = p.shots.reduce((a, s) => a + s.lines.filter((l) => !l.audio && l.text.trim()).length, 0);
  const total = studio.timeline().total;
  $('#out-check').innerHTML = [
    `<div>🎞️ ${p.shots.length} 個鏡頭・約 ${fmtDur(total)}</div>`,
    `<div class="${missingStill ? 'bad' : ''}">${missingStill ? `⚠ ${missingStill} 個鏡頭沒有畫面（會是深色空白）` : '✓ 每個鏡頭都有畫面'}</div>`,
    `<div class="${missingVoice ? 'bad' : ''}">${missingVoice ? `⚠ ${missingVoice} 句還沒配音（字幕照樣產生）` : '✓ 台詞都已配音'}</div>`,
  ].join('');
  $<HTMLButtonElement>('#render').disabled = rendering || !p.shots.length;
  $<HTMLButtonElement>('#render-stop').hidden = !rendering;
  $('#srt-preview').textContent = buildSrt(p) || '（沒有台詞）';
  const has = !!p.output.lastVideo;
  $<HTMLButtonElement>('#open-video').disabled = !has;
  $<HTMLButtonElement>('#open-srt').disabled = !has;
  const v = $<HTMLVideoElement>('#player');
  $('#player-empty').hidden = has;
  v.hidden = !has;
  if (has) void studio.url(p.output.lastVideo).then((u) => {
    if (v.dataset.src !== u) {
      v.dataset.src = u;
      v.src = u;
    }
  });
}

async function render() {
  const p = P();
  if (!p.shots.length) return toast('請先完成分鏡');
  rendering = true;
  renderOut();
  const prog = $('#render-progress');
  prog.hidden = false;
  try {
    const r = await studio.render((x, label) => {
      $<HTMLElement>('div', prog).style.width = `${Math.round(x * 100)}%`;
      $('span', prog).textContent = `${Math.round(x * 100)}%・${label}`;
    });
    toast(`影片完成：${fmtDur(r.total)}・${(r.size / 1048576).toFixed(1)} MB，SRT 逐字稿也一起存好了`, 6000);
  } catch (e) {
    if (!/已取消/.test(friendly(e))) alertBox('合成失敗', `<pre class="srt">${esc(friendly(e))}</pre>`);
  } finally {
    rendering = false;
    prog.hidden = true;
    renderOut();
    renderSteps();
  }
}

// --- 設定 ---------------------------------------------------------------------------------

function needKey(msg: string) {
  void confirmBox('需要 Gemini 金鑰', `<p>${esc(msg)}</p><p>要現在設定嗎？</p>`, '前往設定').then((ok) => ok && openSettings());
}

function openSettings() {
  const d = $<HTMLDialogElement>('#settings-dlg');
  $<HTMLInputElement>('#key').value = settings.geminiKey;
  $<HTMLInputElement>('#m-text').value = settings.textModel;
  $<HTMLInputElement>('#m-image').value = settings.imageModel;
  $<HTMLInputElement>('#m-video').value = settings.videoModel;
  $<HTMLInputElement>('#m-tts').value = settings.ttsModel;
  $<HTMLSelectElement>('#voice-engine').value = xk.web && settings.voiceEngine === 'edge' ? 'taiwan' : settings.voiceEngine;
  $<HTMLSelectElement>('#parallel').value = String(settings.parallel);
  $<HTMLSelectElement>('#local-model').innerHTML = LOCAL_MODELS.map((m) => `<option value="${m.key}">${esc(m.name)}・${m.size} GB・${esc(m.note)}</option>`).join('');
  $<HTMLSelectElement>('#local-model').value = localModelOf(settings.localModel).key;
  $<HTMLInputElement>('#local-exp').checked = settings.localExperimental;
  $<HTMLSelectElement>('#horde-model').innerHTML = HORDE_MODELS.map((m) => `<option value="${esc(m.key)}">${esc(m.name)}・${esc(m.note)}</option>`).join('');
  $<HTMLSelectElement>('#horde-model').value = hordeModelOf(settings.hordeModel).key;
  $<HTMLInputElement>('#horde-key').value = settings.hordeKey;
  $<HTMLInputElement>('#hf-token').value = settings.hfToken;
  d.classList.toggle('show-local', settings.localExperimental);
  void localStatus();
  $('#key-msg').textContent = '';
  d.showModal();
}

function readSettingsForm(): Settings {
  return {
    ...settings,
    geminiKey: $<HTMLInputElement>('#key').value.trim(),
    textModel: $<HTMLInputElement>('#m-text').value.trim() || DEFAULT_SETTINGS.textModel,
    imageModel: $<HTMLInputElement>('#m-image').value.trim() || DEFAULT_SETTINGS.imageModel,
    videoModel: $<HTMLInputElement>('#m-video').value.trim() || DEFAULT_SETTINGS.videoModel,
    ttsModel: $<HTMLInputElement>('#m-tts').value.trim() || DEFAULT_SETTINGS.ttsModel,
    voiceEngine: $<HTMLSelectElement>('#voice-engine').value as Settings['voiceEngine'],
    parallel: +$<HTMLSelectElement>('#parallel').value || 2,
    localModel: $<HTMLSelectElement>('#local-model').value || settings.localModel,
    localExperimental: $<HTMLInputElement>('#local-exp').checked,
    hordeModel: $<HTMLSelectElement>('#horde-model').value || settings.hordeModel,
    hordeKey: $<HTMLInputElement>('#horde-key').value.trim(),
    hfToken: $<HTMLInputElement>('#hf-token').value.trim(),
  };
}

async function saveSettings(s: Settings) {
  settings = s;
  studio.setSettings(s);
  await xk.settings.set({ ...s, lastProject: lastProject });
  renderSteps();
  renderBoardEngine();
}

async function localStatus() {
  const msg = $('#local-msg');
  const key = $<HTMLSelectElement>('#local-model').value;
  const g = await gpuStatus();
  if (!g.ok) {
    msg.textContent = `⚠ ${g.reason}`;
    return;
  }
  const cached = await llm.isCached(key);
  msg.textContent = `${cached ? '✅ 已下載，可離線使用' : '尚未下載（第一次分鏡時下載）'}・顯示晶片：${g.adapter || 'WebGPU'}${g.f16 ? '' : '（不支援半精度，改用較大的 f32 版）'}`;
  $<HTMLButtonElement>('#local-remove').disabled = !cached;
}

async function testKey() {
  const msg = $('#key-msg');
  const s = readSettingsForm();
  if (!s.geminiKey) return (msg.textContent = '請先貼上金鑰');
  msg.textContent = '測試中…';
  try {
    const { Gemini } = await import('./ai');
    const models = await new Gemini(s, xk.net).listModels();
    const want = [s.textModel, s.imageModel, s.videoModel, s.ttsModel];
    const miss = want.filter((m) => !models.includes(m));
    msg.textContent = miss.length ? `✅ 金鑰可以用（共 ${models.length} 個模型）。⚠ 清單中沒看到：${miss.join('、')}（可能是預覽模型，仍可先試用）` : `✅ 金鑰可以用，四個模型都找得到。`;
  } catch (e) {
    msg.textContent = `❌ ${friendly(e)}`;
  }
}

// --- 專案 ---------------------------------------------------------------------------------

let lastProject = '';

async function openProject(dir: string) {
  await studio.saveNow().catch(() => {});
  await studio.open(dir);
  lastProject = dir;
  await xk.settings.set({ ...settings, lastProject: dir });
  afterProjectChange();
}

async function newProjectNamed(title: string) {
  await studio.saveNow().catch(() => {});
  await studio.create(title || '我的故事', newProject(title || '我的故事'));
  lastProject = studio.dir;
  await xk.settings.set({ ...settings, lastProject });
  afterProjectChange();
}

async function renameProject(title: string) {
  title = title.trim();
  if (!title || title === P().title) return;
  P().title = title;
  await studio.saveNow();
  try {
    const nd = await xk.proj.rename(studio.dir, title);
    if (nd !== studio.dir) {
      studio.dir = nd;
      lastProject = nd;
      await xk.settings.set({ ...settings, lastProject });
      await studio.open(nd);
    }
  } catch {
    // 資料夾被其他程式開著時不能改名：只改專案標題
  }
  $<HTMLInputElement>('#proj-title').value = P().title;
}

function afterProjectChange() {
  $<HTMLInputElement>('#proj-title').value = P().title;
  $('#save-state').textContent = '';
  studio.onChange = () => {
    $('#save-state').textContent = '儲存中…';
    renderSteps();
  };
  studio.onSaved = () => ($('#save-state').textContent = '已儲存');
  studio.onVoiceWait = (id, rank) => {
    const s = P().shots.find((x) => x.id === id);
    if (!s) return;
    hordeWait.set(id, rank ? `配音排隊中：前面還有 ${rank} 位` : '雲端正在配音…');
    refreshShot(s);
  };
  renderSteps();
  setStep(P().story.trim() ? (P().shots.length ? 'make' : P().characters.length ? 'cast' : 'story') : 'story');
}

async function showProjects() {
  const d = $<HTMLDialogElement>('#proj-dlg');
  const list = await xk.proj.list();
  const ul = $('#proj-list');
  ul.innerHTML = list.length
    ? list
        .map(
          (x) =>
            `<li data-dir="${esc(x.dir)}" class="${x.dir === studio.dir ? 'cur' : ''}"><span>🎬</span><b>${esc(x.title)}</b><span class="muted">${x.characters} 角色・${x.shots} 鏡頭・${new Date(x.updated).toLocaleString('zh-TW', { hour12: false })}</span></li>`,
        )
        .join('')
    : '<li class="muted">還沒有專案</li>';
  $$('li[data-dir]', ul).forEach((li) =>
    li.addEventListener('click', async () => {
      d.close();
      await openProject(li.dataset.dir!);
    }),
  );
  $<HTMLInputElement>('#new-title').value = '';
  if (!d.open) d.showModal();
}

// --- 給語音教學與自動測試用的介面 --------------------------------------------------------

export interface AppHook {
  setStep(s: string): void;
  step(): string;
  useSample(): Promise<boolean>;
  findCast(): Promise<void>;
  autoBoard(): Promise<void>;
  makeAll(kind: 'all' | 'stills' | 'voices'): Promise<void>;
  render(): Promise<void>;
  setVideoEngine(v: 'ai' | 'photo'): void;
  setStillEngine(v: Settings['stillEngine'], model?: string): void;
  setBoardEngine(v: Settings['boardEngine'], model?: string): void;
  openSettings(): void;
  closeDialogs(): void;
  busy(): boolean;
  project(): ReturnType<typeof P>;
  studio(): Studio;
  /** 測試用：本機小模型 */
  llm(): LocalLLM;
  newProject(title: string): Promise<void>;
  openProject(dir: string): Promise<void>;
  save(): Promise<void>;
  rerender(): void;
}

declare global {
  interface Window {
    xkApp: AppHook;
  }
}

window.xkApp = {
  setStep,
  step: () => step,
  useSample,
  findCast,
  autoBoard,
  makeAll,
  render,
  setVideoEngine: (v) => {
    settings.videoEngine = v;
    void saveSettings(settings);
    renderMake();
  },
  setStillEngine: (v, model) => {
    settings.stillEngine = v;
    if (model) settings.hordeModel = model;
    void saveSettings(settings);
    renderMake();
  },
  setBoardEngine: (v, model) => {
    settings.boardEngine = v;
    if (model) settings.localModel = model;
    void saveSettings(settings);
    renderBoardEngine();
  },
  openSettings,
  closeDialogs: () => $$<HTMLDialogElement>('dialog[open]').forEach((d) => d.close()),
  busy: () => making || rendering || boarding,
  project: () => P(),
  studio: () => studio,
  llm: () => llm,
  newProject: newProjectNamed,
  openProject,
  save: () => studio.saveNow(),
  rerender: () => setStep(step),
};

// --- 啟動 ---------------------------------------------------------------------------------

async function boot() {
  $('#ver').textContent = `v${__APP_VERSION__}`;
  document.querySelector('#guide-btn .mini-robot')!.innerHTML = ROBOT_SVG;
  $$('.empty-robot').forEach((e) => (e.innerHTML = ROBOT_SVG));
  initUpdateButton(__APP_VERSION__);
  let bridge = desktop();
  if (!bridge) {
    // 線上版：專案存在瀏覽器裡、用 ffmpeg.wasm 合成
    document.body.classList.add('web');
    const wb = await import('./web-bridge');
    bridge = wb.createWebBridge();
    window.xk = bridge;
    // iPhone／iPad App：存檔走分享選單
    if (wb.iosApp()) {
      document.body.classList.add('ios-app');
      $$('#open-video .web-only, #open-srt .web-only').forEach((e) => (e.textContent = e.textContent!.replace('下載', '存')));
    }
  }
  xk = bridge;
  const saved = (await xk.settings.get()) as Partial<Settings> & { lastProject?: string };
  settings = { ...DEFAULT_SETTINGS, ...saved };
  lastProject = saved.lastProject ?? '';
  studio = new Studio(xk, settings, newProject());

  // 事件
  $$('#steps > button').forEach((b) => b.addEventListener('click', () => setStep(b.dataset.step!)));
  $$('.next-step').forEach((b) => b.addEventListener('click', () => setStep(b.dataset.goto!)));
  $('#ai-state').addEventListener('click', () => !settings.geminiKey && openSettings());
  $<HTMLTextAreaElement>('#story').addEventListener('input', (e) => {
    P().story = (e.target as HTMLTextAreaElement).value;
    storyStat();
    studio.touch();
  });
  $('#open-story').addEventListener('click', () => void openStoryFile());
  $('#sample-story').addEventListener('click', () => void useSample());
  $$('#aspect button').forEach((b) =>
    b.addEventListener('click', () => {
      P().aspect = b.dataset.v as '16:9' | '9:16';
      studio.touch();
      renderStory();
    }),
  );
  $<HTMLSelectElement>('#resolution').addEventListener('change', (e) => {
    P().resolution = (e.target as HTMLSelectElement).value as '720p' | '1080p';
    studio.touch();
  });
  $<HTMLInputElement>('#style').addEventListener('input', (e) => {
    P().style = (e.target as HTMLInputElement).value;
    studio.touch();
  });
  $$('#nar-gender button').forEach((b) =>
    b.addEventListener('click', () => {
      P().narrator.gender = b.dataset.v as 'male' | 'female';
      studio.touch();
      renderStory();
    }),
  );
  $<HTMLInputElement>('#nar-age').addEventListener('input', (e) => {
    P().narrator.age = Math.max(5, Math.min(95, parseInt((e.target as HTMLInputElement).value, 10) || 35));
    $('#nar-label').textContent = speakerLabel(P().narrator);
    studio.touch();
  });
  $<HTMLInputElement>('#nar-note').addEventListener('input', (e) => {
    P().narrator.voiceNote = (e.target as HTMLInputElement).value;
    studio.touch();
  });
  $('#nar-listen').addEventListener('click', () => void listen('narrator', '從前從前，在海邊的小漁村裡，住著一位老漁夫。'));
  $('#find-cast').addEventListener('click', () => void findCast());
  $('#add-char').addEventListener('click', () => {
    const p = P();
    if (p.characters.length >= MAX_CHARACTERS) return toast(`角色最多 ${MAX_CHARACTERS} 位`);
    p.characters.push(newCharacter(p.characters.length + 1));
    studio.touch();
    renderCast();
    renderSteps();
    $$<HTMLInputElement>('#cast .name').pop()?.select();
  });
  $('#auto-board').addEventListener('click', () => void autoBoard());
  $('#add-shot').addEventListener('click', () => {
    P().shots.push(newShot());
    studio.touch();
    renderBoard();
    $('#stage').scrollTop = 1e6;
  });
  $$('#video-engine button').forEach((b) => b.addEventListener('click', () => setEngine('video', b.dataset.v!)));
  $$('#still-engine button').forEach((b) => b.addEventListener('click', () => setEngine('still', b.dataset.v!)));
  $$('#voice-seg button').forEach((b) => b.addEventListener('click', () => setEngine('voice', b.dataset.v!)));
  $$('#board-engine button').forEach((b) => b.addEventListener('click', () => window.xkApp.setBoardEngine(b.dataset.v as Settings['boardEngine'])));
  $('#board-stop').addEventListener('click', () => llm.cancel());
  $('#local-model').addEventListener('change', () => void localStatus());
  $('#local-exp').addEventListener('change', (e) => $('#settings-dlg').classList.toggle('show-local', (e.target as HTMLInputElement).checked));
  $('#local-remove').addEventListener('click', async () => {
    const m = localModelOf($<HTMLSelectElement>('#local-model').value);
    if (!(await confirmBox('刪除模型？', `<p>刪除已下載的「${esc(m.name)}」（約 ${m.size} GB）。之後用本機小模型分鏡時會再下載一次。</p>`, '刪除'))) return;
    await llm.remove(m.key);
    void localStatus();
  });
  $('#make-all').addEventListener('click', () => void makeAll('all'));
  $('#make-stills').addEventListener('click', () => void makeAll('stills'));
  $('#make-voices').addEventListener('click', () => void makeAll('voices'));
  $('#make-stop').addEventListener('click', () => {
    stopMaking = true;
    hordeCancel.canceled = true;
    toast('正在停止：進行中的鏡頭完成後就會停下');
  });
  $<HTMLInputElement>('#burn-subs').addEventListener('change', (e) => {
    P().output.burnSubs = (e.target as HTMLInputElement).checked;
    studio.touch();
  });
  $<HTMLInputElement>('#ambience').addEventListener('input', (e) => {
    P().output.ambience = +(e.target as HTMLInputElement).value;
    $('#amb-val').textContent = `${P().output.ambience}%`;
    studio.touch();
  });
  $('#render').addEventListener('click', () => void render());
  $('#render-stop').addEventListener('click', () => void xk.ff.cancel());
  $('#open-video').addEventListener('click', async () => P().output.lastVideo && xk.shell.open(await studio.abs(P().output.lastVideo!)));
  $('#open-srt').addEventListener('click', async () => P().output.lastSrt && xk.shell.open(await studio.abs(P().output.lastSrt!)));
  $('#open-folder').addEventListener('click', async () => xk.shell.reveal(P().output.lastVideo ? await studio.abs(P().output.lastVideo!) : await studio.abs('輸出')));

  $('#settings-btn').addEventListener('click', openSettings);
  $('#key-show').addEventListener('click', () => {
    const k = $<HTMLInputElement>('#key');
    k.type = k.type === 'password' ? 'text' : 'password';
  });
  $('#key-test').addEventListener('click', () => void testKey());
  $('#models-reset').addEventListener('click', () => {
    $<HTMLInputElement>('#m-text').value = DEFAULT_SETTINGS.textModel;
    $<HTMLInputElement>('#m-image').value = DEFAULT_SETTINGS.imageModel;
    $<HTMLInputElement>('#m-video').value = DEFAULT_SETTINGS.videoModel;
    $<HTMLInputElement>('#m-tts').value = DEFAULT_SETTINGS.ttsModel;
  });
  $('#settings-save').addEventListener('click', async () => {
    await saveSettings(readSettingsForm());
    $<HTMLDialogElement>('#settings-dlg').close();
    toast('設定已儲存');
    if (step === 'make') renderMake();
  });

  $('#proj-btn').addEventListener('click', () => void showProjects());
  $('#proj-new').addEventListener('click', async () => {
    $<HTMLDialogElement>('#proj-dlg').close();
    await newProjectNamed($<HTMLInputElement>('#new-title').value.trim() || '我的故事');
  });
  $('#proj-open-other').addEventListener('click', async () => {
    const dir = await xk.dlg.project();
    if (!dir) return;
    $<HTMLDialogElement>('#proj-dlg').close();
    await openProject(dir).catch((e) => alertBox('無法開啟專案', `<p>${esc(friendly(e))}</p>`));
  });
  $('#proj-root').addEventListener('click', async () => xk.shell.open(await xk.proj.root()));
  $<HTMLInputElement>('#proj-title').addEventListener('change', (e) => void renameProject((e.target as HTMLInputElement).value));

  // 開啟上次的專案，沒有就建立第一個
  let opened = false;
  if (lastProject) {
    try {
      await studio.open(lastProject);
      opened = true;
    } catch {
      opened = false;
    }
  }
  if (!opened) {
    const list = await xk.proj.list();
    if (list.length) await studio.open(list[0].dir);
    else await studio.create('我的第一個故事', newProject('我的第一個故事'));
    lastProject = studio.dir;
    await xk.settings.set({ ...settings, lastProject });
  }
  afterProjectChange();
  window.addEventListener('beforeunload', () => void studio.saveNow());
  guideOnFirstRun();
  void checkUpdate(__APP_VERSION__, true);
}

$('#guide-btn').addEventListener('click', () => void startGuide());
void boot();
