// 深度估計（Depth Anything V2 小模型，約 27 MB）：只用 CPU（WebAssembly），每張畫面算一次，
// 結果是灰階圖（越亮越近），合成時用來做 2.5D 立體動態照片。
import { env, pipeline, RawImage } from '@huggingface/transformers';

env.allowLocalModels = false;

type Pipe = (img: RawImage) => Promise<{ depth: RawImage }>;
let pipe: Promise<Pipe> | null = null;

self.onmessage = async (e: MessageEvent<{ id: number; image: ArrayBuffer }>) => {
  const { id, image } = e.data;
  try {
    pipe ??= pipeline('depth-estimation', 'onnx-community/depth-anything-v2-small', {
      device: 'wasm',
      dtype: 'q8',
      progress_callback: (p: { status: string; progress?: number; file?: string }) => {
        if (p.status === 'progress' && /onnx/.test(p.file ?? '')) self.postMessage({ id, progress: (p.progress ?? 0) / 100 });
      },
    }) as unknown as Promise<Pipe>;
    const run = await pipe;
    const img = await RawImage.fromBlob(new Blob([image]));
    const { depth } = await run(img);
    const blob = await depth.toBlob('image/png');
    const png = await blob.arrayBuffer();
    (self as unknown as Worker).postMessage({ id, png }, [png]);
  } catch (err) {
    pipe = null;
    self.postMessage({ id, error: (err as Error).message || String(err) });
  }
};
