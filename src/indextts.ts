// 台灣口音雲端語音：Hugging Face 上 IndexTeam 官方的 IndexTTS-2.5 示範空間（免費 GPU 額度）
// 用「小柯機器人台灣語音 MP3 工具」公開的台灣口音聲音樣本（依性別、年齡挑選）複製聲音。
// 做法照抄 achir1015/xiaoke-tts 的 js/engines.js（Gradio queue/join + queue/data）。
import type { Gender } from './types';
import { type AgeBand, ageBand } from './voices';

export const TAIWAN_SPACE = 'https://indexteam-indextts-2-5-demo.hf.space';
const SAMPLE_BASE = 'https://achir1015.github.io/xiaoke-tts/voices/';

/** 聲音樣本（檔名＝xiaoke-tts 內建聲音 id） */
const SAMPLES: Record<Gender, Record<AgeBand, string[]>> = {
  female: {
    child: ['girl', 'girl2'],
    teen: ['girl2', 'young_female'],
    young: ['young_female', 'young_female_read_3d25ed'],
    adult: ['middle_female', 'mature_female', 'middle_female_read_cc15ce'],
    senior: ['elder_female'],
  },
  male: {
    child: ['boy', 'boy2'],
    teen: ['boy2', 'young_male'],
    young: ['young_male'],
    adult: ['middle_male'],
    senior: ['elder_male'],
  },
};

export function taiwanVoiceFor(sp: { gender: Gender; age: number }, index = 0) {
  const list = SAMPLES[sp.gender][ageBand(sp.age)];
  return list[index % list.length];
}

const EMOTIONS = ['開心', '生氣', '悲傷', '害怕', '厭惡', '低落', '驚訝', '平靜'] as const;
const EMO_RE: [RegExp, number][] = [
  [/開心|高興|快樂|興奮|笑|雀躍|得意/, 0],
  [/生氣|憤怒|怒|不耐|責備/, 1],
  [/難過|悲傷|哽咽|哭|心疼|不捨/, 2],
  [/害怕|緊張|恐懼|驚慌|發抖/, 3],
  [/厭惡|嫌棄|噁心/, 4],
  [/低落|疲憊|失望|無奈|嘆/, 5],
  [/驚訝|驚喜|吃驚|意外/, 6],
  [/溫柔|平靜|輕聲|安慰|沉穩/, 7],
];

/** 台詞語氣 → 情緒向量的位置（沒有對應就用聲音樣本本身的語氣） */
export function emotionIndex(emotion: string) {
  for (const [re, i] of EMO_RE) if (re.test(emotion)) return i;
  return -1;
}

export class TaiwanTtsError extends Error {
  constructor(
    msg: string,
    public kind: 'quota' | 'busy' | 'network' | 'other',
  ) {
    super(msg);
  }
}

function friendly(msg: string) {
  if (/quota|GPU duration|exceeded|runs limit/i.test(msg))
    return new TaiwanTtsError('台灣口音雲端語音的免費 GPU 額度用完了。到「⚙ 設定」貼上免費的 Hugging Face 權杖就能繼續用，或明天再試。', 'quota');
  if (/queue is full|too many/i.test(msg)) return new TaiwanTtsError('台灣口音雲端語音排隊人數太多，請稍後再試。', 'busy');
  if (/Failed to fetch|NetworkError|Load failed/i.test(msg)) return new TaiwanTtsError('連不到台灣口音雲端語音，請檢查網路。', 'network');
  return new TaiwanTtsError(msg || '台灣口音雲端語音發生錯誤（沒有提供原因），請再試一次。', 'other');
}

export interface TaiwanJob {
  text: string;
  voiceId: string;
  emotion?: string;
  /** 語速（1＝正常） */
  speed?: number;
  onWait?: (rank: number, eta: number) => void;
  signal?: AbortSignal;
}

export class TaiwanTts {
  private fn: number | null = null;
  constructor(private token = '') {}

  private headers(extra: Record<string, string> = {}) {
    // 權杖放 x-hf-authorization（放 Authorization 會被 ZeroGPU 擋掉）
    const t = this.token.trim();
    return t ? { ...extra, 'x-hf-authorization': `Bearer ${t}` } : extra;
  }

