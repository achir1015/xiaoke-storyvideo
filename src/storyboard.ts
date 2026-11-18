// 分鏡：AI 分鏡的提示詞與結果解析、沒有 AI 時的規則式分鏡（純函式，所有平台共用）
import { type Character, type Line, type Project, type Shot, type ShotType, SHOT_TYPES, newShot, uid } from './types';

/** 中文語音每秒約 4 個字（含標點停頓） */
export const CHARS_PER_SEC = 4.2;
/** 一個鏡頭的台詞最多約 12 秒（AI 影片一段最長 15 秒） */
export const MAX_LINE_SEC = 12;

export function estimateSec(text: string) {
  const n = [...text.replace(/\s+/g, '')].length;
  return n / CHARS_PER_SEC;
}

/** 依標點把文字切成句子（保留標點；引號裡的標點不切，整段對白保持完整） */
export function sentences(text: string): string[] {
  const out: string[] = [];
  let cur = '';
  let depth = 0;
  const chars = [...text];
  for (let i = 0; i < chars.length; i++) {
    const ch = chars[i];
    if (ch === '\n') {
      if (cur.trim()) out.push(cur.trim());
      cur = '';
      depth = 0;
      continue;
    }
    cur += ch;
    if ('「『“'.includes(ch)) depth++;
    else if ('」』”'.includes(ch)) {
      depth = Math.max(0, depth - 1);
      if (!depth && /[。！？!?]$/.test(cur.slice(0, -1))) {
        out.push(cur.trim());
        cur = '';
      }
    } else if (!depth && '。！？!?；;'.includes(ch)) {
      // 連續標點（！？、……）一起帶走
      while (i + 1 < chars.length && '。！？!?…'.includes(chars[i + 1])) cur += chars[++i];
      if (i + 1 < chars.length && '」』”'.includes(chars[i + 1])) continue;
      out.push(cur.trim());
      cur = '';
    }
  }
  if (cur.trim()) out.push(cur.trim());
  return out.filter(Boolean);
}

/** 太長的台詞切成多段（每段不超過 maxSec） */
export function splitLong(text: string, maxSec = MAX_LINE_SEC): string[] {
  if (estimateSec(text) <= maxSec) return [text];
  const parts: string[] = [];
  let cur = '';
  const pieces = text.split(/(?<=[，,、。！？!?；;])/);
  for (const p of pieces) {
    if (cur && estimateSec(cur + p) > maxSec) {
      parts.push(cur);
      cur = '';
    }
    if (estimateSec(p) > maxSec) {
      // 沒有標點的超長句：硬切
      const n = Math.floor(maxSec * CHARS_PER_SEC);
      const chars = [...p];
      for (let i = 0; i < chars.length; i += n) parts.push(chars.slice(i, i + n).join(''));
      continue;
    }
    cur += p;
  }
  if (cur) parts.push(cur);
  return parts.filter((x) => x.trim());
}

const NAME_STOP = new Set(['他們', '我們', '你們', '她們', '大家', '自己', '時候', '今天', '明天', '昨天', '這個', '那個', '什麼', '一個', '因為', '所以', '但是', '可是', '於是', '然後', '突然', '已經', '知道', '覺得', '看到', '聽到', '開始', '從前', '有一天', '小朋友']);

