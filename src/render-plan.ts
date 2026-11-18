// 合成計畫：把專案變成一連串 FFmpeg 指令（純函式；桌面版用內建 FFmpeg 執行，線上版可交給 ffmpeg.wasm）
import type { Project, Shot } from './types';
import { buildTimeline, type Timeline } from './timeline';
import { isIndoor, spaceFilter, spaceFor } from './voices';

export const FPS = 30;

export interface RenderInputs {
  /** 鏡頭 id → 影片絕對路徑與長度（秒） */
  video: Record<string, { path: string; dur: number; hasAudio: boolean } | undefined>;
  /** 鏡頭 id → 靜態畫面絕對路徑 */
  still: Record<string, string | undefined>;
  /** `${shotId}:${lineIndex}` → 語音檔絕對路徑 */
  audio: Record<string, string | undefined>;
  /** 合成時使用的字型（燒錄字幕） */
  font: string;
}

export interface Job {
  label: string;
  args: string[];
  /** 這一步輸出的長度（秒，用來算進度） */
  dur: number;
}

export function frameSize(p: Project): { w: number; h: number } {
  const long = p.resolution === '1080p' ? 1920 : 1280;
  const short = p.resolution === '1080p' ? 1080 : 720;
  return p.aspect === '9:16' ? { w: short, h: long } : { w: long, h: short };
}

const f3 = (n: number) => n.toFixed(3);
const X264 = ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '19', '-pix_fmt', 'yuv420p', '-r', String(FPS)];

/** 靜態畫面的運鏡（Ken Burns）：依鏡頭與運鏡方式決定推、拉、搖 */
export function kenBurns(shot: Shot, w: number, h: number, dur: number): string {
  const n = Math.max(1, Math.round(dur * FPS));
  const prog = `(on/${n})`;
  let z = `1+0.10*${prog}`;
  let x = 'iw/2-(iw/zoom/2)';
  let y = 'ih/2-(ih/zoom/2)';
  if (/拉遠/.test(shot.move)) z = `1.12-0.10*${prog}`;
  else if (/橫搖|跟拍/.test(shot.move)) {
    z = '1.12';
    x = `(iw-iw/zoom)*${prog}`;
  } else if (/固定/.test(shot.move)) z = `1+0.03*${prog}`;
  else if (shot.shotType === '特寫') z = `1+0.14*${prog}`;
  else if (shot.shotType === '遠景') {
    z = `1.10-0.06*${prog}`;
  }
  // 先放大兩倍再 zoompan，運鏡才不會抖動
  return `scale=${w * 2}:${h * 2}:force_original_aspect_ratio=increase,crop=${w * 2}:${h * 2},zoompan=z='${z}':x='${x}':y='${y}':d=1:s=${w}x${h}:fps=${FPS}`;
}

/** 一個鏡頭的畫面（無聲）：AI 影片優先，沒有就用靜態畫面運鏡 */
export function shotVideoJob(p: Project, shot: Shot, i: number, dur: number, inp: RenderInputs): Job {
  const { w, h } = frameSize(p);
  const out = `v_${String(i).padStart(3, '0')}.mp4`;
  const fade = `fade=t=in:st=0:d=0.25,fade=t=out:st=${f3(Math.max(0, dur - 0.25))}:d=0.25`;
  const v = inp.video[shot.id];
  if (v) {
    // 影片比需要的短：先放慢一點（最多 1.3 倍），還不夠就停在最後一格
    const slow = v.dur > 0 && v.dur < dur ? Math.min(1.3, dur / v.dur) : 1;
    const vf = [
      `scale=${w}:${h}:force_original_aspect_ratio=increase`,
      `crop=${w}:${h}`,
      slow > 1.01 ? `setpts=${f3(slow)}*PTS` : '',
      `fps=${FPS}`,
      'setsar=1',
      `tpad=stop_mode=clone:stop_duration=${f3(dur)}`,
      `trim=duration=${f3(dur)}`,
      fade,
    ]
      .filter(Boolean)
      .join(',');
    return { label: `鏡頭 ${i + 1} 畫面`, dur, args: ['-y', '-i', v.path, '-vf', vf, '-an', '-t', f3(dur), ...X264, out] };
  }
  const still = inp.still[shot.id];
  if (still) {
    const vf = `${kenBurns(shot, w, h, dur)},setsar=1,${fade},format=yuv420p`;
    return { label: `鏡頭 ${i + 1} 畫面`, dur, args: ['-y', '-loop', '1', '-framerate', String(FPS), '-t', f3(dur), '-i', still, '-vf', vf, '-frames:v', String(Math.round(dur * FPS)), ...X264, out] };
  }
  return {
    label: `鏡頭 ${i + 1} 畫面（空白）`,
    dur,
    args: ['-y', '-f', 'lavfi', '-i', `color=c=0x141c28:s=${w}x${h}:r=${FPS}:d=${f3(dur)}`, '-vf', fade, ...X264, out],
  };
}

