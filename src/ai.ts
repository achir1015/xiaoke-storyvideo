// Google Gemini API（Interactions API）：分鏡文字、九宮格與畫面、影片、語音、聲音設計
// 桌面版經由主程式連線（沒有 CORS 問題、不會逾時）；線上版直接用瀏覽器 fetch。
import type { Settings } from './types';

const BASE = 'https://generativelanguage.googleapis.com/v1beta';
const REVISION = '2026-05-20';

export interface Media {
  mime: string;
  /** base64 */
  data: string;
}

export interface NetResponse {
  status: number;
  text: string;
}

/** 連線方式：桌面版由 preload 提供 */
export interface Net {
  request(url: string, init: { method: string; headers: Record<string, string>; body?: string; timeoutMs?: number }): Promise<NetResponse>;
}

const browserNet: Net = {
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
};

export class AiError extends Error {
  constructor(
    message: string,
    public status = 0,
    public kind: 'key' | 'quota' | 'safety' | 'model' | 'net' | 'other' = 'other',
  ) {
    super(message);
  }
}

/** 把 API 錯誤翻成看得懂的中文 */
export function explainError(status: number, body: string): AiError {
  let msg = '';
  try {
    const j = JSON.parse(body) as { error?: { message?: string; status?: string } };
    msg = j.error?.message ?? '';
  } catch {
    msg = body.slice(0, 300);
  }
  if (status === 400 && /API key not valid|API_KEY_INVALID/i.test(msg)) return new AiError('Gemini 金鑰不正確，請到「設定」重新貼上。', status, 'key');
  if (status === 401 || status === 403) return new AiError(`Gemini 金鑰沒有權限（${msg || status}）。請確認金鑰正確，並已開通計費。`, status, 'key');
  if (status === 429) return new AiError('Gemini 使用量已達上限（每分鐘或每日額度），請稍後再試，或到 Google AI Studio 提高額度。', status, 'quota');
  if (status === 404) return new AiError(`找不到這個 AI 模型（${msg || status}），請到「設定」更換模型名稱。`, status, 'model');
  if (/safety|blocked|policy|prohibited|recitation|person|minor/i.test(msg)) return new AiError(`AI 安全規則拒絕了這個內容：${msg}`, status, 'safety');
  if (status >= 500) return new AiError(`Gemini 伺服器忙碌（${status}），請稍後再試。`, status, 'net');
  return new AiError(`Gemini 錯誤 ${status}：${msg || '未知錯誤'}`, status, 'other');
}

interface Item {
  type?: string;
  text?: string;
  data?: string;
  uri?: string;
  mime_type?: string;
  mimeType?: string;
}

/** 從 Interactions 回應取出模型輸出的內容（文字、圖片、聲音、影片） */
export function outputs(resp: unknown): Item[] {
  const r = resp as { steps?: { type?: string; content?: Item[] }[]; outputs?: Item[]; output?: Item[] };
  const found: Item[] = [];
  if (Array.isArray(r?.steps)) {
    for (const s of r.steps) if (s && (s.type === 'model_output' || !s.type) && Array.isArray(s.content)) found.push(...s.content);
  }
  if (!found.length && Array.isArray(r?.outputs)) found.push(...r.outputs);
  if (!found.length && Array.isArray(r?.output)) found.push(...r.output);
  if (!found.length) {
    // 其他格式：深度搜尋有 type 的內容
    const walk = (o: unknown, depth: number) => {
      if (!o || typeof o !== 'object' || depth > 6) return;
      const it = o as Item;
      if (typeof it.type === 'string' && (it.data || it.uri || (it.type === 'text' && it.text))) {
        found.push(it);
        return;
      }
      for (const v of Object.values(o)) walk(v, depth + 1);
    };
    walk(resp, 0);
  }
  return found;
}

const mimeOf = (it: Item) => it.mime_type ?? it.mimeType ?? '';

export class Gemini {
  constructor(
    private s: Settings,
    private net: Net = browserNet,
  ) {}

