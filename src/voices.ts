// 聲音：依性別與年齡挑選聲音、聲音設計描述、場景遠近的音量與殘響（純函式）
import type { Character, Gender, Narrator, ShotType } from './types';

export type AgeBand = 'child' | 'teen' | 'young' | 'adult' | 'senior';

export function ageBand(age: number): AgeBand {
  if (age <= 11) return 'child';
  if (age <= 17) return 'teen';
  if (age <= 30) return 'young';
  if (age <= 59) return 'adult';
  return 'senior';
}

export const AGE_LABEL: Record<AgeBand, string> = { child: '兒童', teen: '青少年', young: '青年', adult: '中年', senior: '長者' };

/** Gemini 內建聲音（依性別與年齡層） */
const GEMINI: Record<Gender, Record<AgeBand, string[]>> = {
  female: { child: ['Leda', 'Laomedeia'], teen: ['Leda', 'Autonoe'], young: ['Aoede', 'Zephyr', 'Despina'], adult: ['Kore', 'Erinome', 'Achernar'], senior: ['Sulafat', 'Vindemiatrix'] },
  male: { child: ['Puck', 'Fenrir'], teen: ['Puck', 'Zubenelgenubi'], young: ['Achird', 'Umbriel', 'Iapetus'], adult: ['Orus', 'Charon', 'Alnilam'], senior: ['Gacrux', 'Algenib'] },
};

export const GEMINI_VOICES = [...new Set(Object.values(GEMINI).flatMap((g) => Object.values(g).flat()))].sort();

/** 微軟免費神經語音（Edge）：台灣腔為主，兒童與長者用音高、語速調整 */
interface EdgePick {
  voice: string;
  pitch: string;
  rate: string;
}
const EDGE: Record<Gender, Record<AgeBand, EdgePick>> = {
  female: {
    child: { voice: 'zh-CN-XiaoyiNeural', pitch: '+12%', rate: '+0%' },
    teen: { voice: 'zh-TW-HsiaoYuNeural', pitch: '+6%', rate: '+0%' },
    young: { voice: 'zh-TW-HsiaoYuNeural', pitch: '+0%', rate: '+0%' },
    adult: { voice: 'zh-TW-HsiaoChenNeural', pitch: '-2%', rate: '-3%' },
    senior: { voice: 'zh-TW-HsiaoChenNeural', pitch: '-9%', rate: '-12%' },
  },
  male: {
    child: { voice: 'zh-CN-YunxiaNeural', pitch: '+6%', rate: '+0%' },
    teen: { voice: 'zh-CN-YunxiNeural', pitch: '+4%', rate: '+0%' },
    young: { voice: 'zh-TW-YunJheNeural', pitch: '+0%', rate: '+0%' },
    adult: { voice: 'zh-TW-YunJheNeural', pitch: '-5%', rate: '-4%' },
    senior: { voice: 'zh-CN-YunjianNeural', pitch: '-10%', rate: '-12%' },
  },
};

export const EDGE_VOICES = ['zh-TW-HsiaoChenNeural', 'zh-TW-HsiaoYuNeural', 'zh-TW-YunJheNeural', 'zh-CN-XiaoxiaoNeural', 'zh-CN-XiaoyiNeural', 'zh-CN-YunxiNeural', 'zh-CN-YunxiaNeural', 'zh-CN-YunjianNeural', 'zh-CN-YunyangNeural', 'zh-HK-HiuMaanNeural', 'zh-HK-WanLungNeural'];

type Speaker = Pick<Character, 'gender' | 'age' | 'voiceNote' | 'voice'> & { id?: string; name?: string };

/** 同一性別年齡層有多位角色時，輪流用不同聲音，避免兩人聲音一樣 */
export function geminiVoiceFor(sp: Speaker, index = 0) {
  if (sp.voice.voice && GEMINI_VOICES.includes(sp.voice.voice)) return sp.voice.voice;
  const list = GEMINI[sp.gender][ageBand(sp.age)];
  return list[index % list.length];
}

