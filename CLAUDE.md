# CLAUDE.md — 小柯機器人文字與圖像轉影音工具（xiaoke-storyvideo）

需求文件：`../文字與圖像轉影音.docx`。開發紀錄：`docs/開發紀錄.md`。

## 使用者規矩
- 一律繁體中文（台灣用語）；App 打開就能用，不要命令列；關視窗停止所有工作。
- 署名「開發：吳玉柱 先生 與 Claude AI Opus 5.5」。
- 建 repo、推送、發 Release 等對外動作要先問；commit 用 GitHub noreply，任何檔案不放使用者 email。

## 架構（Electron 45＋Vite＋TS，外殼照抄 xiaoke-compress）
- `src/types.ts` 專案資料（project.json）與設定；`src/storyboard.ts` 規則式分鏡、AI 分鏡提示詞與解析（引號內不切句）；`src/prompts.ts` 寫實提示詞（光源、色溫、焦段）；`src/voices.ts` 性別年齡→聲音、聲音設計描述、遠近殘響；`src/timeline.ts` 鏡頭長度、台詞時間、SRT；`src/render-plan.ts` FFmpeg 合成計畫（純函式，線上版可接 ffmpeg.wasm）。
- `src/ai.ts` Gemini **Interactions API**（`POST /v1beta/interactions`，Api-Revision 2026-05-20）：文字、圖片（Nano Banana）、影片（Omni，3–15 秒、delivery uri）、TTS、聲音設計（`POST /v1beta/voices`）。回應用 `outputs()` 從 steps[].content 取。模型名稱都在設定裡可改。
- `src/studio.ts` 製作流程（桌面版）：檔案放專案資料夾 角色／鏡頭／語音／輸出；stillKey／videoKey／audioKey 判斷是否需要重做。
- `electron/main.cjs`：xkstory://（網頁）、xkmedia://（專案檔案，Range）；net:request 只允許 generativelanguage.googleapis.com 與 aihorde.net（主程式 net.fetch 代送）；xkmedia 回應要帶 access-control-allow-origin（Electron 45 否則 canvas 讀圖會 tainted）；Gemini 金鑰用 safeStorage 加密存 userData；`XK_USER_DATA`、`XK_PROJECTS`、`XK_QUERY` 給測試用。
- **免費優先**（使用者要求：慢可以，不要花大錢）：畫面預設 `src/horde.ts` AI Horde（匿名金鑰 0000000000、每秒最多 2 次請求、Z-Image 要 scheduler simple／9 步；圖片由 net:download 存成 .webp；近景特寫單一角色用九宮格格子 img2img）；動態預設 2.5D 立體動態照片（`src/depth-worker.ts` Depth Anything V2 small q8，**WASM CPU**；`render-plan.ts` parallaxFilter＝FFmpeg displace＋geq 依時間位移＋zoompan）；配音預設微軟語音。
- `src/local-llm.ts`＋`llm-worker.ts`：本機小模型分鏡（WebLLM 0.2.87、Qwen3.5 2B/4B，WebGPU）＝**實驗功能預設關閉**：使用者的 Iris Xe 筆電跑久了整台當機重開三次（WHEA＋Kernel-Power 41）。WebLLM 每次請求的 JSON schema 必須相同（換 schema 會用到已刪除的 GrammarMatcher）；Electron 33 的 WebGPU 在 Iris Xe 會 device lost 且沒有 shader-f16 → 升級 Electron 45。
- **線上版**：`src/web-bridge.ts` 實作同一個 DesktopBridge（boot 時沒有 window.xk 就建立，`xk.web=true`）：檔案存 IndexedDB（路徑 `/專案/<名稱>/<相對路徑>` → Blob）、媒體用 Blob 網址（bridge.media）、選檔用代號 `picked:N/檔名`、shell.open＝下載、設定存 localStorage；合成用 ffmpeg.wasm 0.12（單執行緒，vite 把 core 輸出到 dist/ffmpeg/，Electron 打包排除），每步把 `-i /專案/…` 的檔案放進虛擬硬碟、用完刪；燒字幕要 `fontsdir=/fonts` 和 Noto Sans TC（jsDelivr 固定版本 Sans2.004，存 IndexedDB 快取）。AI Horde 線上版用 r2:false（base64 回傳，避開跨網域）。部署 `.github/workflows/pages.yml`。
- `src/indextts.ts` 台灣口音雲端語音：IndexTeam 官方 HF Space（IndexTTS-2.5，Gradio queue/join＋queue/data，fn_index 從 /config 找 gen_single），聲音樣本用 xiaoke-tts 公開的 `achir1015.github.io/xiaoke-tts/voices/<id>.mp3`（依性別年齡）；權杖放 `x-hf-authorization`；佇列串流要處理 unexpected_error／close_stream，不然會永遠等。線上版沒有微軟語音，engineFor 會把 edge 換成 taiwan。
- `electron/edge-tts.cjs` 微軟免費神經語音（msedge-tts，必須在 dependencies）；`electron/ffmpeg.cjs` 合成。

## 指令（Node 22：`%LOCALAPPDATA%\nvm\v22.22.3\node.exe`，PATH 裡的是 20）
```
node node_modules/vitest/vitest.mjs run      # 19 項，含真的 FFmpeg 合成與立體動態照片
node node_modules/typescript/bin/tsc
node node_modules/vite/bin/vite.js build
node e2e/desktop.mjs [--guide]              # 27 項（免費模式全流程）；XK_EXE= 測安裝版
node --experimental-websocket e2e/web.mjs [--cloud]   # 線上版（先 build；無頭 Chrome；1 句真的台灣口音雲端語音；--cloud 多測 AI Horde）
node e2e/horde-still.mjs [模型]             # AI Horde 真的產生 2 張畫面＋立體合成（會排隊）
node e2e/local-board.mjs                    # 本機小模型分鏡（會讓顯示晶片滿載，使用者筆電會當機，非必要不要跑）
CSC_IDENTITY_AUTO_DISCOVERY=false node node_modules/electron-builder/cli.js --win nsis portable --x64 --publish never "-c.directories.output=E:\xksv-build"
python scripts/make_icon.py
```

## 坑
- Sora 2 API 已在 2026-09-24 停止、Veo 3.1 preview 在 2026-10-22 停止 → 影片用 gemini-omni-1.2-flash。
- FFmpeg 最後輸出不可用 -shortest（字幕軌會把影片截短到最後一句字幕），改用 -t 總長。
- NSIS 輸出到中文路徑會失敗 → 輸出到 E:\xksv-build。
- 尚未用真的 Gemini 金鑰實測（AI 部分依官方文件撰寫）。