  get ready() {
    return !!this.s.geminiKey.trim();
  }

  private headers() {
    return { 'Content-Type': 'application/json', 'x-goog-api-key': this.s.geminiKey.trim(), 'Api-Revision': REVISION };
  }

  private async call(path: string, body: unknown, timeoutMs = 600_000, method = 'POST'): Promise<unknown> {
    if (!this.ready) throw new AiError('還沒有設定 Gemini 金鑰。請按右上角「⚙ 設定」貼上金鑰。', 0, 'key');
    let res: NetResponse;
    try {
      res = await this.net.request(`${BASE}${path}`, { method, headers: this.headers(), body: body === undefined ? undefined : JSON.stringify(body), timeoutMs });
    } catch (e) {
      throw new AiError(`連不上 Gemini：${(e as Error).message}（請檢查網路）`, 0, 'net');
    }
    if (res.status < 200 || res.status >= 300) throw explainError(res.status, res.text);
    try {
      return JSON.parse(res.text);
    } catch {
      throw new AiError('Gemini 回應格式不正確', res.status);
    }
  }

  /** 失敗時自動重試（伺服器忙碌、額度暫時用完） */
  private async retry<T>(fn: () => Promise<T>, tries = 3): Promise<T> {
    for (let i = 0; ; i++) {
      try {
        return await fn();
      } catch (e) {
        const err = e as AiError;
        if (i >= tries - 1 || !(err.kind === 'net' || err.kind === 'quota')) throw e;
        await new Promise((r) => setTimeout(r, (err.kind === 'quota' ? 20_000 : 4000) * (i + 1)));
      }
    }
  }

