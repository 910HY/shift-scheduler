import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { assignStaff } from "@/logic/board";
import { buildPreviewWorkbook } from "@/logic/previewXlsx";
import { nowPlace, presenceTotals } from "@/logic/presence";
import {
  EARLY_CELL,
  OFFICES,
  PERCENT_SHORTCUTS,
  SHIFTS,
  absorbShown,
  addOpenPosts,
  apcPosts,
  applyEarlyLeave,
  bookKey,
  checkRoster,
  combinedRoster,
  createLoan,
  crewFor,
  defaultRules,
  extremeNotes,
  extremeRules,
  isExtreme,
  isLoanMarker,
  officeFocus,
  officeLabel,
  officeOf,
  offClockWarning,
  openPostCodes,
  parseOverlapRowId,
  previewFilename,
  previewRows,
  projectBoard,
  reflowOffice,
  revokeLoan,
  rosterRows,
  setCell,
  setLoanEnd,
  setOffice,
  setOpenCounts,
  setPercent,
  setRowAllows,
  setRules,
  setShift,
  shiftOf,
  shiftRoster,
  shiftsActiveAt,
  shortageAdvice,
  siteCapacity,
  siteOverview,
  slotIndexAt,
  slotStarts,
} from "@/logic/staffing";
import { useBoard } from "@/state/useBoard";
import type { OfficeId, PostKind, RosterRow, RuleSettings, ShiftId, StaffingState } from "@/types";

const KINDS: { id: PostKind; label: string }[] = [
  { id: "counter", label: "櫃位" },
  { id: "apc", label: "APC" },
  { id: "kiosk", label: "Kiosk" },
];

