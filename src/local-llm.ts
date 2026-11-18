// 本機小模型（WebLLM＋WebGPU）：不需金鑰、不花錢，第一次要下載模型（之後離線也能用）。
// 桌面版與線上版共用；模型存在瀏覽器快取（Electron 的 userData 內）。
import type { InitProgressReport, WebWorkerMLCEngine } from '@mlc-ai/web-llm';

export interface LocalModel {
  key: string;
  name: string;
  /** 下載大小（GB） */
  size: number;
  /** 需要的顯示記憶體（GB，內顯會用系統記憶體） */
  vram: number;
  note: string;
}

export const LOCAL_MODELS: LocalModel[] = [
  { key: 'Qwen3.5-2B', name: '標準（Qwen3.5 2B）', size: 1.1, vram: 2.3, note: '速度快，一般筆電就能跑' },
  { key: 'Qwen3.5-4B', name: '精緻（Qwen3.5 4B）', size: 2.4, vram: 3.9, note: '分鏡較細膩，需要 8 GB 以上記憶體' },
];
export const DEFAULT_LOCAL_MODEL = 'Qwen3.5-2B';

export const localModelOf = (key: string) => LOCAL_MODELS.find((m) => m.key === key) ?? LOCAL_MODELS[0];

export interface GpuStatus {
  ok: boolean;
  f16: boolean;
  adapter: string;
  reason?: string;
}

let gpuCache: Promise<GpuStatus> | null = null;
/** 檢查這台電腦（瀏覽器）能不能用 WebGPU 跑小模型 */
export function gpuStatus(): Promise<GpuStatus> {
  gpuCache ??= (async () => {
    const gpu = (navigator as Navigator & { gpu?: { requestAdapter(): Promise<GPUAdapterLike | null> } }).gpu;
    if (!gpu) return { ok: false, f16: false, adapter: '', reason: '這個瀏覽器不支援 WebGPU（請用新版 Chrome、Edge 或 Safari 26 以上）' };
    try {
      const a = await gpu.requestAdapter();
      if (!a) return { ok: false, f16: false, adapter: '', reason: '找不到可用的顯示晶片（WebGPU）' };
      const info = a.info ?? {};
      return { ok: true, f16: a.features.has('shader-f16'), adapter: [info.vendor, info.architecture, info.description].filter(Boolean).join(' ') };
    } catch (e) {
      return { ok: false, f16: false, adapter: '', reason: `WebGPU 無法啟動：${(e as Error).message}` };
    }
  })();
  return gpuCache;
}

interface GPUAdapterLike {
  features: { has(f: string): boolean };
  info?: { vendor?: string; architecture?: string; description?: string };
}

/** 依顯示晶片挑模型檔（支援 16 位元浮點用 q4f16，否則 q4f32） */
export const modelIdFor = (key: string, f16: boolean) => `${localModelOf(key).key}-${f16 ? 'q4f16_1' : 'q4f32_1'}-MLC`;

export interface LoadProgress {
  /** 0–1 */
  p: number;
  text: string;
  /** 是不是在下載（否則是從快取載入） */
  downloading: boolean;
}

export class Canceled extends Error {
  constructor() {
    super('已取消');
  }
}

export class LocalLLM {
  private engine: WebWorkerMLCEngine | null = null;
  private worker: Worker | null = null;
  private loaded = '';
  private loading: Promise<void> | null = null;
  private canceled = false;
  private lastKey = '';

  get ready() {
    return !!this.engine && !!this.loaded;
  }

  async isCached(key: string): Promise<boolean> {
    const g = await gpuStatus();
    const { hasModelInCache } = await import('@mlc-ai/web-llm');
    try {
      return await hasModelInCache(modelIdFor(key, g.f16));
    } catch {
      return false;
    }
  }

  /** 刪除下載過的模型（兩種精度都刪） */
  async remove(key: string) {
    const { deleteModelAllInfoInCache } = await import('@mlc-ai/web-llm');
    if (this.loaded.startsWith(key)) await this.unload();
    for (const f16 of [true, false]) await deleteModelAllInfoInCache(modelIdFor(key, f16)).catch(() => {});
  }

  /** 顯示晶片斷線後重新載入同一個模型（從快取，幾秒） */
  async reload() {
    if (!this.lastKey) throw new Error('本機模型還沒載入');
    await this.load(this.lastKey);
  }

