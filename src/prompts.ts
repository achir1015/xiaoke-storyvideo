// 給影像／影片 AI 的提示詞：寫實攝影、正確光源與色溫、鏡頭焦段（純函式）
import { type Character, GRID_VIEWS, type Project, type Shot } from './types';
import { ageBand } from './voices';

const SHOT_EN: Record<Shot['shotType'], string> = {
  遠景: 'extreme wide establishing shot, characters small in the environment, full scenery visible',
  中景: 'medium shot framing characters from the waist up, environment visible behind them',
  近景: 'medium close-up framing head and shoulders, shallow depth of field',
  特寫: 'close-up on the face showing detailed expression and skin texture, very shallow depth of field, creamy bokeh',
};

const MOVE_EN: Record<string, string> = {
  固定: 'static locked-off camera on a tripod',
  緩慢推近: 'slow smooth dolly-in toward the subject',
  輕微推近: 'very subtle slow push-in',
  拉遠: 'slow dolly-out revealing more of the scene',
  緩慢橫搖: 'slow smooth horizontal pan across the scene',
  橫搖: 'slow horizontal pan',
  跟拍: 'handheld tracking shot following the subject, gentle natural camera shake',
};

export function kelvinWords(k: number) {
  if (k <= 2800) return `very warm ${k}K candle/tungsten light`;
  if (k <= 3600) return `warm ${k}K tungsten or golden-hour light`;
  if (k <= 4800) return `neutral-warm ${k}K light`;
  if (k <= 6000) return `neutral daylight ${k}K`;
  return `cool ${k}K overcast or shade light`;
}

export const REALISM =
  'Photorealistic live-action cinematic photograph, shot on a full-frame cinema camera, natural skin texture with pores, realistic proportions, physically accurate lighting and shadows, true-to-life colors, subtle film grain. Not a cartoon, not anime, not an illustration, not 3D render, no text, no watermark, no subtitles.';

function describeChar(c: Character) {
  const band = ageBand(c.age);
  const who = band === 'child' ? (c.gender === 'female' ? 'girl' : 'boy') : c.gender === 'female' ? 'woman' : 'man';
  return `${c.name} (a ${c.age}-year-old Taiwanese ${who}${c.look ? `; ${c.look}` : ''})`;
}

/** 九宮格角色參考圖（AI 幫手） */
export function gridPrompt(c: Character, hasPhoto: boolean): string {
  const cells = GRID_VIEWS.map((v, i) => `${i + 1}. ${v}`).join('；');
  return `${hasPhoto ? 'Using the attached photo(s) as the exact identity reference of this person (same face, hairstyle, body type and clothing), create' : 'Create'} a single photorealistic character reference sheet arranged as a clean 3x3 grid of nine equal square photos with thin white gutters, same person and same outfit in every cell, plain neutral light-grey studio backdrop, soft even studio lighting at 5600K.
Subject: ${describeChar(c)}.
Cells left-to-right, top-to-bottom: 1 front view full body; 2 left side profile full body; 3 right side profile full body; 4 three-quarter view upper body; 5 back view full body; 6 wide shot full body standing small in frame; 7 medium shot waist up; 8 close shot chest up; 9 extreme close-up of the face.
（中文格位：${cells}）
${REALISM} No labels or numbers inside the image.`;
}

/** 單一鏡頭的關鍵畫面（之後交給影片 AI 當第一格） */
export function stillPrompt(p: Project, shot: Shot, chars: Character[]): string {
  const cast = chars.length ? `Characters (match the attached reference sheets exactly — same faces, hair, clothes): ${chars.map(describeChar).join('; ')}.` : 'No people in frame unless described.';
  return `${REALISM}
Aspect ratio ${p.aspect}. ${SHOT_EN[shot.shotType]}, ${shot.lens}mm lens.
Scene: ${shot.scene ? `${shot.scene}. ` : ''}${shot.visual}
${shot.prompt ? `Details: ${shot.prompt}` : ''}
Time of day: ${shot.timeOfDay}. Lighting: ${shot.light}, ${kelvinWords(shot.kelvin)}; light direction and shadows must be consistent and physically plausible; correct white balance for the light source.
${cast}
${p.style ? `Overall setting/style: ${p.style}.` : 'Setting: contemporary Taiwan unless the story says otherwise.'}`;
}

