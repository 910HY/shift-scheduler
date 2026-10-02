import { toString as qrToString } from "qrcode";
import { splitStaffCode } from "@/logic/label";
import { dayBoards, isLoanMarker, OFFICES, officeLabel, SHIFTS, slotStarts } from "@/logic/staffing";
import type { OfficeId, ShiftId, StaffingState } from "@/types";

const OFFICE_IDS = OFFICES.map((office) => office.id);
const SHIFT_IDS = SHIFTS.map((shift) => shift.id);
const MAX_CELLS = 48;
const MAX_CELL_LENGTH = 80;

export type ScanPerson = {
  shiftId: ShiftId;
  rowId: string;
  code: string;
  label: string;
  cells: string[];
};

export type PersonScan = {
  ok: true;
  view: "person";
  staff: string;
  shift: ShiftId | null;
  date: string;
  loc: OfficeId;
  cells: string[] | null;
};

export type SupervisorScan = {
  ok: true;
  view: "supervisor";
  date: string;
  loc: OfficeId;
};

export type ScanLink = PersonScan | SupervisorScan | { ok: false; message: string };

export function parseScanSearch(search: string): ScanLink | null {
  const params = new URLSearchParams(queryString(search));
  if (!params.has("view")) return null;
  const view = (params.get("view") ?? "").trim().toLowerCase();
  if (view !== "person" && view !== "supervisor") {
    return { ok: false, message: `view 要係 person（員工）或 supervisor（主管）。而家係「${params.get("view")?.trim() || "空"}」。` };
  }

  const missing: string[] = [];
  const dateRaw = params.get("date")?.trim() ?? "";
  const locRaw = params.get("loc")?.trim() ?? "";
  const staffRaw = params.get("staff")?.trim() ?? "";
  if (!dateRaw) missing.push("date（日期 YYYY-MM-DD）");
  if (!locRaw) missing.push("loc（辦公區，例如 arr-hall）");
  if (view === "person" && !staffRaw) missing.push("staff（員工，例如 K4）");
  if (missing.length) return { ok: false, message: `呢條 link 缺參數：${missing.join("、")}。` };

  if (!isIsoDate(dateRaw)) return { ok: false, message: `日期格式唔啱（${dateRaw}）。要用 YYYY-MM-DD。` };
  if (!isOfficeId(locRaw)) {
    return { ok: false, message: `辦公區 loc 唔識（${locRaw}）。可用：${OFFICE_IDS.join("、")}。` };
  }

  if (view === "supervisor") return { ok: true, view: "supervisor", date: dateRaw, loc: locRaw };

  const shiftRaw = params.get("shift")?.trim() ?? "";
  let shift: ShiftId | null = null;
  if (shiftRaw) {
    if (!isShiftId(shiftRaw)) return { ok: false, message: `更 shift 唔識（${shiftRaw}）。可用：${SHIFT_IDS.join("、")}。` };
    shift = shiftRaw;
  }
  const token = parseStaffToken(staffRaw);
  if (!token.ok) return token;
  if (token.shift && shift && token.shift !== shift) {
    return { ok: false, message: `staff 入面嘅更係 ${token.shift}，shift 參數係 ${shift}。請用同一個更。` };
  }
  const resolvedShift = shift ?? token.shift;
  const cellsResult = parseCells(params.get("cells"));
  if (!cellsResult.ok) return cellsResult;
  if (cellsResult.cells && !resolvedShift) {
    return { ok: false, message: "link 有 cells 就要有 shift，先知道邊一更嘅時間格。" };
  }
  if (cellsResult.cells && resolvedShift && cellsResult.cells.length !== slotStarts(resolvedShift).length) {
    const expected = slotStarts(resolvedShift).length;
    return {
      ok: false,
      message: `崗位格數唔啱：link 有 ${cellsResult.cells.length} 格，${resolvedShift} 應該有 ${expected} 格。`,
    };
  }
  return {
    ok: true,
    view: "person",
    staff: token.code,
    shift: resolvedShift,
    date: dateRaw,
    loc: locRaw,
    cells: cellsResult.cells,
  };
}

export function personScanPath(input: { staff: string; shift: ShiftId; date: string; loc: OfficeId; cells?: string[] }): string {
  const params = new URLSearchParams({
    view: "person",
    staff: input.staff,
    shift: input.shift,
    date: input.date,
    loc: input.loc,
  });
  if (input.cells) params.set("cells", JSON.stringify(input.cells));
  return `/?${params.toString()}`;
}

