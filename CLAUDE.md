# CLAUDE.md — 小柯機器人文字與圖像轉影音工具（xiaoke-storyvideo）

需求文件：`../文字與圖像轉影音.docx`。開發紀錄：`docs/開發紀錄.md`。

## 使用者規矩
- 一律繁體中文（台灣用語）；App 打開就能用，不要命令列；關視窗停止所有工作。
- 署名「開發：吳玉柱 先生 與 Claude AI Opus 5.5」。
- 建 repo、推送、發 Release 等對外動作要先問；commit 用 GitHub noreply，任何檔案不放使用者 email。

## 架構（Electron 33＋Vite＋TS，外殼照抄 xiaoke-compress）
- `src/types.ts` 專案資料（project.json）與設定；`src/storyboard.ts` 規則式分鏡、AI 分鏡提示詞與解析（引號內不切句）；`src/prompts.ts` 寫實提示詞（光源、色溫、焦段）；`src/voices.ts` 性別年齡→聲音、聲音設計描述、遠近殘響；`src/timeline.ts` 鏡頭長度、台詞時間、SRT；`src/render-plan.ts` FFmpeg 合成計畫（純函式，線上版可接 ffmpeg.wasm）。
- `src/ai.ts` Gemini **Interactions API**（`POST /v1beta/interactions`，Api-Revision 2026-05-20）：文字、圖片（Nano Banana）、影片（Omni，3–15 秒、delivery uri）、TTS、聲音設計（`POST /v1beta/voices`）。回應用 `outputs()` 從 steps[].content 取。模型名稱都在設定裡可改。
- `src/studio.ts` 製作流程（桌面版）：檔案放專案資料夾 角色／鏡頭／語音／輸出；stillKey／videoKey／audioKey 判斷是否需要重做。
- `electron/main.cjs`：xkstory://（網頁）、xkmedia://（專案檔案，Range）；net:request 只允許 generativelanguage.googleapis.com（主程式 net.fetch 代送）；Gemini 金鑰用 safeStorage 加密存 userData；`XK_USER_DATA`、`XK_PROJECTS`、`XK_QUERY` 給測試用。
- `electron/edge-tts.cjs` 微軟免費神經語音（msedge-tts，必須在 dependencies）；`electron/ffmpeg.cjs` 合成。

## 指令（Node 22：`%LOCALAPPDATA%\nvm\v22.22.3\node.exe`，PATH 裡的是 20）
```
node node_modules/vitest/vitest.mjs run      # 13 項，含真的 FFmpeg 合成
node node_modules/typescript/bin/tsc
node node_modules/vite/bin/vite.js build
node e2e/desktop.mjs [--guide]              # 27 項（免費模式全流程）；XK_EXE= 測安裝版
CSC_IDENTITY_AUTO_DISCOVERY=false node node_modules/electron-builder/cli.js --win nsis portable --x64 --publish never "-c.directories.output=E:\xksv-build"
python scripts/make_icon.py
```

## 坑
- Sora 2 API 已在 2026-09-24 停止、Veo 3.1 preview 在 2026-10-22 停止 → 影片用 gemini-omni-1.2-flash。
- FFmpeg 最後輸出不可用 -shortest（字幕軌會把影片截短到最後一句字幕），改用 -t 總長。
- NSIS 輸出到中文路徑會失敗 → 輸出到 E:\xksv-build。
- 尚未用真的 Gemini 金鑰實測（AI 部分依官方文件撰寫）。