/** 影片 AI：以關鍵畫面為第一格，演出這個鏡頭（對白由本工具另外配音，所以影片不要說話） */
export function videoPrompt(p: Project, shot: Shot, chars: Character[], seconds: number): string {
  const acting = shot.lines
    .filter((l) => l.speaker !== 'narrator')
    .map((l) => {
      const c = chars.find((x) => x.id === l.speaker);
      return c ? `${c.name} speaks${l.emotion ? ` (${l.emotion})` : ''}, natural lip and facial movement` : '';
    })
    .filter(Boolean)
    .join('; ');
  return `Turn this frame into realistic live-action film footage, ${seconds} seconds, continuous single shot. ${SHOT_EN[shot.shotType]}. Camera: ${MOVE_EN[shot.move] ?? shot.move}.
Action: ${shot.visual}${acting ? `. ${acting}` : ''}.
Keep the exact same people, faces, clothing, lighting (${shot.timeOfDay}, ${shot.light}, ${kelvinWords(shot.kelvin)}) and location as the first frame. Natural human motion, realistic physics, no morphing.
Audio: only natural ambient sound of the location${shot.ambience ? ` (${shot.ambience})` : ''}; no music, no narration, no speech, no singing.
${REALISM}`;
}

/** 測試用：提示詞不可提到卡通 */
export function looksRealistic(prompt: string) {
  return /Photorealistic/i.test(prompt) && /Not a cartoon/i.test(prompt);
}

// --- 免費雲端畫面（AI Horde）--------------------------------------------------------------
// 開源繪圖模型的提示詞要短、用逗號分隔的英文關鍵字；Z-Image 看得懂中文，另外附上中文畫面描述。

const SHOT_SHORT: Record<Shot['shotType'], string> = {
  遠景: 'extreme wide establishing shot, people small in the frame',
  中景: 'medium shot, waist up',
  近景: 'medium close-up, head and shoulders',
  特寫: 'close-up portrait of the face, detailed skin texture',
};

const TIME_EN: Record<string, string> = {
  清晨: 'early morning, soft dawn light, light mist',
  白天: 'daytime, natural daylight',
  黃昏: 'golden hour sunset, low warm backlight',
  夜晚: 'night, practical lights, moonlight',
  室內: 'indoors, window light',
};

export function personEn(c: Character) {
  const band = ageBand(c.age);
  const f = c.gender === 'female';
  const who =
    band === 'child' ? (f ? 'little girl' : 'little boy') : band === 'teen' ? (f ? 'teenage girl' : 'teenage boy') : band === 'senior' ? (f ? 'elderly woman' : 'elderly man') : f ? 'woman' : 'man';
  // 兒童、青少年加權（開源模型常把小孩畫成大人）
  return band === 'child' || band === 'teen' ? `(a ${c.age}-year-old Taiwanese ${who}, child:1.3)` : `a ${c.age}-year-old Taiwanese ${who}`;
}

/** AI Horde 的提示詞；chinese＝模型看得懂中文（Z-Image） */
export function hordePrompt(p: Project, shot: Shot, chars: Character[], chinese: boolean): string {
  const en = [
    'photorealistic cinematic film still',
    SHOT_SHORT[shot.shotType],
    `${shot.lens}mm lens`,
    TIME_EN[shot.timeOfDay] ?? 'natural light',
    kelvinWords(shot.kelvin),
    ...chars.map((c) => {
      const look = lookToEn(c.look, shot.shotType === '特寫' ? 'face' : shot.shotType === '近景' ? 'chest' : shot.shotType === '中景' ? 'waist' : 'full');
      return look ? `${personEn(c)} (${look})` : personEn(c);
    }),
    /[a-z]{4,}/i.test(shot.prompt ?? '') ? '' : zhToEnKeywords(`${shot.scene}${shot.visual}${shot.ambience}`),
    (shot.prompt ?? '').replace(/^photorealistic cinematic still,?\s*/i, ''),
    'shallow depth of field, natural skin texture, true-to-life colors, subtle film grain, shot on a cinema camera',
  ]
    .map((x) => x.trim())
    .filter(Boolean)
    .join(', ');
  if (!chinese) return en;
  const look = chars.filter((c) => c.look).map((c) => `${c.name}：${c.gender === 'female' ? '女' : '男'}，${c.age} 歲，${c.look}`);
  return `${en}. 真實電影劇照，不是卡通或插畫。畫面：${shot.scene ? `${shot.scene}，` : ''}${shot.visual}${look.length ? `。人物：${look.join('；')}` : ''}${p.style ? `。風格：${p.style}` : ''}`;
}

