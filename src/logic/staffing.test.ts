import { describe, expect, it } from "vitest";
import ExcelJS from "exceljs";
import { buildPreviewWorkbook } from "@/logic/previewXlsx";
import {
  apcPosts,
  applyEarlyLeave,
  awayHours,
  bookKey,
  checkRoster,
  addOpenPosts,
  combinedRoster,
  createDefaultStaffing,
  createLoan,
  crewFor,
  defaultRules,
  extremeNotes,
  generateRoster,
  hallMax,
  isExtreme,
  isRestCode,
  officeFocus,
  offClockWarning,
  openPostCodes,
  previewFilename,
  projectBoard,
  setCell,
  setShift,
  shiftsActiveAt,
  shortageAdvice,
  siteOverview,
  requiredCrew,
  revokeLoan,
  scaleCount,
  setLoanEnd,
  setOpenCounts,
  setPercent,
  setRules,
  siteCapacity,
  slotIndexAt,
  slotStarts,
} from "@/logic/staffing";
import { isWithinDuty } from "@/logic/time";
import { alignNowToSelectedShift, createAppSeed, ensureStaffing } from "@/logic/seed";
import type { BoardState } from "@/types";

function board(): BoardState {
  return {
    date: "2026-09-28",
    shiftName: "B2",
    now: "09:15",
    zones: [],
    posts: [],
    staff: [],
    staffing: createDefaultStaffing(),
  };
}

describe("capacity and crew", () => {
  it("derives APC posts from gates divided by six and the full site", () => {
    expect(apcPosts(60, 6)).toBe(10);
    expect(hallMax(30, 60, 6)).toBe(40);
    expect(siteCapacity(30, 60, 6, 12)).toBe(104);
    expect(scaleCount(12, 30)).toBe(4);
    expect(scaleCount(30, 50)).toBe(15);
  });

  it("estimates B2 Arr Hall at full open as 52 people", () => {
    expect(requiredCrew(40, 6.5, 1.5)).toBe(52);
    const staffing = createDefaultStaffing();
    expect(crewFor(staffing)).toBe(52);
    expect(awayHours("B2", staffing.rules)).toBe(1.5);
    expect(awayHours("B1", defaultRules("B1"))).toBe(2.5);
    expect(awayHours("A", defaultRules("A"))).toBe(3.5);
  });

  it("follows the enabled meal switch when estimating crew", () => {
    const staffing = createDefaultStaffing();
    const withMeal = setRules(board(), { ...defaultRules("B1"), applyMeal: true });
    const noMeal = setRules(board(), { ...defaultRules("B1"), applyMeal: false });
    expect(withMeal.staffing && noMeal.staffing).toBeTruthy();
    const mealCrew = requiredCrew(40, 8, awayHours("B1", withMeal.staffing!.rules));
    const bareCrew = requiredCrew(40, 8, awayHours("B1", noMeal.staffing!.rules));
    expect(mealCrew).toBeGreaterThan(bareCrew);
    expect(isExtreme(withMeal.staffing!.rules, "B2")).toBe(true);
    expect(extremeNotes({ ...staffing.rules, maxConsecutiveHours: 2.5 }, "B2").join(" ")).toContain("2.5");
  });

  it("names the preview file with office, shift and percent", () => {
    expect(previewFilename(createDefaultStaffing())).toBe("preview-arr-hall-b2-100pct.xlsx");
    const custom = setPercent(board(), 30).staffing!;
    expect(previewFilename({ ...custom, percent: null })).toBe("preview-arr-hall-b2-custom.xlsx");
  });

  it("scales every open count from any percent, not only the shortcuts", () => {
    const next = setPercent(board(), 40).staffing!;
    expect(next.percent).toBe(40);
    expect(next.counters).toBe(12);
    expect(next.apc).toBe(4);
    expect(next.kiosks).toBe(5);
    expect(crewFor(next)).toBe(requiredCrew(16, 6.5, 1.5));
    expect(previewFilename(next)).toBe("preview-arr-hall-b2-40pct.xlsx");
    const typed = setOpenCounts(board(), { counters: 7 }).staffing!;
    expect(typed.percent).toBeNull();
    expect(crewFor(typed)).toBe(requiredCrew(17, 6.5, 1.5));
    expect(previewFilename(typed)).toBe("preview-arr-hall-b2-custom.xlsx");
  });
});