/** 從故事找出可能的角色名字（說話前的稱呼、反覆出現的人名） */
export function guessCharacters(story: string, max = 10): { name: string; count: number; child: boolean; gender?: 'male' | 'female' }[] {
  const counts = new Map<string, number>();
  const add = (n: string, w = 1) => {
    n = n.trim();
    if (n.length < 2 || n.length > 4 || NAME_STOP.has(n) || /[的了著是在和與跟就也都很說道問]$/.test(n) || /^[的了著是在和與跟就也都很]/.test(n)) return;
    counts.set(n, (counts.get(n) ?? 0) + w);
  };
  // 「XX說：」「XX問」「XX笑著說」
  for (const m of story.matchAll(/([一-龥]{2,4}?)(?:笑著|大聲|小聲|輕聲|生氣地|開心地|難過地|哭著|急忙|連忙)?(?:說|問|喊|叫|答|道|回答|大叫)[：:，,]?\s*[「『“"]/g)) add(m[1], 3);
  // 稱謂詞
  for (const m of story.matchAll(/(?:小|阿|老)[一-龥]{1,2}|[一-龥]{1,2}(?:爺爺|奶奶|阿公|阿嬤|爸爸|媽媽|老師|先生|小姐|阿姨|叔叔|伯伯|哥哥|姊姊|姐姐|弟弟|妹妹|公主|王子|國王|皇后|醫生)|(?:爺爺|奶奶|阿公|阿嬤|爸爸|媽媽|老師|國王|皇后|公主|王子)/g)) add(m[0]);
  const list = [...counts.entries()].filter(([, c]) => c >= 2).sort((a, b) => b[1] - a[1]);
  // 去掉被更長名字包含的短名字（例如「小明」與「小明說」）
  const names: { name: string; count: number }[] = [];
  for (const [name, count] of list) {
    if (names.some((x) => x.name.includes(name) || name.includes(x.name))) continue;
    names.push({ name, count });
    if (names.length >= max) break;
  }
  return names.map((x) => {
    const child = /^小|弟弟|妹妹|童|孩/.test(x.name) && !/小姐/.test(x.name);
    const female = /奶奶|阿嬤|媽媽|阿姨|姊姊|姐姐|妹妹|公主|皇后|小姐|女/.test(x.name);
    const male = /爺爺|阿公|爸爸|叔叔|伯伯|哥哥|弟弟|王子|國王|先生/.test(x.name);
    return { ...x, child, gender: female ? 'female' : male ? 'male' : undefined };
  });
}

/** 依稱謂猜年齡 */
export function guessAge(name: string, child: boolean) {
  if (/爺爺|奶奶|阿公|阿嬤|伯伯|國王|皇后/.test(name)) return 70;
  if (/爸爸|媽媽|老師|醫生|叔叔|阿姨|先生/.test(name)) return 40;
  if (/哥哥|姊姊|姐姐|小姐|王子|公主/.test(name)) return 20;
  if (child || /弟弟|妹妹/.test(name)) return 8;
  return 30;
}

/** 依內容猜鏡頭（場景開頭用遠景、對話用近景、情緒用特寫） */
function pickShotType(text: string, index: number, hasDialogue: boolean): ShotType {
  if (/哭|淚|笑了|眼睛|臉|驚訝|害怕|心跳|低頭|微笑/.test(text)) return '特寫';
  if (index === 0 || /從前|有一天|來到|遠方|山|海|森林|城市|村|天空|街|夜晚|清晨|黃昏/.test(text)) return '遠景';
  if (hasDialogue) return '近景';
  return '中景';
}

function lightFor(text: string): { timeOfDay: string; light: string; kelvin: number } {
  if (/夜|晚上|月|星/.test(text)) return { timeOfDay: '夜晚', light: '月光與路燈，冷暖對比', kelvin: 4100 };
  if (/黃昏|夕陽|傍晚/.test(text)) return { timeOfDay: '黃昏', light: '低角度暖色夕陽逆光', kelvin: 3200 };
  if (/清晨|早上|日出/.test(text)) return { timeOfDay: '清晨', light: '柔和的晨光，薄霧', kelvin: 4800 };
  if (/屋裡|房間|教室|客廳|廚房|室內/.test(text)) return { timeOfDay: '白天', light: '窗戶進來的自然光加室內燈', kelvin: 4500 };
  return { timeOfDay: '白天', light: '自然日光', kelvin: 5600 };
}

const LENS: Record<ShotType, number> = { 遠景: 24, 中景: 35, 近景: 50, 特寫: 85 };

/** 沒有 AI 時：依段落與對話把故事切成鏡頭 */
export function ruleStoryboard(story: string, characters: Character[]): Shot[] {
  const shots: Shot[] = [];
  const paras = story.split(/\n\s*\n|\r?\n/).map((p) => p.trim()).filter(Boolean);
  const nameOf = (s: string) => characters.filter((c) => c.name && s.includes(c.name));
  for (const para of paras) {
    let group: string[] = [];
    const flush = () => {
      if (!group.length) return;
      const text = group.join('');
      const lines: Line[] = [];
      for (const s of group) {
        // 「XX說：「……」」→ 角色台詞；其他 → 旁白
        const m = /^(.*?)[「『“"](.+?)[」』”"](.*)$/.exec(s);
        if (m) {
          const who = nameOf(m[1])[0] ?? characters.find((c) => text.includes(c.name));
          if (m[1].replace(/[，,：:]/g, '').trim().length > 6) lines.push({ speaker: 'narrator', text: m[1].replace(/[：:，,]\s*$/, '。'), emotion: '' });
          lines.push({ speaker: who?.id ?? 'narrator', text: m[2], emotion: emotionOf(m[2]) });
          if (m[3].replace(/[。，,]/g, '').trim().length > 1) lines.push({ speaker: 'narrator', text: m[3].replace(/^[，,]/, ''), emotion: '' });
        } else lines.push({ speaker: 'narrator', text: s, emotion: '' });
      }
      const shot = newShot();
      const hasDialogue = lines.some((l) => l.speaker !== 'narrator');
      shot.shotType = pickShotType(text, shots.length, hasDialogue);
      shot.lens = LENS[shot.shotType];
      Object.assign(shot, lightFor(text));
      shot.characters = nameOf(text).map((c) => c.id);
      shot.visual = text.replace(/[「『“"].*?[」』”"]/g, '').slice(0, 80) || text.slice(0, 80);
      shot.scene = paraScene(para);
      shot.move = shot.shotType === '遠景' ? '緩慢橫搖' : shot.shotType === '特寫' ? '緩慢推近' : '輕微推近';
      shot.lines = lines.flatMap((l) => splitLong(l.text).map((t) => ({ ...l, text: t })));
      shots.push(shot);
      group = [];
    };
    for (const s of sentences(para)) {
      if (group.length && estimateSec(group.join('') + s) > MAX_LINE_SEC) flush();
      group.push(s);
    }
    flush();
  }
  return shots;
}

function paraScene(p: string) {
  const m = /(在|來到|走進|回到)([一-龥]{2,8}?)(裡|上|中|旁|邊|前|，|。)/.exec(p);
  return m ? m[2] : '';
}

export function emotionOf(t: string) {
  if (/[!！]{1}/.test(t) && /哈|太好|好棒|耶/.test(t)) return '開心興奮';
  if (/嗚|對不起|難過|捨不得/.test(t)) return '難過哽咽';
  if (/怎麼|為什麼|真的嗎|[?？]/.test(t)) return '疑惑';
  if (/快|小心|救命/.test(t)) return '緊張急促';
  if (/[!！]/.test(t)) return '激動';
  return '';
}

// --- AI 分鏡 --------------------------------------------------------------------------

export function storyboardPrompt(p: Project): string {
  const chars = p.characters
    .map((c) => `- id=${c.id}｜${c.name}｜${c.role}｜${c.gender === 'male' ? '男' : '女'}｜${c.age} 歲｜外觀：${c.look || '（見參考圖）'}`)
    .join('\n');
  return `你是專業的電影導演與分鏡師。請把下面的故事改編成「寫實電影」的分鏡腳本，畫面要像真實拍攝的照片與電影，不要漫畫或卡通。

規則：
1. 鏡頭類型只能是：遠景、中景、近景、特寫。開場與換場用遠景交代環境；對話用中景或近景；情緒高點用特寫。要有變化，不要連續三個相同鏡頭。
2. 每個鏡頭的台詞與旁白合計不超過 45 個中文字（約 11 秒）。太長就拆成多個鏡頭。
3. 故事的敘述文字放在旁白（speaker 填 "narrator"），角色說的話放在該角色的台詞（speaker 填角色 id）。台詞內容要忠於原文，不要省略情節。
4. 光線要符合真實光源：寫出時段（清晨／白天／黃昏／夜晚／室內）、光源方向與性質、色溫（K，例如日光 5600、鎢絲燈 3200、陰天 6500、夕陽 3000）。
5. 焦段：遠景 18–28mm 廣角、中景 35mm、近景 50mm、特寫 85–135mm。
6. visual 用中文寫畫面（場景、人物位置、動作、表情、服裝）；prompt 用英文寫給影像 AI 的寫實攝影描述（photorealistic, cinematic still, 鏡頭焦段、光線、色溫、景深），不要提到卡通或插畫。
7. emotion 寫說話語氣（例如：溫柔、開心、生氣、害怕、哽咽、輕聲）。ambience 寫環境音（例如：蟲鳴、風聲、車流、雨聲）。
8. 只輸出 JSON，不要任何說明文字。

角色（characters 只能填下列 id）：
${chars || '（沒有角色，全部用旁白）'}
${p.style ? `\n整體風格：${p.style}\n` : ''}
輸出格式：
{"shots":[{"scene":"場景名稱","shotType":"遠景","characters":["角色id"],"visual":"中文畫面描述","prompt":"English photorealistic prompt","timeOfDay":"黃昏","light":"光源描述","kelvin":3200,"lens":24,"move":"固定｜緩慢推近｜拉遠｜橫搖｜跟拍","ambience":"環境音","lines":[{"speaker":"narrator","text":"旁白文字","emotion":""},{"speaker":"角色id","text":"台詞","emotion":"開心"}]}]}

故事：
${p.story}`;
}

/** 從 AI 回應中取出 JSON（去掉 ```json 包裝與前後文字） */
export function extractJson(text: string): unknown {
  const t = text.replace(/```(?:json)?/gi, '').trim();
  const start = t.search(/[{[]/);
  if (start < 0) throw new Error('AI 沒有回傳分鏡資料');
  const open = t[start];
  const close = open === '{' ? '}' : ']';
  const end = t.lastIndexOf(close);
  return JSON.parse(t.slice(start, end + 1));
}

/** 檢查並修正 AI 回傳的分鏡 */
export function parseStoryboard(raw: unknown, characters: Character[]): Shot[] {
  const arr = (Array.isArray(raw) ? raw : (raw as { shots?: unknown[] })?.shots) ?? [];
  if (!Array.isArray(arr) || !arr.length) throw new Error('AI 回傳的分鏡是空的');
  const ids = new Set(characters.map((c) => c.id));
  const byName = new Map(characters.map((c) => [c.name, c.id]));
  const fixId = (x: unknown) => {
    const s = String(x ?? '').trim();
    if (s === 'narrator' || s === '旁白' || !s) return 'narrator';
    if (ids.has(s)) return s;
    return byName.get(s) ?? 'narrator';
  };
  const shots: Shot[] = [];
  for (const it of arr as Record<string, unknown>[]) {
    const shot = newShot();
    shot.id = uid('s');
    shot.scene = String(it.scene ?? '');
    const st = String(it.shotType ?? '中景') as ShotType;
    shot.shotType = SHOT_TYPES.includes(st) ? st : '中景';
    shot.characters = (Array.isArray(it.characters) ? it.characters : []).map(fixId).filter((x) => x !== 'narrator');
    shot.characters = [...new Set(shot.characters)];
    shot.visual = String(it.visual ?? '');
    shot.prompt = String(it.prompt ?? '');
    shot.timeOfDay = String(it.timeOfDay ?? '白天');
    shot.light = String(it.light ?? '自然光');
    shot.kelvin = clamp(Number(it.kelvin) || 5600, 1800, 10000);
    shot.lens = clamp(Number(it.lens) || LENS[shot.shotType], 12, 200);
    shot.move = String(it.move ?? '固定');
    shot.ambience = String(it.ambience ?? '');
    const lines = (Array.isArray(it.lines) ? it.lines : []) as Record<string, unknown>[];
    shot.lines = lines
      .map((l) => ({ speaker: fixId(l.speaker), text: String(l.text ?? '').trim(), emotion: String(l.emotion ?? '') }))
      .filter((l) => l.text)
      .flatMap((l) => splitLong(l.text).map((text) => ({ ...l, text })));
    // 說話的角色一定要在畫面裡
    for (const l of shot.lines) if (l.speaker !== 'narrator' && !shot.characters.includes(l.speaker)) shot.characters.push(l.speaker);
    shots.push(shot);
  }
  return shots;
}

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

/** 角色出場的鏡頭數（檢查用） */
export function appearances(shots: Shot[], id: string) {
  return shots.filter((s) => s.characters.includes(id) || s.lines.some((l) => l.speaker === id)).length;
}


// --- 本機小模型分鏡 ---------------------------------------------------------------------
// 小模型一次寫整份分鏡容易漏台詞、亂格式，所以先用規則把故事切成鏡頭（台詞忠於原文），
// 再一個鏡頭一個鏡頭請小模型補上鏡頭類型、光線、色溫、焦段、運鏡、畫面描述、英文提示詞與語氣。

const MOVES = ['固定', '緩慢推近', '拉遠', '橫搖', '跟拍'];
const TIMES = ['清晨', '白天', '黃昏', '夜晚', '室內'];

export const LOCAL_SYSTEM = '你是寫實電影的分鏡師。只輸出 JSON。畫面要像真實拍攝的電影，不要卡通或插畫。';

/** 小模型用的 JSON 格式（WebLLM 會照這個格式限制輸出） */
export function localShotSchema(_lines = 0) {
  return {
    type: 'object',
    properties: {
      scene: { type: 'string' },
      shotType: { type: 'string', enum: SHOT_TYPES },
      timeOfDay: { type: 'string', enum: TIMES },
      light: { type: 'string' },
      kelvin: { type: 'integer' },
      lens: { type: 'integer' },
      move: { type: 'string', enum: MOVES },
      ambience: { type: 'string' },
      visual: { type: 'string' },
      prompt: { type: 'string' },
      // 數量不寫進格式：每鏡都用同一份格式（WebLLM 換格式時會用到已刪除的格式檢查器而出錯）
      emotions: { type: 'array', items: { type: 'string' }, maxItems: 8 },
    },
    required: ['scene', 'shotType', 'timeOfDay', 'light', 'kelvin', 'lens', 'move', 'ambience', 'visual', 'prompt', 'emotions'],
  };
}

/** 第 i 個鏡頭給小模型的提示（附上前一鏡的場景與時段，讓前後連貫） */
export function localShotPrompt(p: Project, shots: Shot[], i: number): string {
  const s = shots[i];
  const prev = shots[i - 1];
  const name = (id: string) => (id === 'narrator' ? '旁白' : (p.characters.find((c) => c.id === id)?.name ?? '旁白'));
  const cast = s.characters
    .map((id) => p.characters.find((c) => c.id === id))
    .filter((c): c is Character => !!c)
    .map((c) => `${c.name}（${c.gender === 'male' ? '男' : '女'}，${c.age} 歲${c.look ? `，${c.look}` : ''}）`)
    .join('；');
  const lines = s.lines.map((l, k) => `${k + 1}. ${name(l.speaker)}：${l.text}`).join('\n');
  const total = shots.length;
  return `故事大意：${p.story.replace(/\s+/g, '').slice(0, 260)}

現在是第 ${i + 1}／${total} 個鏡頭。${prev ? `上一個鏡頭：${prev.scene}，${prev.timeOfDay}，${prev.shotType}。` : '這是開場鏡頭，用遠景交代環境。'}
畫面中的人物：${cast || '沒有人物（只有環境）'}
這個鏡頭的台詞與旁白：
${lines}

請填寫：
- scene：場景名稱（例如：漁港碼頭）
- shotType：遠景（交代環境）、中景（對話、動作）、近景（表情）、特寫（情緒高點）
- timeOfDay、light（光源方向與性質）、kelvin（色溫：日光 5600、陰天 6500、夕陽 3000、鎢絲燈 3200、晨光 4800）
- lens（焦段 mm：遠景 24、中景 35、近景 50、特寫 85）
- move：運鏡
- ambience：環境音（例如：海浪、海鷗、風聲）
- visual：中文畫面描述（人物位置、動作、表情、服裝），40 字以內
- prompt：全英文的寫實攝影提示詞，不可出現中文字或人名（人物用外觀描述，例如 an elderly Taiwanese fisherman、a young girl with braids），寫場景、動作、光線、焦段、淺景深，60 個英文字以內，開頭用 photorealistic cinematic still
- emotions：每一句的說話語氣，共 ${s.lines.length} 個（例如：平靜、溫柔、開心、急促、驚訝、慈祥）`;
}

/** 把小模型的回答套到鏡頭上；欄位不合理就保留規則分鏡的值 */
export function applyLocalShot(shot: Shot, raw: unknown): Shot {
  const r = (raw ?? {}) as Record<string, unknown>;
  const str = (v: unknown, max = 400) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
  const out: Shot = { ...shot, lines: shot.lines.map((l) => ({ ...l })) };
  const st = str(r.shotType) as ShotType;
  if (SHOT_TYPES.includes(st)) out.shotType = st;
  if (str(r.scene, 30)) out.scene = str(r.scene, 30);
  const tod = str(r.timeOfDay);
  if (TIMES.includes(tod)) out.timeOfDay = tod;
  if (str(r.light, 60)) out.light = str(r.light, 60);
  const k = Number(r.kelvin);
  if (k >= 1800 && k <= 10000) out.kelvin = Math.round(k / 100) * 100;
  const lens = Number(r.lens);
  out.lens = lens >= 12 && lens <= 200 ? Math.round(lens) : LENS[out.shotType];
  const mv = str(r.move);
  if (MOVES.includes(mv)) out.move = mv;
  if (str(r.ambience, 40)) out.ambience = str(r.ambience, 40);
  if (str(r.visual, 120)) out.visual = str(r.visual, 120);
  // 英文提示詞：去掉小模型混進去的中文字，剩下的英文夠長才採用
  const pr = englishOnly(str(r.prompt, 600));
  if (pr.length >= 30 && !/cartoon|anime|illustration/i.test(pr)) out.prompt = pr;
  // 語氣只給角色台詞；旁白維持平穩
  const emos = Array.isArray(r.emotions) ? r.emotions : [];
  out.lines.forEach((l, k2) => {
    const e = str(emos[k2], 12);
    if (e && !l.emotion && l.speaker !== 'narrator' && !/^(平靜|中性|無|旁白|一般)$/.test(e)) l.emotion = e;
  });
  return out;
}

/** 去掉中文字（小模型的英文提示詞偶爾夾中文），整理多餘的標點與空白 */
export function englishOnly(t: string): string {
  return t
    .replace(/[　-〿㐀-鿿＀-￯]+/g, ' ')
    .replace(/\s*,\s*(,\s*)+/g, ', ')
    .replace(/\s{2,}/g, ' ')
    .replace(/^[\s,]+|[\s,]+$/g, '')
    .trim();
}

/** 讓鏡頭類型有變化：不要連續三個一樣的 */
export function varyShotTypes(shots: Shot[]): Shot[] {
  const order: ShotType[] = ['中景', '近景', '遠景', '特寫'];
  for (let i = 2; i < shots.length; i++) {
    if (shots[i].shotType === shots[i - 1].shotType && shots[i].shotType === shots[i - 2].shotType) {
      const nt = order.find((t) => t !== shots[i].shotType)!;
      shots[i] = { ...shots[i], shotType: nt, lens: LENS[nt] };
    }
  }
  return shots;
}
