// 2.5D 立體動態照片用的深度圖：在背景執行緒用 CPU 算（不用顯示晶片，避免筆電滿載）
let worker: Worker | null = null;
let seq = 0;
const pending = new Map<number, { resolve: (b: ArrayBuffer) => void; reject: (e: Error) => void; progress?: (p: number) => void }>();

function getWorker() {
  if (worker) return worker;
  worker = new Worker(new URL('./depth-worker.ts', import.meta.url), { type: 'module' });
  worker.onmessage = (e: MessageEvent<{ id: number; png?: ArrayBuffer; error?: string; progress?: number }>) => {
    const job = pending.get(e.data.id);
    if (!job) return;
    if (e.data.progress !== undefined) return job.progress?.(e.data.progress);
    pending.delete(e.data.id);
    if (e.data.png) job.resolve(e.data.png);
    else job.reject(new Error(`深度估計失敗：${e.data.error ?? '未知錯誤'}`));
  };
  worker.onerror = (e) => {
    for (const j of pending.values()) j.reject(new Error(`深度估計失敗：${e.message}`));
    pending.clear();
    worker?.terminate();
    worker = null;
  };
  return worker;
}

/** 算出一張圖的深度圖（PNG 灰階，越亮越近）；第一次會下載約 27 MB 的模型 */
export function estimateDepth(image: ArrayBuffer, progress?: (p: number) => void): Promise<ArrayBuffer> {
  return new Promise((resolve, reject) => {
    const id = ++seq;
    pending.set(id, { resolve, reject, progress });
    getWorker().postMessage({ id, image }, [image]);
  });
}

/** 關閉背景執行緒（釋放記憶體） */
export function stopDepth() {
  worker?.terminate();
  worker = null;
  for (const j of pending.values()) j.reject(new Error('已取消'));
  pending.clear();
}
