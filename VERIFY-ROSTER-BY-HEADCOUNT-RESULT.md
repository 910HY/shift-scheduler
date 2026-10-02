# RESULT｜輸入返工人數 → 一鍵編崗

對照：`VERIFY-ROSTER-BY-HEADCOUNT.md`（#2，優先）  
日期：2/10/2026  
狀態：**新功能**（之前未有）  
待簽：Mark  
Render：未 deploy

情境：主管而家 **A 更**，準備編 **B1／B2**。唔使登入。

## P0

- [x] 可揀區（上面區掣）＋目標更（B1／B2 可一齊或逐更）並輸入返工人數 N。
- [x] 一鍵編崗之後，編表時間格有人上崗。日更跟試算開崗％，預設 **50%**（Arr Hall 開 20 崗）。
- [x] N 不足：紅字寫缺幾多個崗、建議減開崗％或減崗，**未寫入編表**。
- [x] 結果先出編表；可再撳現有「生成 Preview Excel」。V1 貪婪，唔係完美 solver。多人多過開崗就留 **R（後備）**，唔加開崗位。

例：A 更視角，B2 輸入 26、B1 輸入 30，一鍵後 20 個崗有人，B1 有 MB，多餘時間係 R。B2 只輸入 5：缺 15 個崗，編表唔變。

## 截圖

- `shots/roster-n-input.png`：而家視角 A，B1=30、B2=26
- `shots/roster-n-result.png`：一鍵後編表（崗位、MB、後備 R）
- `shots/roster-n-short.png`：B2 只得 5 人，缺 15 個崗，未寫入編表

## 本機

```bash
npm install && npm run dev
```

開 http://127.0.0.1:4317 。撳「準備邊個更 → A」，喺右側輸入 B1／B2 人數再一鍵。人手不足可只輸入 B2=5 再撳一次。

```bash
npx vitest run src/logic/headcount.test.ts
```
