# 渣板

當日現場崗位板，兼四區編崗。主畫面可以看「現在」泊位格，或看編崗表。頂欄是控制室：現在在場、崗位 filled／total、現場時刻，下面是區、更、開崗％同共需人手。

呢個 repo 之前係「即日編更」手機 MVP（Flask + 靜態時間軸）。而家 `/` 係渣板，舊檔留喺 `archive/shift-mobile-mvp/`，唔再係正式站。

沒有登入、多人即時同步。Arr Hall、Dep Hall、Arr Kiosk、Dep Kiosk 各自編崗。Hall 開滿是櫃位 30 加 APC 10（60 閘 ÷ 6）。Kiosk 開滿 12。全場 104。

顏色集中在 `src/theme.css`。在崗 `#2F6B4F`、休息 `#C9872A`（深色字）、早走／遲返 `#B5473A`、空缺虛線 `#9AA3B2`、場地 `#F4F5F7`、選中框 `#3B6FD8`。崗位區淡罩 `#E8F0EC`，休息區淡罩 `#F8F0E4`。

## 怎麼跑

需要 Node.js 與 Python 3.12。

```bash
npm install && npm run setup
npm run dev
```

- 電腦本機：<http://127.0.0.1:4317>
- 手機：跟電腦同一 Wi-Fi，開 `http://<電腦局域网IP>:4317`。`npm run dev` 會印出這個網址。唔好用 `127.0.0.1`，手機上的 127.0.0.1 係手機自己。
- 求解 API（本機 OR-Tools，只給畫面呼叫）：<http://127.0.0.1:4318>

`npm run setup` 會建立 `.venv` 並安裝 `server/requirements.txt`（含 OR-Tools、pytest、httpx）。正式環境只裝 `server/requirements-prod.txt`（冇 pytest／httpx）。

本機生產模式（同一進程、同一埠，先建前端再起 API）：

```bash
npm ci && npm run build
npm run setup
PORT=10000 npm start
```

開 <http://127.0.0.1:10000>。`GET /api/health` 應回 `{"ok":true,"solver":"ortools"}`。`POST /api/solve` 同畫面「重算未鎖定」用同一個路徑。

## 部署（Render）

正式站用 **Dockerfile**：Node 階段 `npm ci && npm run build` 出 `dist/`，Python 階段裝 `server/requirements-prod.txt`（含 ortools），再用 gunicorn + uvicorn worker 喺 `$PORT` 同時提供靜態頁同 `/api/*`。非 API、要 HTML 嘅路徑會回 `index.html`（SPA）。求解 worker timeout 係 **180 秒**，workers **1**（OR-Tools 食 CPU 同記憶體）。

```bash
docker build -t zaaban .
docker run --rm -p 10000:10000 -e PORT=10000 zaaban
```

現有服務 <https://shift-scheduler-9ct4.onrender.com/> 而家係 **Python** runtime，Procfile 以前係 `gunicorn main:app`。加咗 Dockerfile **唔會自動**改 runtime。要同一個 URL 換做渣板，請喺 **呢個現有服務** 改設定（唔好另外開一個 Blueprint，否則會係第二個 onrender.com 網址）：

1. Dashboard → 呢個 web service → **Settings**。
2. **Runtime / Language** 由 Python 3 改做 **Docker**。
3. **Dockerfile path**：`./Dockerfile`。**Docker context / root directory**：repo 根目錄（留空或 `.`）。
4. **Docker command** 留空，用 image 入面嘅 `CMD`（`scripts/start-prod.sh`）。如果仍有舊 start command `gunicorn main:app`，清走。
5. **Health check path**：`/api/health`。
6. 儲存。`main` 有新 commit 會 auto-deploy（如果 Auto-Deploy 開住）。否則撳 **Manual Deploy → Deploy latest commit**。

`render.yaml` 記錄同一個 Docker 規格。`Procfile` 只係未切 Docker 時嘅後備；native Python **冇 Node**，唔會自己 `npm run build`，`/` 會係 503。要以渣板做正式站，必須用 Docker。

瀏覽器如果之前開過舊站，可能仲註冊咗 `/sw.js`（cache 名 `shift-mobile-v9`）。新 `public/sw.js` 會清 cache 然後 unregister。更新之後硬重新載入一次。

## 怎麼看這塊板

桌面同手機用同一套畫面。桌面編崗是員工×時間格；手機改為員工卡同可換行的時間軸，頂欄的區、更、開崗％、共需人手、借調同早走都會摺行，不必橫向拉動先用到。重排仍可下載 Preview Excel。