export function StaffingScreen() {
  const board = useBoard();
  const state = board.state;
  const staffing = state.staffing;
  const narrow = useNarrow();
  const [view, setView] = useState<"now" | "sheet">("now");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [draft, setDraft] = useState<RosterRow[] | null>(null);
  const [hint, setHint] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedPostId, setSelectedPostId] = useState<string | null>(null);
  const [editor, setEditor] = useState<{ rowId: string; index: number; value: string; shiftId?: ShiftId; nativeIndex: number } | null>(null);
  const [loanOpen, setLoanOpen] = useState(false);
  const [earlyOpen, setEarlyOpen] = useState(false);
  const [siteOpen, setSiteOpen] = useState(false);
  const [shiftOpen, setShiftOpen] = useState(false);

  if (!staffing) return null;

  const shown = projectBoard(state);
  const focus = officeFocus(state) ?? { label: officeLabel(staffing.officeId), ...presenceTotals(shown), onSite: 0, onduty: 0, rest: 0, filled: 0, total: 0 };
  const presence = focus;
  const site = siteOpen ? siteOverview(state) : null;
  const overlap = combinedRoster(staffing);
  const slots = overlap.slots;
  const nativeSlots = slotStarts(staffing.shiftId);
  const slotAt = slotIndexAt(nativeSlots, state.now);
  const liveRows = rosterRows(staffing, staffing.officeId);
  const rows = draft ?? overlap.rows;
  const activeNow = shiftsActiveAt(state.now);
  const previewBook = draft ? shiftRoster(staffing, staffing.shiftId, "preview") : null;
  const checkState = previewBook
    ? { ...staffing, books: { ...staffing.books, [bookKey(staffing.officeId, staffing.shiftId, staffing.counters, staffing.apc, staffing.kiosks)]: previewBook } }
    : staffing;
  const issues = checkRoster(checkState).filter((issue) => issue.level === "error");
  const crew = crewFor(staffing);
  const advice = shortageAdvice(staffing, state.now);
  const offClock = offClockWarning(state.now, staffing.shiftId);
  const selectedSheet = rows.find((row) => rowMatches(row.id, selectedId)) ?? null;
  const selected = editableRow(selectedSheet, staffing.shiftId);
  const extreme = isExtreme(staffing.rules, staffing.shiftId);
  const currentShift = shiftOf(staffing.shiftId);

  function say(text: string) {
    setHint(text);
  }

  function addPosts(kind: PostKind, count: number) {
    board.replace(addOpenPosts(state, kind, count));
    setDraft(null);
  }

  async function downloadPreview() {
    const next = previewRows(staffing!);
    setDraft(next);
    setView("sheet");
    const buffer = await buildPreviewWorkbook(staffing!, next);
    const blob = new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = previewFilename(staffing!);
    link.click();
    URL.revokeObjectURL(link.href);
    say("已下載草稿。未按確認套用之前，正式編崗不變。");
  }

  function confirmDraft() {
    const result = reflowOffice(state);
    if (!result.ok) {
      say(result.reason);
      return;
    }
    board.replace(result.state);
    setDraft(null);
    say("已套用這張 preview。");
  }

  function openEditor(rowId: string, index: number, value: string) {
    const parsed = parseOverlapRowId(rowId);
    if (!parsed) {
      setEditor({ rowId, index, value, nativeIndex: index });
      return;
    }
    const nativeIndex = slotStarts(parsed.shiftId).indexOf(slots[index] ?? "");
    if (nativeIndex < 0) return;
    setEditor({ rowId: parsed.rowId, index, value, shiftId: parsed.shiftId, nativeIndex });
  }

  function saveCell() {
    if (!editor || draft) return;
    board.replace(setCell(state, editor.rowId, editor.nativeIndex, editor.value, editor.shiftId));
    setEditor(null);
  }

  function place(staffId: string, postId: string | null) {
    const result = assignStaff(shown, staffId, postId);
    if (!result.ok) {
      say(result.reason);
      return;
    }
    board.replace(absorbShown(state, result.state));
    setSelectedPostId(postId);
    setSelectedId(staffId);
  }

  const settings = (
    <SettingsPanel
      staffing={staffing}
      selected={selected}
      issues={issues}
      extreme={extreme}
      onRules={(rules) => board.replace(setRules(state, rules))}
      onNormal={() => board.replace(setRules(state, defaultRules(staffing.shiftId)))}
      onExtreme={() => board.replace(setRules(state, extremeRules(staffing.shiftId)))}
      onAllows={(allows) => selected && board.replace(setRowAllows(state, selected.id, allows))}
      onOpenLoan={() => setLoanOpen(true)}
      onOpenEarly={() => setEarlyOpen(true)}
      onRevoke={(id) => board.replace(revokeLoan(state, id))}
      onLoanEnd={(id, end) => board.replace(setLoanEnd(state, id, end))}
      onCounts={(patch) => board.replace(setOpenCounts(state, patch))}
    />
  );

  return (
    <div className="v10-shell">
      <header className="topbar flex flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3">
        <div>
          <h1 data-testid="office-scope">{focus.label}</h1>
          <input
            type="date"
            aria-label="日期"
            value={state.date}
            onChange={(event) => board.replace({ ...state, date: event.target.value })}
            className="date-input"
          />
        </div>
        <div className="ml-auto flex flex-wrap items-end gap-x-6 gap-y-2">
          <div data-testid="on-site-count">
            <p className="stat-kicker">{focus.label} · 現在在場</p>
            <p className="presence-num">{presence.onSite}</p>
            <p className="stat-kicker" data-testid="presence-split">
              在崗 {presence.onduty} · 休息 {presence.rest}
            </p>
          </div>
          <div data-testid="post-count">
            <p className="stat-kicker">{focus.label} · 崗位</p>
            <p className="post-num">
              {presence.filled}／{presence.total}
            </p>
          </div>
          <label>
            <p className="stat-kicker">現場</p>
            <input
              type="time"
              aria-label="現場時刻"
              data-testid="board-clock"
              value={state.now}
              onChange={(event) => board.replace({ ...state, now: event.target.value })}
              className="clock-input"
            />
          </label>
        </div>
      </header>

      <section className="ops-bar" aria-label="開崗">
        <div className="ops-offices span-2" role="tablist" aria-label="區">
          {OFFICES.map((office) => (
            <button
              key={office.id}
              type="button"
              role="tab"
              aria-selected={staffing.officeId === office.id}
              data-testid={`office-${office.id}`}
              className={staffing.officeId === office.id ? "is-on" : ""}
              onClick={() => {
                board.replace(setOffice(state, office.id));
                setDraft(null);
                setSelectedId(null);
              }}
            >
              {office.label}
            </button>
          ))}
        </div>
        <div className="ops-shift span-2">
          <span className="ops-shift-label" id="shift-label">更</span>
          <button
            type="button"
            className="ops-shift-trigger"
            data-testid="shift-select"
            aria-labelledby="shift-label"
            aria-haspopup="dialog"
            aria-expanded={shiftOpen}
            onClick={() => setShiftOpen(true)}
          >
            <span className="ops-shift-copy">
              <span className="ops-shift-id">{currentShift.id}</span>
              <span className="ops-shift-time">{currentShift.start}–{currentShift.end}</span>
            </span>
            <span className="ops-shift-chevron" aria-hidden="true">▾</span>
          </button>
        </div>
        <div className="ops-percents span-2" role="group" aria-label="開崗百分比">
          {PERCENT_SHORTCUTS.map((percent) => (
            <button
              key={percent}
              type="button"
              data-testid={`percent-${percent}`}
              className={staffing.percent === percent ? "is-on" : ""}
              onClick={() => {
                board.replace(setPercent(state, percent));
                setDraft(null);
              }}
            >
              {percent}%
            </button>
          ))}
        </div>
        <div
          className={`ops-metrics span-2 ${officeOf(staffing.officeId).kind === "hall" ? "is-hall" : "is-kiosk"}`}
          data-testid="ops-metrics"
        >
          <label className="ops-metric">
            <span className="ops-metric-label">自訂％</span>
            <input
              type="number"
              min={0}
              max={100}
              step={1}
              inputMode="numeric"
              aria-label="自訂開崗百分比"
              data-testid="percent-custom"
              value={staffing.percent ?? ""}
              placeholder="例如 40"
              onChange={(event) => {
                if (event.target.value === "") return;
                board.replace(setPercent(state, Number(event.target.value)));
                setDraft(null);
              }}
            />
          </label>
          {officeOf(staffing.officeId).kind === "hall" ? (
            <>
              <label className="ops-metric">
                <span className="ops-metric-label">櫃位</span>
                <input
                  aria-label="櫃位數"
                  data-testid="open-counters"
                  type="number"
                  min={0}
                  inputMode="numeric"
                  value={staffing.counters}
                  onChange={(event) => {
                    board.replace(setOpenCounts(state, { counters: numberOrZero(event.target.value) }));
                    setDraft(null);
                  }}
                />
              </label>
              <label className="ops-metric">
                <span className="ops-metric-label">APC</span>
                <input
                  aria-label="APC 崗數"
                  data-testid="open-apc"
                  type="number"
                  min={0}
                  inputMode="numeric"
                  value={staffing.apc}
                  onChange={(event) => {
                    board.replace(setOpenCounts(state, { apc: numberOrZero(event.target.value) }));
                    setDraft(null);
                  }}
                />
              </label>
            </>
          ) : (
            <label className="ops-metric">
              <span className="ops-metric-label">Kiosk</span>
              <input
                aria-label="Kiosk 數"
                data-testid="open-kiosks"
                type="number"
                min={0}
                inputMode="numeric"
                value={staffing.kiosks}
                onChange={(event) => {
                  board.replace(setOpenCounts(state, { kiosks: numberOrZero(event.target.value) }));
                  setDraft(null);
                }}
              />
            </label>
          )}
        </div>
        <div className="ops-add-posts span-2" role="group" aria-label="臨時加崗位">
          {officeOf(staffing.officeId).kind === "hall" ? (
            <>
              <button type="button" data-testid="add-counter" onClick={() => addPosts("counter", 1)}>+1 櫃位</button>
              <button type="button" data-testid="add-counters" onClick={() => addPosts("counter", 2)}>+2 櫃位</button>
              <button type="button" data-testid="add-apc" onClick={() => addPosts("apc", 1)}>+1 APC</button>
            </>
          ) : (
            <>
              <button type="button" data-testid="add-kiosk" onClick={() => addPosts("kiosk", 1)}>+1 Kiosk</button>
              <button type="button" data-testid="add-kiosks" onClick={() => addPosts("kiosk", 2)}>+2 Kiosk</button>
            </>
          )}
        </div>
        <div className="ops-open-strip span-2">
          <OpenTotals staffing={staffing} compact />
        </div>
        <div className="ops-crew span-2" data-testid="crew-count">
          <div className="ops-crew-main">
            <span className="ops-crew-label">共需人手</span>
            <strong>{crew}</strong>
          </div>
          <div className="ops-crew-meta">
            <span>同時開 {openPostCodes(staffing.officeId, staffing).length} 崗</span>
            <span data-testid="preview-name">{previewFilename(staffing)}</span>
          </div>
        </div>
        <div className="ops-actions span-2">
          <button type="button" data-testid="view-now" className={view === "now" ? "is-on" : ""} onClick={() => setView("now")}>
            現在
          </button>
          <button type="button" data-testid="view-sheet" className={view === "sheet" ? "is-on" : ""} onClick={() => setView("sheet")}>
            編崗
          </button>
          <button type="button" data-testid="preview-excel" className="is-primary" onClick={() => void downloadPreview()}>
            生成 Preview Excel
          </button>
          {narrow && (
            <button type="button" data-testid="open-settings" onClick={() => setSettingsOpen(true)}>
              規則／借調／早走
            </button>
          )}
        </div>
      </section>

      <p className="shortage" data-testid="shortage">{advice.text}</p>
      {offClock && <p className="off-clock" data-testid="off-clock">{offClock}</p>}
      <p className="overlap-note" data-testid="overlap-shifts">
        同時段 {overlap.shifts.join("、")}。崗位一個池。{state.now} 仍在崗：{activeNow.length ? activeNow.join("、") : "沒有更"}
      </p>
      {(hint || board.notice) && <p className="board-notice px-4 py-2 text-sm">{hint || board.notice}</p>}
      {extreme && (
        <p className="extreme-banner" data-testid="extreme-banner">
          極端規則：{extremeNotes(staffing.rules, staffing.shiftId).join("；") || "已偏離這更的預設。"}
        </p>
      )}
      {draft && (
        <div className="draft-banner" data-testid="draft-banner">
          <p>這是草稿 preview，未當正式更表。畫面上的「現在」仍用正式編崗。</p>
          <div>
            <Button type="button" data-testid="confirm-draft" onClick={confirmDraft}>確認套用</Button>
            <Button type="button" variant="outline" onClick={() => { setDraft(null); say("已放棄草稿。"); }}>放棄</Button>
          </div>
        </div>
      )}
      {issues.length > 0 && (
        <ul className="issue-list" data-testid="issue-list">
          {issues.slice(0, 4).map((issue) => (
            <li key={`${issue.rule}-${issue.message}`}><span className="dot" />{issue.message}</li>
          ))}
        </ul>
      )}

      <div className="v10-body">
        <main>
          {offClock && <p className="off-clock-floor">{offClock}</p>}
          {view === "now" ? (
            <NowFloor
              shown={shown}
              rows={liveRows}
              slotAt={slotAt}
              clockNote={slotAt >= 0 ? `這一格 ${nativeSlots[slotAt]}。點人再點空崗，即可對調。` : `${state.now} 不在 ${staffing.shiftId}。仍在崗：${activeNow.join("、") || "沒有更"}`}
              selectedId={selectedId}
              selectedPostId={selectedPostId}
              onSelectPost={(postId) => setSelectedPostId(postId)}
              onSelectPerson={(id) => setSelectedId(id)}
              onPlace={place}
            />
          ) : narrow ? (
            <StaffCards rows={rows} slots={slots} issues={issues.map((issue) => issue.message)} onEdit={openEditor} onSelect={setSelectedId} selectedId={selectedId} />
          ) : (
            <RosterTable rows={rows} slots={slots} issues={issues.map((issue) => issue.message)} onEdit={openEditor} onSelect={setSelectedId} selectedId={selectedId} />
          )}
        </main>
        {!narrow && <aside className="v10-side">{settings}</aside>}
      </div>

      {narrow && settingsOpen && (
        <div className="sheet" role="dialog" aria-label="規則、借調、早走" data-testid="settings-sheet">
          <div className="sheet-head">
            <strong>規則／借調／早走</strong>
            <Button type="button" variant="outline" onClick={() => setSettingsOpen(false)}>關閉</Button>
          </div>
          {settings}
        </div>
      )}

      {editor && (
        <dialog className="plain-dialog" open data-testid="cell-editor">
          <form
            onSubmit={(event) => {
              event.preventDefault();
              saveCell();
            }}
          >
            <h2>改 {slots[editor.index]}</h2>
            <input aria-label="格值" value={editor.value} onChange={(event) => setEditor({ ...editor, value: event.target.value })} />
            <div className="quick-row">
              {["R", "B", "MB", EARLY_CELL].map((token) => (
                <button key={token} type="button" onClick={() => setEditor({ ...editor, value: token })}>{token}</button>
              ))}
            </div>
            <div className="quick-row">
              <Button type="submit" disabled={draft != null}>儲存</Button>
              <Button type="button" variant="outline" onClick={() => setEditor(null)}>取消</Button>
            </div>
            {draft && <p>草稿未套用，不能直接改格。</p>}
          </form>
        </dialog>
      )}

      {shiftOpen && (
        <dialog className="plain-dialog shift-picker-dialog" open data-testid="shift-sheet" aria-label="揀更">
          <div className="sheet-head">
            <strong>揀更</strong>
            <Button type="button" variant="outline" onClick={() => setShiftOpen(false)}>關閉</Button>
          </div>
          <div className="ops-shift-list" role="listbox" aria-label="更">
            {SHIFTS.map((shift) => (
              <button
                key={shift.id}
                type="button"
                role="option"
                aria-selected={staffing.shiftId === shift.id}
                data-testid={`shift-option-${shift.id}`}
                className={staffing.shiftId === shift.id ? "is-on" : ""}
                onClick={() => {
                  board.replace(setShift(state, shift.id));
                  setDraft(null);
                  setShiftOpen(false);
                }}
              >
                <strong>{shift.id}</strong>
                <span>{shift.start}–{shift.end}</span>
              </button>
            ))}
          </div>
        </dialog>
      )}

      {loanOpen && (
        <LoanDialog
          rows={liveRows}
          currentOffice={staffing.officeId}
          onClose={() => setLoanOpen(false)}
          onSubmit={(input) => {
            let next = state;
            const sent: string[] = [];
            for (const personId of input.personIds) {
              const result = createLoan(next, { personId, toOffice: input.toOffice, start: input.start, end: input.end });
              if (!result.ok) {
                say(result.reason);
                return;
              }
              next = result.state;
              const code = input.rows.find((row) => row.id === personId)?.code ?? personId;
              sent.push(code);
            }
            board.replace(next);
            setLoanOpen(false);
            say(`已借 ${sent.join("、")} 去 ${officeLabel(input.toOffice)}。`);
          }}
        />
      )}

      {earlyOpen && (
        <EarlyDialog
          rows={liveRows}
          currentOffice={staffing.officeId}
          onClose={() => setEarlyOpen(false)}
          onSubmit={(input) => {
            const result = applyEarlyLeave(state, input);
            if (!result.ok) {
              say(result.reason);
              return;
            }
            board.replace(result.state);
            setEarlyOpen(false);
            say(result.note);
          }}
        />
      )}

      {site && (
        <section className="site-overview" data-testid="site-overview">
          <h2>全場總覽</h2>
          <ul>
            {site.offices.map((office) => (
              <li key={office.officeId}>
                {office.label}：現在 {office.onSite}，崗位 {office.filled}／{office.total}，共需 {office.crew}
              </li>
            ))}
          </ul>
          <p>
            全場合計：現在 {site.onSite}，崗位 {site.filled}／{site.total}，共需 {site.crew}。開滿容量 {siteCapacity(staffing.counterMax, staffing.gates, staffing.gatesPerPost, staffing.kioskMax)} 崗。
          </p>
        </section>
      )}

      <footer className="v10-foot">
        <Button type="button" variant="outline" onClick={board.resetDemo}>回復示範</Button>
        <Button type="button" variant="outline" data-testid="site-overview-toggle" onClick={() => setSiteOpen((open) => !open)}>
          {siteOpen ? "返回本區" : "全場總覽"}
        </Button>
        <span>APC {apcPosts(staffing.gates, staffing.gatesPerPost)}（{staffing.gates} 閘 ÷ {staffing.gatesPerPost}）</span>
      </footer>
    </div>
  );
}