/** 沒有英文畫面描述時：把常見的中文場景、天氣、物品換成英文關鍵字（開源繪圖模型看不懂中文） */
const ZH_EN: [RegExp, string][] = [
  [/漁港|港口|港邊/, 'fishing harbor with moored fishing boats'],
  [/碼頭|堤防|棧橋/, 'wooden pier and sea wall'],
  [/海邊|海灘|沙灘/, 'beach by the sea'],
  [/海|浪/, 'ocean waves'],
  [/漁網|網子/, 'fishing nets'],
  [/漁船|船/, 'fishing boat'],
  [/魚/, 'fresh fish'],
  [/夜市/, 'busy Taiwanese night market with food stalls and lanterns'],
  [/廟|宮|寺/, 'traditional Taiwanese temple with red lanterns'],
  [/老街/, 'old street with red brick shophouses'],
  [/街|巷|路/, 'narrow street in a Taiwanese town'],
  [/市場|菜市/, 'traditional wet market'],
  [/教室|學校|操場/, 'school classroom'],
  [/醫院|病房/, 'hospital ward'],
  [/客廳/, 'cozy living room'],
  [/廚房/, 'home kitchen'],
  [/房間|臥室/, 'bedroom'],
  [/餐廳|飯桌|吃飯/, 'family dinner table'],
  [/辦公室|公司/, 'office interior'],
  [/車站|火車|月台/, 'train station platform'],
  [/公車|巴士/, 'city bus'],
  [/機車|摩托車/, 'scooter'],
  [/公園/, 'city park'],
  [/山/, 'green mountains'],
  [/森林|樹林/, 'forest'],
  [/田|稻/, 'rice paddy fields'],
  [/河|溪/, 'river'],
  [/湖/, 'lake'],
  [/雨/, 'rain, wet ground, reflections'],
  [/霧/, 'morning mist'],
  [/雪/, 'snow'],
  [/夕陽|黃昏/, 'golden sunset'],
  [/日出|清晨/, 'sunrise'],
  [/月|夜/, 'night'],
  [/燈籠/, 'red lanterns'],
  [/茶|杯子/, 'cup of hot tea with steam'],
  [/保溫壺/, 'thermos flask'],
  [/笑/, 'smiling'],
  [/哭|淚/, 'tears, emotional'],
  [/跑/, 'running'],
  [/走/, 'walking'],
  [/蹲/, 'crouching'],
  [/牽/, 'holding hands'],
  [/抱/, 'hugging'],
];

export function zhToEnKeywords(t: string): string {
  const out: string[] = [];
  for (const [re, en] of ZH_EN) if (re.test(t) && !out.includes(en)) out.push(en);
  return out.slice(0, 8).join(', ');
}

/** 九宮格九個角度（順序同 GRID_VIEWS） */
export const SHEET_VIEWS_EN = [
  'full body front view, standing straight, facing the camera',
  'full body left side profile view, facing left',
  'full body right side profile view, facing right',
  'three-quarter view, upper body portrait cropped at the waist',
  'full body back view, seen from behind',
  'wide shot, full body standing small in the frame',
  'medium shot, waist-up portrait cropped at the waist, facing the camera',
  'close shot, chest-up portrait, facing the camera',
  'close-up portrait of the face, head and shoulders, detailed skin texture',
];

/** 免費雲端（AI Horde）產生九宮格的一格；lookEn＝外觀的英文描述 */
export function hordeSheetPrompt(c: Character, view: number, lookEn: string): string {
  // 鏡頭距離放最前面並加權（SDXL 容易忽略「特寫」而畫成全身）
  const part: LookPart = view === 8 ? 'face' : view === 7 ? 'chest' : view === 6 || view === 3 ? 'waist' : 'full';
  return [
    `(${SHEET_VIEWS_EN[view]}:1.4)`,
    'photorealistic character reference photo',
    personEn(c),
    lookEn ? (part === 'face' ? '' : lookEn) : lookToEn(c.look, part),
    part === 'face' ? lookToEn(c.look, 'face') : '',
    part === 'full' ? '' : '(no shoes visible:1.2)',
    'same person, same outfit',
    'plain light grey studio backdrop, soft even studio lighting 5600K, natural skin texture, true-to-life colors, shot on a full-frame camera, 85mm lens',
  ]
    .filter(Boolean)
    .join(', ');
}