  /** 測試金鑰：列出可用的模型 */
  async listModels(): Promise<string[]> {
    const j = (await this.call('/models?pageSize=200', undefined, 30_000, 'GET')) as { models?: { name: string }[] };
    return (j.models ?? []).map((m) => m.name.replace(/^models\//, ''));
  }

  async text(prompt: string): Promise<string> {
    return this.retry(async () => {
      const r = await this.call('/interactions', {
        model: this.s.textModel,
        input: prompt,
      });
      const t = outputs(r)
        .filter((x) => x.type === 'text' && x.text)
        .map((x) => x.text)
        .join('');
      if (!t) throw new AiError('AI 沒有回傳文字');
      return t;
    });
  }

  /** 產生或編輯圖片：可附參考圖（角色九宮格、照片） */
  async image(prompt: string, refs: Media[], aspect: string, size = '2K'): Promise<Media> {
    return this.retry(async () => {
      const r = await this.call('/interactions', {
        model: this.s.imageModel,
        input: [{ type: 'text', text: prompt }, ...refs.map((m) => ({ type: 'image', mime_type: m.mime, data: m.data }))],
        response_format: { type: 'image', aspect_ratio: aspect, image_size: size },
      });
      const img = outputs(r).find((x) => x.type === 'image' && x.data);
      if (!img?.data) {
        const why = outputs(r).find((x) => x.type === 'text')?.text;
        throw new AiError(`AI 沒有產生圖片${why ? `：${why.slice(0, 200)}` : '（可能被安全規則擋下，請修改描述）'}`, 0, 'safety');
      }
      return { mime: mimeOf(img) || 'image/png', data: img.data };
    }, 2);
  }

  /** 影片：以第一格畫面（可加角色參考圖）產生 3–15 秒寫實影片，附原生環境音 */
  async video(prompt: string, first: Media | null, refs: Media[], seconds: number, aspect: string, resolution: string): Promise<{ data?: string; uri?: string; mime: string }> {
    const input: unknown[] = [];
    if (first) input.push({ type: 'image', mime_type: first.mime, data: first.data });
    for (const m of refs.slice(0, first ? 5 : 6)) input.push({ type: 'image', mime_type: m.mime, data: m.data });
    input.push({ type: 'text', text: prompt });
    return this.retry(async () => {
      const r = await this.call(
        '/interactions',
        {
          model: this.s.videoModel,
          input,
          response_format: { type: 'video', aspect_ratio: aspect, resolution, duration: `${Math.max(3, Math.min(15, Math.round(seconds)))}s`, delivery: 'uri' },
        },
        1_200_000,
      );
      const v = outputs(r).find((x) => x.type === 'video' && (x.data || x.uri));
      if (!v) {
        const why = outputs(r).find((x) => x.type === 'text')?.text;
        throw new AiError(`AI 沒有產生影片${why ? `：${why.slice(0, 200)}` : '（可能被安全規則擋下）'}`, 0, 'safety');
      }
      return { data: v.data, uri: v.uri, mime: mimeOf(v) || 'video/mp4' };
    }, 2);
  }

  /** 影片以網址交付時：等檔案處理完成，回傳下載網址與標頭 */
  async videoDownload(uri: string): Promise<{ url: string; headers: Record<string, string> }> {
    const m = /files\/([^/:?]+)/.exec(uri);
    if (m) {
      for (let i = 0; i < 120; i++) {
        const f = (await this.call(`/files/${m[1]}`, undefined, 30_000, 'GET')) as { state?: string; downloadUri?: string; download_uri?: string };
        if (!f.state || f.state === 'ACTIVE') break;
        if (f.state === 'FAILED') throw new AiError('影片檔處理失敗');
        await new Promise((r) => setTimeout(r, 3000));
      }
      return { url: `${BASE}/files/${m[1]}:download?alt=media`, headers: { 'x-goog-api-key': this.s.geminiKey.trim() } };
    }
    return { url: uri, headers: uri.includes('googleapis.com') ? { 'x-goog-api-key': this.s.geminiKey.trim() } : {} };
  }

  /** 語音：回傳 WAV（24kHz 單聲道） */
  async tts(text: string, voice: string, style: string): Promise<Media> {
    return this.retry(async () => {
      const r = await this.call(
        '/interactions',
        {
          model: this.s.ttsModel,
          input: [
            {
              type: 'user_input',
              content: [{ type: 'text', text, ...(style ? { annotations: [{ type: 'speech_metadata', style }] } : {}) }],
            },
          ],
          response_format: { type: 'audio' },
          generation_config: { speech_config: [{ voice }] },
        },
        180_000,
      );
      const a = outputs(r).find((x) => x.type === 'audio' && x.data);
      if (!a?.data) throw new AiError('AI 沒有產生語音');
      return { mime: mimeOf(a) || 'audio/wav', data: a.data };
    });
  }

  /** 聲音設計：依描述建立角色專屬聲音，回傳 voice_… 代號 */
  async designVoice(name: string, gender: 'male' | 'female', description: string): Promise<{ id: string; sample?: Media }> {
    const body = (lang: string | null) => ({
      store: true,
      voice: {
        model: this.s.ttsModel,
        type: 'prompted',
        display_name: `小柯-${name}`.slice(0, 60),
        gender,
        ...(lang ? { language_code: lang } : {}),
        prompted: { input: description },
      },
    });
    let r: { id?: string; name?: string; sample_audio?: { data?: string; mime_type?: string } };
    try {
      r = (await this.call('/voices', body('zh-TW'), 120_000)) as typeof r;
    } catch (e) {
      // 不支援 zh-TW 語言代碼時，改用 cmn-TW 或不指定
      if ((e as AiError).status !== 400) throw e;
      try {
        r = (await this.call('/voices', body('cmn-TW'), 120_000)) as typeof r;
      } catch {
        r = (await this.call('/voices', body(null), 120_000)) as typeof r;
      }
    }
    const id = r.id ?? r.name?.replace(/^voices\//, '');
    if (!id) throw new AiError('聲音設計沒有回傳代號');
    return { id, sample: r.sample_audio?.data ? { mime: r.sample_audio.mime_type ?? 'audio/wav', data: r.sample_audio.data } : undefined };
  }
}
