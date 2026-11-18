// 小柯機器人：語音動態教學（邊講邊示範、聚光框）與版本更新
import { desktop, type UpdateInfo } from './bridge';

export const APP_NAME = '小柯機器人文字與圖像轉影音工具';
const STORE_KEY = 'xiaoke-storyvideo:guided';

const $ = <T extends HTMLElement = HTMLElement>(sel: string) => document.querySelector<T>(sel);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export const ROBOT_SVG = `<svg viewBox="0 0 120 120" aria-hidden="true">
  <line x1="60" y1="8" x2="60" y2="22" stroke="#5a6478" stroke-width="4"/>
  <circle cx="60" cy="8" r="7" fill="#ffc428"/>
  <rect x="6" y="50" width="12" height="32" rx="5" fill="#2878dc"/>
  <rect x="102" y="50" width="12" height="32" rx="5" fill="#2878dc"/>
  <circle cx="60" cy="66" r="48" fill="#4696f0"/>
  <circle cx="60" cy="66" r="44" fill="#f0f6ff"/>
  <rect x="25" y="44" width="70" height="42" rx="20" fill="#182440"/>
  <path class="eye" d="M36 62 q9 -10 18 0" stroke="#5ae6ff" stroke-width="5" fill="none" stroke-linecap="round"/>
  <path class="eye" d="M66 62 q9 -10 18 0" stroke="#5ae6ff" stroke-width="5" fill="none" stroke-linecap="round"/>
  <ellipse class="mouth" cx="60" cy="75" rx="9" ry="3" fill="#5ae6ff"/>
  <circle cx="32" cy="80" r="5" fill="#ff8ca0" opacity=".8"/>
  <circle cx="88" cy="80" r="5" fill="#ff8ca0" opacity=".8"/>
</svg>`;

// --- 語音動態教學 ----------------------------------------------------------------------

interface Step {
  target?: () => HTMLElement | null;
  text: string;
  before?: () => void | Promise<void>;
  demo?: () => Promise<void>;
}

const app = () => window.xkApp;
async function press(el: HTMLElement | null) {
  if (!el) return;
  el.animate([{ transform: 'scale(1)' }, { transform: 'scale(.92)', boxShadow: '0 0 0 4px #ffc428' }, { transform: 'scale(1)' }], { duration: 420 });
  await sleep(300);
}
/** 教學是否幫使用者填了範例故事 */
let filledSample = false;