describe("office focus", () => {
  it("counts only the selected office in the top bar", () => {
    const state = { ...board(), now: "13:15" };
    const hall = officeFocus(state, "arr-hall");
    const kiosk = officeFocus(state, "arr-kiosk");
    expect(shiftsActiveAt("13:15")).toEqual(["B1", "C2", "E1"]);
    expect(hall?.label).toBe("Arr Hall");
    expect(hall?.total).toBe(40);
    expect(hall?.filled).toBeGreaterThan(0);
    expect(hall?.filled).toBeLessThanOrEqual(40);
    expect(hall?.onSite).toBeGreaterThan(0);
    expect(kiosk?.total).toBe(12);
    expect(kiosk?.onSite).toBeGreaterThan(0);
    expect(kiosk?.onSite).toBeLessThan(hall!.onSite);
    const site = siteOverview(state);
    expect(site.total).toBe(104);
    expect(site.onSite).toBeGreaterThan(hall!.onSite);
    const overlapping = officeFocus({ ...board(), now: "13:10" }, "arr-hall");
    expect(shiftsActiveAt("13:10")).toEqual(["B2", "B1", "C2", "E1"]);
    expect(overlapping?.onSite).toBeGreaterThan(52);
  });
});

describe("sample rosters", () => {
  it("accepts the B2 Arr Hall sheet under the default rules", () => {
    const staffing = createDefaultStaffing();
    const errors = checkRoster(staffing).filter((issue) => issue.level === "error");
    expect(errors).toEqual([]);
    expect(staffing.books["arr-hall|B2|c30|a10"]).toHaveLength(52);
  });

  it("accepts the A kiosk sheet for a 2.5h break and a 2h work cap", () => {
    const state = setPercent(board(), 30);
    const staffing = { ...state.staffing!, officeId: "arr-kiosk" as const, shiftId: "A" as const, rules: defaultRules("A") };
    const errors = checkRoster(staffing).filter((issue) => issue.level === "error");
    expect(errors).toEqual([]);
  });

  it("stops flagging consecutive R when that rule is switched off", () => {
    const staffing = createDefaultStaffing();
    const key = "arr-hall|B2|c30|a10";
    const rows = staffing.books[key]!.map((row, index) =>
      index === 0 ? { ...row, cells: ["R", "R", ...row.cells.slice(2)] } : row,
    );
    const broken = { ...staffing, books: { ...staffing.books, [key]: rows } };
    expect(checkRoster(broken).some((issue) => issue.rule === "日間 R")).toBe(true);
    const relaxed = checkRoster({ ...broken, rules: { ...broken.rules, scatterRest: false } });
    expect(relaxed.some((issue) => issue.rule === "日間 R")).toBe(false);
  });

  it("rejects a post the person is not allowed to work", () => {
    const staffing = createDefaultStaffing();
    const key = "arr-hall|B2|c30|a10";
    const target = staffing.books[key]!.find((row) => row.cells.some((cell) => cell.startsWith("Apc")));
    expect(target).toBeTruthy();
    const rows = staffing.books[key]!.map((row) => (row.id === target!.id ? { ...row, allows: ["counter" as const] } : row));
    const issues = checkRoster({ ...staffing, books: { ...staffing.books, [key]: rows }, rules: { ...staffing.rules, respectPreference: true } });
    expect(issues.some((issue) => issue.rule === "喜好")).toBe(true);
  });
});