  private async fnIndex() {
    if (this.fn == null) {
      const r = await fetch(`${TAIWAN_SPACE}/config`, { headers: this.headers() }).catch((e) => {
        throw friendly(String(e));
      });
      if (!r.ok) throw new TaiwanTtsError(`台灣口音雲端語音回應 ${r.status}（可能在睡眠或維修中，請稍後再試）`, 'busy');
      const c = (await r.json()) as { dependencies: { id: number; api_name?: string }[] };
      const d = c.dependencies.find((x) => x.api_name === 'gen_single');
      if (!d) throw new TaiwanTtsError('台灣口音雲端語音的介面改版了，請更新程式', 'other');
      this.fn = d.id;
    }
    return this.fn;
  }

  /** 產生一句語音，回傳音檔內容與副檔名 */
  async synth(o: TaiwanJob): Promise<{ bytes: ArrayBuffer; ext: string }> {
    const url = `${SAMPLE_BASE}${o.voiceId}.mp3`;
    const file = { path: url, url, orig_name: `${o.voiceId}.mp3`, meta: { _type: 'gradio.FileData' } };
    const vec = [0, 0, 0, 0, 0, 0, 0, 0];
    const ei = emotionIndex(o.emotion ?? '');
    if (ei >= 0) vec[ei] = ei === 7 ? 0.5 : 0.6;
    const method = ei >= 0 ? 'Use emotion vectors' : 'Same as the voice reference';
    const sampling = [true, 0.8, 30, 0.8, 0, 3, 10, 1500];
    const dur = Math.max(0.5, Math.min(2, 1 / (o.speed || 1)));
    const data = [method, file, o.text, 'ZH', null, ei >= 0 ? 1 : 0.65, ...vec, '', false, 120, dur, ...sampling];
    const fn = await this.fnIndex();
    const session = Math.random().toString(36).slice(2, 13);
    let r: Response;
    try {
      r = await fetch(`${TAIWAN_SPACE}/gradio_api/queue/join`, {
        method: 'POST',
        headers: this.headers({ 'Content-Type': 'application/json' }),
        signal: o.signal,
        body: JSON.stringify({ data, fn_index: fn, session_hash: session, event_data: null, trigger_id: null }),
      });
    } catch (e) {
      throw friendly(String(e));
    }
    if (!r.ok) throw friendly(`台灣口音雲端語音回應 ${r.status}`);
    const s = await fetch(`${TAIWAN_SPACE}/gradio_api/queue/data?session_hash=${session}`, { headers: this.headers(), signal: o.signal });
    const reader = s.body!.getReader();
    const dec = new TextDecoder();
    let buf = '';
    type Done = { success: boolean; output?: { error?: string; data?: unknown[] }; title?: string };
    let result = null as Done | null;
    while (!result) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let k: number;
      while ((k = buf.indexOf('\n\n')) >= 0) {
        const chunk = buf.slice(0, k);
        buf = buf.slice(k + 2);
        const line = chunk.split('\n').find((l) => l.startsWith('data:'));
        if (!line) continue;
        let msg: Record<string, unknown>;
        try {
          msg = JSON.parse(line.slice(5));
        } catch {
          continue;
        }
        if (msg.msg === 'estimation') o.onWait?.(Number(msg.rank ?? 0), Number(msg.rank_eta ?? 0));
        if (msg.msg === 'unexpected_error') throw friendly(String(msg.message ?? ''));
        if (msg.msg === 'close_stream') break;
        if (msg.msg === 'process_completed') {
          result = msg as unknown as Done;
          break;
        }
      }
    }
    reader.cancel().catch(() => {});
    if (!result) throw new TaiwanTtsError('台灣口音雲端語音中斷連線，請再試一次。', 'network');
    if (!result.success) throw friendly(String(result.output?.error || result.title || ''));
    const out = result.output?.data?.[0] as { value?: { url?: string; path?: string }; url?: string } | undefined;
    const u = out?.value?.url || out?.url || (out?.value?.path && `${TAIWAN_SPACE}/gradio_api/file=${out.value.path}`);
    if (!u) throw new TaiwanTtsError('台灣口音雲端語音沒有回傳音檔', 'other');
    const a = await fetch(u, { headers: this.headers(), signal: o.signal });
    if (!a.ok) throw new TaiwanTtsError(`下載語音失敗（${a.status}）`, 'network');
    const ext = (/\.(wav|mp3|flac|ogg|m4a)(?:\?|$)/i.exec(u)?.[1] ?? 'wav').toLowerCase();
    return { bytes: await a.arrayBuffer(), ext };
  }
}

export { EMOTIONS as TAIWAN_EMOTIONS };
