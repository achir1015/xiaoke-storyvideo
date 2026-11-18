// 製作流程：九宮格、分鏡、關鍵畫面、AI 影片、配音、合成（桌面版）
import { AiError, Gemini, type Media } from './ai';
import { type DesktopBridge, mediaUrl } from './bridge';
import { gridPrompt, stillPrompt, videoPrompt } from './prompts';
import { buildPlan, type RenderInputs } from './render-plan';
import { extractJson, parseStoryboard, ruleStoryboard, storyboardPrompt } from './storyboard';
import { aiVideoSeconds, buildSrt, buildTimeline } from './timeline';
import { type Character, type Line, type Project, type Settings, type Shot, normalizeProject } from './types';
import { ageBand, designKey, edgeVoiceFor, geminiVoiceFor, narratorAsSpeaker, voiceDesignPrompt } from './voices';

export function hash(s: string) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

const MIME_BY_EXT: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', bmp: 'image/bmp', mp4: 'video/mp4', wav: 'audio/wav', mp3: 'audio/mpeg' };
const extOf = (p: string) => (/\.([a-z0-9]+)$/i.exec(p)?.[1] ?? '').toLowerCase();

type Speaker = ReturnType<typeof narratorAsSpeaker>;

export class Studio {
  p: Project;
  dir = '';
  gemini: Gemini;
  private saveTimer = 0;
  onChange: () => void = () => {};
  onSaved: () => void = () => {};
  private absCache = new Map<string, string>();

  constructor(
    public xk: DesktopBridge,
    public settings: Settings,
    p: Project,
  ) {
    this.p = normalizeProject(p);
    this.gemini = new Gemini(settings, xk.net);
  }

  setSettings(s: Settings) {
    this.settings = s;
    this.gemini = new Gemini(s, this.xk.net);
  }

  // --- 檔案 --------------------------------------------------------------------------

  async open(dir: string) {
    this.dir = dir;
    this.p = normalizeProject(await this.xk.proj.load(dir));
    this.absCache.clear();
  }

  async create(title: string, p: Project) {
    this.dir = await this.xk.proj.create(title);
    this.p = normalizeProject(p);
    this.p.title = title;
    this.absCache.clear();
    await this.saveNow();
  }

  touch() {
    this.p.updated = new Date().toISOString();
    clearTimeout(this.saveTimer);
    this.saveTimer = window.setTimeout(() => void this.saveNow(), 600);
    this.onChange();
  }

  async saveNow() {
    clearTimeout(this.saveTimer);
    if (!this.dir) return;
    await this.xk.proj.save(this.dir, this.p);
    this.onSaved();
  }

  async abs(rel: string) {
    let a = this.absCache.get(rel);
    if (!a) {
      a = await this.xk.proj.abs(this.dir, rel);
      this.absCache.set(rel, a);
    }
    return a;
  }

  async url(rel: string | undefined) {
    if (!rel) return '';
    return mediaUrl(await this.abs(rel), this.p.updated);
  }

  async readMedia(rel: string): Promise<Media> {
    return { mime: MIME_BY_EXT[extOf(rel)] ?? 'image/png', data: await this.xk.proj.read(this.dir, rel) };
  }

  async writeMedia(rel: string, m: Media) {
    await this.xk.proj.write(this.dir, rel, m.data);
    this.absCache.delete(rel);
    return rel;
  }

