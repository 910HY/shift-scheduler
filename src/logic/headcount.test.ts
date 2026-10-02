import { describe, expect, it } from "vitest";
import ExcelJS from "exceljs";
import { headcountTrial } from "@/logic/headcount";
import { buildPreviewWorkbook } from "@/logic/previewXlsx";
import {
  applyPreparedRoster,
  assignByHeadcount,
  awayHours,
  createDefaultStaffing,
  defaultRules,
  isRestCode,
  postKind,
  postsForPercent,
  projectBoard,
  requiredCrew,
  setPercent,
  shiftOf,
  slotStarts,
} from "@/logic/staffing";
import type { BoardState, ShiftId, StaffingState } from "@/types";

function board(staffing: StaffingState = createDefaultStaffing()): BoardState {
  return {
    date: "2026-09-28",
    shiftName: staffing.shiftId,
    now: "02:00",
    zones: [],
    posts: [],
    staff: [],
    staffing,
  };
}

function smallHall(): StaffingState {
  return {
    ...createDefaultStaffing(),
    counterMax: 4,
    gates: 6,
    gatesPerPost: 6,
    books: {},
    percent: 100,
  };
}

function dutyCells(cells: string[]) {
  return cells.filter((cell) => cell && !isRestCode(cell) && cell !== "早走" && !cell.startsWith("on loan"));
}

function covered(
  rows: Partial<Record<ShiftId, { cells: string[] }[]>>,
  posts: string[],
  shiftIds: ShiftId[],
) {
  const times = new Set<string>();
  for (const id of shiftIds) for (const slot of slotStarts(id)) times.add(slot);
  const problems: string[] = [];
  for (const slot of times) {
    const seen = new Map<string, number>();
    for (const id of shiftIds) {
      const slots = slotStarts(id);
      const index = slots.indexOf(slot);
      if (index < 0) continue;
      for (const row of rows[id] ?? []) {
        const cell = row.cells[index] ?? "";
        if (!cell || isRestCode(cell)) continue;
        seen.set(cell, (seen.get(cell) ?? 0) + 1);
      }
    }
    for (const code of posts) {
      if (seen.get(code) !== 1) problems.push(`${slot} ${code}=${seen.get(code) ?? 0}`);
    }
    for (const [code, count] of seen) {
      if (!posts.includes(code) || count !== 1) problems.push(`${slot} extra ${code}×${count}`);
    }
  }
  return problems;
}

describe("headcount trial", () => {
  it("lists day shifts at 50% and A at 30% without adding overlap crews", () => {
    const staffing = createDefaultStaffing();
    const trial = headcountTrial(staffing, 50, 30);
    const b2 = trial.lines.find((line) => line.shiftId === "B2");
    const b1 = trial.lines.find((line) => line.shiftId === "B1");
    const night = trial.lines.find((line) => line.shiftId === "A");
    expect(postsForPercent(staffing, 50)).toHaveLength(20);
    expect(postsForPercent(staffing, 30)).toHaveLength(12);
    expect(b2).toMatchObject({ percent: 50, openPosts: 20, suggested: requiredCrew(20, 6.5, awayHours("B2", staffing.rules)) });
    expect(b1?.suggested).toBe(requiredCrew(20, 8, awayHours("B1", defaultRules("B1"))));
    expect(night).toMatchObject({
      percent: 30,
      openPosts: 12,
      end: "06:45",
      suggested: requiredCrew(12, shiftOf("A").hours, awayHours("A", defaultRules("A"))),
    });
    expect(shiftOf("A").end).toBe("06:45");

    const morning = trial.overlaps.find((item) => item.at === "09:15");
    expect(morning?.active).toEqual(expect.arrayContaining(["B2", "B1"]));
    expect(morning).toBeTruthy();
    if (!morning) return;
    expect(morning.suggestedSum).toBeGreaterThan(morning.simultaneousPosts);
    expect(morning?.simultaneousPosts).toBe(20);
    expect(morning?.message).toContain("唔等於");
    expect(morning?.message).toContain("崗位池");

    const handoff = trial.overlaps.find((item) => item.at === "23:00");
    expect(handoff?.active).toEqual(expect.arrayContaining(["E4", "A"]));
    expect(handoff?.mixedPercent).toBe(true);
    expect(handoff?.simultaneousPosts).toBe(20);
    expect(handoff?.message).toContain("上限 20");
    expect(handoff?.message).toContain("唔等於");
  });

  it("counts a kiosk at 4 posts plus 2 APC", () => {
    const staffing = { ...createDefaultStaffing(), officeId: "arr-kiosk" as const };
    const trial = headcountTrial(staffing, 50, 30);
    expect(postsForPercent(staffing, 100)).toEqual(["A1", "A2", "A3", "A4", "Apc 1", "Apc 2"]);
    expect(trial.lines.find((line) => line.shiftId === "B2")).toMatchObject({ openPosts: 3, percent: 50 });
    expect(trial.lines.find((line) => line.shiftId === "A")).toMatchObject({ openPosts: 2, percent: 30, end: "06:45" });
  });
});

