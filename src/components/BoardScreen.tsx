import { useEffect, useState } from "react";
import { ConfirmDialog, PostFormDialog, StaffFormDialog, type StaffDraft } from "@/components/dialogs";
import { FloorApron } from "@/components/FloorApron";
import { InlineText } from "@/components/InlineText";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  addPost,
  addStaff,
  assignStaff,
  deletePost,
  movePostToZone,
  moveToTop,
  nextStaffCode,
  placementLabel,
  postById,
  postOfStaff,
  removeStaff,
  renamePost,
  renameZone,
  setPostLocked,
  staffById,
  suggestPostName,
  summarize,
  swapStaff,
  updateStaff,
} from "@/logic/board";
import type { FloorFilter } from "@/logic/chip";
import { presenceTotals } from "@/logic/presence";
import { addMinutes, isLateActive, isLeaveActive } from "@/logic/time";
import { useBoard } from "@/state/useBoard";
import { STORAGE_KEY, STORAGE_VERSION, TEMPLATES, type TemplateId } from "@/types";

type PostDraft = { templateId: TemplateId; zoneId: string; name: string };
type ConfirmState = { title: string; body: string; confirmLabel: string; run: () => void };

const FILTERS: { id: FloorFilter; label: string }[] = [
  { id: "all", label: "全部" },
  { id: "onduty", label: "在崗" },
  { id: "break", label: "MB／R" },
  { id: "exception", label: "S/L／UVL" },
  { id: "vacant", label: "空缺" },
];

function blankStaff(code: string): StaffDraft {
  return {
    id: null,
    code,
    shift: "",
    dutyStart: "07:00",
    dutyEnd: "15:30",
    breakStart: "",
    breakEnd: "",
    leaveEarlyAt: "",
    returnLateAt: "",
    restLocked: false,
  };
}

function normalizeCode(code: string): string {
  const trimmed = code.trim();
  if (/^\d+$/.test(trimmed) && trimmed.length < 2) return trimmed.padStart(2, "0");
  return trimmed;
}

function staffToDraft(person: {
  id: string;
  code: string;
  shift?: string;
  dutyStart: string;
  dutyEnd: string;
  breakStart: string | null;
  breakEnd: string | null;
  leaveEarlyAt: string | null;
  returnLateAt: string | null;
  restLocked: boolean;
}): StaffDraft {
  return {
    id: person.id,
    code: person.code,
    shift: person.shift ?? "",
    dutyStart: person.dutyStart,
    dutyEnd: person.dutyEnd,
    breakStart: person.breakStart ?? "",
    breakEnd: person.breakEnd ?? "",
    leaveEarlyAt: person.leaveEarlyAt ?? "",
    returnLateAt: person.returnLateAt ?? "",
    restLocked: person.restLocked,
  };
}

