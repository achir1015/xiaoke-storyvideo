// 線上版（瀏覽器）用的「桌面功能」：專案存在瀏覽器的 IndexedDB、合成用 ffmpeg.wasm、網路直接連。
// 和 Electron preload 提供同一套介面（bridge.ts 的 DesktopBridge），畫面程式不用分兩套。
import type { DesktopBridge, ProjectEntry, RenderPlanWire } from './bridge';

declare const __APP_VERSION__: string;

const ROOT = '/專案';
const DB_NAME = 'xksv';
const SETTINGS_KEY = 'xksv-settings';
/** 燒錄字幕用的繁體中文字型（libass 需要字型檔；第一次合成時下載並存起來） */
const FONT_URL = 'https://cdn.jsdelivr.net/gh/notofonts/noto-cjk@Sans2.004/Sans/SubsetOTF/TC/NotoSansTC-Medium.otf';
export const WEB_FONT = 'Noto Sans TC Medium';

// --- IndexedDB：路徑 → Blob ------------------------------------------------------------

let dbp: Promise<IDBDatabase> | null = null;
function db() {
  if (!dbp)
    dbp = new Promise((res, rej) => {
      const r = indexedDB.open(DB_NAME, 1);
      r.onupgradeneeded = () => {
        r.result.createObjectStore('files');
        r.result.createObjectStore('cache');
      };
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
  return dbp;
}

async function tx<T>(store: string, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T> | void): Promise<T> {
  const d = await db();
  return new Promise((res, rej) => {
    const t = d.transaction(store, mode);
    const req = fn(t.objectStore(store));
    t.oncomplete = () => res(req ? req.result : (undefined as T));
    t.onerror = () => rej(t.error ?? new Error('瀏覽器儲存空間錯誤'));
    t.onabort = () => rej(t.error ?? new Error('瀏覽器儲存空間已滿，請刪掉一些舊專案'));
  });
}

const getFile = (path: string) => tx<Blob | undefined>('files', 'readonly', (s) => s.get(path));
const putFile = (path: string, b: Blob) => tx('files', 'readwrite', (s) => void s.put(b, path));
const delFile = (path: string) => tx('files', 'readwrite', (s) => void s.delete(path));
const keysUnder = (prefix: string) => tx<IDBValidKey[]>('files', 'readonly', (s) => s.getAllKeys(IDBKeyRange.bound(prefix, `${prefix}￿`)));

const join = (dir: string, rel: string) => `${dir}/${rel.replace(/\\/g, '/').replace(/^\/+/, '')}`;
function safeName(s: string) {
  return (s.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '').trim() || '我的故事').slice(0, 60);
}
const b64ToBlob = (b64: string, type = '') => new Blob([Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))], { type });
async function blobToB64(b: Blob) {
  const u8 = new Uint8Array(await b.arrayBuffer());
  let s = '';
  for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode(...u8.subarray(i, i + 0x8000));
  return btoa(s);
}
const MIME: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', bmp: 'image/bmp', mp4: 'video/mp4', wav: 'audio/wav', mp3: 'audio/mpeg', srt: 'text/plain', json: 'application/json' };
const mimeOf = (p: string) => MIME[(/\.([a-z0-9]+)$/i.exec(p)?.[1] ?? '').toLowerCase()] ?? 'application/octet-stream';

async function uniqueDir(title: string) {
  const base = `${ROOT}/${safeName(title)}`;
  for (let i = 1; ; i++) {
    const d = i === 1 ? base : `${base} (${i})`;
    if (!(await keysUnder(`${d}/`)).length) return d;
  }
}

// --- 使用者選的檔案（瀏覽器沒有路徑：給代號） ------------------------------------------

const picked = new Map<string, File>();
let pickN = 0;
function token(f: File) {
  const t = `picked:${++pickN}/${f.name}`;
  picked.set(t, f);
  return t;
}

function pick(accept: string, multi: boolean): Promise<File[]> {
  return new Promise((res) => {
    const i = document.createElement('input');
    i.type = 'file';
    i.accept = accept;
    i.multiple = multi;
    i.style.display = 'none';
    document.body.append(i);
    i.addEventListener('change', () => {
      res([...(i.files ?? [])]);
      i.remove();
    });
    i.addEventListener('cancel', () => {
      res([]);
      i.remove();
    });
    i.click();
  });
}

function saveAs(blob: Blob, name: string) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 60_000);
}

// --- 媒體網址（Blob URL，同一檔案重複使用） ----------------------------------------------

