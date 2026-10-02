# VERIFY｜掃 QR 睇崗（RESULT）

日期：2026-10-02  
本機：`npm run dev`（:4317）。冇 deploy、冇改 Render。  
個人崗位同列印沿用 CLOCK-LABEL-PRINT 嗰張表，掃碼頁只係深連結入口。

## 點試

```bash
npm install
npm run dev
```

電腦開 <http://127.0.0.1:4317>，開崗列撳 **產生 QR**。

1. 員工：日期＋區＋一個人。QR 同下面條 link 係同一個網址。開 link 就係嗰個人全日崗，撳 **列印**。
2. 主管：撳「主管」，日期＋區。開 link 係該日該區全日只讀總覽。
3. 壞 link：<http://127.0.0.1:4317/?view=person>

示範（Arr Hall、2026-09-28）：

- 員工：<http://127.0.0.1:4317/?view=person&staff=K4&shift=B2&date=2026-09-28&loc=arr-hall>
- 主管：<http://127.0.0.1:4317/?view=supervisor&date=2026-09-28&loc=arr-hall>

`127.0.0.1` 只係產生 QR 嗰部電腦開到。手機用 `npm run dev` 印出嘅局域网網址。V1 冇登入，試玩／內網，未批唔好公開。

## 截圖

`npm run dev` 開住，再跑：

```bash
npm run shots:qr
```

| 檔名 | 內容 |
|------|------|
| `shots/qr-gen-staff.png` | 主 App 員工 QR 同 link |
| `shots/qr-gen-supervisor.png` | 主 App 主管 QR 同 link |
| `shots/qr-staff-day.png` | 掃碼後個人全日崗 |
| `shots/qr-staff-print.png` | 個人列印（隱藏導航） |
| `shots/qr-supervisor-day.png` | 掃碼後全日總覽 |
| `shots/qr-bad-link.png` | 壞 link 錯誤態 |

## P0

### QR-A｜員工掃碼 → 全日自己崗位
- [x] 主 App 可顯示／產生員工 QR，同可複製 deep link
- [x] 開 link 只見該員工全日崗位（更碼＋工號、時段、區、日期、時間×崗／R）
- [x] 沿用個人崗位；可列印，列印時無主導航
- [x] 唔使再選工號；窄屏可读

### QR-B｜主管掃碼 → 全日編崗總覽
- [x] 主 App 可顯示／產生主管 QR
- [x] 開 link 見該日該區全日編崗總覽（邊個、邊個時段、邊個崗）
- [x] 掃碼頁只讀；窄屏可換行

### QR-C｜壞 link
- [x] 缺參／錯區有清楚錯誤，唔白屏

鐘、更 focus、A 至 06:45 冇改邏輯。`vitest` 斷言通過。