示範板的現場時刻是 **13:10**，更份是 E3／E4／E，另有通宵 10K（22:15–07:00）。03 鎖在 **A14**。04 在 ACK 但正在 MB（25 分鐘），07 在 A15 的 MB（45 分鐘），10 在 UMB 的 MB（30 分鐘），12 在 R。06 在 A3、是 S/L 12:30，09 在 D3、UVL 14:00 才返。DCK 與 FB 是空缺。11（10K）與 13（14:00 才上班）在 13:10 不在場。改亂了可以按 **回復示範**。點泊位格會開姓名卡，上面有人、更份，以及崗位與 MB 的 In／Out。

## 本機儲存

每次改動會寫進瀏覽器 `localStorage`。

| 項目 | 值 |
| --- | --- |
| 鍵名 | `zaaban.board.v1` |
| 版本常數 | `STORAGE_VERSION = 1`（`src/types.ts`） |

紀錄形狀：

```json
{
  "version": 1,
  "state": { "date": "2026-09-28", "shiftName": "早更", "now": "13:10", "zones": [], "posts": [], "staff": [] }
}
```

版本對不上時，畫面先顯示示範板，**不會蓋掉舊檔**，直到你按「覆蓋舊紀錄」或開始改這塊板。重新整理後，版本相符的內容會留在板上。

## 重算

**重算未鎖定** 把目前的板送到本機 OR-Tools（CP-SAT）：

- 鎖定崗位上的人維持原位，鎖定的空位不會被填上。
- 休息區鎖住的人不會被抽走。
- 已 S/L、UVL 未返，或當值時間未涵蓋現場時刻的人，不會被派去未鎖定崗位。
- 先補滿未鎖定崗位，再盡量少搬動已經在崗的人；正在 MB 的人會晚一點才被抽。
- 人不夠時，剩下的未鎖定空位標成 **缺人**。

手動拖動、對調、送去休息也會拒絕覆蓋鎖定格子。

## VERIFY

先跑 `npm run dev`，用橫向大視窗打開 <http://127.0.0.1:4317>。若板被改過，先按 **回復示範**。

### V1 大螢幕平面

- 頂欄是「今日場地」、日期、**現在在場**、**崗位 filled／total**、現場時刻，以及在崗、MB／R、S/L／UVL、空缺四個圖例。
- 畫布是淡格線底圖。綠框裡是泊位格，琥珀框是休息區。到達、出發、大堂、外勤仍在崗位區裡。
- 格上主字是崗位碼，不是人名清單。主畫面不是時間軸，也不是圓釘。

### V2 當日可改崗位

- 按 **加崗位**，點 ARR 或其他模板，把名稱改成「臨時問詢」再儲存。
- 在方塊上方直接改名。點選該格後，用側欄的區域選單換區，再按 **刪除崗位**。
- 模板沒有把名稱或區域鎖死。分組標題也可以直接改。

### V3 人員與狀態

- 點 A14，姓名卡有 03、更 E3、崗位 In／Out。點 MB 格，看得到 MB In／Out。
- 點 06，看得到 **S/L 12:30**。點 09，看得到 **UVL 未返 14:00**。
- 把現場時刻改早於 12:30，06 回到 A3。改到 14:00，09 回到 D3，13 出現在 R。改到 23:00，10K 的 11 才在場。改回 13:10 會再切回示範切面。

### V4 即時調動

- 點一個未鎖定的人，按 **送去休息**，人立刻出現在休息區。
- 再點一個空的未鎖定崗位，人會回到該格。
- 點 **對調**，再點另一個人，兩人交換位置。
- 點 **移到最前**，該泊位格排到所在區最前；人若在休息區，則排到休息隊列最前。
- 點 03（A14 上有「鎖」），試著把 03 拖走或對調。畫面會拒絕，03 仍在 A14。選中時外框是藍色，底色不變。

### V5 只重算未鎖定

- 維持示範板與 13:10，確認 03 的格子是鎖定的。
- 按 **重算未鎖定**。03 仍在 A14。
- 06、09 離開原本的未鎖定崗位；休息區的人補上其他空位。
- 因為人不夠，至少還有一個 **缺人**。
- 若求解服務沒開，按鈕會提示失敗，手動調動仍可用。

### V6 重新整理仍在

- 改一個崗位名稱，重新整理 <http://127.0.0.1:4317>。名稱還在。
- 在開發者工具 → Application → Local Storage 看鍵 `zaaban.board.v1`，JSON 裡有 `"version": 1`。
- 側欄底部也寫著同一組鍵名與 version。

13:10 的示範切面：現在在場 9（在崗 5、休息 4）。06、09、空缺、未上班的 11 與 13 不計。崗位 10／12。

自動測試（鎖定格子不會被搬走）：

```bash
npm test
```

## 不做的事

登入與權限、多人即時、推播、WhatsApp。桌面同手機用同一套畫面。正式環境係上面嘅 Render Docker 服務，唔係第二套後端。
