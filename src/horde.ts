// AI Horde（https://aihorde.net）：全球志工電腦組成的免費 AI 繪圖網路。
// 不需帳號（匿名金鑰 0000000000），要排隊所以比較慢；註冊免費帳號拿到自己的金鑰可以排比較前面。
// 圖片在志工電腦上產生，不在這台電腦跑，所以筆電不會滿載。
import type { Net } from './ai';

export const HORDE_API = 'https://aihorde.net/api/v2';
export const HORDE_ANON = '0000000000';

export interface HordeModel {
  key: string;
  name: string;
  note: string;
  params: { steps: number; cfg_scale: number; sampler_name: string; karras?: boolean; scheduler?: string };
  /** 適合的最大像素（匿名使用者有大小限制） */
  maxPixels: number;
}

/** 寫實模型（參數依 AI Horde 模型資料庫的規定） */
export const HORDE_MODELS: HordeModel[] = [
  { key: 'Juggernaut XL', name: 'Juggernaut XL', note: '寫實照片風格，推薦（實測約 4 分鐘）', params: { steps: 25, cfg_scale: 5, sampler_name: 'k_dpmpp_2m', karras: true }, maxPixels: 512 * 512 },
  { key: "ICBINP - I Can't Believe It's Not Photography", name: 'ICBINP 寫實照片', note: '最快（實測約 20 秒），人物細節較少', params: { steps: 25, cfg_scale: 6, sampler_name: 'k_dpmpp_2m', karras: true }, maxPixels: 512 * 512 },
  { key: 'Z-Image-Turbo', name: 'Z-Image Turbo', note: '最寫實、看得懂中文，但很熱門：匿名可能排隊 15 分鐘以上', params: { steps: 9, cfg_scale: 1, sampler_name: 'k_euler', scheduler: 'simple' }, maxPixels: 512 * 512 },
];
export const DEFAULT_HORDE_MODEL = HORDE_MODELS[0].key;
export const hordeModelOf = (key: string) => HORDE_MODELS.find((m) => m.key === key) ?? HORDE_MODELS[0];

export const HORDE_NEGATIVE = 'cartoon, anime, illustration, painting, drawing, sketch, 3d render, cgi, doll, plastic skin, deformed, disfigured, extra fingers, extra limbs, text, watermark, logo, signature, blurry';

/** 依畫面比例算出 64 的倍數、不超過像素上限的尺寸 */
export function hordeSize(aspect: string, maxPixels: number): { width: number; height: number } {
  const [a, b] = aspect.split(':').map(Number);
  const r = a && b ? a / b : 16 / 9;
  let h = Math.sqrt(maxPixels / r);
  let w = h * r;
  w = Math.max(256, Math.floor(w / 64) * 64);
  h = Math.max(256, Math.floor(h / 64) * 64);
  return { width: w, height: h };
}

export interface HordeJob {
  prompt: string;
  negative?: string;
  model: string;
  width: number;
  height: number;
  /** img2img 參考圖（base64，不含 data: 前綴） */
  source?: string;
  /** img2img 改變程度 0–1（越大越不像參考圖） */
  strength?: number;
  seed?: string;
}

export interface HordeStatus {
  /** 排在第幾位 */
  queue: number;
  /** 預估還要幾秒 */
  wait: number;
  processing: boolean;
}

