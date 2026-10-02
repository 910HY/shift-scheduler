import { useEffect, useState } from "react";
import { PersonSheet } from "@/components/PersonSheet";
import { splitStaffCode } from "@/logic/label";
import { dayBoards, FOCUS_BANDS, officeLabel, shiftCovers, shiftOf, shiftsActiveAt } from "@/logic/staffing";
import { findScanPerson, printCell, scanDateIssue, type ScanLink } from "@/logic/scanLink";
import { hongKongClock } from "@/logic/time";
import { useBoard } from "@/state/useBoard";
import type { OfficeId } from "@/types";

export function ScanScreen({ request }: { request: ScanLink }) {
  useEffect(() => {
    const title = !request.ok ? "連結有問題 · 渣板" : request.view === "person" ? "個人崗位 · 渣板" : "主管總覽 · 渣板";
    document.title = title;
    return () => {
      document.title = "渣板";
    };
  }, [request]);

  if (!request.ok) return <ScanError message={request.message} />;
  return <ScanReady request={request} />;
}

function ScanReady({ request }: { request: Exclude<ScanLink, { ok: false }> }) {
  const board = useBoard();
  const staffing = board.state.staffing;
  if (!staffing) return <ScanError message="本機未有編崗，開唔到呢條 link。" />;
  if (request.view === "supervisor") {
    const dateIssue = scanDateIssue(request.date, board.state.date);
    if (dateIssue) return <ScanError message={dateIssue} />;
    return <SupervisorScan staffing={staffing} loc={request.loc} date={request.date} />;
  }
  if (request.cells && request.shift) {
    return (
      <div className="scan-shell" data-testid="scan-person">
        <PersonSheet
          staffing={staffing}
          date={request.date}
          office={officeLabel(request.loc)}
          target={{ shiftId: request.shift, rowId: request.staff, code: request.staff }}
          cells={request.cells}
          homeHref="/"
        />
      </div>
    );
  }
  const dateIssue = scanDateIssue(request.date, board.state.date);
  if (dateIssue) return <ScanError message={dateIssue} />;
  const found = findScanPerson(staffing, request.loc, request.staff, request.shift);
  if (!found.ok) return <ScanError message={found.message} />;
  return (
    <div className="scan-shell" data-testid="scan-person">
      <PersonSheet
        staffing={staffing}
        date={request.date}
        office={officeLabel(request.loc)}
        target={{ shiftId: found.person.shiftId, rowId: found.person.rowId, code: found.person.code }}
        homeHref="/"
      />
    </div>
  );
}

function SupervisorScan({
  staffing,
  loc,
  date,
}: {
  staffing: NonNullable<ReturnType<typeof useBoard>["state"]["staffing"]>;
  loc: OfficeId;
  date: string;
}) {
  const clock = useHongKongClock();
  const [slices, setSlices] = useState<ReturnType<typeof dayBoards> | null>(null);
  useEffect(() => {
    let cancelled = false;
    const timer = window.setTimeout(() => {
      const next = dayBoards({ ...staffing, officeId: loc }).filter((slice) => slice.rows.length > 0);
      if (!cancelled) setSlices(next);
    }, 0);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [staffing, loc]);
  const active = shiftsActiveAt(clock.hhmm);
  return (
    <div className="scan-shell scan-overview" data-testid="scan-supervisor">
      <header className="scan-overview-head">
        <p className="stat-kicker">主管總覽 · 只讀</p>
        <h1 data-testid="office-scope">{officeLabel(loc)}</h1>
        <p>{date}</p>
        <p data-testid="live-clock">而家（香港） {clock.hms}</p>
        <p data-testid="scan-active">而家在崗：{active.length ? active.join("、") : "沒有更"}</p>
        <p className="qr-note">試玩／內網連結，冇登入。呢頁只睇，改崗請返主程式。</p>
        <a className="no-print person-home" href="/">主程式</a>
      </header>
      <div className="focus-band" aria-label="準備邊個更" data-testid="focus-band">
        {FOCUS_BANDS.map((band) => {
          const shift = shiftOf(band.id);
          const on = shiftCovers(band.id, clock.hhmm);
          return (
            <p key={band.id} data-testid={`focus-${band.id}`} data-shift={band.id} className={on ? "is-on" : ""}>
              <strong>{band.id}</strong>
              <span>{shift.start}–{shift.end}{band.id === "A" ? " 跨日" : ""}</span>
              {on && <em>而家</em>}
            </p>
          );
        })}
      </div>
      {slices === null && <p className="scan-error-copy">編緊全日總覽…</p>}
      {slices?.length === 0 && <p className="scan-error-copy">呢個區未有編崗。</p>}
      {slices?.map((slice) => (
        <section key={slice.shiftId} className="scan-shift" data-testid="scan-shift" data-shift={slice.shiftId}>
          <h2>
            {slice.shiftId} · {shiftOf(slice.shiftId).start}–{shiftOf(slice.shiftId).end}
            {slice.shiftId === "A" ? "（跨日）" : ""}
          </h2>
          {slice.rows.map((row) => {
            const badge = splitStaffCode(row.code, slice.shiftId);
            return (
              <article key={row.id} className="scan-person-card" data-testid="scan-person-row">
                <span className="staff-id" data-shift={slice.shiftId}>
                  <span className="staff-shift">{badge.shift || slice.shiftId}</span>
                  <span className="staff-code">{badge.code || badge.label}</span>
                </span>
                <div className="scan-slots">
                  {slice.slots.map((slot, index) => (
                    <span key={slot} className={cellTone(row.cells[index] ?? "")}>
                      <small>{slot}</small>
                      <b>{printCell(row.cells[index] ?? "")}</b>
                    </span>
                  ))}
                </div>
              </article>
            );
          })}
        </section>
      ))}
    </div>
  );
}

function ScanError({ message }: { message: string }) {
  return (
    <main className="scan-shell scan-error" data-testid="scan-error">
      <p className="stat-kicker">掃碼連結</p>
      <h1>呢條 link 開唔到</h1>
      <p className="scan-error-copy">{message}</p>
      <a className="person-home" href="/">返回主程式</a>
    </main>
  );
}

function cellTone(value: string) {
  if (value === "R") return "cell is-r";
  if (value === "B" || value === "MB") return "cell is-b";
  if (value.startsWith("Apc")) return "cell is-apc";
  if (value.startsWith("on loan to ") || value === "早走") return "cell is-loan";
  if (!value) return "cell is-empty";
  return "cell";
}

function useHongKongClock() {
  const [clock, setClock] = useState(() => hongKongClock());
  useEffect(() => {
    const timer = window.setInterval(() => setClock(hongKongClock()), 1000);
    return () => window.clearInterval(timer);
  }, []);
  return clock;
}
