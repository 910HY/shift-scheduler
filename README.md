# 今日編更｜即日人手調度（手機 MVP）

現場用、大掣、少打字嘅即日編更原型。即時改班（走咗／頂替／對調）只改本地狀態；每一次「重算」或「生成草稿」都呼叫後端 **OR-Tools CP-SAT**（`ShiftSchedulerWithConstraints`）。已過時段同「已確認」格會鎖住，求解器唔會覆寫。

舊版桌面設定頁仍可喺 `/desktop` 用。

## 本機跑

```bash
python3 -m venv .venv
source .venv/bin/activate   # Windows: .venv\Scripts\activate
pip install -r requirements.txt
python main.py
```

瀏覽器開 <http://127.0.0.1:8080>。

### 用 iPhone Safari 試

1. 電腦同 iPhone 連同一個 Wi‑Fi。
2. 查電腦區網 IP（macOS / Linux：`ipconfig getifaddr en0` 或 `hostname -I`）。
3. iPhone Safari 開 `http://<電腦IP>:8080`。
4. （可選）分享 → 加入主畫面，當 PWA 用。
5. 如果電話開唔到：檢查防火牆有冇擋 8080，或用 USB 連接 + 本機端口轉發。

部署到 Render 等平台時，沿用 `Procfile` 嘅 gunicorn（timeout 120 秒）。

## iPhone 上建議試嘅步驟

示範數據預設「而家」係 **09:45**，所以 09:00–09:30 已過並鎖住；阿明 09:00–10:00 **ARR-1** 已確認。唔使先重算都可以改。

1. **今日**：左右滑時間軸，按 ARR／DEP／KIOSK (A)／KIOSK (D) 分組，下面係 ARR-1、ARR-2 等軌道。色塊係有人，紅色「空缺」係有需求但冇人。
2. 撳一格有人嘅未來班 → **標記之後空缺**：呢位同事之後未鎖定班會變空缺（即時，唔等求解器）。
3. 撳空缺 → **派人頂呢格**，或撳有人嘅班 → **搵人頂替**。
4. **對調給其他人**：揀兩項未鎖定班 → 確認對調。已確認／已過時段唔會改動。
5. **人手**：睇每位工作／休息分鐘同進度條。接近連續工時上限會出黃／橙色提示，**唔會鎖死編輯**。
6. **重算**：撳「重算未鎖定時段」。應見到計時，然後回到今日；已鎖格不變，剩餘空缺會列喺重算頁。
7. 「生成草稿」亦會行 OR-Tools，但唔帶而家嘅鎖定（方便由零再排）。
8. **更多 → 崗位要求**：只有四類 **ARR / DEP / KIOSK (A) / KIOSK (D)**。用 +/- 改**崗位數**（例如 ARR=3 會變成 ARR-1、ARR-2、ARR-3 三條軌道），再加／刪需求時段。時間軸同「重算」會即時跟住更新。減崗唔會洗走剩餘軌道嘅已確認／已過時段。
9. **更多 → 人手名單**：由 **1** 至 **20** 撳「批量加入」一次過產生編號 1…20（已有編號會跳過，示範人名留低）。可以逐個加／刪，或「清空人手」。人手頁同時間軸會用大號數字顯示。
10. **更多** 亦可改示範時間、約束、重設示範數據。

編更會存 `localStorage`（key：`shift-mobile-v2`）。

## 重算點樣鎖格（同限制）

- 前端把 **已過時段** 同 **已確認** 嘅指派，以及「走咗」之後嘅不可用時段，一齊傳去 `POST /schedule`。
- 求解器以員工名入模（唔再只得 K1…Kn），工作量平衡改為**軟目標**（唔再硬性 ±1，避免現場人手不均就無解）。
- 崗位覆蓋仍然係軟約束：填唔晒就回報 `unfilled_job_slots`，介面繼續顯示空缺，唔會卡住。
- 若完整硬規則（連續工時、連崗、強制落場）加鎖定之後 INFEASIBLE，會自動再試：
  1. `relaxed`：跳過同鎖定格重疊嘅連續工時／連崗窗
  2. `locks`：只保留鎖定／離開／唔超額，專心填空缺
  3. 仍無解：回傳鎖定格 + 其餘留空（`FEASIBLE_LOCKS_ONLY`），並列出剩餘空缺

每一次嘗試都仍然跑 CP-SAT；最後一步只係合併結果，唔會用啟發式取代重算。

每位軌道每 30 分鐘格只派 1 人，方便沿用而家 OR-Tools 一人一崗編碼。四類崗位嘅「崗位數」會展開成 `ARR-1`、`KIOSK-A-2` 呢類代碼再交俾 `/schedule`。

## 後端測試

```bash
python -m unittest tests.test_scheduler_locks
```

## 主要檔案

| 檔案 | 用途 |
| --- | --- |
| `index.html` / `static/app.js` / `static/app.css` | 手機介面 |
| `desktop.html` / `static/script.js` | 舊版桌面設定＋一次過求解 |
| `backend_api.py` | `ShiftSchedulerWithConstraints`（CP-SAT + 鎖定） |
| `main.py` | Flask：`/` 手機、`/desktop` 舊版、`POST /schedule` |
