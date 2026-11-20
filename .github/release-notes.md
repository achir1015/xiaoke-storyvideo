## 小柯機器人文字與圖像轉影音工具

一篇故事文案＋角色九宮格圖 → AI 製作寫實鏡頭影片、分性別年齡的真人感配音、SRT 逐字稿。

**下載：**
- Windows 11：`XiaokeStoryVideo-版本-win-x64.exe`（安裝版，會建立桌面與開始選單捷徑）／`…-portable.exe`（免安裝）
- Mac（Apple 晶片）：`…-mac-arm64.dmg`；Mac（Intel）：`…-mac-x64.dmg`
- 線上版（免安裝）：https://achir1015.github.io/xiaoke-storyvideo/
- Android：`XiaokeStoryVideo-版本-android.apk`（第一次安裝要允許「安裝不明應用程式」）
- iPhone／iPad：用 Safari 開 https://achir1015.github.io/xiaoke-storyvideo/ios/ 按「安裝」（`xiaoke-storyvideo-ios.ipa`）

**v1.4.1：修正**
- 修正 Windows／Mac 桌面版：專案放在 OneDrive 資料夾時合成影片失敗（EPERM, Permission denied … _合成暫存）。合成暫存檔改放系統暫存區。
- 只有桌面版需要更新；線上版、iPhone、Android 仍是 v1.4.0，不用更新。

**v1.4.0：iPhone／iPad 版**
- 新增 iPhone／iPad App（線上安裝）：和線上版同一套功能，專案存在 App 裡；做好的影片用分享選單存到「照片」「檔案」或 AirDrop。
- 手機、平板版面：標題列與角色卡片自動換行，不再超出螢幕。
- 產生素材、合成影片時不會自動鎖定螢幕。
- 新增 Android App：影片存到「影片/小柯故事影音」、語音教學用手機語音、App 內一鍵更新、返回鍵回上一步。

**v1.3.0：線上版**
- 新增線上版：打開網址就能用，專案存在瀏覽器裡，影片在瀏覽器合成（較慢），做好按「⬇ 下載影片」。
- 新增配音「🇹🇼 台灣口音」：免費雲端語音（IndexTTS），用台灣人的聲音樣本，依角色性別年齡挑選並表現語氣；建議在「⚙ 設定」貼上免費的 Hugging Face 權杖。桌面版也可以選。

**v1.2.0：全部可以免費做**
- 畫面：☁️ 免費雲端 AI（AI Horde 志工電腦產生寫實照片，免帳號、免費，要排隊，每張約 1–5 分鐘）。
- 九宮格：沒有 Gemini 也能「AI 產生九宮格」（免費雲端畫九個角度再拼起來）。
- 動態：🎞️ 立體動態照片（AI 判斷遠近，做出有立體感的推、拉、搖運鏡；用 CPU 計算，免費）。
- 分鏡：Google AI Studio 的免費金鑰就能 AI 分鏡；沒有金鑰也能快速切段。
- 配音：預設微軟神經語音（免費）。
- 付費的 Gemini 寫實畫面、AI 影片仍可選用。

Mac 版未經 Apple 公證，第一次開啟若被擋：在「應用程式」對它按右鍵 →「打開」，或到「系統設定 → 隱私權與安全性」按「強制打開」。

**不需要任何付費帳號就能做出整支影片。** Gemini 金鑰（在程式「⚙ 設定」貼上）是選用的。

開發：吳玉柱 先生 與 Claude AI Opus 5.5