describe("early leave", () => {
  it("closes the vacated posts and drops that person from the floor", () => {
    const result = applyEarlyLeave(board(), { personId: "arr-hall:K1", at: "10:00", strategy: "close" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const slots = slotStarts("B2");
    const index = slotIndexAt(slots, "10:15");
    const row = result.state.staffing!.books["arr-hall|B2|c30|a10"]!.find((item) => item.code === "K1");
    expect(row?.cells[index]).toBe("早走");
    expect(result.state.staffing!.closures[0]?.slots.length).toBeGreaterThan(0);
    const shown = projectBoard({ ...result.state, now: "10:15" });
    const closed = result.state.staffing!.closures[0]!.slots.find((slot) => slot.index === index);
    expect(shown.posts.some((post) => post.name === closed?.code)).toBe(false);
    expect(shown.staff.find((person) => person.code === "K1")?.leaveEarlyAt).toBeTruthy();
  });

  it("lets someone on rest fill the gap", () => {
    const slots = slotStarts("B2");
    const base = board();
    const key = "arr-hall|B2|c30|a10";
    base.staffing!.books[key] = [
      { id: "arr-hall:K1", code: "K1", allows: [], cells: slots.map(() => "1") },
      { id: "arr-hall:K2", code: "K2", allows: [], cells: slots.map(() => "R") },
    ];
    const result = applyEarlyLeave(base, { personId: "arr-hall:K1", at: "09:00", strategy: "fill" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const filled = result.state.staffing!.books[key]!.find((row) => row.code === "K2");
    expect(filled?.cells.some((cell) => cell === "1")).toBe(true);
  });

  it("borrows a person from another office to cover an early leave", () => {
    const slots = slotStarts("B2");
    const base = board();
    const hall = "arr-hall|B2|c30|a10";
    const dep = "dep-hall|B2|c30|a10";
    base.staffing!.books[hall] = [{ id: "arr-hall:K1", code: "K1", allows: [], cells: slots.map(() => "1") }];
    base.staffing!.books[dep] = [{ id: "dep-hall:K9", code: "K9", allows: [], cells: slots.map(() => "R") }];
    const result = applyEarlyLeave(base, { personId: "arr-hall:K1", at: "10:00", strategy: "borrow", fromOffice: "dep-hall" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const loan = result.state.staffing!.loans[0];
    const index = slotIndexAt(slots, "10:15");
    expect(loan?.personCode).toBe("K9");
    expect(loan?.cells[index]).toBe("1");
    expect(result.state.staffing!.books[dep]!.find((row) => row.code === "K9")?.cells[index]).toBe("on loan to Arr Hall");
    const arrived = projectBoard({ ...result.state, now: "10:15" });
    expect(arrived.staff.some((person) => person.code === "K9")).toBe(true);
    const home = projectBoard({ ...result.state, now: "10:15", staffing: { ...result.state.staffing!, officeId: "dep-hall" } });
    expect(home.staff.some((person) => person.code === "K9")).toBe(false);
  });
});

describe("loans", () => {
  it("moves two people from Dep Hall onto Arr Hall from 10:00 until the shift ends", () => {
    const base = board();
    const dep = { ...base, staffing: { ...base.staffing!, officeId: "dep-hall" as const } };
    const first = createLoan(dep, { personId: "dep-hall:K1", toOffice: "arr-hall", start: "10:00", end: null });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const second = createLoan(first.state, { personId: "dep-hall:K2", toOffice: "arr-hall", start: "10:00", end: null });
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    const loaned = second.state;
    const source = projectBoard({ ...loaned, now: "10:15", staffing: { ...loaned.staffing!, officeId: "dep-hall" } });
    const target = projectBoard({ ...loaned, now: "10:15", staffing: { ...loaned.staffing!, officeId: "arr-hall" } });
    expect(source.staff.some((person) => person.code === "K1")).toBe(false);
    expect(target.staff.some((person) => person.code === "K1")).toBe(true);
    const marked = loaned.staffing!.books["dep-hall|B2|c30|a10"]!.find((row) => row.code === "K1");
    expect(marked?.cells.some((cell) => cell === "on loan to Arr Hall")).toBe(true);
    const ended = setLoanEnd(loaned, loaned.staffing!.loans[0]!.id, "11:00");
    expect(ended.staffing?.loans[0]?.end).toBe("11:00");
    const restored = revokeLoan(ended, ended.staffing!.loans[0]!.id);
    expect(restored.staffing?.loans).toHaveLength(1);
    const back = restored.staffing!.books["dep-hall|B2|c30|a10"]!.find((row) => row.code === "K1");
    expect(back?.cells.some((cell) => cell.startsWith("on loan"))).toBe(false);
  });
});

describe("generated roster posts", () => {
  function workRuns(cells: string[]) {
    const runs: string[][] = [];
    let run: string[] = [];
    for (const cell of cells) {
      if (!cell || isRestCode(cell)) {
        if (run.length) runs.push(run);
        run = [];
        continue;
      }
      run.push(cell);
    }
    if (run.length) runs.push(run);
    return runs;
  }

  function restBoundaries(cells: string[]) {
    const boundaries: { slot: number; before: string; after: string }[] = [];
    let previous = "";
    let sawRest = false;
    cells.forEach((cell, slot) => {
      if (!cell || isRestCode(cell)) {
        if (previous) sawRest = true;
        return;
      }
      if (sawRest && previous) boundaries.push({ slot, before: previous, after: cell });
      previous = cell;
      sawRest = false;
    });
    return boundaries;
  }

  function othersTaken(rows: { cells: string[] }[], rowIndex: number, slot: number) {
    const taken = new Set<string>();
    rows.forEach((row, index) => {
      if (index === rowIndex) return;
      const cell = row.cells[slot] ?? "";
      if (cell && !isRestCode(cell)) taken.add(cell);
    });
    return taken;
  }

  it("leaves the pre-rest post when returnAfterRest is off and another post is free", () => {
    const rules = { ...defaultRules("B2"), returnAfterRest: false };
    const staffing = { counters: 4, apc: 2, kiosks: 0, rules };
    const posts = openPostCodes("arr-hall", staffing);
    const rows = generateRoster("arr-hall", "B2", staffing, false);
    let checked = 0;
    rows.forEach((row, rowIndex) => {
      for (const boundary of restBoundaries(row.cells)) {
        const taken = othersTaken(rows, rowIndex, boundary.slot);
        const alternative = posts.some((code) => code !== boundary.before && !taken.has(code));
        if (!alternative) continue;
        expect(boundary.after).not.toBe(boundary.before);
        checked += 1;
      }
    });
    expect(checked).toBeGreaterThan(0);
    const work = rows[0]?.cells.filter((cell) => cell && !isRestCode(cell)) ?? [];
    expect(work.length).toBeGreaterThan(1);
    expect(new Set(work).size).toBeGreaterThan(1);
  });

  it("spreads counter and APC codes across the shift when returnAfterRest is off", () => {
    const rules = { ...defaultRules("B2"), returnAfterRest: false };
    const staffing = { counters: 30, apc: 10, kiosks: 0, rules };
    const rows = generateRoster("arr-hall", "B2", staffing, false);
    const workOf = (cells: string[]) => cells.filter((cell) => cell && !isRestCode(cell));
    const k1 = workOf(rows[0]?.cells ?? []);
    expect(k1.length).toBeGreaterThan(1);
    expect(new Set(k1).size).toBeGreaterThan(1);
    const apcPeople = rows.filter((row) => workOf(row.cells).some((cell) => cell.startsWith("Apc ")));
    expect(apcPeople.length).toBeGreaterThan(0);
    for (const row of apcPeople) expect(new Set(workOf(row.cells)).size).toBeGreaterThan(1);
    const glued = rows.filter((row) => {
      const work = workOf(row.cells);
      return work.length > 1 && new Set(work).size === 1;
    });
    expect(glued).toEqual([]);
    const posts = openPostCodes("arr-hall", staffing);
    for (const row of rows) {
      for (const run of workRuns(row.cells)) expect(new Set(run).size).toBe(1);
    }
    for (let slot = 0; slot < (rows[0]?.cells.length ?? 0); slot += 1) {
      const seen = new Map<string, number>();
      for (const row of rows) {
        const cell = row.cells[slot] ?? "";
        if (!cell || isRestCode(cell)) continue;
        seen.set(cell, (seen.get(cell) ?? 0) + 1);
      }
      for (const count of seen.values()) expect(count).toBe(1);
      for (const code of posts) expect(seen.has(code)).toBe(true);
    }
  });

  it("returns to the prior post after rest when returnAfterRest is on and that post is free", () => {
    const rules = { ...defaultRules("B2"), returnAfterRest: true, stickyPost: true };
    const staffing = { counters: 3, apc: 1, kiosks: 0, rules };
    const rows = generateRoster("arr-hall", "B2", staffing, false);
    let checked = 0;
    rows.forEach((row, rowIndex) => {
      for (const boundary of restBoundaries(row.cells)) {
        const taken = othersTaken(rows, rowIndex, boundary.slot);
        if (taken.has(boundary.before)) continue;
        expect(boundary.after).toBe(boundary.before);
        checked += 1;
      }
    });
    expect(checked).toBeGreaterThan(0);
    const home = workRuns(rows[0]?.cells ?? []);
    expect(home.length).toBeGreaterThan(1);
    expect(new Set(home[0] ?? [])).toEqual(new Set(home[1] ?? []));
  });

  it("rotates kiosk posts inside a work run when stickyPost is off", () => {
    const rules = { ...defaultRules("B2"), stickyPost: false, returnAfterRest: false };
    const staffing = { counters: 0, apc: 0, kiosks: 4, rules };
    const rows = generateRoster("arr-kiosk", "B2", staffing, false);
    const runs = workRuns(rows[0]?.cells ?? []).filter((run) => run.length > 1);
    expect(runs.length).toBeGreaterThan(0);
    expect(runs.some((run) => new Set(run).size > 1)).toBe(true);
    expect(rows[0]?.cells.some((cell) => /^A\d+$/.test(cell))).toBe(true);
  });

  it("does not keep the pre-meal post after MB when returnAfterRest is off", () => {
    const rules = { ...defaultRules("B1"), returnAfterRest: false };
    const staffing = { counters: 3, apc: 1, kiosks: 0, rules };
    const posts = openPostCodes("arr-hall", staffing);
    const rows = generateRoster("arr-hall", "B1", staffing, false);
    const row = rows[0];
    expect(row?.cells.includes("MB")).toBe(true);
    const mealAt = row?.cells.findIndex((cell) => cell === "MB") ?? -1;
    const before = [...(row?.cells.slice(0, mealAt) ?? [])].reverse().find((cell) => cell && !isRestCode(cell));
    const afterIndex = row?.cells.findIndex((cell, index) => index > mealAt && cell && !isRestCode(cell)) ?? -1;
    const after = afterIndex >= 0 ? row?.cells[afterIndex] : "";
    const taken = othersTaken(rows, 0, afterIndex);
    const alternative = posts.some((code) => code !== before && !taken.has(code));
    expect(before && after && alternative).toBeTruthy();
    expect(after).not.toBe(before);
  });
});

describe("overlapping shifts", () => {
  it("keeps B1 and C2 on the timeline after B2 ends at 13:15", () => {
    const staffing = {
      ...createDefaultStaffing(),
      counters: 2,
      apc: 1,
      kiosks: 1,
      books: {},
      percent: null,
    };
    const roster = combinedRoster(staffing, "preview");
    expect(roster.shifts).toEqual(["B2", "B1", "C2", "E1", "A"]);
    expect(roster.slots[0]).toBe("06:30");
    const at1245 = roster.slots.indexOf("12:45");
    const at1315 = roster.slots.indexOf("13:15");
    const b2 = roster.rows.filter((row) => row.code.startsWith("B2 "));
    const b1 = roster.rows.filter((row) => row.code.startsWith("B1 "));
    expect(at1245).toBeGreaterThanOrEqual(0);
    expect(at1315).toBeGreaterThan(at1245);
    expect(b2.some((row) => row.cells[at1245])).toBe(true);
    expect(b2.every((row) => row.cells[at1315] === "")).toBe(true);
    expect(b1.some((row) => row.cells[at1315] && !isRestCode(row.cells[at1315] ?? ""))).toBe(true);
    expect(roster.rows.some((row) => row.code.startsWith("C2 ") && row.cells[at1315])).toBe(true);
  });

  it("shows B1 and C2 still working at 13:15, and labels only meal breaks as MB", () => {
    const later = projectBoard({ ...board(), now: "13:15" });
    expect(later.staff.some((person) => person.shift === "B2")).toBe(false);
    expect(later.staff.some((person) => person.shift === "B1")).toBe(true);
    expect(later.staff.some((person) => person.shift === "C2")).toBe(true);
    expect(later.staff.some((person) => person.shift === "E1")).toBe(true);
    expect(later.staff.every((person) => /^(B1|C2|E1) /.test(person.code))).toBe(true);

    const meal = projectBoard({ ...board(), now: "11:15" });
    expect(meal.staff.some((person) => person.shift === "B1" && person.breakStart === "11:15" && person.breakEnd === "11:45")).toBe(true);
    expect(meal.staff.some((person) => person.shift === "B2" && !person.breakStart && !person.dutyPost && !person.leaveEarlyAt)).toBe(true);
  });

  it("writes a one-hour MB and keeps ordinary rests as R", () => {
    const staffing = { counters: 2, apc: 1, kiosks: 1, rules: defaultRules("B1") };
    const slots = slotStarts("B1");
    const rows = generateRoster("arr-hall", "B1", staffing, false);
    const mealSlots = slots.filter((slot) => slot === "11:15" || slot === "11:45");
    expect(mealSlots).toEqual(["11:15", "11:45"]);
    expect(mealSlots.length * 30).toBe(60);
    for (const row of rows) {
      for (const slot of mealSlots) expect(row.cells[slots.indexOf(slot)]).toBe("MB");
      expect(row.cells.includes("R")).toBe(true);
    }
  });

  it("shares one counter pool across B1 and B2", () => {
    const staffing = {
      ...createDefaultStaffing(),
      counters: 10,
      apc: 0,
      kiosks: 0,
      books: {},
      percent: null,
    };
    const roster = combinedRoster(staffing, "preview");
    const used = postsAt(roster, "09:15");
    expect(used.size).toBeGreaterThan(0);
    expect(used.size).toBeLessThanOrEqual(10);
    for (const names of used.values()) expect(names).toHaveLength(1);
    const holders = [...used.values()].flat();
    expect(holders.some((code) => code.startsWith("B2 "))).toBe(true);
    expect(holders.some((code) => code.startsWith("B1 "))).toBe(true);
    const shown = projectBoard({
      ...board(),
      now: "09:15",
      staffing,
    });
    expect(shown.posts).toHaveLength(10);
    const duty = shown.staff.map((person) => person.dutyPost).filter((post): post is string => Boolean(post));
    expect(new Set(duty).size).toBe(duty.length);
    expect(duty.length).toBeLessThanOrEqual(10);
  });

  it("lets C2 take a shared post while an earlier shift is on MB", () => {
    const staffing = {
      ...createDefaultStaffing(),
      counters: 10,
      apc: 0,
      kiosks: 0,
      books: {},
      percent: null,
    };
    const roster = combinedRoster(staffing, "preview");
    const at = roster.slots.indexOf("11:15");
    const b1 = roster.rows.filter((row) => row.code.startsWith("B1 "));
    expect(b1.some((row) => row.cells[at] === "MB")).toBe(true);
    expect(b1.some((row) => row.cells[at] !== "MB")).toBe(true);
    for (const row of b1) {
      const meals: string[] = [];
      roster.slots.forEach((slot, index) => {
        if (row.cells[index] === "MB") meals.push(slot);
      });
      expect(meals).toHaveLength(2);
      expect(meals[1]).toBe(addHalfHour(meals[0] ?? ""));
    }
    expect(roster.rows.some((row) => row.code.startsWith("C2 ") && row.cells[at] && !isRestCode(row.cells[at] ?? ""))).toBe(true);
    const used = postsAt(roster, "11:15");
    expect(used.size).toBeLessThanOrEqual(10);
    for (const names of used.values()) expect(names).toHaveLength(1);
    const later = postsAt(roster, "13:15");
    expect(later.size).toBeLessThanOrEqual(10);
    expect([...later.values()].flat().some((code) => code.startsWith("B2 "))).toBe(false);
    const floor = projectBoard({ ...board(), now: "11:15", staffing });
    expect(floor.staff.some((person) => person.shift === "B1" && person.breakStart === "11:15")).toBe(true);
    expect(floor.staff.some((person) => person.shift === "C2" && person.dutyPost)).toBe(true);
    const duty = floor.staff.map((person) => person.dutyPost).filter((post): post is string => Boolean(post));
    expect(new Set(duty).size).toBe(duty.length);
    expect(duty.length).toBeLessThanOrEqual(10);
  });

  it("splits one baseline crew across B2, B1 and C2 instead of copying it onto each shift", () => {
    const staffing = {
      ...createDefaultStaffing(),
      counters: 31,
      apc: 0,
      kiosks: 0,
      books: {},
      percent: null,
    };
    expect(crewFor(staffing)).toBe(41);
    const roster = combinedRoster(staffing, "preview");
    const count = (shiftId: string) => roster.rows.filter((row) => row.code.startsWith(`${shiftId} `)).length;
    expect(count("B2")).toBeGreaterThan(0);
    expect(count("B1")).toBeGreaterThan(0);
    expect(count("C2")).toBeGreaterThan(0);
    expect(count("B2")).toBeLessThan(41);
    expect(count("B1")).toBeLessThan(41);
    expect(count("C2")).toBeLessThan(41);
    const total = count("B2") + count("B1") + count("C2");
    expect(total).toBeGreaterThan(41);
    expect(total).toBeLessThan(41 * 2);
    const morning = postsAt(roster, "09:15");
    expect(morning.size).toBe(31);
    for (const names of morning.values()) expect(names).toHaveLength(1);
    const later = projectBoard({ ...board(), now: "13:15", staffing });
    const duty = later.staff.map((person) => person.dutyPost).filter((post): post is string => Boolean(post));
    expect(new Set(duty).size).toBe(duty.length);
    expect(duty.length).toBe(31);
    expect(later.staff.some((person) => person.shift === "B2")).toBe(false);
    expect(later.staff.some((person) => person.shift === "B1" && person.dutyPost)).toBe(true);
    expect(later.staff.some((person) => person.shift === "C2" && person.dutyPost)).toBe(true);
  });

  it("counts only people whose duty window covers now, and shows 0 off the clock", () => {
    const demo = createAppSeed();
    expect(demo.now).toBe("13:10");
    expect(crewFor(demo.staffing!)).toBe(52);
    expect(openPostCodes("arr-hall", demo.staffing!)).toHaveLength(40);
    const focus = officeFocus(demo);
    const shown = projectBoard(demo);
    expect(focus?.total).toBe(40);
    expect(focus?.filled).toBe(40);
    expect(focus?.onSite).toBe((focus?.onduty ?? 0) + (focus?.rest ?? 0));
    expect(focus?.onSite).toBeGreaterThan(40);
    expect(focus?.onSite).toBeLessThan(150);
    expect(focus?.onSite).not.toBe(222);
    expect(focus?.rest).toBeLessThan(120);
    expect(focus?.rest).not.toBe(182);
    expect(shown.posts).toHaveLength(40);
    expect(shown.staff.every((person) => isWithinDuty(person, demo.now))).toBe(true);
    expect(shown.staff.every((person) => shiftsActiveAt(demo.now).includes(person.shift as "B2"))).toBe(true);
    expect(shown.staff.some((person) => person.shift === "A")).toBe(false);
    expect(shown.staff.some((person) => person.shift === "B2")).toBe(true);
    expect(offClockWarning(demo.now, "B2")).toBeNull();

    const night = { ...demo, now: "01:10" };
    expect(shiftsActiveAt(night.now)).toEqual(["A"]);
    const nightFocus = officeFocus(night);
    const nightBoard = projectBoard(night);
    expect(nightBoard.posts).toHaveLength(40);
    expect(nightBoard.staff.length).toBeGreaterThan(0);
    expect(nightBoard.staff.every((person) => person.shift === "A")).toBe(true);
    expect(nightBoard.staff.every((person) => isWithinDuty(person, night.now))).toBe(true);
    expect(nightFocus?.onSite).toBe((nightFocus?.onduty ?? 0) + (nightFocus?.rest ?? 0));
    expect(nightFocus?.onSite).toBe(nightBoard.staff.length);
    expect(nightFocus?.onSite).toBeLessThan(120);
    expect(nightFocus?.onSite).not.toBe(222);
    expect(nightFocus?.rest).not.toBe(182);
    const nightWarning = offClockWarning(night.now, "B2");
    expect(nightWarning).toContain("唔喺 B2");
    expect(nightWarning).toContain("唔會計入在場或休息");
    expect(shortageAdvice(night.staffing!, night.now).text).toBe(nightWarning);

    const off = { ...demo, now: "00:00" };
    expect(shiftsActiveAt(off.now)).toEqual([]);
    expect(offClockWarning(off.now)).toContain("在場係 0");
    expect(offClockWarning(off.now, "B2")).toContain("在場係 0");
    expect(shortageAdvice(off.staffing!, off.now).text).toBe(offClockWarning(off.now));
    const empty = officeFocus(off);
    expect(empty?.onSite).toBe(0);
    expect(empty?.onduty).toBe(0);
    expect(empty?.rest).toBe(0);
    expect(empty?.filled).toBe(0);
    expect(empty?.total).toBe(40);
    expect(projectBoard(off).staff).toEqual([]);
    expect(projectBoard(off).posts).toHaveLength(40);

    const moved = setShift(demo, "A");
    expect(moved.now).toBe("00:01");
    expect(shiftsActiveAt(moved.now)).toContain("A");
    const kept = setShift({ ...demo, now: "11:00" }, "B1");
    expect(kept.now).toBe("11:00");

    const snapped = ensureStaffing({ ...demo, now: "01:10" });
    expect(snapped.now).toBe("06:45");
    expect(shiftsActiveAt(snapped.now)).toContain("B2");
    expect(alignNowToSelectedShift(demo).now).toBe("13:10");
    const overnight = ensureStaffing(setShift(demo, "A"));
    expect(overnight.now).toBe("00:01");
  });

  it("edits another shift's cell without changing the selected shift", () => {
    const state = board();
    const next = setCell(state, "arr-hall:K1", 0, "MB", "B1");
    expect(next.staffing?.shiftId).toBe("B2");
    const key = bookKey("arr-hall", "B1", 30, 10, 12);
    expect(next.staffing?.books[key]?.find((row) => row.id === "arr-hall:K1")?.cells[0]).toBe("MB");
    expect(state.staffing?.books[bookKey("arr-hall", "B2", 30, 10, 12)]?.find((row) => row.code === "K1")?.cells[0]).toBe("R");
  });
});

function postsAt(roster: { slots: string[]; rows: { code: string; cells: string[] }[] }, slot: string) {
  const index = roster.slots.indexOf(slot);
  const used = new Map<string, string[]>();
  for (const row of roster.rows) {
    const cell = row.cells[index] ?? "";
    if (!cell || isRestCode(cell)) continue;
    const names = used.get(cell) ?? [];
    names.push(row.code);
    used.set(cell, names);
  }
  return used;
}

function addHalfHour(slot: string) {
  const [hour, minute] = slot.split(":").map(Number);
  const total = (hour ?? 0) * 60 + (minute ?? 0) + 30;
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

describe("temporary posts", () => {
  it("adds counter and APC posts onto the floor, roster and preview workbook", async () => {
    const base = {
      ...createDefaultStaffing(),
      counters: 10,
      apc: 0,
      kiosks: 0,
      books: {},
      percent: 100,
    };
    const before = { ...board(), now: "09:15", staffing: base };
    const beforeCodes = openPostCodes("arr-hall", base);
    const beforeCrew = crewFor(base);
    expect(beforeCodes).toHaveLength(10);
    expect(beforeCodes).not.toContain("11");

    const added = addOpenPosts(addOpenPosts(before, "counter", 2), "apc", 1);
    const staffing = added.staffing!;
    expect(staffing.counters).toBe(12);
    expect(staffing.apc).toBe(1);
    expect(staffing.percent).toBeNull();
    const codes = openPostCodes("arr-hall", staffing);
    expect(codes).toEqual([...Array.from({ length: 12 }, (_, index) => String(index + 1)), "Apc 1"]);
    expect(crewFor(staffing)).toBeGreaterThan(beforeCrew);
    expect(projectBoard(added).posts).toHaveLength(13);
    expect(projectBoard(added).posts.map((post) => post.name)).toEqual(expect.arrayContaining(["11", "12", "Apc 1"]));

    const roster = combinedRoster(staffing, "preview");
    const morning = postsAt(roster, "09:15");
    expect(morning.size).toBe(13);
    expect(morning.has("11")).toBe(true);
    expect(morning.has("12")).toBe(true);
    expect(morning.has("Apc 1")).toBe(true);
    for (const names of morning.values()) expect(names).toHaveLength(1);

    const buffer = await buildPreviewWorkbook(staffing);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer as ExcelJS.Buffer);
    const sheet = workbook.getWorksheet("preview");
    const values = new Set<string>();
    sheet?.eachRow((row) => {
      row.eachCell((cell) => {
        const value = String(cell.value ?? "");
        if (value) values.add(value);
      });
    });
    expect(values.has("11")).toBe(true);
    expect(values.has("12")).toBe(true);
    expect(values.has("Apc 1")).toBe(true);
  });

  it("adds kiosk posts only on a kiosk office", () => {
    const hall = addOpenPosts(board(), "kiosk", 2);
    expect(hall.staffing?.kiosks).toBe(createDefaultStaffing().kiosks);
    const kiosk = {
      ...board(),
      staffing: { ...createDefaultStaffing(), officeId: "arr-kiosk" as const, kiosks: 4, books: {}, percent: null },
    };
    const added = addOpenPosts(kiosk, "kiosk", 2);
    expect(added.staffing?.kiosks).toBe(6);
    expect(openPostCodes("arr-kiosk", added.staffing!)).toEqual(["A1", "A2", "A3", "A4", "A5", "A6"]);
    expect(crewFor(added.staffing!)).toBeGreaterThan(crewFor(kiosk.staffing!));
    expect(addOpenPosts(added, "counter", 1).staffing?.counters).toBe(added.staffing?.counters);
  });
});

describe("preview workbook", () => {
  it("writes an xlsx with orange rest cells on the overlapping timeline", async () => {
    const buffer = await buildPreviewWorkbook(createDefaultStaffing());
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer as ExcelJS.Buffer);
    const sheet = workbook.getWorksheet("preview");
    expect(sheet?.getRow(1).getCell(1).value).toBe("員工");
    expect(sheet?.getRow(2).getCell(1).value).toBe("B2 K1");
    let rest: ExcelJS.Cell | undefined;
    sheet?.eachRow((row, index) => {
      if (index === 1 || rest) return;
      row.eachCell((cell, col) => {
        if (col === 1 || rest) return;
        if (cell.value === "R") rest = cell;
      });
    });
    expect(rest?.value).toBe("R");
    expect(rest?.fill && "fgColor" in rest.fill ? rest.fill.fgColor?.argb : "").toBe("FFF4B183");
    let at = 0;
    sheet?.getRow(1).eachCell((cell, col) => {
      if (cell.value === "09:15") at = col;
    });
    const used = new Map<string, number>();
    sheet?.eachRow((row, index) => {
      if (index === 1) return;
      const value = String(row.getCell(at).value ?? "");
      if (!value || isRestCode(value)) return;
      used.set(value, (used.get(value) ?? 0) + 1);
    });
    expect(used.size).toBeLessThanOrEqual(40);
    for (const count of used.values()) expect(count).toBe(1);
  });

  it("paints B1 meal cells as MB", async () => {
    const staffing = { ...createDefaultStaffing(), shiftId: "B1" as const, rules: defaultRules("B1"), books: {} };
    const buffer = await buildPreviewWorkbook(staffing);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer as ExcelJS.Buffer);
    const sheet = workbook.getWorksheet("preview");
    let mealCol = 0;
    sheet?.getRow(1).eachCell((cell, col) => {
      if (cell.value === "11:15") mealCol = col;
    });
    let meal: ExcelJS.Cell | undefined;
    sheet?.eachRow((row, index) => {
      if (index === 1 || meal) return;
      if (String(row.getCell(1).value ?? "").startsWith("B1 ") && row.getCell(mealCol).value === "MB") meal = row.getCell(mealCol);
    });
    expect(meal?.value).toBe("MB");
    expect(meal?.fill && "fgColor" in meal.fill ? meal.fill.fgColor?.argb : "").toBe("FFF8CBAD");
  });
});
