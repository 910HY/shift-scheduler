import { Button } from "@/components/ui/button";
import { splitStaffCode } from "@/logic/label";
import { printCell } from "@/logic/scanLink";
import { shiftBoard, shiftOf, slotStarts } from "@/logic/staffing";
import type { ShiftId, StaffingState } from "@/types";

export function PersonSheet({
  staffing,
  date,
  office,
  target,
  cells,
  onClose,
  homeHref,
}: {
  staffing: StaffingState;
  date: string;
  office: string;
  target: { shiftId: ShiftId; rowId: string; code?: string };
  /** Duty cells from the QR link. When set, the page does not look the person up again. */
  cells?: string[] | null;
  onClose?: () => void;
  homeHref?: string;
}) {
  const shift = shiftOf(target.shiftId);
  const slots = slotStarts(target.shiftId);
  const row = cells
    ? { code: target.code ? `${target.shiftId} ${target.code}` : target.rowId, cells }
    : shiftBoard(staffing, target.shiftId).rows.find((item) => item.id === target.rowId);
  const badge = splitStaffCode(row?.code ?? target.code ?? "", target.shiftId);
  return (
    <section className="person-sheet" data-testid="person-sheet" role={onClose ? "dialog" : "region"} aria-label="個人更表">
      <header className="person-sheet-head">
        <div>
          <p className="stat-kicker">個人崗位</p>
          <h2>{badge.label || target.code || target.rowId}</h2>
          <p>
            更 {target.shiftId} · 工號 {badge.code || target.code || "—"} · {shift.start}–{shift.end}
            {target.shiftId === "A" ? "（跨日）" : ""} · {office} · {date}
          </p>
        </div>
        <div className="no-print quick-row">
          <Button type="button" data-testid="print-person" onClick={() => window.print()}>列印</Button>
          {onClose && (
            <Button type="button" variant="outline" onClick={onClose}>返回</Button>
          )}
          {homeHref && (
            <a className="person-home" href={homeHref}>主程式</a>
          )}
        </div>
      </header>
      {row ? (
        <table className="person-table">
          <thead>
            <tr>
              <th>時間</th>
              <th>崗位</th>
            </tr>
          </thead>
          <tbody>
            {slots.map((slot, index) => (
              <tr key={slot}>
                <th>{slot}</th>
                <td>{printCell(row.cells[index] ?? "")}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p>搵唔到呢個人嘅更表。</p>
      )}
    </section>
  );
}