export function edgeVoiceFor(sp: Speaker, index = 0): EdgePick {
  const base = EDGE[sp.gender][ageBand(sp.age)];
  if (sp.voice.voice && EDGE_VOICES.includes(sp.voice.voice)) return { ...base, voice: sp.voice.voice };
  // 同層第二位以後：稍微改變音高區分
  const shift = [0, -4, 4, -7, 7][index % 5];
  const pitch = parseInt(base.pitch, 10) + shift;
  return { ...base, pitch: `${pitch >= 0 ? '+' : ''}${pitch}%` };
}

/** 聲音設計的描述（給 Gemini 建立專屬聲音） */
export function voiceDesignPrompt(sp: Speaker): string {
  const band = ageBand(sp.age);
  const who =
    band === 'child'
      ? sp.gender === 'female' ? `a ${sp.age}-year-old little girl` : `a ${sp.age}-year-old little boy`
      : band === 'teen'
        ? sp.gender === 'female' ? `a ${sp.age}-year-old teenage girl` : `a ${sp.age}-year-old teenage boy`
        : sp.gender === 'female' ? `a woman in her ${Math.floor(sp.age / 10) * 10}s` : `a man in his ${Math.floor(sp.age / 10) * 10}s`;
  const timbre =
    band === 'child' ? 'with a natural, high-pitched, innocent child voice' : band === 'senior' ? 'with a natural aged voice, slightly slower and softer' : 'with a natural, warm, realistic voice';
  const note = sp.voiceNote ? ` Voice character: ${sp.voiceNote}.` : '';
  return `${who} from Taiwan speaking Taiwanese Mandarin (台灣國語) with a natural Taiwan accent, ${timbre}, sounding like a real person recorded with a good microphone, never robotic.${note}`;
}

/** 這個角色的聲音設計是否需要重做（性別年齡或描述改了） */
export function designKey(sp: Speaker) {
  return `${sp.gender}|${sp.age}|${sp.voiceNote}`;
}

export function speakerLabel(sp: Speaker) {
  return `${sp.gender === 'male' ? '男' : '女'}・${sp.age} 歲（${AGE_LABEL[ageBand(sp.age)]}）`;
}

export function narratorAsSpeaker(n: Narrator): Speaker {
  return { id: 'narrator', name: '旁白', gender: n.gender, age: n.age, voiceNote: n.voiceNote, voice: n.voice };
}

// --- 聲音遠近 --------------------------------------------------------------------------

export interface SpaceProfile {
  /** 音量（線性） */
  gain: number;
  /** 低通（Hz，0＝不處理）：遠處高頻衰減 */
  lowpass: number;
  /** 高通（Hz）：近距離收音的近接效應較強，遠處低頻較少 */
  highpass: number;
  /** FFmpeg aecho 參數（空白＝不加殘響） */
  echo: string;
}

/** 依鏡頭遠近決定角色聲音：特寫貼近、遠景較小聲且帶空間殘響 */
export function spaceFor(shotType: ShotType, indoor: boolean): SpaceProfile {
  switch (shotType) {
    case '特寫':
      return { gain: 1.0, lowpass: 0, highpass: 60, echo: '' };
    case '近景':
      return { gain: 0.92, lowpass: 0, highpass: 80, echo: indoor ? '0.8:0.5:18:0.12' : '' };
    case '中景':
      return { gain: 0.8, lowpass: 11000, highpass: 100, echo: indoor ? '0.8:0.6:28|47:0.18|0.1' : '0.8:0.4:35:0.08' };
    case '遠景':
    default:
      return { gain: 0.6, lowpass: 7000, highpass: 140, echo: indoor ? '0.8:0.7:45|80:0.28|0.18' : '0.8:0.5:60|110:0.16|0.1' };
  }
}

export function isIndoor(text: string) {
  return /室內|屋|房間|教室|客廳|廚房|走廊|大廳|店裡|車內|宮殿|洞穴|浴室|辦公室|醫院|教堂/.test(text);
}

/** 組成 FFmpeg 音訊濾鏡 */
export function spaceFilter(p: SpaceProfile): string {
  const f: string[] = [];
  if (p.highpass) f.push(`highpass=f=${p.highpass}`);
  if (p.lowpass) f.push(`lowpass=f=${p.lowpass}`);
  if (p.echo) f.push(`aecho=${p.echo}`);
  f.push(`volume=${p.gain.toFixed(2)}`);
  return f.join(',');
}
