import { readFileSync } from 'node:fs';
import { defineConfig } from 'vitest/config';

const { version } = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version: string };
const core = (f: string) => readFileSync(new URL(`./node_modules/@ffmpeg/core/dist/esm/${f}`, import.meta.url));

export default defineConfig({
  // 相對路徑：本機、GitHub Pages、Electron 自訂協定、手機 App 都能用
  base: './',
  define: { __APP_VERSION__: JSON.stringify(version) },
  worker: { format: 'es' },
  // @ffmpeg/ffmpeg 自己建立 worker，開發模式不要預先打包
  optimizeDeps: { exclude: ['@ffmpeg/ffmpeg', '@ffmpeg/util'] },
  plugins: [
    {
      name: 'xk-assets',
      generateBundle() {
        this.emitFile({ type: 'asset', fileName: 'version.json', source: JSON.stringify({ version }) });
        // 線上版的 ffmpeg.wasm（同網域載入；桌面版打包時排除）
        this.emitFile({ type: 'asset', fileName: 'ffmpeg/ffmpeg-core.js', source: core('ffmpeg-core.js') });
        this.emitFile({ type: 'asset', fileName: 'ffmpeg/ffmpeg-core.wasm', source: core('ffmpeg-core.wasm') });
      },
      configureServer(server) {
        server.middlewares.use((req, res, next) => {
          const m = /\/ffmpeg\/(ffmpeg-core\.(js|wasm))/.exec(req.url ?? '');
          if (!m) return next();
          res.setHeader('Content-Type', m[2] === 'js' ? 'text/javascript' : 'application/wasm');
          res.end(core(m[1]));
        });
      },
    },
  ],
  build: { target: 'es2022', chunkSizeWarningLimit: 1500 },
  test: { testTimeout: 60_000 },
});
