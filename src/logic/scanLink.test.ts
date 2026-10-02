import { createDefaultStaffing, shiftOf, slotStarts } from "@/logic/staffing";
import { createAppSeed } from "@/logic/seed";
import {
  findScanPerson,
  listScanPeople,
  parseScanSearch,
  personScanPath,
  qrSvg,
  scanDateIssue,
  scanUrl,
  supervisorScanPath,
} from "@/logic/scanLink";
import { describe, expect, it } from "vitest";

const staffing = createDefaultStaffing();

describe("scan deep links", () => {
  it("leaves the main app alone when there is no view", () => {
    expect(parseScanSearch("")).toBeNull();
    expect(parseScanSearch("?date=2026-09-28")).toBeNull();
  });

  it("parses a person link and a supervisor link", () => {
    expect(parseScanSearch("?view=person&staff=K4&shift=B2&date=2026-09-28&loc=arr-hall")).toEqual({
      ok: true,
      view: "person",
      staff: "K4",
      shift: "B2",
      date: "2026-09-28",
      loc: "arr-hall",
      cells: null,
    });
    expect(parseScanSearch("?view=supervisor&date=2026-09-28&loc=dep-kiosk")).toEqual({
      ok: true,
      view: "supervisor",
      date: "2026-09-28",
      loc: "dep-kiosk",
    });
  });

  it("accepts staff written as B2 K4 or B2-K4", () => {
    expect(parseScanSearch("?view=person&staff=B2%20K4&date=2026-09-28&loc=arr-hall")).toMatchObject({
      ok: true,
      staff: "K4",
      shift: "B2",
    });
    expect(parseScanSearch("?view=person&staff=B2-K4&date=2026-09-28&loc=arr-hall")).toMatchObject({
      ok: true,
      staff: "K4",
      shift: "B2",
    });
  });

  it("round-trips a person path, including the duty cells", () => {
    const cells = ["R", "7", "Apc 1"];
    const path = personScanPath({ staff: "K4", shift: "B2", date: "2026-09-28", loc: "arr-hall", cells });
    expect(path.startsWith("/?")).toBe(true);
    const parsed = parseScanSearch(path);
    expect(parsed).toMatchObject({ ok: false });
    const full = slotStarts("B2").map((_, index) => cells[index] ?? "R");
    const okPath = personScanPath({ staff: "K4", shift: "B2", date: "2026-09-28", loc: "arr-hall", cells: full });
    expect(parseScanSearch(okPath)).toMatchObject({ ok: true, view: "person", staff: "K4", shift: "B2", cells: full });
    expect(parseScanSearch(supervisorScanPath({ date: "2026-09-28", loc: "arr-hall" }))).toMatchObject({
      ok: true,
      view: "supervisor",
      loc: "arr-hall",
    });
    expect(scanUrl("http://127.0.0.1:4317/", okPath)).toBe(`http://127.0.0.1:4317${okPath}`);
  });

  it("shows a clear error for a bad or incomplete link", () => {
    expect(parseScanSearch("?view=")).toMatchObject({ ok: false });
    expect(parseScanSearch("?view=poster")).toMatchObject({ ok: false });
    expect(parseScanSearch("?view=person")).toMatchObject({ ok: false });
    expect(parseScanSearch("?view=person&staff=K4&date=2026-09-28")).toMatchObject({ ok: false });
    expect(parseScanSearch("?view=supervisor&date=28-09-2026&loc=arr-hall")).toMatchObject({ ok: false });
    expect(parseScanSearch("?view=supervisor&date=2026-02-31&loc=arr-hall")).toMatchObject({ ok: false });
    expect(parseScanSearch("?view=supervisor&date=2026-09-28&loc=roof")).toMatchObject({ ok: false });
    expect(parseScanSearch("?view=person&staff=K4&shift=Z9&date=2026-09-28&loc=arr-hall")).toMatchObject({ ok: false });
    expect(parseScanSearch("?view=person&staff=B2%20K4&shift=E1&date=2026-09-28&loc=arr-hall")).toMatchObject({ ok: false });
    expect(parseScanSearch("?view=person&staff=K4&shift=B2&date=2026-09-28&loc=arr-hall&cells=nope")).toMatchObject({ ok: false });
    for (const search of [
      "?view=",
      "?view=person",
      "?view=supervisor&date=2026-09-28&loc=roof",
    ]) {
      const parsed = parseScanSearch(search);
      expect(parsed && !parsed.ok && parsed.message.length > 0).toBe(true);
    }
  });

  it("finds one person on the demo board and rejects a missing or ambiguous code", () => {
    const found = findScanPerson(staffing, "arr-hall", "K4", "B2");
    expect(found.ok).toBe(true);
    if (found.ok) {
      expect(found.person.cells.length).toBe(slotStarts("B2").length);
      expect(found.person.cells.some((cell) => cell === "R")).toBe(true);
    }
    expect(findScanPerson(staffing, "arr-hall", "K4", null).ok).toBe(false);
    expect(findScanPerson(staffing, "arr-hall", "ZZZ", "B2").ok).toBe(false);
    expect(listScanPeople(staffing, "arr-hall").some((person) => person.shiftId === "A")).toBe(true);
  });

  it("keeps the A handoff at 06:45", () => {
    expect(shiftOf("A").end).toBe("06:45");
    expect(createAppSeed().date).toBe("2026-09-28");
    expect(scanDateIssue("2026-09-28", "2026-09-28")).toBeNull();
    expect(scanDateIssue("2026-10-02", "2026-09-28")).toContain("2026-10-02");
  });

  it("encodes the deep-link URL into an SVG QR", async () => {
    const url = scanUrl("http://127.0.0.1:4317", personScanPath({
      staff: "K4",
      shift: "B2",
      date: "2026-09-28",
      loc: "arr-hall",
    }));
    const svg = await qrSvg(url);
    expect(svg.startsWith("<svg")).toBe(true);
    expect(svg).toContain("viewBox");
    const other = await qrSvg(`${url}&x=1`);
    expect(other).not.toBe(svg);
  });
});