// --- 外觀文字 → 英文（顏色＋衣物、臉部特徵），依鏡頭距離只放看得到的部分 ---

export type LookPart = 'full' | 'waist' | 'chest' | 'face';

const COLORS: [RegExp, string][] = [
  [/深藍|海軍藍|藏青/, 'navy blue'],
  [/淺藍|天藍/, 'light blue'],
  [/藍/, 'blue'],
  [/米白|米色|奶油/, 'cream'],
  [/白/, 'white'],
  [/深灰/, 'dark grey'],
  [/灰/, 'grey'],
  [/黑|深色/, 'black'],
  [/紅/, 'red'],
  [/粉/, 'pink'],
  [/黃/, 'yellow'],
  [/橘|橙/, 'orange'],
  [/綠/, 'green'],
  [/紫/, 'purple'],
  [/棕|咖啡|褐/, 'brown'],
  [/卡其/, 'khaki'],
  [/牛仔/, 'denim'],
];

/** 衣物：[比對, 英文, 在哪個部位（upper 上半身、lower 下半身、feet 腳、neck 脖子）] */
const ITEMS: [RegExp, string, 'upper' | 'lower' | 'feet' | 'neck'][] = [
  [/連身漁夫褲|連身漁褲|吊帶褲/, 'waterproof fishing bib overalls', 'lower'],
  [/防風外套|風衣/, 'windbreaker jacket', 'upper'],
  [/西裝外套|西裝/, 'suit jacket', 'upper'],
  [/外套|夾克/, 'jacket', 'upper'],
  [/針織毛衣|毛衣/, 'knit sweater', 'upper'],
  [/長袖棉衫|長袖|棉衫/, 'long-sleeve cotton shirt', 'upper'],
  [/襯衫/, 'button-up shirt', 'upper'],
  [/T恤|T 恤|短袖/, 't-shirt', 'upper'],
  [/洋裝|連身裙/, 'dress', 'upper'],
  [/制服/, 'school uniform', 'upper'],
  [/背心/, 'vest', 'upper'],
  [/圍巾/, 'long scarf', 'neck'],
  [/牛仔褲/, 'jeans', 'lower'],
  [/長褲|褲/, 'trousers', 'lower'],
  [/短裙|長裙|裙/, 'skirt', 'lower'],
  [/雨鞋/, 'rain boots', 'feet'],
  [/拖鞋/, 'slippers', 'feet'],
  [/布鞋|球鞋|運動鞋/, 'sneakers', 'feet'],
  [/皮鞋/, 'leather shoes', 'feet'],
];

const FACE: [RegExp, string][] = [
  [/黝黑|曬黑|古銅/, 'tanned skin'],
  [/白皙/, 'fair skin'],
  [/皺紋/, 'deep wrinkles'],
  [/花白|灰白|白髮/, 'grey hair'],
  [/黑髮/, 'black hair'],
  [/麻花辮/, 'two braided pigtails'],
  [/馬尾/, 'ponytail'],
  [/及肩/, 'shoulder-length hair'],
  [/短髮/, 'short hair'],
  [/長髮/, 'long hair'],
  [/捲髮/, 'curly hair'],
  [/光頭/, 'bald head'],
  [/眼鏡/, 'glasses'],
  [/鬍/, 'beard'],
  [/雀斑/, 'freckles'],
  [/酒窩/, 'dimples'],
];

export function lookToEn(look: string, part: LookPart = 'full'): string {
  const out: string[] = [];
  for (const [re, en] of FACE) if (re.test(look) && !out.includes(en)) out.push(en);
  if (part !== 'face') {
    const show = { full: ['upper', 'lower', 'feet', 'neck'], waist: ['upper', 'neck'], chest: ['upper', 'neck'], face: [] }[part];
    for (const seg of look.split(/[，,、；;。]/)) {
      const it = ITEMS.find(([re]) => re.test(seg));
      if (!it || !show.includes(it[2])) continue;
      const color = COLORS.find(([re]) => re.test(seg))?.[1];
      const en = `${color && !it[1].startsWith(color) ? `${color} ` : ''}${it[1]}`;
      if (!out.includes(en)) out.push(en);
    }
  }
  return out.join(', ');
}
