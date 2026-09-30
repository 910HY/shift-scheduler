import { describe, expect, it } from "vitest";
import ExcelJS from "exceljs";
import { buildPreviewWorkbook } from "@/logic/previewXlsx";
import {
  apcPosts,
  applyEarlyLeave,
  awayHours,
  checkRoster,
  createDefaultStaffing,
  createLoan,
  crewFor,
  defaultRules,
  extremeNotes,
  hallMax,
  isExtreme,
  officeFocus,
  previewFilename,
  projectBoard,
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
    const state = { ...board(), now: "13:10" };
    const hall = officeFocus(state, "arr-hall");
    const kiosk = officeFocus(state, "arr-kiosk");
    expect(hall?.label).toBe("Arr Hall");
    expect(hall?.total).toBe(40);
    expect(hall?.filled).toBe(40);
    expect(hall?.onSite).toBe(52);
    expect(kiosk?.total).toBe(12);
    expect(kiosk?.onSite).toBeLessThan(hall!.onSite);
    const site = siteOverview(state);
    expect(site.total).toBe(104);
    expect(site.onSite).toBeGreaterThan(hall!.onSite);
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

describe("preview workbook", () => {
  it("writes an xlsx with orange rest cells", async () => {
    const buffer = await buildPreviewWorkbook(createDefaultStaffing());
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer as ExcelJS.Buffer);
    const sheet = workbook.getWorksheet("preview");
    expect(sheet?.getRow(1).getCell(1).value).toBe("員工");
    expect(sheet?.getRow(2).getCell(1).value).toBe("K1");
    const rest = sheet?.getRow(2).getCell(2);
    expect(rest?.value).toBe("R");
    expect(rest?.fill && "fgColor" in rest.fill ? rest.fill.fgColor?.argb : "").toBe("FFF4B183");
  });
});
