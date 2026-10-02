import { useState } from "react";
import { headcountTrial } from "@/logic/headcount";
import { SHIFTS, officeLabel } from "@/logic/staffing";
import type { ShiftId, StaffingState } from "@/types";

export function HeadcountPanel({
  staffing,
  dayPercent,
  nightPercent,
  onDayPercent,
  onNightPercent,
  onUseMix,
  error,
  onAssign,
  onReject,
  onPreviewExcel,
}: {
  staffing: StaffingState;
  dayPercent: number;
  nightPercent: number;
  onDayPercent: (value: number) => void;
  onNightPercent: (value: number) => void;
  onUseMix: () => void;
  error: string | null;
  onAssign: (counts: Partial<Record<ShiftId, number>>) => void;
  onReject: (message: string) => void;
  onPreviewExcel: () => void;
}) {
  const trial = headcountTrial(staffing, dayPercent, nightPercent);
  const dayOpen = trial.lines.find((line) => line.band === "day")?.openPosts ?? 0;
  const nightOpen = trial.lines.find((line) => line.shiftId === "A")?.openPosts ?? 0;
  const [picked, setPicked] = useState<Partial<Record<ShiftId, boolean>>>({ B1: true, B2: true });
  const [counts, setCounts] = useState<Partial<Record<ShiftId, string>>>({});

  function submit() {
    const next: Partial<Record<ShiftId, number>> = {};
    const missing: ShiftId[] = [];
    for (const shift of SHIFTS) {
      if (!picked[shift.id]) continue;
      const raw = counts[shift.id]?.trim() ?? "";
      const value = Number(raw);
      if (!raw || !Number.isInteger(value) || value <= 0) missing.push(shift.id);
      else next[shift.id] = value;
    }
    if (!Object.keys(next).length && missing.length === 0) {
      onReject("請揀至少一個更。未寫入編表。");
      return;
    }
    if (missing.length) {
      onReject(`請輸入 ${missing.join("、")} 返工人數。未寫入編表。`);
      return;
    }
    onAssign(next);
  }

  return (
    <section className="headcount-panel" data-testid="headcount-panel" aria-label="人手試算同埋一鍵編崗">
      <div className="headcount-copy">
        <h2>人手試算</h2>
        <p data-testid="headcount-summary">
          日更 {dayPercent}% 開 {dayOpen} 崗，A 更 {nightPercent}% 開 {nightOpen} 崗。
          每行「建議」係嗰更單獨包場（含休息、meal、A 大休）。重疊時段同時在崗唔等於各更建議相加，因為共用一個崗位池（共需唔會每更各乘一次）。
          頂欄「共需人手」只係而家選中嗰更、按而家開崗數計。
        </p>
        <div className="headcount-mix">
          <button type="button" data-testid="mix-day50-a30" onClick={onUseMix}>日更 50% · A 30%</button>
          <label>
            日更開崗％
            <input
              type="number"
              min={0}
              max={100}
              step={1}
              inputMode="numeric"
              aria-label="日更開崗百分比"
              data-testid="day-percent"
              value={dayPercent}
              onChange={(event) => onDayPercent(numberOr(event.target.value, dayPercent))}
            />
          </label>
          <label>
            A 更開崗％
            <input
              type="number"
              min={0}
              max={100}
              step={1}
              inputMode="numeric"
              aria-label="A 更開崗百分比"
              data-testid="night-percent"
              value={nightPercent}
              onChange={(event) => onNightPercent(numberOr(event.target.value, nightPercent))}
            />
          </label>
        </div>
        <div className="headcount-scroll">
        <table className="headcount-table" data-testid="headcount-table">
          <thead>
            <tr>
              <th>更</th>
              <th>時段</th>
              <th>開崗％</th>
              <th>開崗</th>
              <th>單獨建議</th>
            </tr>
          </thead>
          <tbody>
            {trial.lines.map((line) => (
              <tr key={line.shiftId} data-testid={`headcount-row-${line.shiftId}`}>
                <td>{line.shiftId}</td>
                <td>{line.start}–{line.end}</td>
                <td>{line.percent}%</td>
                <td data-testid={`open-posts-${line.shiftId}`}>{line.openPosts}</td>
                <td data-testid={`suggested-${line.shiftId}`}>{line.suggested}</td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
        <div data-testid="overlap-explain">
          {trial.overlaps.map((item) => (
            <p key={item.at} data-testid={`overlap-at-${item.at.replace(":", "")}`}>{item.message}</p>
          ))}
        </div>
      </div>
      <form
        className="roster-by-n"
        data-testid="roster-by-n"
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        <h2>輸入返工人數 · 一鍵編崗</h2>
        <p>
          目標區：{officeLabel(staffing.officeId)}（用上面區掣改）。主管可以喺 A 更準備下一更：揀 B1／B2（或單獨一個更），輸入呢更有幾多人返工。
          開崗跟上面試算：日更用日更％，淨係編 A 就用 A％。預設日更 50%、A 30%。唔使登入。
        </p>
        <ul className="roster-n-list">
          {SHIFTS.map((shift) => (
            <li key={shift.id}>
              <label>
                <input
                  type="checkbox"
                  data-testid={`prepare-${shift.id}`}
                  checked={Boolean(picked[shift.id])}
                  onChange={(event) => setPicked({ ...picked, [shift.id]: event.target.checked })}
                />
                {shift.id}
                <span>{shift.start}–{shift.end}</span>
              </label>
              <input
                type="number"
                min={1}
                step={1}
                inputMode="numeric"
                aria-label={`${shift.id} 返工人數`}
                data-testid={`headcount-n-${shift.id}`}
                placeholder="返工人數"
                value={counts[shift.id] ?? ""}
                onChange={(event) => setCounts({ ...counts, [shift.id]: event.target.value })}
              />
            </li>
          ))}
        </ul>
        <div className="roster-n-actions">
          <button type="submit" className="is-primary" data-testid="assign-by-headcount">一鍵編崗</button>
          <button type="button" data-testid="assign-preview-excel" onClick={onPreviewExcel}>生成 Preview Excel</button>
        </div>
        <p className="roster-n-strategy" data-testid="roster-n-strategy">
          人數多過開崗：全部人留喺編表，填滿開崗之後多餘時間寫 R（後備），唔會加開崗位。人數少過開崗：提示缺幾多，唔會當編成功。
        </p>
        {error && <p className="assign-error" data-testid="assign-error" role="alert">{error}</p>}
        {staffing.pinnedRoster && !error && (
          <p className="assign-note" data-testid="assign-note">{staffing.pinnedRoster.note}</p>
        )}
      </form>
    </section>
  );
}

function numberOr(value: string, fallback: number) {
  if (value.trim() === "") return fallback;
  const next = Number(value);
  if (!Number.isFinite(next)) return fallback;
  return Math.min(100, Math.max(0, Math.round(next)));
}