// 檔案改寫時 forget() 會清掉，所以同一路徑不必依專案更新時間重建（避免正在播放的影片被中斷）
const urls = new Map<string, string>();
async function mediaUrl(path: string) {
  const c = urls.get(path);
  if (c) return c;
  const b = await getFile(path);
  if (!b) return '';
  const url = URL.createObjectURL(b.type ? b : new Blob([b], { type: mimeOf(path) }));
  urls.set(path, url);
  return url;
}
function forget(path: string) {
  const c = urls.get(path);
  // 稍後才釋放：畫面可能還在用
  if (c) setTimeout(() => URL.revokeObjectURL(c), 30_000);
  urls.delete(path);
}

// --- ffmpeg.wasm -----------------------------------------------------------------------

type FF = import('@ffmpeg/ffmpeg').FFmpeg;
let ffp: Promise<FF> | null = null;
let logTail: string[] = [];
let onLog: ((line: string) => void) | null = null;

function loadFF() {
  if (!ffp)
    ffp = (async () => {
      const { FFmpeg } = await import('@ffmpeg/ffmpeg');
      const ff = new FFmpeg();
      ff.on('log', ({ message }) => {
        logTail.push(message);
        if (logTail.length > 400) logTail = logTail.slice(-200);
        onLog?.(message);
      });
      const base = new URL('ffmpeg/', location.href).href;
      await ff.load({ coreURL: `${base}ffmpeg-core.js`, wasmURL: `${base}ffmpeg-core.wasm` });
      return ff;
    })().catch((e) => {
      ffp = null;
      throw new Error(`FFmpeg 載入失敗：${(e as Error).message}`);
    });
  return ffp;
}

async function mkdirs(ff: FF, file: string) {
  const parts = file.split('/').slice(1, -1);
  let cur = '';
  for (const p of parts) {
    cur += `/${p}`;
    await ff.createDir(cur).catch(() => {});
  }
}

async function exec(ff: FF, args: string[]) {
  logTail = [];
  const code = await ff.exec(['-hide_banner', '-nostdin', ...args]);
  return { code, log: logTail.join('\n') };
}

async function fontBytes() {
  const cached = await tx<Blob | undefined>('cache', 'readonly', (s) => s.get(FONT_URL));
  if (cached) return new Uint8Array(await cached.arrayBuffer());
  const r = await fetch(FONT_URL);
  if (!r.ok) throw new Error(`下載字幕字型失敗（${r.status}）`);
  const b = await r.blob();
  await tx('cache', 'readwrite', (s) => void s.put(b, FONT_URL));
  return new Uint8Array(await b.arrayBuffer());
}

let canceled = false;