export function supervisorScanPath(input: { date: string; loc: OfficeId }): string {
  const params = new URLSearchParams({
    view: "supervisor",
    date: input.date,
    loc: input.loc,
  });
  return `/?${params.toString()}`;
}

export function scanUrl(origin: string, path: string): string {
  return `${origin.replace(/\/$/, "")}${path.startsWith("/") ? path : `/${path}`}`;
}

export function listScanPeople(staffing: StaffingState, officeId: OfficeId): ScanPerson[] {
  const people: ScanPerson[] = [];
  for (const board of dayBoards({ ...staffing, officeId })) {
    for (const row of board.rows) {
      const badge = splitStaffCode(row.code, board.shiftId);
      const code = badge.code || row.code;
      people.push({
        shiftId: board.shiftId,
        rowId: row.id,
        code,
        label: badge.label || `${board.shiftId} ${code}`,
        cells: row.cells.slice(),
      });
    }
  }
  return people;
}

export function findScanPerson(
  staffing: StaffingState,
  officeId: OfficeId,
  staff: string,
  shift: ShiftId | null,
): { ok: true; person: ScanPerson } | { ok: false; message: string } {
  const people = listScanPeople(staffing, officeId).filter((person) => person.code === staff && (!shift || person.shiftId === shift));
  if (people.length === 1) return { ok: true, person: people[0] };
  const where = officeLabel(officeId);
  if (people.length === 0) {
    return { ok: false, message: `喺 ${where} 搵唔到員工 ${shift ? `${shift} ` : ""}${staff}。` };
  }
  const shifts = [...new Set(people.map((person) => person.shiftId))].join("、");
  return { ok: false, message: `員工 ${staff} 喺多過一個更（${shifts}）。請喺 link 加上 shift。` };
}

export function scanDateIssue(linkDate: string, boardDate: string): string | null {
  if (linkDate === boardDate) return null;
  return `呢條 link 日期係 ${linkDate}，本機編更日係 ${boardDate}。請返主程式對齊日期，再產生 QR。`;
}

export function printCell(value: string) {
  if (!value) return "—";
  if (isLoanMarker(value)) return "借";
  return value;
}

/** SVG QR whose payload is exactly `text` (a working URL). */
export async function qrSvg(text: string): Promise<string> {
  const svg = await qrToString(text, { type: "svg", margin: 1, errorCorrectionLevel: "M" });
  if (!svg.includes("<svg")) throw new Error("QR 產生失敗");
  return svg;
}

function queryString(search: string): string {
  const hash = search.indexOf("#");
  const bare = hash >= 0 ? search.slice(0, hash) : search;
  const query = bare.indexOf("?");
  if (query >= 0) return bare.slice(query + 1);
  return bare.replace(/^\?/, "");
}

function parseCells(raw: string | null): { ok: true; cells: string[] | null } | { ok: false; message: string } {
  if (raw == null || raw.trim() === "") return { ok: true, cells: null };
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ok: false, message: "cells 讀唔到。員工 QR 嘅崗位格要係 JSON 陣列。" };
  }
  if (!Array.isArray(parsed) || parsed.some((cell) => typeof cell !== "string")) {
    return { ok: false, message: "cells 要係字串陣列，每一格一個崗位。" };
  }
  const cells = parsed as string[];
  if (cells.length > MAX_CELLS || cells.some((cell) => cell.length > MAX_CELL_LENGTH)) {
    return { ok: false, message: "cells 太長，呢條 link 唔似有效嘅個人更表。" };
  }
  return { ok: true, cells };
}

function parseStaffToken(staff: string): { ok: true; code: string; shift: ShiftId | null } | { ok: false; message: string } {
  const text = staff.trim();
  const dashed = /^([A-Za-z][A-Za-z0-9]*)-(.+)$/.exec(text);
  if (dashed && isShiftId(dashed[1])) {
    const code = dashed[2].trim();
    if (!code) return { ok: false, message: "staff 缺工號。" };
    return { ok: true, code, shift: dashed[1] };
  }
  const split = splitStaffCode(text);
  if (split.shift && split.code && isShiftId(split.shift)) {
    return { ok: true, code: split.code, shift: split.shift };
  }
  if (!text) return { ok: false, message: "staff 缺工號。" };
  return { ok: true, code: text, shift: null };
}

function isIsoDate(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

function isOfficeId(value: string): value is OfficeId {
  return OFFICE_IDS.includes(value as OfficeId);
}

function isShiftId(value: string): value is ShiftId {
  return SHIFT_IDS.includes(value as ShiftId);
}
