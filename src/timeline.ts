// 時間軸：每個鏡頭的長度、每句台詞的開始時間、SRT 逐字稿（純函式）
import type { Character, Project, Shot } from './types';
import { estimateSec } from './storyboard';

/** 鏡頭開頭留白、句與句之間的停頓、鏡頭結尾留白（秒） */
export const LEAD = 0.5;
export const GAP = 0.35;
export const TAIL = 0.7;
export const MIN_SHOT = 3;
export const MAX_AI_VIDEO = 15;

export interface LineCue {
  shot: number;
  line: number;
  start: number;
  end: number;
  speaker: string;
  text: string;
}

export interface ShotTime {
  start: number;
  dur: number;
}

export interface Timeline {
  shots: ShotTime[];
  cues: LineCue[];
  total: number;
}

const lineDur = (l: Shot['lines'][number]) => (l.dur && l.dur > 0 ? l.dur : estimateSec(l.text) + 0.3);

/** 一個鏡頭需要多長（台詞長度＋留白；使用者指定秒數優先，但不能比台詞短） */
export function shotDuration(s: Shot): number {
  const speech = s.lines.reduce((a, l, i) => a + lineDur(l) + (i ? GAP : 0), 0);
  const need = s.lines.length ? LEAD + speech + TAIL : 4;
  const want = s.seconds > 0 ? Math.max(s.seconds, need) : need;
  return Math.max(MIN_SHOT, Math.round(want * 10) / 10);
}

/** AI 影片要求的秒數（3–15 秒，取整數） */
export function aiVideoSeconds(s: Shot) {
  return Math.max(3, Math.min(MAX_AI_VIDEO, Math.ceil(shotDuration(s))));
}

export function buildTimeline(p: Project): Timeline {
  const shots: ShotTime[] = [];
  const cues: LineCue[] = [];
  let t = 0;
  p.shots.forEach((s, si) => {
    const dur = shotDuration(s);
    shots.push({ start: t, dur });
    let lt = t + LEAD;
    s.lines.forEach((l, li) => {
      const d = lineDur(l);
      cues.push({ shot: si, line: li, start: lt, end: lt + d, speaker: l.speaker, text: l.text });
      lt += d + GAP;
    });
    t += dur;
  });
  return { shots, cues, total: t };
}

export function fmtSrtTime(sec: number) {
  const ms = Math.max(0, Math.round(sec * 1000));
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  const r = ms % 1000;
  const p2 = (n: number) => String(n).padStart(2, '0');
  return `${p2(h)}:${p2(m)}:${p2(s)},${String(r).padStart(3, '0')}`;
}

/** 字幕每行最多幾個字：長句依標點切開，時間依字數比例分配 */
export function chunkText(text: string, max = 18): string[] {
  const clean = text.replace(/\s+/g, ' ').trim();
  if ([...clean].length <= max) return [clean];
  const out: string[] = [];
  let cur = '';
  for (const piece of clean.split(/(?<=[，,、。！？!?；;：:])/)) {
    if (cur && [...(cur + piece)].length > max) {
      out.push(cur);
      cur = '';
    }
    if ([...piece].length > max) {
      const chars = [...piece];
      for (let i = 0; i < chars.length; i += max) {
        const part = chars.slice(i, i + max).join('');
        if (i + max >= chars.length) cur = part;
        else out.push(part);
      }
    } else cur += piece;
  }
  if (cur) out.push(cur);
  return out.map((x) => x.trim()).filter(Boolean);
}

export interface SrtOptions {
  /** 在台詞前加說話者名字（旁白不加） */
  names?: boolean;
  max?: number;
}

export function buildSrt(p: Project, tl: Timeline = buildTimeline(p), opt: SrtOptions = {}): string {
  const nameOf = new Map<string, Character>(p.characters.map((c) => [c.id, c]));
  const blocks: string[] = [];
  let n = 1;
  for (const cue of tl.cues) {
    const parts = chunkText(cue.text, opt.max ?? 18);
    const total = parts.reduce((a, x) => a + [...x].length, 0) || 1;
    let t = cue.start;
    parts.forEach((part, i) => {
      const d = ((cue.end - cue.start) * [...part].length) / total;
      const who = opt.names && cue.speaker !== 'narrator' ? nameOf.get(cue.speaker)?.name : '';
      const text = (who && i === 0 ? `${who}：` : '') + part.replace(/[，,、；;]$/, '');
      blocks.push(`${n++}\n${fmtSrtTime(t)} --> ${fmtSrtTime(t + d)}\n${text}\n`);
      t += d;
    });
  }
  return blocks.join('\n');
}

export function fmtDur(sec: number) {
  const s = Math.round(sec);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