const STEPS: Step[] = [
  {
    before: () => app().setStep('story'),
    text: '你好，我是小柯機器人！歡迎使用文字與圖像轉影音工具。只要一篇故事，加上角色的九宮格照片，我就能幫你做出像真人拍攝的影片，還有分男女老少的配音和 SRT 逐字稿。我一步一步示範給你看。',
  },
  {
    target: () => $('#steps'),
    text: '左邊是五個製作步驟：故事文案、角色九宮格、分鏡腳本、畫面與配音，最後合成影片和字幕。照著一二三四五走就完成了，每一步都會自動存檔。',
  },
  {
    target: () => $('.story-card'),
    text: '第一步，貼上故事，或按「開啟文字檔」讀入 Word、文字檔。敘述的部分會變成旁白，引號裡的話會變成角色的台詞。第一次使用可以按「試用範例故事」。',
    demo: async () => {
      if (app().project().story.trim()) return;
      await sleep(5500);
      await press($('#sample-story'));
      filledSample = await app().useSample();
    },
  },
  {
    target: () => $('.side-card'),
    text: '右邊設定畫面比例，橫式適合電腦和電視，直式適合手機短影音。下面可以選旁白是男聲還是女聲、幾歲，按「試聽旁白」先聽聽看。',
  },
  {
    before: () => app().setStep('cast'),
    target: () => $('#cast .char') ?? $('#cast-empty'),
    text: '第二步是角色。主角、配角、童星，每一位放一張九宮格圖：正面、左右側面、背面、遠景、中景、近景和臉部特寫。AI 會照著這些照片，讓每個鏡頭裡的人長得一模一樣。',
  },
  {
    target: () => $('#cast .char .ai') ?? $('#find-cast'),
    text: '沒有九宮格圖也沒關係！加入一到三張這個人的照片，或寫下髮型和服裝，再按「AI 產生九宮格」，我就幫你拍出九個角度的寫實照片。也可以按「從故事找出角色」自動列出人物。',
  },
  {
    target: () => $('#cast .char .fields') ?? $('#cast'),
    text: '每個角色要設定性別和年齡。配音會依照年齡做出小孩、青年、中年或長者的聲音，不會像機器人。按「試聽聲音」就能聽到這個角色怎麼說話。',
  },
  {
    before: () => app().setStep('board'),
    target: () => $('#auto-board'),
    text: '第三步，按「AI 自動分鏡」。AI 像導演一樣把故事拆成鏡頭：開場用遠景交代環境，對話用中景近景，情緒高點用特寫，還會寫好光源、色溫和鏡頭焦段。',
  },
  {
    target: () => $('#shots .shot') ?? $('#board-empty'),
    text: '每個鏡頭都能修改：換鏡頭類型、選出場角色、改畫面描述，也可以調整每一句台詞是誰說的、用什麼語氣。色溫的小圓點會顯示光線是暖色還是冷色。',
  },
  {
    before: () => app().setStep('make'),
    target: () => $('#video-engine'),
    text: '第四步產生畫面與配音。「AI 寫實影片」會讓畫面裡的人真的動起來，還有現場環境音；「動態照片」只做寫實照片加上運鏡，費用低很多，適合先試做。',
  },
  {
    target: () => $('#make-all'),
    text: '按「全部產生」，我會先拍每個鏡頭的寫實畫面，再演成影片，同時錄好配音。遠景的聲音比較小、有空間迴音，特寫則貼近清楚。哪一個鏡頭不滿意，按它的重新產生就好。',
  },
  {
    before: () => app().setStep('out'),
    target: () => $('#render'),
    text: '最後一步，按「合成影片」，就會把全部鏡頭、配音和環境音接成一支 MP4，同時產生 SRT 逐字稿，可以直接上傳 YouTube。字幕也可以選擇燒在畫面上。',
  },
  {
    target: () => $('#settings-btn'),
    text: '寫實畫面、AI 影片和最自然的配音需要 Google Gemini 金鑰，在這裡設定。沒有金鑰也能用免費模式：自動分鏡、微軟語音，加上用九宮格照片做的動態影片。',
  },
  {
    before: () => app().setStep('story'),
    target: () => $('.xk-update'),
    text: '這顆按鈕會檢查新版本，有更新可以直接安裝。教學到這裡結束，想再聽一次就按「語音教學」。祝你做出好看的影片！',
  },
];

let running = false;
let cutSpeech: (() => void) | null = null;
let stopRequested = false;

function pickVoice(): SpeechSynthesisVoice | undefined {
  const voices = speechSynthesis.getVoices();
  for (const re of [/zh[-_]TW/i, /Hanhan|Yating|Zhiwei|HsiaoChen|HsiaoYu|Mei-Jia/i, /zh[-_]HK/i, /zh/i]) {
    const v = voices.find((x) => re.test(x.lang) || re.test(x.name));
    if (v) return v;
  }
  return undefined;
}

function speak(text: string, mouth: HTMLElement): Promise<void> {
  return new Promise((resolve) => {
    if (!('speechSynthesis' in window) || /[?&]mute/.test(location.search)) {
      mouth.classList.add('talk');
      setTimeout(
        () => {
          mouth.classList.remove('talk');
          resolve();
        },
        /[?&]fastguide/.test(location.search) ? 300 : Math.max(2500, text.length * 180),
      );
      return;
    }
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    const v = pickVoice();
    if (v) u.voice = v;
    u.lang = v?.lang ?? 'zh-TW';
    u.rate = 1.05;
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      cutSpeech = null;
      mouth.classList.remove('talk');
      resolve();
    };
    cutSpeech = finish;
    u.onstart = () => mouth.classList.add('talk');
    u.onend = finish;
    u.onerror = finish;
    setTimeout(finish, Math.max(4000, text.length * 260) + 1500);
    speechSynthesis.speak(u);
  });
}