  async load(key: string, onProgress: (p: LoadProgress) => void = () => {}) {
    this.lastKey = key;
    const g = await gpuStatus();
    if (!g.ok) throw new Error(g.reason);
    const id = modelIdFor(key, g.f16);
    if (this.loaded === id && this.engine) return;
    if (this.loading) await this.loading.catch(() => {});
    if (this.loaded === id && this.engine) return;
    this.canceled = false;
    this.loading = (async () => {
      await this.unload();
      const { CreateWebWorkerMLCEngine } = await import('@mlc-ai/web-llm');
      this.worker = new Worker(new URL('./llm-worker.ts', import.meta.url), { type: 'module' });
      const report = (r: InitProgressReport) => {
        const downloading = /Fetching|下載|fetch/i.test(r.text) && !/cache/i.test(r.text);
        onProgress({ p: r.progress, text: progressText(r.text), downloading });
      };
      try {
        this.engine = await CreateWebWorkerMLCEngine(this.worker, id, { initProgressCallback: report });
        this.loaded = id;
      } catch (e) {
        await this.unload();
        if (this.canceled) throw new Canceled();
        throw new Error(loadError(e as Error));
      }
    })();
    try {
      await this.loading;
    } finally {
      this.loading = null;
    }
  }

  /** 送出一段對話；schema 給了就強制輸出符合格式的 JSON */
  async chat(system: string, user: string, opts: { schema?: object; maxTokens?: number; temperature?: number } = {}): Promise<string> {
    if (!this.engine) throw new Error('本機模型還沒載入');
    let r;
    try {
      await this.engine.resetChat();
      r = await this.engine.chat.completions.create({
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      temperature: opts.temperature ?? 0.4,
      max_tokens: opts.maxTokens ?? 600,
      response_format: opts.schema ? { type: 'json_object', schema: JSON.stringify(opts.schema) } : undefined,
      extra_body: { enable_thinking: false },
      });
    } catch (e) {
      if (this.canceled) throw new Canceled();
      // 顯示晶片斷線（Windows 逾時重設等）：丟掉引擎，下次 reload()
      if (/Instance reference|device (was )?lost|disposed|mapAsync|DeviceLost|deleted object|Model not loaded/i.test((e as Error).message || '')) await this.unload();
      throw e;
    }
    if (this.canceled) throw new Canceled();
    const text = r.choices[0]?.message?.content ?? '';
    return text.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
  }

  /** 中斷：產生中就停下來，載入中就結束背景執行緒 */
  cancel() {
    this.canceled = true;
    if (this.loading) void this.unload();
    else this.engine?.interruptGenerate();
  }

  async unload() {
    const e = this.engine;
    this.engine = null;
    this.loaded = '';
    try {
      await e?.unload();
    } catch {
      // 背景執行緒可能已結束
    }
    this.worker?.terminate();
    this.worker = null;
  }
}

function progressText(t: string): string {
  const m = /Fetching param cache\[(\d+)\/(\d+)\]:\s*(\d+)MB fetched\.\s*(\d+)% completed/i.exec(t);
  if (m) return `下載模型 ${m[4]}%（${m[3]} MB）`;
  const c = /Loading model from cache\[(\d+)\/(\d+)\]/i.exec(t);
  if (c) return `載入模型 ${c[1]}/${c[2]}`;
  if (/shader|Loading GPU|compil/i.test(t)) return '準備顯示晶片…';
  if (/Finish loading/i.test(t)) return '模型已就緒';
  if (/Start to fetch|params/i.test(t)) return '準備下載模型…';
  return '載入模型中…';
}

function loadError(e: Error): string {
  const m = e.message || String(e);
  if (/out of memory|OOM|allocate|createBuffer/i.test(m)) return '顯示記憶體不足，請改用「標準」模型或關掉其他程式後再試';
  if (/fetch|network|Failed to fetch|NetworkError/i.test(m)) return '模型下載失敗，請確認網路連線後再試（已下載的部分會保留）';
  if (/QuotaExceeded|quota/i.test(m)) return '磁碟空間不足，無法儲存模型';
  if (/WebGPU|adapter|device/i.test(m)) return `顯示晶片無法使用：${m}`;
  return m;
}