  /** 把大圖縮小（送給 AI 的參考圖不必太大，省流量也較快） */
  async shrink(rel: string, max = 1536): Promise<Media> {
    const src = await this.url(rel);
    const img = new Image();
    img.src = src;
    await img.decode();
    const k = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
    const c = document.createElement('canvas');
    c.width = Math.round(img.naturalWidth * k);
    c.height = Math.round(img.naturalHeight * k);
    c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height);
    const data = c.toDataURL('image/jpeg', 0.9).split(',')[1];
    return { mime: 'image/jpeg', data };
  }

  /** 九宮格切成九張（1 正面 … 9 面部特寫） */
  async gridCells(rel: string): Promise<Media[]> {
    const img = new Image();
    img.src = await this.url(rel);
    await img.decode();
    const out: Media[] = [];
    const cw = img.naturalWidth / 3;
    const ch = img.naturalHeight / 3;
    for (let r = 0; r < 3; r++)
      for (let c = 0; c < 3; c++) {
        const cv = document.createElement('canvas');
        const s = Math.min(768, Math.round(cw));
        cv.width = s;
        cv.height = Math.round((s * ch) / cw);
        cv.getContext('2d')!.drawImage(img, c * cw, r * ch, cw, ch, 0, 0, cv.width, cv.height);
        out.push({ mime: 'image/jpeg', data: cv.toDataURL('image/jpeg', 0.9).split(',')[1] });
      }
    return out;
  }

  charOf(id: string) {
    return this.p.characters.find((c) => c.id === id);
  }

  castOf(shot: Shot) {
    return shot.characters.map((id) => this.charOf(id)).filter((c): c is Character => !!c);
  }

  // --- 角色九宮格 ---------------------------------------------------------------------

  async genSheet(c: Character) {
    const refs: Media[] = [];
    for (const ph of c.photos.slice(0, 3)) refs.push(await this.shrink(ph));
    if (!refs.length && c.sheet) refs.push(await this.shrink(c.sheet));
    const img = await this.gemini.image(gridPrompt(c, refs.length > 0), refs, '1:1', '2K');
    const rel = `角色/${c.id}-九宮格-${Date.now().toString(36)}.${img.mime.includes('jpeg') ? 'jpg' : 'png'}`;
    await this.writeMedia(rel, img);
    c.sheet = rel;
    this.touch();
    return rel;
  }

  // --- 分鏡 ----------------------------------------------------------------------------

  async storyboard(useAi: boolean): Promise<{ shots: Shot[]; ai: boolean; note?: string }> {
    if (useAi && this.gemini.ready) {
      try {
        const text = await this.gemini.text(storyboardPrompt(this.p));
        return { shots: parseStoryboard(extractJson(text), this.p.characters), ai: true };
      } catch (e) {
        if ((e as AiError).kind === 'key') throw e;
        return { shots: ruleStoryboard(this.p.story, this.p.characters), ai: false, note: `AI 分鏡失敗，改用自動切段：${(e as Error).message}` };
      }
    }
    return { shots: ruleStoryboard(this.p.story, this.p.characters), ai: false };
  }

  // --- 關鍵畫面 -----------------------------------------------------------------------

  stillKey(shot: Shot) {
    const cast = this.castOf(shot);
    return hash(stillPrompt(this.p, shot, cast) + cast.map((c) => c.sheet).join('|'));
  }

  async genStill(shot: Shot) {
    const cast = this.castOf(shot).slice(0, 4);
    const refs: Media[] = [];
    for (const c of cast) if (c.sheet) refs.push(await this.shrink(c.sheet, 1536));
    const img = await this.gemini.image(stillPrompt(this.p, shot, cast), refs, this.p.aspect, '2K');
    const rel = `鏡頭/${shot.id}-畫面.${img.mime.includes('jpeg') ? 'jpg' : 'png'}`;
    await this.writeMedia(rel, img);
    shot.still = rel;
    shot.stillKey = this.stillKey(shot);
    shot.error = undefined;
    this.touch();
  }

  /** 沒有 AI 時的畫面：用角色九宮格裡最符合鏡頭的那一格 */
  async stillFromSheet(shot: Shot) {
    const c = this.castOf(shot).find((x) => x.sheet) ?? this.p.characters.find((x) => x.sheet);
    if (!c?.sheet) return false;
    const cells = await this.gridCells(c.sheet);
    const pick = { 遠景: 5, 中景: 6, 近景: 7, 特寫: 8 }[shot.shotType];
    const rel = `鏡頭/${shot.id}-畫面.jpg`;
    await this.writeMedia(rel, cells[pick]);
    shot.still = rel;
    shot.stillKey = 'sheet';
    this.touch();
    return true;
  }

  // --- 影片 ----------------------------------------------------------------------------

  videoKey(shot: Shot) {
    return hash(videoPrompt(this.p, shot, this.castOf(shot), aiVideoSeconds(shot)) + (shot.still ?? '') + (shot.stillKey ?? '') + this.p.aspect + this.p.resolution);
  }

  async genVideo(shot: Shot) {
    if (!shot.still) await this.genStill(shot);
    const cast = this.castOf(shot);
    const secs = aiVideoSeconds(shot);
    const first = await this.shrink(shot.still!, 1920);
    // 角色參考：每人正面與臉部特寫（最多兩位角色）
    const refs: Media[] = [];
    for (const c of cast.slice(0, 2)) {
      if (!c.sheet) continue;
      const cells = await this.gridCells(c.sheet);
      refs.push(cells[0], cells[8]);
    }
    const v = await this.gemini.video(videoPrompt(this.p, shot, cast, secs), first, refs, secs, this.p.aspect, this.p.resolution);
    const rel = `鏡頭/${shot.id}-影片.mp4`;
    if (v.data) await this.writeMedia(rel, { mime: v.mime, data: v.data });
    else if (v.uri) {
      const d = await this.gemini.videoDownload(v.uri);
      await this.xk.net.download(d.url, d.headers, this.dir, rel);
      this.absCache.delete(rel);
    }
    shot.video = rel;
    shot.videoKey = this.videoKey(shot);
    shot.error = undefined;
    this.touch();
  }

  // --- 語音 ----------------------------------------------------------------------------

  speakerOf(id: string): Speaker {
    if (id === 'narrator') return narratorAsSpeaker(this.p.narrator);
    const c = this.charOf(id);
    if (!c) return narratorAsSpeaker(this.p.narrator);
    return { id: c.id, name: c.name, gender: c.gender, age: c.age, voiceNote: c.voiceNote, voice: c.voice };
  }

  /** 同性別同年齡層裡的第幾位（讓聲音錯開） */
  voiceIndex(sp: Speaker) {
    const list = [narratorAsSpeaker(this.p.narrator), ...this.p.characters.map((c) => this.speakerOf(c.id))].filter((x) => x.gender === sp.gender && ageBand(x.age) === ageBand(sp.age));
    return Math.max(0, list.findIndex((x) => x.id === sp.id));
  }

  engineFor(sp: Speaker): 'gemini-design' | 'gemini' | 'edge' {
    const e = sp.voice.engine === 'auto' ? this.settings.voiceEngine : sp.voice.engine;
    if (e !== 'edge' && !this.gemini.ready) return 'edge';
    return e;
  }

  audioKey(line: Line) {
    const sp = this.speakerOf(line.speaker);
    return hash(`${line.text}|${line.emotion}|${this.engineFor(sp)}|${designKey(sp)}|${sp.voice.voice ?? ''}|${this.voiceIndex(sp)}`);
  }

  private designing = new Map<string, Promise<string>>();

  /** 角色專屬聲音（Gemini 聲音設計）；同一角色只建立一次 */
  async designedVoice(sp: Speaker): Promise<string> {
    const key = designKey(sp);
    if (sp.voice.designedId && sp.voice.designedFor === key) return sp.voice.designedId;
    const k = `${sp.id}|${key}`;
    let job = this.designing.get(k);
    if (!job) {
      job = (async () => {
        const r = await this.gemini.designVoice(sp.name ?? '角色', sp.gender, voiceDesignPrompt(sp));
        const target = sp.id === 'narrator' ? this.p.narrator.voice : this.charOf(sp.id!)?.voice;
        if (target) {
          target.designedId = r.id;
          target.designedFor = key;
        }
        this.touch();
        return r.id;
      })();
      this.designing.set(k, job);
      job.catch(() => this.designing.delete(k));
    }
    return job;
  }

  async genVoice(shot: Shot, li: number): Promise<void> {
    const line = shot.lines[li];
    const sp = this.speakerOf(line.speaker);
    let engine = this.engineFor(sp);
    const base = `語音/${shot.id}-${li + 1}`;
    let rel = '';
    const style = [line.emotion, sp.voiceNote].filter(Boolean).join('，');
    if (engine === 'gemini-design') {
      try {
        const vid = await this.designedVoice(sp);
        const wav = await this.gemini.tts(line.text, vid, style);
        rel = await this.writeMedia(`${base}.wav`, wav);
      } catch (e) {
        if ((e as AiError).kind === 'key' || (e as AiError).kind === 'quota') throw e;
        engine = 'gemini'; // 聲音設計不能用：改用內建聲音
      }
    }
    if (!rel && engine === 'gemini') {
      try {
        const age = ageBand(sp.age);
        const ageStyle = age === 'child' ? '像小孩子一樣稚嫩天真' : age === 'senior' ? '像長輩一樣緩慢溫和' : '';
        const wav = await this.gemini.tts(line.text, geminiVoiceFor(sp, this.voiceIndex(sp)), ['台灣口音的國語', ageStyle, style].filter(Boolean).join('，'));
        rel = await this.writeMedia(`${base}.wav`, wav);
      } catch (e) {
        if ((e as AiError).kind === 'key' || sp.voice.engine !== 'auto') throw e;
        engine = 'edge';
      }
    }
    if (!rel) {
      const v = edgeVoiceFor(sp, this.voiceIndex(sp));
      // 語氣：激動稍快、難過稍慢
      let rate = parseInt(v.rate, 10);
      if (/激動|緊張|急|興奮|生氣/.test(line.emotion)) rate += 8;
      if (/難過|哽咽|溫柔|輕聲|疲憊/.test(line.emotion)) rate -= 8;
      rel = `${base}.mp3`;
      await this.xk.tts.edge(line.text, v.voice, v.pitch, `${rate >= 0 ? '+' : ''}${rate}%`, this.dir, rel);
      this.absCache.delete(rel);
    }
    const info = await this.xk.ff.probe(await this.abs(rel));
    line.audio = rel;
    line.dur = Math.round(info.dur * 100) / 100;
    line.audioKey = this.audioKey(line);
    this.touch();
  }

  // --- 狀態 ----------------------------------------------------------------------------

  shotState(shot: Shot) {
    const stillOk = !!shot.still && (shot.stillKey === 'sheet' || shot.stillKey === this.stillKey(shot));
    const videoOk = !!shot.video && shot.videoKey === this.videoKey(shot);
    const voices = shot.lines.map((l) => !!l.audio && l.audioKey === this.audioKey(l));
    return { stillOk, videoOk, voicesOk: voices.every(Boolean), voices };
  }

  // --- 合成 ----------------------------------------------------------------------------

  async render(onProgress: (p: number, label: string) => void) {
    if (!this.p.shots.length) throw new Error('還沒有分鏡');
    const inp: RenderInputs = { video: {}, still: {}, audio: {}, font: this.xk.platform === 'darwin' ? 'PingFang TC' : 'Microsoft JhengHei' };
    for (const s of this.p.shots) {
      if (s.video && (await this.xk.proj.exists(this.dir, s.video))) {
        const a = await this.abs(s.video);
        const info = await this.xk.ff.probe(a);
        if (info.hasVideo) inp.video[s.id] = { path: a, dur: info.dur, hasAudio: info.hasAudio };
      }
      if (s.still && (await this.xk.proj.exists(this.dir, s.still))) inp.still[s.id] = await this.abs(s.still);
      for (const [i, l] of s.lines.entries()) if (l.audio && (await this.xk.proj.exists(this.dir, l.audio))) inp.audio[`${s.id}:${i}`] = await this.abs(l.audio);
    }
    const outName = 'final.mp4';
    const plan = buildPlan(this.p, inp, outName);
    const srt = buildSrt(this.p, plan.timeline);
    const d = new Date();
    const p2 = (n: number) => String(n).padStart(2, '0');
    const stamp = `${d.getFullYear()}${p2(d.getMonth() + 1)}${p2(d.getDate())}-${p2(d.getHours())}${p2(d.getMinutes())}${p2(d.getSeconds())}`;
    const safe = this.p.title.replace(/[\\/:*?"<>|]/g, '_').slice(0, 40) || '影片';
    const outRel = `輸出/${safe}-${stamp}.mp4`;
    const off = this.xk.ff.onProgress((d) => onProgress(d.p, d.label));
    try {
      const r = await this.xk.ff.render(this.dir, { jobs: plan.jobs, final: plan.final, videoList: plan.videoList, audioList: plan.audioList, srtName: plan.srtName, srt, outName }, outRel);
      this.p.output.lastVideo = outRel;
      this.p.output.lastSrt = outRel.replace(/\.mp4$/i, '.srt');
      this.touch();
      await this.saveNow();
      return { ...r, total: plan.timeline.total };
    } finally {
      off();
    }
  }

  timeline() {
    return buildTimeline(this.p);
  }
}

export function friendly(e: unknown) {
  if (e instanceof AiError) return e.message;
  return (e as Error)?.message ?? String(e);
}