export class HordeError extends Error {
  constructor(message: string, readonly kind: 'busy' | 'refused' | 'net' | 'timeout' | 'other' = 'other') {
    super(message);
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export class Horde {
  constructor(
    private net: Net,
    private apiKey = '',
    private version = '1.0.0',
  ) {}

  private headers() {
    return {
      'Content-Type': 'application/json',
      apikey: this.apiKey || HORDE_ANON,
      'Client-Agent': `xiaoke-storyvideo:${this.version}:https://github.com/achir1015/xiaoke-storyvideo`,
    };
  }

  private async call(path: string, method = 'GET', body?: unknown) {
    for (let attempt = 0; ; attempt++) {
      let r;
      try {
        r = await this.net.request(`${HORDE_API}${path}`, { method, headers: this.headers(), body: body ? JSON.stringify(body) : undefined, timeoutMs: 60_000 });
      } catch (e) {
        if (attempt < 3) {
          await sleep(3000 * (attempt + 1));
          continue;
        }
        throw new HordeError(`連不上 AI Horde：${(e as Error).message}`, 'net');
      }
      // 每秒最多 2 次請求；太快就等一下
      if (r.status === 429 && attempt < 6) {
        await sleep(1500 * (attempt + 1));
        continue;
      }
      let j: Record<string, unknown> = {};
      try {
        j = JSON.parse(r.text || '{}');
      } catch {
        // 不是 JSON
      }
      if (r.status >= 500 && attempt < 3) {
        await sleep(4000 * (attempt + 1));
        continue;
      }
      if (r.status >= 400) throw new HordeError(hordeMessage(r.status, String(j.message ?? r.text).slice(0, 300)), r.status === 429 ? 'busy' : 'refused');
      return j;
    }
  }

  /** 送出一張圖，等它完成，回傳圖片網址（webp） */
  async generate(job: HordeJob, onStatus: (s: HordeStatus) => void = () => {}, signal?: { canceled: boolean }): Promise<{ url: string; model: string; worker: string; seed: string }> {
    const m = hordeModelOf(job.model);
    const params: Record<string, unknown> = { ...m.params, width: job.width, height: job.height, n: 1 };
    if (job.seed) params.seed = job.seed;
    if (job.source) params.denoising_strength = job.strength ?? 0.6;
    const body: Record<string, unknown> = {
      prompt: `${job.prompt} ### ${job.negative ?? HORDE_NEGATIVE}`,
      params,
      models: [m.key],
      nsfw: false,
      censor_nsfw: true,
      r2: true,
      shared: false,
      replacement_filter: true,
    };
    if (job.source) {
      body.source_image = job.source;
      body.source_processing = 'img2img';
    }
    const sub = await this.call('/generate/async', 'POST', body);
    const id = String(sub.id ?? '');
    if (!id) throw new HordeError('AI Horde 沒有接受這張圖', 'refused');
    const t0 = Date.now();
    try {
      for (;;) {
        await sleep(6000);
        if (signal?.canceled) throw new HordeError('已取消', 'other');
        const c = await this.call(`/generate/check/${id}`);
        if (c.faulted) throw new HordeError('AI Horde 產生失敗，請再試一次', 'other');
        if (c.is_possible === false) throw new HordeError('目前沒有志工電腦能跑這個模型，請換一個模型', 'busy');
        onStatus({ queue: Number(c.queue_position ?? 0), wait: Number(c.wait_time ?? 0), processing: Number(c.processing ?? 0) > 0 });
        if (c.done) break;
        if (Date.now() - t0 > 30 * 60_000) throw new HordeError('等太久了（超過 30 分鐘），請稍後再試', 'timeout');
      }
    } catch (e) {
      // 取消或失敗：通知 AI Horde 不用做了
      void this.call(`/generate/status/${id}`, 'DELETE').catch(() => {});
      throw e;
    }
    const s = await this.call(`/generate/status/${id}`);
    const g = (s.generations as { img: string; model: string; worker_name: string; seed: string; censored?: boolean }[] | undefined)?.[0];
    if (!g?.img) throw new HordeError('AI Horde 沒有回傳圖片', 'other');
    if (g.censored) throw new HordeError('這張圖被 AI Horde 的安全過濾擋下，請修改畫面描述再試', 'refused');
    return { url: g.img, model: g.model, worker: g.worker_name, seed: String(g.seed ?? '') };
  }
}

function hordeMessage(status: number, msg: string) {
  if (status === 401) return 'AI Horde 金鑰不正確（可留空改用匿名）';
  if (status === 403) return `AI Horde 拒絕這次請求：${msg}`;
  if (status === 429) return 'AI Horde 太忙或請求太頻繁，請稍後再試';
  return `AI Horde 錯誤（${status}）：${msg}`;
}
