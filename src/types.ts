// 專案資料結構（存成 project.json；桌面版、線上版、手機版共用）

export type Gender = 'male' | 'female';
export type Role = '主角' | '配角' | '童星' | '其他';
export type ShotType = '遠景' | '中景' | '近景' | '特寫';
export type Distance = 'near' | 'mid' | 'far';

export const SHOT_TYPES: ShotType[] = ['遠景', '中景', '近景', '特寫'];
export const ROLES: Role[] = ['主角', '配角', '童星', '其他'];
/** 九宮格各格的視角（由左而右、由上而下） */
export const GRID_VIEWS = ['正面', '左側面', '右側面', '四分之三側面', '背面（後方身景）', '遠景全身', '中景半身', '近景胸像', '面部特寫'] as const;
export const MAX_CHARACTERS = 10;

export interface VoiceSetting {
  /** gemini-design：依性別年齡設計專屬聲音；gemini：Gemini 內建聲音；edge：微軟免費神經語音 */
  engine: 'auto' | 'gemini-design' | 'gemini' | 'edge';
  /** Gemini 內建聲音名稱或 Edge 聲音名稱（空白＝依性別年齡自動挑） */
  voice?: string;
  /** Gemini 聲音設計建立的 voice_… 代號 */
  designedId?: string;
  designedFor?: string;
}

export interface Character {
  id: string;
  name: string;
  role: Role;
  gender: Gender;
  age: number;
  /** 外觀描述（髮型、服裝、體型…），AI 產生畫面時使用 */
  look: string;
  /** 聲音特色（溫柔、沙啞…） */
  voiceNote: string;
  /** 九宮格圖（專案資料夾內的相對路徑） */
  sheet?: string;
  /** 使用者提供的原始照片（給 AI 幫手產生九宮格用） */
  photos: string[];
  voice: VoiceSetting;
}

export interface Line {
  /** 角色 id，或 'narrator'（旁白） */
  speaker: string;
  text: string;
  /** 語氣：開心、難過、生氣、驚訝、輕聲… */
  emotion: string;
  /** 產生好的語音檔（相對路徑）與長度（秒） */
  audio?: string;
  dur?: number;
  audioKey?: string;
}

export interface Shot {
  id: string;
  scene: string;
  shotType: ShotType;
  characters: string[];
  /** 中文畫面描述 */
  visual: string;
  /** AI 分鏡產生的英文影像提示詞 */
  prompt?: string;
  /** 光線：時段、光源、色溫 */
  timeOfDay: string;
  light: string;
  kelvin: number;
  /** 鏡頭焦段（mm），遠景廣角、特寫望遠 */
  lens: number;
  /** 運鏡：固定、推近、拉遠、橫搖、跟拍 */
  move: string;
  /** 環境音描述 */
  ambience: string;
  lines: Line[];
  /** 產生結果（相對路徑） */
  still?: string;
  stillKey?: string;
  video?: string;
  videoKey?: string;
  /** 深度圖（2.5D 立體動態照片用；depthKey＝算深度時的畫面） */
  depth?: string;
  depthKey?: string;
  /** 使用者指定秒數（0＝依台詞長度自動） */
  seconds: number;
  error?: string;
}

export interface Narrator {
  gender: Gender;
  age: number;
  voice: VoiceSetting;
  voiceNote: string;
}

export interface Project {
  format: 'xiaoke-storyvideo';
  version: number;
  title: string;
  story: string;
  aspect: '16:9' | '9:16';
  resolution: '720p' | '1080p';
  /** 整體風格補充（例如：台灣鄉村、1980 年代） */
  style: string;
  narrator: Narrator;
  characters: Character[];
  shots: Shot[];
  output: { burnSubs: boolean; ambience: number; music: boolean; lastVideo?: string; lastSrt?: string };
  created: string;
  updated: string;
}

export const uid = (p = '') => p + Math.random().toString(36).slice(2, 8) + Date.now().toString(36).slice(-4);

export function newCharacter(n = 1): Character {
  return { id: uid('c'), name: `角色${n}`, role: n === 1 ? '主角' : '配角', gender: 'female', age: 30, look: '', voiceNote: '', photos: [], voice: { engine: 'auto' } };
}

export function newShot(): Shot {
  return { id: uid('s'), scene: '', shotType: '中景', characters: [], visual: '', timeOfDay: '白天', light: '自然光', kelvin: 5600, lens: 35, move: '固定', ambience: '', lines: [], seconds: 0 };
}

export function newProject(title = '我的故事'): Project {
  const now = new Date().toISOString();
  return {
    format: 'xiaoke-storyvideo',
    version: 1,
    title,
    story: '',
    aspect: '16:9',
    resolution: '720p',
    style: '',
    narrator: { gender: 'female', age: 35, voice: { engine: 'auto' }, voiceNote: '溫暖、沉穩的說故事口吻' },
    characters: [],
    shots: [],
    output: { burnSubs: true, ambience: 35, music: false },
    created: now,
    updated: now,
  };
}

/** 讀進來的舊專案／不完整資料補上預設值 */
export function normalizeProject(raw: unknown): Project {
  const p = { ...newProject(), ...(raw as Partial<Project>) } as Project;
  p.narrator = { ...newProject().narrator, ...(p.narrator ?? {}) };
  p.output = { ...newProject().output, ...(p.output ?? {}) };
  p.characters = (p.characters ?? []).map((c) => ({ ...newCharacter(), ...c, photos: c.photos ?? [], voice: c.voice ? { ...c.voice } : { engine: 'auto' } }));
  p.shots = (p.shots ?? []).map((s) => ({ ...newShot(), ...s, lines: (s.lines ?? []).map((l) => ({ ...l, emotion: l.emotion ?? '' })) }));
  return p;
}

export interface Settings {
  geminiKey: string;
  textModel: string;
  imageModel: string;
  videoModel: string;
  ttsModel: string;
  /** 影片引擎：AI 影片或動態照片（免費，運鏡效果） */
  videoEngine: 'ai' | 'photo';
  /** 語音引擎預設 */
  voiceEngine: 'gemini-design' | 'gemini' | 'edge';
  /** 同時進行的 AI 工作數 */
  parallel: number;
  /** 分鏡方式：雲端 Gemini、本機小模型（免費）、快速切段 */
  boardEngine: 'gemini' | 'local' | 'rule';
  /** 本機小模型（見 local-llm.ts） */
  localModel: string;
  /** 畫面來源：免費雲端（AI Horde）、九宮格照片、Gemini（付費） */
  stillEngine: 'horde' | 'sheet' | 'gemini';
  /** AI Horde 模型與金鑰（空白＝匿名，免費） */
  hordeModel: string;
  hordeKey: string;
  /** 啟用本機小模型分鏡（實驗功能：長時間讓顯示晶片滿載，部分筆電會不穩） */
  localExperimental: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  geminiKey: '',
  textModel: 'gemini-3.8-flash',
  imageModel: 'gemini-nano-banana-2.1',
  videoModel: 'gemini-omni-1.2-flash',
  ttsModel: 'gemini-3.8-flash-tts',
  videoEngine: 'photo',
  voiceEngine: 'edge',
  parallel: 2,
  boardEngine: 'gemini',
  localModel: 'Qwen3.5-2B',
  localExperimental: false,
  stillEngine: 'horde',
  hordeModel: 'Juggernaut XL',
  hordeKey: '',
};