function NowFloor({
  shown,
  rows,
  slotAt,
  clockNote,
  selectedId,
  selectedPostId,
  onSelectPost,
  onSelectPerson,
  onPlace,
}: {
  shown: ReturnType<typeof projectBoard>;
  rows: RosterRow[];
  slotAt: number;
  clockNote: string;
  selectedId: string | null;
  selectedPostId: string | null;
  onSelectPost: (id: string) => void;
  onSelectPerson: (id: string) => void;
  onPlace: (staffId: string, postId: string | null) => void;
}) {
  const resting = shown.staff.filter((person) => nowPlace(shown, person) === "mb" || nowPlace(shown, person) === "r");
  const away = shown.staff.filter((person) => nowPlace(shown, person) === "sl" || nowPlace(shown, person) === "uvl");
  const stillOn = shown.staff.filter((person) => person.id.startsWith("ov:") && nowPlace(shown, person) === "stand" && !shown.posts.some((post) => post.assigneeId === person.id));
  const outgoing = slotAt < 0 ? [] : rows.filter((row) => isLoanMarker(row.cells[slotAt] ?? ""));
  const zoned = new Set(shown.zones.map((zone) => zone.id));
  const loose = shown.posts.filter((post) => !zoned.has(post.zoneId));
  const bay = (post: (typeof shown.posts)[number]) => {
    const person = shown.staff.find((item) => item.id === post.assigneeId);
    const place = person ? nowPlace(shown, person) : "off";
    const tone = person ? (place === "stand" ? "is-onduty" : "is-break") : "is-vacant";
    return (
      <button
        key={post.id}
        type="button"
        data-testid="floor-bay"
        className={`bay ${tone} ${selectedPostId === post.id ? "is-selected" : ""}`}
        onClick={() => {
          onSelectPost(post.id);
          if (person) onSelectPerson(person.id);
          else if (selectedId) onPlace(selectedId, post.id);
        }}
      >
        <span className="bay-code">{post.name}</span>
        <span className="bay-sub">{person ? person.code : "空"}{person?.id.startsWith("loan:") ? " 借" : ""}</span>
      </button>
    );
  };
  return (
    <div className="now-wrap" data-testid="floor-board">
      <p className="floor-status" data-testid="floor-status">
        場地 {shown.posts.length} 崗
      </p>
      {shown.zones.map((zone) => (
        <section key={zone.id}>
          <h2>{zone.title}</h2>
          <div className="now-grid">
            {shown.posts.filter((post) => post.zoneId === zone.id).map(bay)}
          </div>
        </section>
      ))}
      {loose.length > 0 && (
        <section>
          <h2>崗位</h2>
          <div className="now-grid">{loose.map(bay)}</div>
        </section>
      )}
      {stillOn.length > 0 && (
        <section data-testid="other-shifts-on-duty">
          <h2>其他更仍在崗</h2>
          <div className="chip-row">
            {stillOn.map((person) => (
              <button key={person.id} type="button" className="person-chip is-onduty" onClick={() => onSelectPerson(person.id)}>
                {person.code}{person.dutyPost ? ` · ${person.dutyPost}` : ""}
              </button>
            ))}
          </div>
        </section>
      )}
      <section>
        <h2>休息</h2>
        <div className="chip-row">
          {resting.map((person) => (
            <button key={person.id} type="button" className="person-chip" onClick={() => {
              onSelectPerson(person.id);
              if (selectedPostId) onPlace(person.id, selectedPostId);
            }}>
              {person.code} {nowPlace(shown, person) === "mb" ? "MB" : "R"}
            </button>
          ))}
          {resting.length === 0 && <p>這一格沒有人在休息。</p>}
        </div>
      </section>
      {(away.length > 0 || outgoing.length > 0) && (
        <section>
          <h2>不在本區崗</h2>
          <div className="chip-row">
            {away.map((person) => <span key={person.id} className="person-chip is-away">{person.code} 早走</span>)}
            {outgoing.map((row) => (
              <span key={row.id} className="person-chip is-loan" data-testid="loaned-out" title={row.cells[slotAt]}>
                {row.code} 借出
              </span>
            ))}
          </div>
        </section>
      )}
      <p className="hint-line">{clockNote}</p>
    </div>
  );
}