export async function startGuide() {
  if (running || app()?.busy()) return;
  running = true;
  stopRequested = false;
  filledSample = false;
  const startStep = app().step();
  let index = 0;
  let jump: number | null = null;
  let paused = false;

  const layer = document.createElement('div');
  layer.className = 'xk-guide';
  layer.innerHTML = `
    <div class="xk-spot"></div>
    <div class="xk-bubble" role="dialog" aria-live="polite">
      <div class="xk-robot">${ROBOT_SVG}</div>
      <div class="xk-body">
        <p class="xk-text"></p>
        <div class="xk-bar"><span class="xk-count"></span>
          <button type="button" class="ghost xk-prev" title="上一步">◀</button>
          <button type="button" class="ghost xk-pause" title="暫停">⏸</button>
          <button type="button" class="ghost xk-next" title="下一步">▶</button>
          <button type="button" class="ghost xk-close" title="結束教學">✕</button>
        </div>
      </div>
    </div>`;
  document.body.append(layer);
  const spot = layer.querySelector<HTMLElement>('.xk-spot')!;
  const bubble = layer.querySelector<HTMLElement>('.xk-bubble')!;
  const text = layer.querySelector<HTMLElement>('.xk-text')!;
  const count = layer.querySelector<HTMLElement>('.xk-count')!;
  const robot = layer.querySelector<HTMLElement>('.xk-robot')!;
  const pauseBtn = layer.querySelector<HTMLButtonElement>('.xk-pause')!;
  let wake: (() => void) | null = null;
  const interrupt = () => {
    if ('speechSynthesis' in window) speechSynthesis.cancel();
    cutSpeech?.();
    wake?.();
  };
  layer.querySelector('.xk-prev')!.addEventListener('click', () => {
    jump = Math.max(0, index - 1);
    interrupt();
  });
  layer.querySelector('.xk-next')!.addEventListener('click', () => {
    jump = index + 1;
    interrupt();
  });
  pauseBtn.addEventListener('click', () => {
    paused = !paused;
    pauseBtn.textContent = paused ? '▶︎ 繼續' : '⏸';
    if (paused && 'speechSynthesis' in window) speechSynthesis.pause();
    else {
      if ('speechSynthesis' in window) speechSynthesis.resume();
      wake?.();
    }
  });
  layer.querySelector('.xk-close')!.addEventListener('click', () => {
    stopRequested = true;
    interrupt();
  });
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      stopRequested = true;
      interrupt();
    }
  };
  document.addEventListener('keydown', onKey);

  const place = (target: HTMLElement | null) => {
    if (!target || target.offsetParent === null) {
      spot.classList.add('none');
      Object.assign(bubble.style, { left: '50%', top: '50%', transform: 'translate(-50%, -50%)' });
      return;
    }
    target.scrollIntoView({ block: 'nearest' });
    const r = target.getBoundingClientRect();
    const pad = 6;
    spot.classList.remove('none');
    Object.assign(spot.style, { left: `${r.left - pad}px`, top: `${r.top - pad}px`, width: `${r.width + 2 * pad}px`, height: `${r.height + 2 * pad}px` });
    const bw = Math.min(460, window.innerWidth - 24);
    const bh = bubble.offsetHeight || 160;
    let left = r.right + 18;
    let top = r.top;
    if (left + bw > window.innerWidth - 12) left = r.left - bw - 18;
    if (left < 12) {
      left = Math.max(12, Math.min(window.innerWidth - bw - 12, r.left + r.width / 2 - bw / 2));
      top = r.bottom + 18;
      if (top + bh > window.innerHeight - 12) top = r.top - bh - 18;
      if (top < 12) top = Math.min(window.innerHeight - bh - 12, r.bottom - bh - 12);
    }
    top = Math.max(12, Math.min(window.innerHeight - bh - 12, top));
    Object.assign(bubble.style, { left: `${left}px`, top: `${top}px`, transform: 'none' });
  };

  try {
    while (index < STEPS.length && !stopRequested) {
      const step = STEPS[index];
      jump = null;
      count.textContent = `${index + 1} / ${STEPS.length}`;
      await step.before?.();
      await sleep(250);
      if (stopRequested) break;
      if (jump !== null) {
        index = jump;
        continue;
      }
      text.textContent = step.text;
      robot.classList.remove('pop');
      void robot.offsetWidth;
      robot.classList.add('pop');
      place(step.target?.() ?? null);
      const follow = setInterval(() => place(step.target?.() ?? null), 400);
      await Promise.all([speak(step.text, robot), step.demo?.().then(() => sleep(400))]);
      clearInterval(follow);
      while (paused && !stopRequested && jump === null) await new Promise<void>((r) => (wake = r));
      wake = null;
      if (jump === null && !stopRequested) await sleep(500);
      index = jump ?? index + 1;
    }
  } finally {
    if ('speechSynthesis' in window) speechSynthesis.cancel();
    document.removeEventListener('keydown', onKey);
    layer.remove();
    running = false;
    app().closeDialogs();
    app().setStep(filledSample ? 'cast' : startStep);
    try {
      localStorage.setItem(STORE_KEY, '1');
    } catch {
      // 無痕模式：下次再播也無妨
    }
  }
}