/** 一個鏡頭的聲音：每句語音依時間放好、依遠近加殘響，再混入影片的環境音 */
export function shotAudioJob(p: Project, shot: Shot, i: number, tl: Timeline, inp: RenderInputs): Job {
  const st = tl.shots[i];
  const dur = st.dur;
  const out = `a_${String(i).padStart(3, '0')}.wav`;
  const args: string[] = ['-y'];
  const chains: string[] = [];
  const labels: string[] = [];
  const space = spaceFor(shot.shotType, isIndoor(`${shot.scene}${shot.visual}${shot.light}`));
  let n = 0;
  tl.cues
    .filter((c) => c.shot === i)
    .forEach((c) => {
      const file = inp.audio[`${shot.id}:${c.line}`];
      if (!file) return;
      args.push('-i', file);
      const ms = Math.max(0, Math.round((c.start - st.start) * 1000));
      // 旁白是畫外音：乾淨、貼近；角色聲音依鏡頭遠近處理
      const fx = c.speaker === 'narrator' ? 'highpass=f=60,volume=1.0' : spaceFilter(space);
      chains.push(`[${n}:a]aresample=48000,aformat=sample_fmts=fltp:channel_layouts=mono,${fx},pan=stereo|c0=c0|c1=c0,adelay=${ms}|${ms}[l${n}]`);
      labels.push(`[l${n}]`);
      n++;
    });
  const v = inp.video[shot.id];
  const amb = Math.max(0, Math.min(100, p.output.ambience)) / 100;
  if (v?.hasAudio && amb > 0) {
    args.push('-i', v.path);
    const slow = v.dur > 0 && v.dur < dur ? Math.min(1.3, dur / v.dur) : 1;
    // 有台詞時環境音再壓低一些，避免蓋過人聲
    const g = amb * (n ? 0.6 : 1);
    chains.push(
      `[${n}:a]aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo,${slow > 1.01 ? `atempo=${f3(1 / slow)},` : ''}volume=${g.toFixed(2)},afade=t=in:d=0.3[l${n}]`,
    );
    labels.push(`[l${n}]`);
    n++;
  }
  if (!n) {
    return { label: `鏡頭 ${i + 1} 聲音`, dur, args: ['-y', '-f', 'lavfi', '-i', `anullsrc=r=48000:cl=stereo`, '-t', f3(dur), '-c:a', 'pcm_s16le', out] };
  }
  const mix = n > 1 ? `${labels.join('')}amix=inputs=${n}:normalize=0:dropout_transition=0[m]` : `${labels[0]}anull[m]`;
  const tail = `[m]apad,atrim=duration=${f3(dur)},afade=t=out:st=${f3(Math.max(0, dur - 0.2))}:d=0.2[out]`;
  args.push('-filter_complex', [...chains, mix, tail].join(';'), '-map', '[out]', '-ar', '48000', '-ac', '2', '-c:a', 'pcm_s16le', out);
  return { label: `鏡頭 ${i + 1} 聲音`, dur, args };
}

export interface Plan {
  timeline: Timeline;
  jobs: Job[];
  /** 串接清單檔（FFmpeg concat demuxer）的內容 */
  videoList: string;
  audioList: string;
  srtName: string;
  final: Job;
}

/** 字幕樣式：白字黑框，畫面下方 */
export function subStyle(p: Project, font: string) {
  const size = p.aspect === '9:16' ? 11 : 16;
  return `FontName=${font},FontSize=${size},PrimaryColour=&H00FFFFFF,OutlineColour=&H00000000,BackColour=&H64000000,BorderStyle=1,Outline=1.6,Shadow=0.6,MarginV=${p.aspect === '9:16' ? 60 : 22}`;
}

export function buildPlan(p: Project, inp: RenderInputs, outName: string): Plan {
  const tl = buildTimeline(p);
  const jobs: Job[] = [];
  p.shots.forEach((s, i) => {
    jobs.push(shotVideoJob(p, s, i, tl.shots[i].dur, inp));
    jobs.push(shotAudioJob(p, s, i, tl, inp));
  });
  const videoList = p.shots.map((_, i) => `file 'v_${String(i).padStart(3, '0')}.mp4'`).join('\n') + '\n';
  const audioList = p.shots.map((_, i) => `file 'a_${String(i).padStart(3, '0')}.wav'`).join('\n') + '\n';
  const srtName = 'subs.srt';
  // 先無損串接，最後一步混音、響度標準化、（選擇）燒錄字幕、內嵌字幕軌
  jobs.push({ label: '串接畫面', dur: tl.total, args: ['-y', '-f', 'concat', '-safe', '0', '-i', 'videos.txt', '-c', 'copy', 'joined.mp4'] });
  jobs.push({ label: '串接聲音', dur: tl.total, args: ['-y', '-f', 'concat', '-safe', '0', '-i', 'audios.txt', '-c', 'copy', 'joined.wav'] });
  const hasSubs = tl.cues.length > 0;
  const finalArgs = ['-y', '-i', 'joined.mp4', '-i', 'joined.wav', ...(hasSubs ? ['-i', srtName] : []), '-map', '0:v', '-map', '1:a', ...(hasSubs ? ['-map', '2:s'] : [])];
  if (p.output.burnSubs && hasSubs) finalArgs.push('-vf', `subtitles=${srtName}:force_style='${subStyle(p, inp.font)}'`, ...X264);
  else finalArgs.push('-c:v', 'copy');
  finalArgs.push(
    '-af',
    'loudnorm=I=-16:TP=-1.5:LRA=11,aresample=48000',
    '-c:a',
    'aac',
    '-b:a',
    '192k',
    ...(hasSubs ? ['-c:s', 'mov_text', '-metadata:s:s:0', 'language=chi', '-metadata:s:s:0', 'title=中文逐字稿'] : []),
    '-metadata',
    `title=${p.title}`,
    '-movflags',
    '+faststart',
    '-t',
    f3(tl.total),
    outName,
  );
  const final: Job = { label: '混音與輸出 MP4', dur: tl.total, args: finalArgs };
  return { timeline: tl, jobs, videoList, audioList, srtName, final };
}