function RosterTable({
  rows,
  slots,
  issues,
  selectedId,
  onSelect,
  onEdit,
}: {
  rows: RosterRow[];
  slots: string[];
  issues: string[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onEdit: (rowId: string, index: number, value: string) => void;
}) {
  return (
    <div className="roster-scroll" data-testid="roster-table">
      <table>
        <thead>
          <tr>
            <th>員工</th>
            {slots.map((slot) => <th key={slot}>{slot}</th>)}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id} className={rowMatches(row.id, selectedId) ? "is-selected" : ""}>
              <th>
                <button type="button" onClick={() => onSelect(row.id)}>
                  {issues.some((issue) => mentionsCode(row.code, issue)) && <span className="dot" />}
                  {row.id.startsWith("loan:") && <span className="loan-in">借</span>}
                  {row.code}
                </button>
              </th>
              {row.cells.map((cell, index) => (
                <td key={`${row.id}-${slots[index]}`}>
                  <button type="button" className={cellTone(cell)} onClick={() => onEdit(row.id, index, cell)}>
                    {cell || "—"}
                  </button>
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function StaffCards({
  rows,
  slots,
  issues,
  selectedId,
  onSelect,
  onEdit,
}: {
  rows: RosterRow[];
  slots: string[];
  issues: string[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onEdit: (rowId: string, index: number, value: string) => void;
}) {
  return (
    <div className="staff-cards" data-testid="staff-cards">
      {rows.map((row) => {
        const problem = issues.find((issue) => mentionsCode(row.code, issue));
        return (
          <article key={row.id} className={rowMatches(row.id, selectedId) ? "is-selected" : ""}>
            <header>
              <button type="button" onClick={() => onSelect(row.id)}>
                {problem && <span className="dot" />}
                {row.id.startsWith("loan:") && <span className="loan-in">借</span>}
                <strong>{row.code}</strong>
              </button>
              {row.cells.some((cell) => isLoanMarker(cell)) && <span className="loan-out">on loan</span>}
            </header>
            {problem && <p className="person-issue">{problem}</p>}
            <div className="timeline">
              {slots.map((slot, index) => (
                <button key={slot} type="button" className={cellTone(row.cells[index] ?? "")} onClick={() => onEdit(row.id, index, row.cells[index] ?? "")}>
                  <small>{slot}</small>
                  <b>{row.cells[index] || "—"}</b>
                </button>
              ))}
            </div>
          </article>
        );
      })}
    </div>
  );
}

function SettingsPanel({
  staffing,
  selected,
  issues,
  extreme,
  onRules,
  onNormal,
  onExtreme,
  onAllows,
  onOpenLoan,
  onOpenEarly,
  onRevoke,
  onLoanEnd,
  onCounts,
}: {
  staffing: NonNullable<ReturnType<typeof useBoard>["state"]["staffing"]>;
  selected: RosterRow | null;
  issues: { message: string }[];
  extreme: boolean;
  onRules: (rules: RuleSettings) => void;
  onNormal: () => void;
  onExtreme: () => void;
  onAllows: (allows: PostKind[]) => void;
  onOpenLoan: () => void;
  onOpenEarly: () => void;
  onRevoke: (id: string) => void;
  onLoanEnd: (id: string, end: string | null) => void;
  onCounts: (patch: { counters?: number; apc?: number; kiosks?: number; gates?: number; gatesPerPost?: number }) => void;
}) {
  const rules = staffing.rules;
  const officeLoans = staffing.loans.filter((loan) => loan.shiftId === staffing.shiftId && (loan.fromOffice === staffing.officeId || loan.toOffice === staffing.officeId));
  return (
    <div className="settings">
      <h2>規則</h2>
      <div className="quick-row">
        <button type="button" data-testid="rules-normal" className={!extreme ? "is-on" : ""} onClick={onNormal}>正常</button>
        <button type="button" data-testid="rules-extreme" className={extreme ? "is-on" : ""} onClick={onExtreme}>極端</button>
      </div>
      <div className="rules-list" role="group" aria-label="規則開關">
        <label className="check-row"><input type="checkbox" data-testid="rule-scatter" checked={rules.scatterRest} onChange={(event) => onRules({ ...rules, scatterRest: event.target.checked })} />日間 R 拆散</label>
        <label className="check-row"><input type="checkbox" checked={rules.stickyPost} onChange={(event) => onRules({ ...rules, stickyPost: event.target.checked })} />粘崗</label>
        <label className="check-row"><input type="checkbox" checked={rules.returnAfterRest} onChange={(event) => onRules({ ...rules, returnAfterRest: event.target.checked })} />R 後返原崗</label>
        <label className="check-row"><input type="checkbox" checked={rules.respectPreference} onChange={(event) => onRules({ ...rules, respectPreference: event.target.checked })} />跟員工喜好</label>
        <label className="check-row"><input type="checkbox" checked={rules.limitConsecutive} onChange={(event) => onRules({ ...rules, limitConsecutive: event.target.checked })} />連續做上限</label>
        <label className="check-row"><input type="checkbox" checked={rules.applyMeal} onChange={(event) => onRules({ ...rules, applyMeal: event.target.checked })} />計 meal</label>
        <label className="check-row"><input type="checkbox" checked={rules.requireBigRest} onChange={(event) => onRules({ ...rules, requireBigRest: event.target.checked })} />A 大休</label>
      </div>
      <label className="num-row">連續做上限（小時）<input type="number" min={0.5} step={0.5} value={rules.maxConsecutiveHours} onChange={(event) => onRules({ ...rules, maxConsecutiveHours: Number(event.target.value) })} /></label>
      <label className="num-row">日間休息轉數<input type="number" min={0} step={1} value={rules.restTurns} onChange={(event) => onRules({ ...rules, restTurns: Number(event.target.value) })} /></label>
      <h2>開崗數</h2>
      <OpenTotals staffing={staffing} />
      <label className="num-row">櫃位<input aria-label="櫃位數" type="number" min={0} value={staffing.counters} onChange={(event) => onCounts({ counters: Number(event.target.value) })} /></label>
      <label className="num-row">APC<input aria-label="APC 崗數" type="number" min={0} value={staffing.apc} onChange={(event) => onCounts({ apc: Number(event.target.value) })} /></label>
      <label className="num-row">Kiosk<input aria-label="Kiosk 數" type="number" min={0} value={staffing.kiosks} onChange={(event) => onCounts({ kiosks: Number(event.target.value) })} /></label>
      <label className="num-row">閘數<input aria-label="閘數" type="number" min={0} value={staffing.gates} onChange={(event) => onCounts({ gates: Number(event.target.value) })} /></label>
      <h2>喜好</h2>
      {selected ? (
        <>
          <p className="pref-hint is-ready" data-testid="preference-hint">正在設 <strong>{selected.code}</strong> 嘅喜好</p>
          <PreferenceChips allows={selected.allows} onChange={onAllows} />
        </>
      ) : (
        <p className="pref-hint" data-testid="preference-hint">
          喜好要先揀人：喺「現在」或「編崗」點選員工，再返嚟設櫃位／APC／Kiosk。
        </p>
      )}
      <h2>借調／早走</h2>
      <div className="quick-row">
        <button type="button" data-testid="loan-open" onClick={onOpenLoan}>借調</button>
        <button type="button" data-testid="early-open" onClick={onOpenEarly}>早走</button>
      </div>
      <ul className="loan-list">
        {officeLoans.map((loan) => (
          <li key={loan.id}>
            <span>{loan.personCode}：{officeLabel(loan.fromOffice)} → {officeLabel(loan.toOffice)} {loan.start}–{loan.end ?? "收工"}</span>
            <input aria-label={`${loan.personCode} 結束時間`} type="time" value={loan.end ?? ""} onChange={(event) => onLoanEnd(loan.id, event.target.value || null)} />
            <button type="button" onClick={() => onRevoke(loan.id)}>撤銷</button>
          </li>
        ))}
        {officeLoans.length === 0 && <li>這一更未有借調。</li>}
      </ul>
      {issues.length > 0 && <p className="person-issue">{issues[0]?.message}</p>}
    </div>
  );
}


function OpenTotals({ staffing, compact = false }: { staffing: StaffingState; compact?: boolean }) {
  const hall = officeOf(staffing.officeId).kind === "hall";
  // Zone-relevant open counts (Hall has no Kiosk posts; Kiosk office has no 櫃位/APC).
  const parts = hall
    ? [
        { key: "counter", label: "櫃位", value: staffing.counters },
        { key: "apc", label: "APC", value: staffing.apc },
      ]
    : [{ key: "kiosk", label: "Kiosk", value: staffing.kiosks }];
  const summary = parts.map((part) => `${part.value} ${part.label}`).join(" · ");
  const pctNote = staffing.percent != null ? `${staffing.percent}%` : "自訂";
  return (
    <div className={`open-totals${compact ? " is-compact" : ""}`} data-testid="open-totals" aria-label={`本期開崗 ${summary}`}>
      {!compact && <p className="open-totals-label">本期開崗（{pctNote}）：{summary}</p>}
      {compact && <span className="open-totals-label">本期開崗</span>}
      {parts.map((part) => (
        <span key={part.key} className="open-totals-chip">
          <strong>{part.value}</strong> {part.label}
        </span>
      ))}
    </div>
  );
}

function PreferenceChips({ allows, onChange }: { allows: PostKind[]; onChange: (allows: PostKind[]) => void }) {
  function toggle(kind: PostKind) {
    if (!allows.length) {
      onChange([kind]);
      return;
    }
    const next = allows.includes(kind) ? allows.filter((item) => item !== kind) : [...allows, kind];
    onChange(next);
  }
  return (
    <div className="quick-row" data-testid="preference-chips">
      <button type="button" className={!allows.length ? "is-on" : ""} onClick={() => onChange([])}>不限</button>
      {KINDS.map((kind) => (
        <button key={kind.id} type="button" className={allows.includes(kind.id) ? "is-on" : ""} onClick={() => toggle(kind.id)}>
          {kind.label}
        </button>
      ))}
    </div>
  );
}

function LoanDialog({
  rows,
  currentOffice,
  onClose,
  onSubmit,
}: {
  rows: RosterRow[];
  currentOffice: OfficeId;
  onClose: () => void;
  onSubmit: (input: { personIds: string[]; toOffice: OfficeId; start: string; end: string | null; rows: RosterRow[] }) => void;
}) {
  const people = rows.filter((row) => !row.id.startsWith("loan:"));
  const [personIds, setPersonIds] = useState<string[]>([]);
  const [toOffice, setToOffice] = useState<OfficeId>(OFFICES.find((office) => office.id !== currentOffice)?.id ?? "dep-hall");
  const [start, setStart] = useState("10:00");
  const [untilEnd, setUntilEnd] = useState(true);
  const [end, setEnd] = useState("12:00");
  function togglePerson(id: string) {
    setPersonIds((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]);
  }
  return (
    <dialog className="plain-dialog" open data-testid="loan-dialog">
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (!personIds.length) return;
          onSubmit({ personIds, toOffice, start, end: untilEnd ? null : end, rows: people });
        }}
      >
        <h2>借出員工</h2>
        <p className="pref-hint">可一次借兩個人。由開始時刻起，借出區唔再佔崗。</p>
        <div className="loan-people" role="group" aria-label="借出員工">
          {people.map((row) => (
            <label key={row.id} className="check-row">
              <input
                type="checkbox"
                data-testid={`loan-person-${row.code}`}
                checked={personIds.includes(row.id)}
                onChange={() => togglePerson(row.id)}
              />
              {row.code}
            </label>
          ))}
        </div>
        <label>借入區
          <select aria-label="借入區" value={toOffice} onChange={(event) => setToOffice(event.target.value as OfficeId)}>
            {OFFICES.filter((office) => office.id !== currentOffice).map((office) => <option key={office.id} value={office.id}>{office.label}</option>)}
          </select>
        </label>
        <label>由<input aria-label="借出時刻" type="time" value={start} onChange={(event) => setStart(event.target.value)} /></label>
        <label className="check-row"><input type="checkbox" checked={untilEnd} onChange={(event) => setUntilEnd(event.target.checked)} />直到收工</label>
        {!untilEnd && <label>到<input aria-label="借完時刻" type="time" value={end} onChange={(event) => setEnd(event.target.value)} /></label>}
        <div className="quick-row">
          <Button type="submit" data-testid="loan-confirm" disabled={!personIds.length}>確認借調{personIds.length ? `（${personIds.length}）` : ""}</Button>
          <Button type="button" variant="outline" onClick={onClose}>取消</Button>
        </div>
      </form>
    </dialog>
  );
}

function EarlyDialog({
  rows,
  currentOffice,
  onClose,
  onSubmit,
}: {
  rows: RosterRow[];
  currentOffice: OfficeId;
  onClose: () => void;
  onSubmit: (input: { personId: string; at: string; strategy: "close" | "fill" | "borrow"; fromOffice?: OfficeId }) => void;
}) {
  const [personId, setPersonId] = useState(rows[0]?.id ?? "");
  const [at, setAt] = useState("10:00");
  const [strategy, setStrategy] = useState<"close" | "fill" | "borrow">("close");
  const [fromOffice, setFromOffice] = useState<OfficeId>(OFFICES.find((office) => office.id !== currentOffice)?.id ?? "dep-hall");
  return (
    <dialog className="plain-dialog" open data-testid="early-dialog">
      <form
        onSubmit={(event) => {
          event.preventDefault();
          onSubmit({ personId, at, strategy, fromOffice: strategy === "borrow" ? fromOffice : undefined });
        }}
      >
        <h2>早走</h2>
        <label>員工
          <select aria-label="早走員工" value={personId} onChange={(event) => setPersonId(event.target.value)}>
            {rows.filter((row) => !row.id.startsWith("loan:")).map((row) => <option key={row.id} value={row.id}>{row.code}</option>)}
          </select>
        </label>
        <label>由<input aria-label="早走時刻" type="time" value={at} onChange={(event) => setAt(event.target.value)} /></label>
        <fieldset>
          <legend>空崗點處理</legend>
          <label className="check-row"><input type="radio" name="strategy" checked={strategy === "close"} onChange={() => setStrategy("close")} />減開崗位</label>
          <label className="check-row"><input type="radio" name="strategy" checked={strategy === "fill"} onChange={() => setStrategy("fill")} />其餘員工 fill</label>
          <label className="check-row"><input type="radio" name="strategy" checked={strategy === "borrow"} onChange={() => setStrategy("borrow")} />向外 office 借人</label>
        </fieldset>
        {strategy === "borrow" && (
          <label>向
            <select aria-label="借出區" value={fromOffice} onChange={(event) => setFromOffice(event.target.value as OfficeId)}>
              {OFFICES.filter((office) => office.id !== currentOffice).map((office) => <option key={office.id} value={office.id}>{office.label}</option>)}
            </select>
          </label>
        )}
        <div className="quick-row">
          <Button type="submit">確認早走</Button>
          <Button type="button" variant="outline" onClick={onClose}>取消</Button>
        </div>
      </form>
    </dialog>
  );
}

const SHIFT_CODE = /^(?:E1|E3|E4|B2|B1|C2|E|A) /;

function mentionsCode(code: string, issue: string) {
  const native = code.replace(SHIFT_CODE, "");
  return issue.startsWith(`${code} `) || issue.startsWith(`${native} `);
}

function rowMatches(rowId: string, selectedId: string | null) {
  if (!selectedId) return false;
  if (rowId === selectedId) return true;
  const row = parseOverlapRowId(rowId);
  const selected = parseOverlapRowId(selectedId);
  if (row && row.rowId === selectedId) return true;
  if (selected && selected.rowId === rowId) return true;
  return Boolean(row && selected && row.shiftId === selected.shiftId && row.rowId === selected.rowId);
}

function editableRow(row: RosterRow | null, shiftId: ShiftId): RosterRow | null {
  if (!row) return null;
  const parsed = parseOverlapRowId(row.id);
  if (!parsed || parsed.shiftId !== shiftId || parsed.rowId.startsWith("loan:")) return null;
  return { ...row, id: parsed.rowId };
}

function cellTone(value: string) {
  if (value === "R") return "cell is-r";
  if (value === "B" || value === "MB") return "cell is-b";
  if (value.startsWith("Apc")) return "cell is-apc";
  if (isLoanMarker(value)) return "cell is-loan";
  if (value === EARLY_CELL) return "cell is-early";
  if (!value) return "cell is-empty";
  return "cell";
}

function numberOrZero(value: string) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 0;
  return Math.max(0, Math.round(parsed));
}

function useNarrow() {
  const [narrow, setNarrow] = useState(() => window.matchMedia("(max-width: 760px)").matches);
  useEffect(() => {
    const media = window.matchMedia("(max-width: 760px)");
    const onChange = () => setNarrow(media.matches);
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, []);
  return narrow;
}