export function guideOnFirstRun() {
  let seen = '1';
  try {
    seen = localStorage.getItem(STORE_KEY) ?? '';
  } catch {
    seen = '1';
  }
  if (!seen && !/[?&]noguide/.test(location.search)) setTimeout(() => void startGuide(), 1200);
}

// --- 版本更新 ---------------------------------------------------------------------------

const UPDATE_REPO = 'achir1015/xiaoke-storyvideo';

function cmpVer(a: string, b: string) {
  const pa = a.replace(/^v/, '').split('.').map((x) => parseInt(x, 10) || 0);
  const pb = b.replace(/^v/, '').split('.').map((x) => parseInt(x, 10) || 0);
  for (let i = 0; i < 3; i++) if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) - (pb[i] ?? 0);
  return 0;
}

function dialog(html: string): HTMLDialogElement {
  const d = document.createElement('dialog');
  d.className = 'xk-dialog';
  d.innerHTML = `<form method="dialog">${html}</form>`;
  document.body.append(d);
  d.addEventListener('close', () => d.remove());
  d.showModal();
  return d;
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);

export function initUpdateButton(current: string) {
  for (const b of document.querySelectorAll<HTMLButtonElement>('.xk-update')) b.addEventListener('click', () => void checkUpdate(current));
}

export async function checkUpdate(current: string, quiet = false) {
  const xk = desktop();
  try {
    let info: UpdateInfo;
    if (xk) info = await xk.update.check();
    else {
      const res = await fetch(`version.json?t=${Date.now()}`, { cache: 'no-store' });
      const j = (await res.json()) as { version: string; notes?: string };
      info = { current, latest: j.version, newer: cmpVer(j.version, current) > 0, notes: j.notes ?? '', page: `https://github.com/${UPDATE_REPO}/releases/latest`, canInstall: true, flavor: 'web' };
    }
    if (!info.newer) {
      if (!quiet) dialog(`<h2>已是最新版</h2><p>目前版本 v${esc(info.current)} 就是最新版。</p><div class="xk-row"><button class="ghost">關閉</button></div>`);
      return;
    }
    const d = dialog(`<h2>有新版本 v${esc(info.latest)}</h2><p>目前版本 v${esc(info.current)}</p>
      ${info.notes ? `<pre class="xk-notes">${esc(info.notes)}</pre>` : ''}
      <progress hidden max="1" value="0"></progress><p class="xk-msg"></p>
      <div class="xk-row"><button type="button" class="xk-go primary">${info.canInstall ? (xk ? '下載並安裝' : '立即更新') : '開啟下載頁'}</button><button class="ghost">稍後</button></div>`);
    const go = d.querySelector<HTMLButtonElement>('.xk-go')!;
    const bar = d.querySelector<HTMLProgressElement>('progress')!;
    const msg = d.querySelector<HTMLElement>('.xk-msg')!;
    go.addEventListener('click', async () => {
      if (!xk) {
        location.reload();
        return;
      }
      if (!info.canInstall) {
        await xk.update.openPage();
        return;
      }
      if (window.xkApp?.busy() && !confirm('還有工作正在進行，更新會停止它。要繼續更新嗎？')) return;
      await window.xkApp?.save().catch(() => {});
      go.disabled = true;
      bar.hidden = false;
      const off = xk.update.onProgress(({ got, total }) => {
        if (total) bar.value = got / total;
        msg.textContent = `下載中 ${(got / 1048576).toFixed(1)} MB${total ? ` / ${(total / 1048576).toFixed(1)} MB` : ''}`;
      });
      try {
        const file = await xk.update.download();
        msg.textContent = '下載完成，正在安裝，程式會自動重新開啟…';
        const r = await xk.update.install(file);
        if (r.manual) msg.textContent = `已下載到 ${r.path}，請手動開啟安裝。`;
      } catch (e) {
        msg.textContent = `更新失敗：${(e as Error).message}`;
        go.disabled = false;
      } finally {
        off();
      }
    });
  } catch (e) {
    if (!quiet) dialog(`<h2>無法檢查更新</h2><p>${esc((e as Error).message)}</p><div class="xk-row"><button class="ghost">關閉</button></div>`);
  }
}