async function probeBlob(path: string) {
  const b = await getFile(path);
  if (!b) throw new Error(`找不到檔案：${path}`);
  if (/\.(wav|mp3|m4a|ogg|flac)$/i.test(path)) {
    try {
      const ctx = new OfflineAudioContext(1, 1, 44100);
      const buf = await ctx.decodeAudioData(await b.arrayBuffer());
      return { dur: buf.duration, hasAudio: true, hasVideo: false };
    } catch {
      // 交給 FFmpeg
    }
  }
  const ff = await loadFF();
  const tmp = `/probe/${Date.now()}${/\.[a-z0-9]+$/i.exec(path)?.[0] ?? ''}`;
  await mkdirs(ff, tmp);
  await ff.writeFile(tmp, new Uint8Array(await b.arrayBuffer()));
  const { log } = await exec(ff, ['-i', tmp]);
  await ff.deleteFile(tmp).catch(() => {});
  const m = /Duration: (\d+):(\d+):(\d+(?:\.\d+)?)/.exec(log);
  return { dur: m ? +m[1] * 3600 + +m[2] * 60 + +m[3] : 0, hasAudio: /Stream #.*Audio:/.test(log), hasVideo: /Stream #.*Video:/.test(log) };
}

async function render(dir: string, plan: RenderPlanWire, outRel: string, progress: (p: number, label: string) => void) {
  canceled = false;
  const ff = await loadFF();
  const enc = new TextEncoder();
  const written = new Set<string>();
  const put = async (name: string, data: Uint8Array) => {
    await mkdirs(ff, name.startsWith('/') ? name : `/${name}`);
    await ff.writeFile(name, data);
    written.add(name);
  };
  await put('videos.txt', enc.encode(plan.videoList));
  await put('audios.txt', enc.encode(plan.audioList));
  await put(plan.srtName, enc.encode(`﻿${plan.srt}`));
  const final = { ...plan.final, args: [...plan.final.args] };
  const vf = final.args.findIndex((a) => a.startsWith('subtitles='));
  if (vf >= 0) {
    await put('/fonts/NotoSansTC-Medium.otf', await fontBytes());
    final.args[vf] = final.args[vf].replace(/^subtitles=([^:]+):/, 'subtitles=$1:fontsdir=/fonts:');
  }
  const jobs = [...plan.jobs, final];
  const weight = (j: { label: string; dur: number }) => (/畫面|輸出/.test(j.label) ? 3 : 1) * Math.max(1, j.dur);
  const total = jobs.reduce((a, j) => a + weight(j), 0);
  let done = 0;
  try {
    for (const job of jobs) {
      if (canceled) throw new Error('已取消');
      progress(done / total, job.label);
      // 這一步用到的專案檔案放進 FFmpeg 的虛擬硬碟（用完就刪，省記憶體）
      const inputs: string[] = [];
      for (let i = 0; i < job.args.length - 1; i++) {
        const a = job.args[i + 1];
        if (job.args[i] === '-i' && a.startsWith(`${ROOT}/`) && !written.has(a)) {
          const b = await getFile(a);
          if (!b) throw new Error(`${job.label}失敗：找不到 ${a.slice(ROOT.length + 1)}`);
          await put(a, new Uint8Array(await b.arrayBuffer()));
          inputs.push(a);
        }
      }
      onLog = (line) => {
        const m = /time=(\d+):(\d+):(\d+(?:\.\d+)?)/.exec(line);
        if (m) progress((done + weight(job) * Math.min(1, (+m[1] * 3600 + +m[2] * 60 + +m[3]) / Math.max(0.1, job.dur))) / total, job.label);
      };
      const { code, log } = await exec(ff, job.args);
      onLog = null;
      for (const f of inputs) {
        await ff.deleteFile(f).catch(() => {});
        written.delete(f);
      }
      if (canceled) throw new Error('已取消');
      if (code !== 0) throw new Error(`${job.label}失敗：\n${log.trim().split('\n').slice(-6).join('\n')}`);
      // 輸出檔記下來，最後清掉
      const out = job.args[job.args.length - 1];
      if (!out.startsWith('-')) written.add(out);
      done += weight(job);
    }
    progress(1, '完成');
    const data = new Uint8Array((await ff.readFile(plan.outName)) as Uint8Array);
    const video = join(dir, outRel);
    await putFile(video, new Blob([data], { type: 'video/mp4' }));
    const srt = video.replace(/\.mp4$/i, '.srt');
    await putFile(srt, new Blob([`﻿${plan.srt}`], { type: 'text/plain' }));
    forget(video);
    forget(srt);
    return { video, srt, size: data.byteLength };
  } finally {
    onLog = null;
    for (const f of written) await ff.deleteFile(f).catch(() => {});
  }
}

// --- 介面 --------------------------------------------------------------------------------

export function createWebBridge(): DesktopBridge {
  void navigator.storage?.persist?.().catch(() => false);
  const progressFns = new Set<(d: { p: number; label: string }) => void>();
  const bridge: DesktopBridge = {
    web: true,
    async info() {
      return { version: __APP_VERSION__, platform: 'web', arch: '', ffmpeg: 'ffmpeg.wasm', projectsRoot: ROOT };
    },
    settings: {
      async get() {
        try {
          return JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? '{}') as Record<string, unknown>;
        } catch {
          return {};
        }
      },
      async set(s) {
        try {
          localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
        } catch {
          // 私密瀏覽：只在這次使用有效
        }
        return true;
      },
    },
    net: {
      async request(url, init) {
        const ctl = new AbortController();
        const timer = init.timeoutMs ? setTimeout(() => ctl.abort(), init.timeoutMs) : 0;
        try {
          const res = await fetch(url, { method: init.method, headers: init.headers, body: init.body, signal: ctl.signal });
          return { status: res.status, text: await res.text() };
        } finally {
          if (timer) clearTimeout(timer);
        }
      },
      async download(url, headers, dir, rel) {
        let b: Blob;
        if (/^https?:/i.test(url)) {
          const r = await fetch(url, { headers });
          if (!r.ok) throw new Error(`下載失敗（${r.status}）`);
          b = await r.blob();
        } else b = b64ToBlob(url.replace(/^data:[^,]*,/, ''), mimeOf(rel));
        const p = join(dir, rel);
        await putFile(p, b);
        forget(p);
        return b.size;
      },
    },
    proj: {
      async root() {
        return ROOT;
      },
      async list() {
        const keys = (await keysUnder(`${ROOT}/`)).map(String).filter((k) => /^\/專案\/[^/]+\/project\.json$/.test(k));
        const out: ProjectEntry[] = [];
        for (const k of keys) {
          try {
            const j = JSON.parse(await (await getFile(k))!.text()) as { title?: string; updated?: string; shots?: unknown[]; characters?: unknown[] };
            const dir = k.replace(/\/project\.json$/, '');
            out.push({ dir, title: j.title || dir.slice(ROOT.length + 1), updated: j.updated || '', shots: (j.shots ?? []).length, characters: (j.characters ?? []).length });
          } catch {
            // 壞掉的專案略過
          }
        }
        return out.sort((a, b) => String(b.updated).localeCompare(String(a.updated)));
      },
      async create(title) {
        const dir = await uniqueDir(title);
        await putFile(`${dir}/project.json`, new Blob(['{}'], { type: 'application/json' }));
        return dir;
      },
      async load(dir) {
        const b = await getFile(`${dir}/project.json`);
        if (!b) throw new Error('找不到這個專案');
        return JSON.parse((await b.text()).replace(/^﻿/, '')) as unknown;
      },
      async save(dir, data) {
        await putFile(`${dir}/project.json`, new Blob([JSON.stringify(data)], { type: 'application/json' }));
        return true;
      },
      async rename(dir, title) {
        if (dir.slice(ROOT.length + 1) === safeName(title)) return dir;
        const target = await uniqueDir(title);
        for (const k of (await keysUnder(`${dir}/`)).map(String)) {
          const b = await getFile(k);
          if (b) await putFile(target + k.slice(dir.length), b);
          await delFile(k);
          forget(k);
        }
        return target;
      },
      async write(dir, rel, b64) {
        const p = join(dir, rel);
        await putFile(p, b64ToBlob(b64, mimeOf(rel)));
        forget(p);
        return p;
      },
      async writeText(dir, rel, text) {
        const p = join(dir, rel);
        await putFile(p, new Blob([text], { type: mimeOf(rel) }));
        forget(p);
        return p;
      },
      async read(dir, rel) {
        const b = await getFile(join(dir, rel));
        if (!b) throw new Error(`找不到檔案：${rel}`);
        return blobToB64(b);
      },
      async exists(dir, rel) {
        return !!(await getFile(join(dir, rel)));
      },
      async remove(dir, rel) {
        const p = join(dir, rel);
        await delFile(p);
        forget(p);
        return true;
      },
      async import(dir, src, relDir, base) {
        const f = picked.get(src);
        if (!f) throw new Error('沒有這個檔案的存取權，請重新選擇');
        const ext = (/\.[a-z0-9]+$/i.exec(f.name)?.[0] ?? '.png').toLowerCase();
        let rel = `${relDir}/${safeName(base)}${ext}`;
        for (let i = 2; await getFile(join(dir, rel)); i++) rel = `${relDir}/${safeName(base)}-${i}${ext}`;
        await putFile(join(dir, rel), f);
        return rel;
      },
      async abs(dir, rel) {
        return join(dir, rel);
      },
    },
    dlg: {
      async images(multi) {
        return (await pick('image/png,image/jpeg,image/webp,image/bmp', multi)).map(token);
      },
      async story() {
        const [f] = await pick('.txt,.docx,.md,text/plain', false);
        return f ? { name: f.name, b64: await blobToB64(f) } : null;
      },
      async project() {
        return null;
      },
    },
    async allow() {
      return true;
    },
    pathOf(f: File) {
      return token(f);
    },
    tts: {
      async edge() {
        throw new Error('線上版不能用微軟語音（微軟不允許網頁直接連線），請在「4 產生素材」的配音改選「🇹🇼 台灣口音（免費）」。');
      },
    },
    ff: {
      probe: probeBlob,
      async render(dir, plan, outRel) {
        return render(dir, plan, outRel, (p, label) => progressFns.forEach((fn) => fn({ p, label })));
      },
      async cancel() {
        canceled = true;
        // ffmpeg.wasm 不能中斷單一指令：直接結束，下次再重新載入
        const p = ffp;
        ffp = null;
        if (p) (await p.catch(() => null))?.terminate();
      },
      onProgress(fn) {
        progressFns.add(fn);
        return () => progressFns.delete(fn);
      },
    },
    shell: {
      async reveal(p) {
        await bridge.shell.open(p);
      },
      async open(p) {
        const b = await getFile(p);
        if (!b) return '找不到檔案';
        saveAs(b, p.split('/').pop() || 'download');
        return '';
      },
      async external(url) {
        if (/^https:\/\//.test(url)) window.open(url, '_blank', 'noopener');
      },
    },
    update: {
      async check() {
        throw new Error('線上版不用安裝更新');
      },
      async download() {
        return '';
      },
      async install() {
        return {};
      },
      async openPage() {},
      onProgress() {
        return () => {};
      },
    },
    media: mediaUrl,
    platform: 'web',
  };
  return bridge;
}
