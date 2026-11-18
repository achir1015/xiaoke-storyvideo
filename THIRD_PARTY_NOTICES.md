# 第三方軟體聲明

小柯機器人文字與圖像轉影音工具本身以 MIT 授權釋出（見 LICENSE），程式碼全部自行撰寫。
需求文件提到的 HunyuanVideo、Movie Gen 等專案只作為構想參考，沒有使用它們的程式碼或模型。

## 雲端 AI 服務

寫實畫面、AI 影片、AI 分鏡與 Gemini 語音使用 Google Gemini API（使用者自己的金鑰，依 Google 的服務條款與計費）。
免費語音使用 Microsoft Edge 線上朗讀服務（透過 msedge-tts 套件連線）。

## FFmpeg

桌面版內附獨立執行的 FFmpeg 程式（resources/bin/ffmpeg），由 npm 套件 ffmpeg-static 提供（Windows：gyan.dev 6.1.1 essentials；macOS：靜態建置）。
這些建置啟用了 GPL 元件（x264、libass 等），以 **GNU GPL v3** 授權；FFmpeg 以獨立程式呼叫、不連結進本程式。
授權全文見同資料夾 `LICENSE`、`ffmpeg*.LICENSE`、`ffmpeg*.README`；原始碼：https://ffmpeg.org/download.html

## Electron

MIT License，Copyright (c) Electron contributors / GitHub Inc.

## msedge-tts

MIT License，https://github.com/Migushthe2nd/MsEdgeTTS

## mammoth（讀取 .docx 故事檔）

BSD-2-Clause License，Copyright (c) 2013 Michael Williamson