export function BoardScreen() {
  const board = useBoard();
  const { state } = board;
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedPostId, setSelectedPostId] = useState<string | null>(null);
  const [filter, setFilter] = useState<FloorFilter>("all");
  const [swapArmed, setSwapArmed] = useState(false);
  const [postDraft, setPostDraft] = useState<PostDraft | null>(null);
  const [staffDraft, setStaffDraft] = useState<StaffDraft | null>(null);
  const [staffError, setStaffError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<ConfirmState | null>(null);
  const [solver, setSolver] = useState<"checking" | "up" | "down">("checking");
  const selected = selectedId ? staffById(state, selectedId) : undefined;
  const selectedPost = selectedPostId ? postById(state, selectedPostId) : undefined;
  const counts = summarize(state);
  const presence = presenceTotals(state);

  useEffect(() => {
    let active = true;
    async function ping() {
      for (let attempt = 0; attempt < 8 && active; attempt += 1) {
        try {
          const response = await fetch("/api/health");
          if (response.ok) {
            if (active) setSolver("up");
            return;
          }
        } catch {
          // The API process may still be opening its port.
        }
        await new Promise((resolve) => setTimeout(resolve, 400));
      }
      if (active) setSolver("down");
    }
    void ping();
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setSelectedId(null);
        setSelectedPostId(null);
        setSwapArmed(false);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  function openPostDialog(zoneId: string) {
    const zone = state.zones.find((item) => item.id === zoneId) ?? state.zones[0];
    if (!zone) return;
    const template = TEMPLATES.find((item) => item.id === zone.templateId) ?? TEMPLATES[0];
    setPostDraft({
      templateId: template.id,
      zoneId: zone.id,
      name: suggestPostName(state, zone.id, template.id),
    });
  }

  function selectStaff(staffId: string) {
    if (selectedId && swapArmed && staffId !== selectedId) {
      const swapped = board.commit(swapStaff(state, selectedId, staffId));
      if (swapped) setSwapArmed(false);
      return;
    }
    setSelectedId(staffId);
    setSelectedPostId(postOfStaff(state, staffId)?.id ?? null);
  }

  function activatePost(postId: string) {
    const post = postById(state, postId);
    if (!post) return;
    if (selectedId && swapArmed) {
      if (!post.assigneeId || post.assigneeId === selectedId) {
        board.setNotice("對調要點另一個人。");
        return;
      }
      const swapped = board.commit(swapStaff(state, selectedId, post.assigneeId));
      if (swapped) setSwapArmed(false);
      return;
    }
    if (selectedId && post.assigneeId !== selectedId) {
      const placed = board.commit(assignStaff(state, selectedId, postId));
      if (placed) setSelectedPostId(postId);
      return;
    }
    if (post.assigneeId) {
      setSelectedId(post.assigneeId);
      setSelectedPostId(post.id);
      return;
    }
    setSelectedId(null);
    setSwapArmed(false);
    setSelectedPostId(post.id);
  }

  function editStaff(staffId: string) {
    const person = staffById(state, staffId);
    if (!person) return;
    setStaffError(null);
    setStaffDraft(staffToDraft(person));
  }

  function saveStaff() {
    if (!staffDraft) return;
    const code = normalizeCode(staffDraft.code);
    if (!code) {
      setStaffError("要有編號。");
      return;
    }
    if (state.staff.some((person) => person.code === code && person.id !== staffDraft.id)) {
      setStaffError("這個編號已經有人用了。");
      return;
    }
    const breakStart = staffDraft.breakStart || null;
    const breakEnd = staffDraft.breakEnd || null;
    if (Boolean(breakStart) !== Boolean(breakEnd)) {
      setStaffError("MB 要同時有 In 和 Out。");
      return;
    }
    if (breakStart && breakEnd && breakEnd <= breakStart) {
      setStaffError("MB Out 要晚於 In。");
      return;
    }
    const patch = {
      code,
      shift: staffDraft.shift.trim(),
      dutyStart: staffDraft.dutyStart || "07:00",
      dutyEnd: staffDraft.dutyEnd || "15:30",
      breakStart,
      breakEnd,
      leaveEarlyAt: staffDraft.leaveEarlyAt || null,
      returnLateAt: staffDraft.returnLateAt || null,
      restLocked: staffDraft.restLocked,
    };
    if (staffDraft.id) {
      board.replace(updateStaff(state, staffDraft.id, patch));
    } else {
      const added = addStaff(state, patch);
      board.replace(added);
      const created = added.staff[added.staff.length - 1];
      if (created) {
        setSelectedId(created.id);
        setSelectedPostId(null);
      }
    }
    setStaffDraft(null);
    setStaffError(null);
  }

  function askDeletePost(postId: string) {
    const post = postById(state, postId);
    if (!post) return;
    setConfirm({
      title: `刪除「${post.name}」？`,
      body: post.locked
        ? "此格已鎖定。刪除是你的決定，上面的人會回到休息區。重算本身不會刪格子。"
        : "上面的人會回到休息區。",
      confirmLabel: "刪除崗位",
      run: () => {
        board.replace(deletePost(state, postId));
        if (selectedPostId === postId) setSelectedPostId(null);
      },
    });
  }

  const solverLabel = solver === "up" ? "求解就緒" : solver === "down" ? "求解未連線" : "確認求解…";

  return (
    <div className="board-root flex min-h-svh flex-col min-[1100px]:h-svh min-[1100px]:overflow-hidden">
      <header className="topbar flex flex-wrap items-center gap-x-8 gap-y-2 px-5 py-3">
        <div>
          <h1>今日場地</h1>
          <input
            type="date"
            aria-label="日期"
            value={state.date}
            onChange={(event) => board.replace({ ...state, date: event.target.value })}
            className="date-input"
          />
        </div>
        <div className="ml-auto flex flex-wrap items-end gap-x-8 gap-y-2">
          <div data-testid="on-site-count">
            <p className="stat-kicker">現在在場</p>
            <p className="presence-num">{presence.onSite}</p>
            <p className="stat-kicker" data-testid="presence-split">
              在崗 {presence.onduty} · 休息 {presence.rest}
            </p>
          </div>
          <div data-testid="post-count">
            <p className="stat-kicker">崗位</p>
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
          <ul className="legend-label flex flex-wrap items-center gap-x-4 gap-y-2 pb-1">
            <li className="flex items-center gap-1.5">
              <span className="legend-dot" style={{ background: "var(--status-onduty)" }} />
              在崗
            </li>
            <li className="flex items-center gap-1.5">
              <span className="legend-dot" style={{ background: "var(--status-break)" }} />
              MB／R
            </li>
            <li className="flex items-center gap-1.5">
              <span className="legend-dot" style={{ background: "var(--status-exception)" }} />
              S/L／UVL
            </li>
            <li className="flex items-center gap-1.5">
              <span className="legend-dot is-vacant" />
              空缺
            </li>
          </ul>
        </div>
      </header>

      {board.notice && (
        <div role="status" data-testid="notice" className="board-notice px-5 py-2 text-sm">
          {board.notice}
          {board.mismatch && !board.persist && (
            <Button type="button" size="sm" className="ml-3" onClick={board.acceptUpgrade}>
              覆蓋舊紀錄
            </Button>
          )}
        </div>
      )}

      <div className="flex min-h-0 flex-1 flex-col min-[1100px]:flex-row">
        <main data-testid="floor-board" className="floor-canvas min-h-[640px] flex-1 overflow-auto p-4">
          <FloorApron
            state={state}
            selectedId={selectedId}
            selectedPostId={selectedPostId}
            filter={filter}
            onActivatePost={activatePost}
            onSelectStaff={selectStaff}
            onDropStaff={(postId, staffId) => {
              setSelectedId(staffId);
              setSwapArmed(false);
              const placed = board.commit(assignStaff(state, staffId, postId));
              if (placed) setSelectedPostId(postId);
            }}
            onDropRest={(staffId) => {
              setSelectedId(staffId);
              setSwapArmed(false);
              setSelectedPostId(null);
              board.commit(assignStaff(state, staffId, null));
            }}
            onSwap={(fromId, toId) => {
              setSelectedId(fromId);
              const swapped = board.commit(swapStaff(state, fromId, toId));
              if (swapped) setSwapArmed(false);
            }}
            onEditStaff={editStaff}
            onRenameZone={(zoneId, patch) => board.replace(renameZone(state, zoneId, patch))}
            onClear={() => {
              setSelectedId(null);
              setSelectedPostId(null);
              setSwapArmed(false);
            }}
          />
        </main>

        <aside className="side-panel flex w-full shrink-0 flex-col gap-4 overflow-auto border-t border-[var(--line)] p-4 min-[1100px]:border-t-0">
          <section>
            <h2 className="text-base font-semibold">狀態標記</h2>
            <div className="mt-3 grid gap-2">
              <div className="sample-chip is-onduty">在崗</div>
              <div className="sample-chip is-break">MB／R</div>
              <div className="sample-chip is-exception">S/L／UVL</div>
              <div className="sample-chip is-vacant">空缺</div>
            </div>
            <p className="ink-secondary mt-3 text-xs leading-5">
              泊位格寫崗位碼。點格開姓名卡，看得到人與 In／Out。選中是藍框。
            </p>
          </section>

          <section>
            <h2 className="text-base font-semibold">篩選</h2>
            <div className="mt-2 grid grid-cols-2 gap-2">
              {FILTERS.map((item) => (
                <Button
                  key={item.id}
                  type="button"
                  variant="outline"
                  className={item.id === "all" ? "filter-btn col-span-2" : "filter-btn"}
                  aria-pressed={filter === item.id}
                  onClick={() => setFilter(item.id)}
                >
                  {item.label}
                </Button>
              ))}
            </div>
          </section>

          <section className="grid gap-2">
            <label className="ink-secondary grid gap-1 text-xs">
              更次
              <Input
                value={state.shiftName}
                onChange={(event) => board.replace({ ...state, shiftName: event.target.value })}
                className="h-11 bg-white"
              />
            </label>
            <label className="ink-secondary grid gap-1 text-xs">
              現場時刻
              <Input
                type="time"
                value={state.now}
                onChange={(event) => board.replace({ ...state, now: event.target.value })}
                className="h-11 bg-white"
              />
            </label>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                const now = new Date();
                const hh = String(now.getHours()).padStart(2, "0");
                const mm = String(now.getMinutes()).padStart(2, "0");
                board.replace({ ...state, now: `${hh}:${mm}` });
              }}
            >
              對齊電腦時間
            </Button>
            <p className="ink-secondary text-xs">
              S/L {counts.left} · UVL {counts.late} · 缺人 {counts.vacancies}
            </p>
          </section>

          <section className="grid gap-2">
            <Button type="button" data-testid="add-post" onClick={() => openPostDialog(state.zones[0]?.id ?? "arr")}>
              加崗位
            </Button>
            <Button
              type="button"
              variant="outline"
              data-testid="add-staff"
              onClick={() => {
                setStaffError(null);
                setStaffDraft(blankStaff(nextStaffCode(state)));
              }}
            >
              加人
            </Button>
            <Button
              type="button"
              data-testid="recompute"
              disabled={board.solving}
              onClick={() => {
                void board.recompute().then(() => {
                  fetch("/api/health")
                    .then((response) => setSolver(response.ok ? "up" : "down"))
                    .catch(() => setSolver("down"));
                });
              }}
            >
              {board.solving ? "重算中…" : "重算未鎖定"}
            </Button>
            <Button type="button" variant="outline" onClick={board.resetDemo}>
              回復示範
            </Button>
          </section>

          <section className="grid gap-2 border-t border-[var(--line)] pt-4">
            {selected ? (
              <>
                <p className="text-base font-semibold">已選 {selected.code}</p>
                <p className="text-sm">{placementLabel(state, selected.id)}</p>
                {selected.shift && <p className="ink-secondary text-sm">更 {selected.shift}</p>}
                <p className="ink-secondary text-sm">
                  崗位 In {selected.dutyStart} Out {selected.dutyEnd}
                </p>
                {selected.breakStart && selected.breakEnd && (
                  <p className="ink-secondary text-sm">
                    MB In {selected.breakStart} Out {selected.breakEnd}
                  </p>
                )}
                {selected.leaveEarlyAt && (
                  <p className="text-sm">
                    {isLeaveActive(selected, state.now) ? "S/L" : "S/L 未生效"} {selected.leaveEarlyAt}
                  </p>
                )}
                {selected.returnLateAt && (
                  <p className="text-sm">
                    {isLateActive(selected, state.now) ? "UVL 未返" : "UVL"} {selected.returnLateAt}
                  </p>
                )}
                <Button type="button" variant="outline" data-testid="move-top" onClick={() => board.commit(moveToTop(state, selected.id))}>
                  移到最前
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  className="filter-btn"
                  data-testid="swap"
                  aria-pressed={swapArmed}
                  onClick={() => setSwapArmed((value) => !value)}
                >
                  {swapArmed ? "再點一個人" : "對調"}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  data-testid="to-rest"
                  disabled={!postOfStaff(state, selected.id)}
                  onClick={() => {
                    const moved = board.commit(assignStaff(state, selected.id, null));
                    if (moved) setSelectedPostId(null);
                  }}
                >
                  送去休息
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() =>
                    board.replace(
                      updateStaff(state, selected.id, {
                        leaveEarlyAt: selected.leaveEarlyAt ? null : state.now,
                      }),
                    )
                  }
                >
                  {selected.leaveEarlyAt ? "取消 S/L" : "標 S/L"}
                </Button>
                {selected.leaveEarlyAt && (
                  <Input
                    type="time"
                    aria-label="S/L 時刻"
                    value={selected.leaveEarlyAt}
                    onChange={(event) =>
                      board.replace(updateStaff(state, selected.id, { leaveEarlyAt: event.target.value || null }))
                    }
                    className="h-11 bg-white"
                  />
                )}
                <Button
                  type="button"
                  variant="outline"
                  onClick={() =>
                    board.replace(
                      updateStaff(state, selected.id, {
                        returnLateAt: selected.returnLateAt ? null : addMinutes(state.now, 45),
                      }),
                    )
                  }
                >
                  {selected.returnLateAt ? "取消 UVL" : "標 UVL"}
                </Button>
                {selected.returnLateAt && (
                  <Input
                    type="time"
                    aria-label="UVL 時刻"
                    value={selected.returnLateAt}
                    onChange={(event) =>
                      board.replace(updateStaff(state, selected.id, { returnLateAt: event.target.value || null }))
                    }
                    className="h-11 bg-white"
                  />
                )}
                {!postOfStaff(state, selected.id) && (
                  <Button
                    type="button"
                    variant="outline"
                    aria-pressed={selected.restLocked}
                    onClick={() => board.replace(updateStaff(state, selected.id, { restLocked: !selected.restLocked }))}
                  >
                    {selected.restLocked ? "解除休息鎖定" : "鎖定在休息區"}
                  </Button>
                )}
                <Button type="button" variant="outline" onClick={() => editStaff(selected.id)}>
                  改時間
                </Button>
              </>
            ) : (
              <p className="ink-secondary text-sm">點一個泊位格看姓名卡。再點別格會把人放上去，拖過去也行。</p>
            )}

            {selectedPost && (
              <div className="mt-2 grid gap-2 border-t border-[var(--line)] pt-3">
                <label className="ink-secondary grid gap-1 text-xs">
                  崗位名稱
                  <InlineText
                    label="側欄崗位名稱"
                    value={selectedPost.name}
                    onCommit={(name) => board.replace(renamePost(state, selectedPost.id, name))}
                    className="h-11 rounded-lg border border-[var(--line)] bg-white px-2 text-sm text-[var(--ink-primary)]"
                  />
                </label>
                <label className="ink-secondary grid gap-1 text-xs">
                  所在區域
                  <select
                    aria-label={`${selectedPost.name} 所在區域`}
                    value={selectedPost.zoneId}
                    onChange={(event) => board.replace(movePostToZone(state, selectedPost.id, event.target.value))}
                    className="h-11 rounded-lg border border-[var(--line)] bg-white px-2 text-sm text-[var(--ink-primary)]"
                  >
                    {state.zones.map((zone) => (
                      <option key={zone.id} value={zone.id}>
                        {zone.code} · {zone.title}
                      </option>
                    ))}
                  </select>
                </label>
                <Button
                  type="button"
                  variant="outline"
                  aria-pressed={selectedPost.locked}
                  onClick={() => board.replace(setPostLocked(state, selectedPost.id, !selectedPost.locked))}
                >
                  {selectedPost.locked ? "解除鎖定" : "鎖定此格"}
                </Button>
                <Button type="button" variant="outline" onClick={() => askDeletePost(selectedPost.id)}>
                  刪除崗位
                </Button>
              </div>
            )}
          </section>

          <footer className="ink-secondary mt-auto space-y-1 border-t border-[var(--line)] pt-3 text-xs">
            <p className={solver === "down" ? "text-status-alert" : undefined}>{solverLabel}</p>
            <p>泊位格是崗位碼。MB、R、S/L、UVL 在休息區，並跟現場時刻切。</p>
            <p data-testid="storage-key">
              本機鍵 <span className="font-mono">{STORAGE_KEY}</span>
              {" · "}
              version <span className="font-mono">{STORAGE_VERSION}</span>
              {board.persist ? " · 已寫入" : " · 尚未覆蓋舊紀錄"}
            </p>
          </footer>
        </aside>
      </div>

      <PostFormDialog
        open={postDraft !== null}
        zones={state.zones}
        templateId={postDraft?.templateId ?? "ARR"}
        zoneId={postDraft?.zoneId ?? state.zones[0]?.id ?? "arr"}
        name={postDraft?.name ?? ""}
        onTemplate={(templateId) => {
          const template = TEMPLATES.find((item) => item.id === templateId);
          if (!template || !postDraft) return;
          setPostDraft({
            templateId,
            zoneId: template.zoneId,
            name: suggestPostName(state, template.zoneId, templateId),
          });
        }}
        onZone={(zoneId) => postDraft && setPostDraft({ ...postDraft, zoneId })}
        onName={(name) => postDraft && setPostDraft({ ...postDraft, name })}
        onClose={() => setPostDraft(null)}
        onCreate={() => {
          if (!postDraft?.name.trim()) return;
          board.replace(addPost(state, { zoneId: postDraft.zoneId, name: postDraft.name }));
          setPostDraft(null);
        }}
      />
      <StaffFormDialog
        draft={staffDraft}
        error={staffError}
        onChange={(draft) => {
          setStaffError(null);
          setStaffDraft(draft);
        }}
        onClose={() => setStaffDraft(null)}
        onSave={saveStaff}
        onRemove={() => {
          if (!staffDraft?.id) return;
          const id = staffDraft.id;
          board.replace(removeStaff(state, id));
          if (selectedId === id) {
            setSelectedId(null);
            setSelectedPostId(null);
          }
          setStaffDraft(null);
        }}
      />
      <ConfirmDialog
        open={confirm !== null}
        title={confirm?.title ?? ""}
        body={confirm?.body ?? ""}
        confirmLabel={confirm?.confirmLabel ?? "確定"}
        onClose={() => setConfirm(null)}
        onConfirm={() => {
          confirm?.run();
          setConfirm(null);
        }}
      />
    </div>
  );
}