describe("assign by headcount", () => {
  it("covers Arr Hall day posts at 50% when B1 and B2 each bring a solo crew", () => {
    const staffing = { ...createDefaultStaffing(), books: {} };
    const posts = postsForPercent(staffing, 50);
    const b2 = requiredCrew(posts.length, shiftOf("B2").hours, awayHours("B2", staffing.rules));
    const b1 = requiredCrew(posts.length, shiftOf("B1").hours, awayHours("B1", defaultRules("B1")));
    const result = assignByHeadcount(staffing, { B2: b2, B1: b1 }, 50);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(posts).toHaveLength(20);
    expect(covered(result.rows, posts, ["B2", "B1"])).toEqual([]);
    const applied = applyPreparedRoster({ ...board(staffing), now: "02:00" }, result);
    const shown = projectBoard(applied);
    const duty = shown.staff.map((person) => person.dutyPost).filter((post): post is string => Boolean(post));
    expect(new Set(duty).size).toBe(duty.length);
    expect(duty).toHaveLength(20);
  });

  it("fills B1 and B2 from the shared pool and leaves surplus on R", () => {
    const staffing = smallHall();
    const posts = postsForPercent(staffing, 50);
    expect(posts).toHaveLength(3);
    const b2 = requiredCrew(posts.length, shiftOf("B2").hours, awayHours("B2", staffing.rules));
    const b1 = requiredCrew(posts.length, shiftOf("B1").hours, awayHours("B1", staffing.rules));
    const result = assignByHeadcount(staffing, { B2: b2 + 2, B1: b1 }, 50);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.strategy).toBe("spare-on-r");
    expect(result.note).toContain("後備");
    expect(result.rows.B2).toHaveLength(b2 + 2);
    expect(result.rows.B1).toHaveLength(b1);
    expect(covered(result.rows, posts, ["B2", "B1"])).toEqual([]);
    expect(result.rows.B1?.some((row) => row.cells.includes("MB"))).toBe(true);
    expect(result.rows.B2?.some((row) => row.cells.includes("R"))).toBe(true);
    const extras = result.rows.B2 ?? [];
    expect(extras.some((row) => dutyCells(row.cells).length < (extras[0]?.cells.length ?? 0))).toBe(true);

    const applied = applyPreparedRoster(board(staffing), result);
    expect(applied.staffing?.percent).toBe(50);
    expect(applied.staffing?.pinnedRoster?.counts).toMatchObject({ B2: b2 + 2, B1: b1 });
    expect(applied.now).toBe(result.now);
    const shown = projectBoard(applied);
    const duty = shown.staff.map((person) => person.dutyPost).filter((post): post is string => Boolean(post));
    expect(shown.posts).toHaveLength(posts.length);
    expect(new Set(duty).size).toBe(duty.length);
    expect(duty.length).toBe(posts.length);

    const later = projectBoard({ ...applied, now: "11:15" });
    const laterDuty = later.staff.map((person) => person.dutyPost).filter((post): post is string => Boolean(post));
    expect(new Set(laterDuty).size).toBe(laterDuty.length);
    expect(laterDuty.length).toBe(posts.length);
    expect(setPercent(applied, 100).staffing?.pinnedRoster).toBeUndefined();
  });

  it("refuses a crew smaller than the open posts and does not write a roster", () => {
    const staffing = smallHall();
    const before = JSON.stringify(staffing.books);
    const result = assignByHeadcount(staffing, { B2: 2 }, 50);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toContain("缺");
    expect(result.reason).toContain("未寫入編表");
    expect(result.reason).toContain("減開崗");
    expect(JSON.stringify(staffing.books)).toBe(before);
    expect(staffing.pinnedRoster).toBeUndefined();
  });

  it("keeps a counter-only preference off kiosk posts", () => {
    const staffing = { ...createDefaultStaffing(), officeId: "arr-kiosk" as const, books: {} as StaffingState["books"], kioskMax: 4 };
    const posts = postsForPercent(staffing, 50);
    const suggested = requiredCrew(posts.length, shiftOf("B2").hours, awayHours("B2", staffing.rules));
    staffing.books[`arr-kiosk|B2|c0|a0|k${posts.length}`] = [
      { id: "arr-kiosk:K1", code: "K1", allows: ["counter"], cells: [] },
    ];
    const result = assignByHeadcount(staffing, { B2: suggested + 1 }, 50);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const first = result.rows.B2?.find((row) => row.code === "K1");
    expect(dutyCells(first?.cells ?? []).every((cell) => postKind(cell) !== "kiosk")).toBe(true);
    expect(covered(result.rows, posts, ["B2"])).toEqual([]);
  });

  it("writes the prepared posts into the preview workbook", async () => {
    const staffing = smallHall();
    const posts = postsForPercent(staffing, 50);
    const suggested = requiredCrew(posts.length, shiftOf("B2").hours, awayHours("B2", staffing.rules));
    const result = assignByHeadcount(staffing, { B2: suggested }, 50);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const applied = applyPreparedRoster(board(staffing), result);
    const buffer = await buildPreviewWorkbook(applied.staffing!);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer as ExcelJS.Buffer);
    const values = new Set<string>();
    workbook.getWorksheet("preview")?.eachRow((row) => row.eachCell((cell) => values.add(String(cell.value ?? ""))));
    expect(values.has("Apc 1") || values.has("1")).toBe(true);
    expect([...values].some((value) => value.startsWith("B2 "))).toBe(true);
  });
});
