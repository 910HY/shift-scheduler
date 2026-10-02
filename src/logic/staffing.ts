import hallCsv from "@/logic/fixtures/b2-arr-hall.csv?raw";
import kioskCsv from "@/logic/fixtures/b2-arr-kiosk.csv?raw";
import overnightCsv from "@/logic/fixtures/a-arr-kiosk.csv?raw";
import { presenceTotals } from "@/logic/presence";
import { isWithinDuty, timeToMinutes } from "@/logic/time";
import type {
  BoardState,
  OfficeId,
  Post,
  PostCover,
  PostKind,
  RosterRow,
  RuleSettings,
  ShiftId,
  Staff,
  StaffingState,
  StaffLoan,
  Zone,
} from "@/types";

export type ShiftDef = {
  id: ShiftId;
  start: string;
  end: string;
  hours: number;
  meal: boolean;
  mealStart?: string;
};

export const SHIFTS: ShiftDef[] = [
  { id: "B2", start: "06:45", end: "13:10", hours: 6.5, meal: false },
  { id: "B1", start: "06:45", end: "14:45", hours: 8, meal: true, mealStart: "11:00" },
  { id: "C2", start: "10:15", end: "18:15", hours: 8, meal: true, mealStart: "11:00" },
  { id: "E1", start: "13:10", end: "19:25", hours: 6.5, meal: false },
  { id: "E3", start: "14:30", end: "22:30", hours: 8, meal: true, mealStart: "18:00" },
  { id: "E4", start: "15:45", end: "23:45", hours: 8, meal: true, mealStart: "18:00" },
  { id: "E", start: "19:25", end: "22:15", hours: 170 / 60, meal: false },
  { id: "A", start: "22:15", end: "06:45", hours: 8.5, meal: false },
];

/** Handoff bands the floor prepares. Clock windows tile the day; other shifts still overlap inside them. */
export const FOCUS_BANDS: { id: ShiftId; prepare: string }[] = [
  { id: "B2", prepare: "10:00" },
  { id: "E1", prepare: "15:00" },
  { id: "E", prepare: "20:50" },
  { id: "A", prepare: "02:00" },
];

export const OFFICES: { id: OfficeId; label: string; kind: "hall" | "kiosk" }[] = [
  { id: "arr-hall", label: "Arr Hall", kind: "hall" },
  { id: "dep-hall", label: "Dep Hall", kind: "hall" },
  { id: "arr-kiosk", label: "Arr Kiosk", kind: "kiosk" },
  { id: "dep-kiosk", label: "Dep Kiosk", kind: "kiosk" },
];

/** Arr Kiosk and Dep Kiosk each open at 4 posts plus 2 APC. Hall stays 30 counters plus 10 APC. */
export const KIOSK_POSTS = 4;
export const KIOSK_APC = 2;

export const PERCENT_SHORTCUTS = [30, 50, 75, 100] as const;

const SLOT_MINUTES = 30;

export type RuleIssue = {
  level: "error" | "warning";
  rule: string;
  message: string;
};

export function officeOf(id: OfficeId) {
  return OFFICES.find((office) => office.id === id) ?? OFFICES[0];
}

export function shiftOf(id: ShiftId) {
  return SHIFTS.find((shift) => shift.id === id) ?? SHIFTS[0];
}

const DAY_MINUTES = 24 * 60;

/** Duty ranges in minutes. An overnight shift is split at midnight. End is exclusive. */
export function dutyRanges(shiftId: ShiftId): [number, number][] {
  const shift = shiftOf(shiftId);
  const start = timeToMinutes(shift.start);
  const end = timeToMinutes(shift.end);
  if (end > start) return [[start, end]];
  if (end < start) return [[start, DAY_MINUTES], [0, end]];
  return [];
}

function rangesOverlap(left: [number, number], right: [number, number]) {
  return left[0] < right[1] && right[0] < left[1];
}

export function shiftsOverlap(left: ShiftId, right: ShiftId) {
  const a = dutyRanges(left);
  const b = dutyRanges(right);
  return a.some((one) => b.some((other) => rangesOverlap(one, other)));
}

/** Shifts whose duty window overlaps this shift, including itself. */
export function shiftsOverlapping(shiftId: ShiftId): ShiftId[] {
  return SHIFTS.map((shift) => shift.id).filter((id) => shiftsOverlap(shiftId, id));
}

export function shiftCovers(shiftId: ShiftId, now: string) {
  const minute = timeToMinutes(now);
  return dutyRanges(shiftId).some(([start, end]) => minute >= start && minute < end);
}

/** Shifts still on duty at this clock time. End is exclusive, so 13:10 drops B2 and 06:45 drops A. */
export function shiftsActiveAt(now: string): ShiftId[] {
  return SHIFTS.filter((shift) => shiftCovers(shift.id, now)).map((shift) => shift.id);
}

export function overlapRowId(shiftId: ShiftId, rowId: string) {
  return `ov:${shiftId}:${rowId}`;
}

export function parseOverlapRowId(id: string): { shiftId: ShiftId; rowId: string } | null {
  if (!id.startsWith("ov:")) return null;
  const rest = id.slice(3);
  const split = rest.indexOf(":");
  if (split < 0) return null;
  const shiftId = rest.slice(0, split);
  if (!SHIFTS.some((shift) => shift.id === shiftId)) return null;
  return { shiftId: shiftId as ShiftId, rowId: rest.slice(split + 1) };
}

export function officeLabel(id: OfficeId) {
  return officeOf(id).label;
}

export function loanMarker(office: OfficeId) {
  return `on loan to ${officeLabel(office)}`;
}

export function isLoanMarker(value: string) {
  return value.startsWith("on loan to ");
}

export const EARLY_CELL = "早走";

export function isGapCell(value: string) {
  return !value || isLoanMarker(value) || value === EARLY_CELL;
}

export function extremeRules(shiftId: ShiftId): RuleSettings {
  return { ...defaultRules(shiftId), maxConsecutiveHours: 2.5 };
}

export function apcPosts(gates: number, gatesPerPost: number) {
  if (gatesPerPost <= 0) return 0;
  return Math.floor(gates / gatesPerPost);
}

export function hallMax(counterMax: number, gates: number, gatesPerPost: number) {
  return counterMax + apcPosts(gates, gatesPerPost);
}

export function siteCapacity(counterMax: number, gates: number, gatesPerPost: number, kioskMax: number, kioskApcMax = 0) {
  return hallMax(counterMax, gates, gatesPerPost) * 2 + (kioskMax + kioskApcMax) * 2;
}

export function scaleCount(max: number, percent: number) {
  return Math.max(0, Math.round((max * percent) / 100));
}

export function awayHours(shiftId: ShiftId, rules: RuleSettings) {
  if (shiftId === "A") {
    const big = rules.requireBigRest ? rules.bigRestMinHours : 0;
    return big + (rules.shortRestTurns * rules.shortRestMinutes) / 60;
  }
  const meal = rules.applyMeal ? rules.mealMinutes / 60 : 0;
  return meal + (rules.restTurns * rules.restTurnMinutes) / 60;
}

/** 更上 ≈ 同時在崗 ÷ ((更長 − 離崗) / 更長) */
export function requiredCrew(onDutyPosts: number, durationHours: number, away: number) {
  if (onDutyPosts <= 0) return 0;
  const working = durationHours - away;
  if (working <= 0) return onDutyPosts;
  return Math.ceil((onDutyPosts * durationHours) / working);
}

export function defaultRules(shiftId: ShiftId): RuleSettings {
  const shift = shiftOf(shiftId);
  const overnight = shiftId === "A";
  return {
    scatterRest: true,
    stickyPost: true,
    returnAfterRest: true,
    respectPreference: true,
    restTurns: overnight ? 2 : 3,
    restTurnMinutes: 30,
    mealMinutes: 60,
    applyMeal: shift.meal,
    bigRestMinHours: 2.5,
    shortRestTurns: 2,
    shortRestMinutes: 30,
    maxConsecutiveHours: 2,
    limitConsecutive: true,
    requireBigRest: overnight,
  };
}

export function isExtreme(rules: RuleSettings, shiftId: ShiftId) {
  return JSON.stringify(rules) !== JSON.stringify(defaultRules(shiftId));
}

export function extremeNotes(rules: RuleSettings, shiftId: ShiftId) {
  const base = defaultRules(shiftId);
  const notes: string[] = [];
  const flags: [keyof RuleSettings, string][] = [
    ["scatterRest", "日間 R 拆散"],
    ["stickyPost", "粘崗"],
    ["returnAfterRest", "R 後返原崗"],
    ["respectPreference", "跟員工喜好"],
    ["applyMeal", "計 meal"],
    ["limitConsecutive", "連續做上限"],
    ["requireBigRest", "A 大休"],
  ];
  for (const [key, label] of flags) {
    if (rules[key] !== base[key]) notes.push(`${label}已${rules[key] ? "打開" : "關掉"}`);
  }
  const numbers: [keyof RuleSettings, string, string][] = [
    ["restTurns", "日間休息轉數", "轉"],
    ["restTurnMinutes", "每轉休息", "分鐘"],
    ["mealMinutes", "meal", "分鐘"],
    ["bigRestMinHours", "大休最少", "小時"],
    ["shortRestTurns", "A 細休轉數", "轉"],
    ["shortRestMinutes", "A 細休", "分鐘"],
    ["maxConsecutiveHours", "連續做上限", "小時"],
  ];
  for (const [key, label, unit] of numbers) {
    if (rules[key] !== base[key]) notes.push(`${label} ${rules[key]}${unit}（預設 ${base[key]}${unit}）`);
  }
  return notes;
}

export function slotStarts(shiftId: ShiftId) {
  const shift = shiftOf(shiftId);
  const start = timeToMinutes(shift.start);
  const end = timeToMinutes(shift.end);
  const slots: string[] = [];
  if (end > start) {
    for (let minute = start; minute < end; minute += SLOT_MINUTES) slots.push(formatMinute(minute));
    return slots;
  }
  if (end === start) return slots;
  for (let minute = start; minute < DAY_MINUTES; minute += SLOT_MINUTES) slots.push(formatMinute(minute));
  const last = timeToMinutes(slots[slots.length - 1] ?? shift.start);
  const spilled = last + SLOT_MINUTES - DAY_MINUTES;
  for (let minute = spilled > 0 ? spilled : 0; minute < end; minute += SLOT_MINUTES) slots.push(formatMinute(minute));
  return slots;
}

/** Inclusive start, exclusive end. End may pass midnight as a value above 24:00. The last slot stops at duty end, so A releases posts at 06:45. */
function slotRangeOf(shiftId: ShiftId, slots: string[], index: number): [number, number] | null {
  const slot = slots[index];
  if (!slot) return null;
  const start = timeToMinutes(slot);
  const next = slots[index + 1];
  if (next) {
    const nextMin = timeToMinutes(next);
    return [start, nextMin > start ? nextMin : nextMin + DAY_MINUTES];
  }
  const shift = shiftOf(shiftId);
  const shiftStart = timeToMinutes(shift.start);
  const shiftEnd = timeToMinutes(shift.end);
  if (shiftEnd > shiftStart) return [start, shiftEnd];
  if (start >= shiftStart) return [start, shiftEnd + DAY_MINUTES];
  return [start, shiftEnd];
}

function minuteInRange(minute: number, range: [number, number]) {
  const [start, end] = range;
  if (end <= DAY_MINUTES) return minute >= start && minute < end;
  return minute >= start || minute < end - DAY_MINUTES;
}

function slotDuration(shiftId: ShiftId, slot: string) {
  const slots = slotStarts(shiftId);
  const index = slots.indexOf(slot);
  const range = index < 0 ? null : slotRangeOf(shiftId, slots, index);
  if (!range) return SLOT_MINUTES;
  return range[1] - range[0];
}

export function slotIndexAt(slots: string[], now: string, shiftId?: ShiftId) {
  const current = timeToMinutes(now);
  for (let index = 0; index < slots.length; index += 1) {
    const range = shiftId ? slotRangeOf(shiftId, slots, index) : fallbackSlotRange(slots, index);
    if (range && minuteInRange(current, range)) return index;
  }
  return -1;
}

function fallbackSlotRange(slots: string[], index: number): [number, number] | null {
  const slot = slots[index];
  if (!slot) return null;
  const start = timeToMinutes(slot);
  const next = slots[index + 1];
  if (!next) return [start, start + SLOT_MINUTES];
  const nextMin = timeToMinutes(next);
  return [start, nextMin > start ? nextMin : nextMin + DAY_MINUTES];
}

export function bookKey(officeId: OfficeId, shiftId: ShiftId, counters: number, apc: number, kiosks: number, kioskApc = 0) {
  const office = officeOf(officeId);
  if (office.kind === "hall") return `${officeId}|${shiftId}|c${counters}|a${apc}`;
  return `${officeId}|${shiftId}|k${kiosks}|a${kioskApc}`;
}

type OpenCounts = Pick<StaffingState, "counters" | "apc" | "kiosks"> & Partial<Pick<StaffingState, "kioskApc">>;

function staffingBookKey(staffing: OpenCounts, officeId: OfficeId, shiftId: ShiftId) {
  return bookKey(officeId, shiftId, staffing.counters, staffing.apc, staffing.kiosks, staffing.kioskApc ?? 0);
}

export function openPostCodes(officeId: OfficeId, staffing: OpenCounts) {
  const office = officeOf(officeId);
  if (office.kind === "hall") {
    return [
      ...numbers(staffing.counters).map(String),
      ...numbers(staffing.apc).map((index) => `Apc ${index}`),
    ];
  }
  return [
    ...numbers(staffing.kiosks).map((index) => `A${index}`),
    ...numbers(staffing.kioskApc ?? 0).map((index) => `Apc ${index}`),
  ];
}

export function simultaneousPosts(officeId: OfficeId, staffing: StaffingState) {
  return openPostCodes(officeId, staffing).length;
}

/** True when a filled cell is a post kind this person is not allowed to work. */
export function breaksPreference(allows: PostKind[], cell: string, respect = true) {
  if (!respect || allows.length === 0) return false;
  const kind = postKind(cell);
  return Boolean(kind && !allows.includes(kind));
}

export function preferenceViolations(rows: RosterRow[], respect: boolean): RuleIssue[] {
  if (!respect) return [];
  const issues: RuleIssue[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    for (const cell of row.cells) {
      if (!breaksPreference(row.allows, cell, true)) continue;
      const message = `${row.code} 不可派去 ${cell}。`;
      if (seen.has(message)) continue;
      seen.add(message);
      issues.push({ level: "error", rule: "喜好", message });
    }
  }
  return issues;
}

export function postKind(code: string): PostKind | null {
  if (/^Apc \d+$/.test(code)) return "apc";
  if (/^A\d+$/.test(code)) return "kiosk";
  if (/^\d+$/.test(code)) return "counter";
  return null;
}

export function isRestCode(code: string) {
  return code === "R" || code === "B" || code === "MB";
}

export function parseRosterCsv(text: string, officeId: OfficeId): { slots: string[]; rows: RosterRow[] } {
  const lines = text.trim().split(/\r?\n/);
  const header = splitCsv(lines[0] ?? "");
  const slotIndexes: number[] = [];
  const slots: string[] = [];
  header.forEach((cell, index) => {
    if (/^\d{2}:\d{2}$/.test(cell)) {
      slotIndexes.push(index);
      slots.push(cell);
    }
  });
  const rows = lines.slice(1).filter(Boolean).map((line) => {
    const cols = splitCsv(line);
    const code = cols[0] ?? "";
    return {
      id: rowId(officeId, code),
      code,
      allows: [],
      cells: slotIndexes.map((index) => cols[index] ?? ""),
    };
  });
  return { slots, rows };
}

export function createDefaultStaffing(): StaffingState {
  const rules = defaultRules("B2");
  const staffing: StaffingState = {
    officeId: "arr-hall",
    shiftId: "B2",
    percent: 100,
    counters: 30,
    apc: 10,
    kiosks: KIOSK_POSTS,
    kioskApc: KIOSK_APC,
    gates: 60,
    gatesPerPost: 6,
    counterMax: 30,
    kioskMax: KIOSK_POSTS,
    kioskApcMax: KIOSK_APC,
    rules,
    lockedCodes: ["1"],
    books: {},
    loans: [],
    closures: [],
  };
  const hall = parseRosterCsv(hallCsv, "arr-hall");
  const kiosk = parseRosterCsv(kioskCsv, "arr-kiosk");
  const overnight = parseRosterCsv(overnightCsv, "arr-kiosk");
  staffing.books[bookKey("arr-hall", "B2", 30, 10, 12)] = hall.rows;
  staffing.books[bookKey("dep-hall", "B2", 30, 10, 12)] = cloneRows(hall.rows, "dep-hall");
  staffing.books[bookKey("arr-kiosk", "B2", 30, 10, 12, 0)] = kiosk.rows;
  staffing.books[bookKey("dep-kiosk", "B2", 30, 10, 12, 0)] = cloneRows(kiosk.rows, "dep-kiosk");
  staffing.books[bookKey("arr-kiosk", "A", 9, 3, 4, 0)] = overnight.rows;
  return staffing;
}

export function rowsFor(staffing: StaffingState, officeId = staffing.officeId, shiftId = staffing.shiftId) {
  const key = staffingBookKey(staffing, officeId, shiftId);
  return staffing.books[key] ?? generateRoster(officeId, shiftId, staffing);
}

export function withBook(staffing: StaffingState, officeId: OfficeId, shiftId: ShiftId, rows: RosterRow[]): StaffingState {
  const key = staffingBookKey(staffing, officeId, shiftId);
  return { ...staffing, books: { ...staffing.books, [key]: rows } };
}

export function activeRows(staffing: StaffingState) {
  return rowsFor(staffing);
}

export function setOffice(state: BoardState, officeId: OfficeId): BoardState {
  if (!state.staffing) return state;
  return { ...state, staffing: { ...state.staffing, officeId } };
}

export function setShift(state: BoardState, shiftId: ShiftId): BoardState {
  if (!state.staffing) return state;
  const current = state.staffing;
  const rules = isExtreme(current.rules, current.shiftId) ? current.rules : defaultRules(shiftId);
  const now = shiftsActiveAt(state.now).includes(shiftId) ? state.now : shiftOf(shiftId).start;
  return { ...state, now, shiftName: shiftId, staffing: { ...current, shiftId, rules } };
}

/**
 * People outside the duty window for `now` are not on site and are not rest.
 * A gap with no shift stays at 0. If another shift is on but the selected one is not, say so.
 */
export function offClockWarning(now: string, shiftId?: ShiftId) {
  const active = shiftsActiveAt(now);
  if (active.length === 0) return `${now} 冇任何更當值。在場係 0，呢班人唔會當休息計。`;
  if (shiftId && !active.includes(shiftId)) {
    const shift = shiftOf(shiftId);
    return `現場 ${now} 唔喺 ${shiftId}（${shift.start}–${shift.end}）。而家當值係 ${active.join("、")}。${shiftId} 嘅人唔會計入在場或休息。`;
  }
  return null;
}

export function setPercent(state: BoardState, percent: number): BoardState {
  if (!state.staffing || !Number.isFinite(percent)) return state;
  const staffing = state.staffing;
  const clamped = Math.min(100, Math.max(0, Math.round(percent * 10) / 10));
  const counters = scaleCount(staffing.counterMax, clamped);
  const apc = scaleCount(apcPosts(staffing.gates, staffing.gatesPerPost), clamped);
  const kiosks = scaleCount(staffing.kioskMax, clamped);
  const kioskApc = scaleCount(staffing.kioskApcMax ?? 0, clamped);
  return { ...state, staffing: { ...staffing, percent: clamped, counters, apc, kiosks, kioskApc } };
}

export function setOpenCounts(state: BoardState, patch: Partial<Pick<StaffingState, "counters" | "apc" | "kiosks" | "kioskApc" | "gates" | "gatesPerPost">>): BoardState {
  if (!state.staffing) return state;
  return { ...state, staffing: { ...state.staffing, ...patch, percent: null } };
}

/** Temporary open posts on top of the current counts. A percent shortcut still returns to the baseline. */
export function addOpenPosts(state: BoardState, kind: PostKind, count = 1): BoardState {
  if (!state.staffing) return state;
  const step = Math.min(2, Math.max(1, Math.round(count)));
  const staffing = state.staffing;
  const hall = officeOf(staffing.officeId).kind === "hall";
  if (hall && kind === "kiosk") return state;
  if (!hall && kind === "counter") return state;
  const cap = 99;
  if (kind === "counter") return setOpenCounts(state, { counters: Math.min(cap, staffing.counters + step) });
  if (kind === "apc") {
    if (hall) return setOpenCounts(state, { apc: Math.min(cap, staffing.apc + step) });
    return setOpenCounts(state, { kioskApc: Math.min(cap, (staffing.kioskApc ?? 0) + step) });
  }
  return setOpenCounts(state, { kiosks: Math.min(cap, staffing.kiosks + step) });
}

export function setRules(state: BoardState, rules: RuleSettings): BoardState {
  if (!state.staffing) return state;
  return { ...state, staffing: { ...state.staffing, rules } };
}

export function setRowAllows(state: BoardState, rowId: string, allows: PostKind[]): BoardState {
  if (!state.staffing) return state;
  const staffing = state.staffing;
  const rows = activeRows(staffing).map((row) => (row.id === rowId ? { ...row, allows: normalizeAllows(allows) } : row));
  const loans = staffing.loans.map((loan) => (loan.personId === rowId || loan.id === rowId ? { ...loan, allows: normalizeAllows(allows) } : loan));
  return { ...state, staffing: { ...withBook(staffing, staffing.officeId, staffing.shiftId, rows), loans } };
}

export function setCell(state: BoardState, rowId: string, slotIndex: number, value: string, shiftId?: ShiftId): BoardState {
  if (!state.staffing) return state;
  const staffing = state.staffing;
  const next = value.trim();
  const targetShift = shiftId ?? staffing.shiftId;
  if (rowId.startsWith("loan:")) {
    const loans = staffing.loans.map((loan) => {
      if (`loan:${loan.id}` !== rowId) return loan;
      const cells = loan.cells.slice();
      cells[slotIndex] = next;
      return { ...loan, cells };
    });
    return { ...state, staffing: { ...staffing, loans } };
  }
  const view = { ...staffing, shiftId: targetShift };
  const rows = activeRows(view).map((row) => {
    if (row.id !== rowId) return row;
    if (isLoanMarker(row.cells[slotIndex] ?? "")) return row;
    const cells = row.cells.slice();
    cells[slotIndex] = next;
    return { ...row, cells };
  });
  const booked = withBook(view, view.officeId, targetShift, rows);
  return { ...state, staffing: { ...booked, shiftId: staffing.shiftId } };
}

export function createLoan(
  state: BoardState,
  input: { personId: string; toOffice: OfficeId; start: string; end: string | null; fromOffice?: OfficeId },
): { ok: true; state: BoardState } | { ok: false; reason: string } {
  if (!state.staffing) return { ok: false, reason: "未有編崗。" };
  const staffing = state.staffing;
  const fromOffice = input.fromOffice ?? staffing.officeId;
  if (input.toOffice === fromOffice) return { ok: false, reason: "不能借給自己這個區。" };
  const sourceKey = staffingBookKey(staffing, fromOffice, staffing.shiftId);
  const rows = staffing.books[sourceKey] ?? generateRoster(fromOffice, staffing.shiftId, staffing);
  const person = rows.find((row) => row.id === input.personId);
  if (!person) return { ok: false, reason: "找不到這個人。" };
  if (staffing.loans.some((loan) => loan.personId === person.id && loan.shiftId === staffing.shiftId)) {
    return { ok: false, reason: "這個人這一更已經借出。" };
  }
  const slots = slotStarts(staffing.shiftId);
  const window = slotWindow(slots, input.start, input.end ?? shiftOf(staffing.shiftId).end);
  if (!window.length) return { ok: false, reason: "借調時段不在這一更裡面。" };
  const sourceShadow = person.cells.slice();
  const marked = person.cells.slice();
  for (const index of window) marked[index] = loanMarker(input.toOffice);
  const destKey = staffingBookKey(staffing, input.toOffice, staffing.shiftId);
  const destRows = staffing.books[destKey] ?? generateRoster(input.toOffice, staffing.shiftId, staffing);
  const cells = fillLoanCells(slots, window, destRows, staffing.rules, person.allows, openPostCodes(input.toOffice, staffing));
  const loan: StaffLoan = {
    id: `loan-${person.id}-${input.toOffice}-${input.start}`,
    personId: person.id,
    personCode: person.code,
    fromOffice,
    toOffice: input.toOffice,
    shiftId: staffing.shiftId,
    start: input.start,
    end: input.end,
    allows: person.allows,
    cells,
    sourceShadow,
  };
  const nextRows = rows.map((row) => (row.id === person.id ? { ...row, cells: marked } : row));
  const booked = withBook({ ...staffing, loans: [...staffing.loans, loan] }, fromOffice, staffing.shiftId, nextRows);
  return {
    ok: true,
    state: {
      ...state,
      staffing: { ...booked, books: { ...booked.books, [destKey]: destRows } },
    },
  };
}

export function revokeLoan(state: BoardState, loanId: string): BoardState {
  if (!state.staffing) return state;
  const loan = state.staffing.loans.find((item) => item.id === loanId);
  if (!loan) return state;
  const sourceKey = staffingBookKey(state.staffing, loan.fromOffice, loan.shiftId);
  const sourceRows = (state.staffing.books[sourceKey] ?? []).map((row) =>
    row.id === loan.personId ? { ...row, cells: loan.sourceShadow.slice() } : row,
  );
  return {
    ...state,
    staffing: {
      ...state.staffing,
      loans: state.staffing.loans.filter((item) => item.id !== loanId),
      books: { ...state.staffing.books, [sourceKey]: sourceRows },
    },
  };
}

export function setLoanEnd(state: BoardState, loanId: string, end: string | null): BoardState {
  if (!state.staffing) return state;
  const staffing = state.staffing;
  const loans = staffing.loans.map((loan) => {
    if (loan.id !== loanId) return loan;
    const slots = slotStarts(loan.shiftId);
    const window = slotWindow(slots, loan.start, end ?? shiftOf(loan.shiftId).end);
    const destRows = rowsFor({ ...staffing, officeId: loan.toOffice, shiftId: loan.shiftId });
    const filled = fillLoanCells(slots, window, destRows, staffing.rules, loan.allows, openPostCodes(loan.toOffice, staffing));
    for (const index of window) {
      if (loan.cells[index]) filled[index] = loan.cells[index] ?? filled[index];
    }
    return { ...loan, end, cells: filled };
  });
  const sourceBooks = { ...staffing.books };
  for (const loan of staffing.loans) {
    if (loan.id !== loanId) continue;
    const sourceKey = staffingBookKey(staffing, loan.fromOffice, loan.shiftId);
    const nextLoan = loans.find((item) => item.id === loanId);
    sourceBooks[sourceKey] = (staffing.books[sourceKey] ?? []).map((row) => {
      if (row.id !== loan.personId || !nextLoan) return row;
      const cells = loan.sourceShadow.slice();
      const window = slotWindow(slotStarts(loan.shiftId), loan.start, end ?? shiftOf(loan.shiftId).end);
      for (const index of window) cells[index] = loanMarker(loan.toOffice);
      return { ...row, cells };
    });
  }
  return { ...state, staffing: { ...staffing, loans, books: sourceBooks } };
}

export function shortageAdvice(staffing: StaffingState, now: string) {
  const offClock = offClockWarning(now, staffing.shiftId);
  if (offClock) return { missing: [] as string[], text: offClock };
  const slots = slotStarts(staffing.shiftId);
  const index = slotIndexAt(slots, now, staffing.shiftId);
  if (index < 0) return { missing: [] as string[], text: "這一更未開始，未有在崗缺口。" };
  const open = codesAt(staffing, staffing.officeId, slots[index] ?? now);
  const taken = new Set<string>();
  for (const row of rosterRows(staffing, staffing.officeId)) {
    const cell = row.cells[index] ?? "";
    if (!isGapCell(cell) && !isRestCode(cell)) taken.add(cell);
  }
  const missing = open.filter((code) => !taken.has(code));
  let bestLabel = "";
  let bestFree = 0;
  for (const office of OFFICES) {
    if (office.id === staffing.officeId) continue;
    const free = rowsFor(staffing, office.id, staffing.shiftId).filter((row) => {
      const cell = row.cells[index] ?? "";
      const loaned = staffing.loans.some((loan) => loan.personId === row.id && loan.shiftId === staffing.shiftId);
      return cell === "R" && !loaned;
    }).length;
    if (free > bestFree) {
      bestFree = free;
      bestLabel = office.label;
    }
  }
  const text = missing.length === 0
    ? "而家崗位都有人。"
    : bestFree > 0
      ? `而家缺 ${missing.length} 人。${bestLabel} 有 ${bestFree} 人在休息，可向該區借。`
      : `而家缺 ${missing.length} 人。其他區這一格沒有人在休息。`;
  return { missing, text };
}

export function applyEarlyLeave(
  state: BoardState,
  input: { personId: string; at: string; strategy: "close" | "fill" | "borrow"; fromOffice?: OfficeId },
): { ok: true; state: BoardState; note: string } | { ok: false; reason: string } {
  if (!state.staffing) return { ok: false, reason: "未有編崗。" };
  const staffing = state.staffing;
  const slots = slotStarts(staffing.shiftId);
  const rows = activeRows(staffing).map((row) => ({ ...row, cells: row.cells.slice() }));
  const person = rows.find((row) => row.id === input.personId);
  if (!person) return { ok: false, reason: "找不到這個人。" };
  if (person.cells.some((cell, index) => timeToMinutes(slots[index] ?? "00:00") >= timeToMinutes(input.at) && isLoanMarker(cell))) {
    return { ok: false, reason: "這個人這段已經借出，請先改借調。" };
  }
  const planRows = officePlans(staffing).get(staffing.shiftId) ?? [];
  const planPerson = planRows.find((row) => row.id === person.id);
  const planVacated: { index: number; code: string }[] = [];
  planPerson?.cells.forEach((cell, index) => {
    if (timeToMinutes(slots[index] ?? "00:00") < timeToMinutes(input.at)) return;
    if (cell && !isRestCode(cell) && !isGapCell(cell)) planVacated.push({ index, code: cell });
  });
  const vacated: { index: number; code: string }[] = [];
  person.cells.forEach((cell, index) => {
    if (timeToMinutes(slots[index] ?? "00:00") < timeToMinutes(input.at)) return;
    if (cell && !isRestCode(cell) && !isGapCell(cell)) vacated.push({ index, code: cell });
    if (!isLoanMarker(cell)) person.cells[index] = EARLY_CELL;
  });
  person.leaveEarlyAt = input.at;
  let note = `${person.code} 由 ${input.at} 早走。`;
  let closures = staffing.closures ?? [];
  let covers = staffing.covers ?? [];
  if (input.strategy === "close") {
    const closed = vacated.slice();
    for (const item of planVacated) {
      if (!closed.some((slot) => slot.index === item.index && slot.code === item.code)) closed.push(item);
    }
    closures = [
      ...closures,
      { id: `close-${person.id}-${input.at}`, officeId: staffing.officeId, shiftId: staffing.shiftId, slots: closed },
    ];
    const names = [...new Set(closed.map((item) => item.code))];
    note += names.length ? ` 已減開 ${names.join("、")}。` : " 這段沒有在崗格可減。";
  }
  if (input.strategy === "fill") {
    const missed: string[] = [];
    for (const item of vacated) {
      const filler = rows.find((row) =>
        row.id !== person.id
        && row.cells[item.index] === "R"
        && !row.leaveEarlyAt
        && allowsCode(row.allows, item.code),
      );
      if (!filler) {
        missed.push(`${slots[item.index]} ${item.code}`);
        continue;
      }
      filler.cells[item.index] = item.code;
    }
    const added: PostCover[] = [];
    for (const item of planVacated) {
      const filler = planRows.find((row) =>
        row.id !== person.id
        && !row.id.startsWith("loan:")
        && row.cells[item.index] === "R"
        && !row.leaveEarlyAt,
      );
      if (!filler) {
        missed.push(`${slots[item.index]} ${item.code}`);
        continue;
      }
      added.push({ shiftId: staffing.shiftId, rowId: filler.id, index: item.index, code: item.code });
    }
    covers = [...covers, ...added];
    note += missed.length && added.length === 0 ? ` 未能補上 ${missed.join("、")}。` : " 其餘在休息的人已補上。";
  }
  const next = { ...state, staffing: { ...withBook({ ...staffing, closures, covers }, staffing.officeId, staffing.shiftId, rows), covers } };
  if (input.strategy !== "borrow") return { ok: true, state: next, note };
  if (!input.fromOffice || input.fromOffice === staffing.officeId) return { ok: false, reason: "請揀一個其他區借人。" };
  const donorBook = rowsFor(next.staffing!, input.fromOffice, staffing.shiftId);
  const kinds = new Set(vacated.map((item) => postKind(item.code)).filter(Boolean));
  const donor = donorBook.find((row) => {
    const loaned = staffing.loans.some((loan) => loan.personId === row.id && loan.shiftId === staffing.shiftId);
    if (loaned || row.leaveEarlyAt) return false;
    if (vacated.length && !vacated.every((item) => allowsCode(row.allows, item.code))) return false;
    if (kinds.size && row.allows.length && ![...kinds].every((kind) => kind && row.allows.includes(kind))) return false;
    return true;
  });
  if (!donor) return { ok: false, reason: "那個區沒有符合喜好、又未借出的人。" };
  const loaned = createLoan(next, {
    personId: donor.id,
    fromOffice: input.fromOffice,
    toOffice: staffing.officeId,
    start: input.at,
    end: null,
  });
  if (!loaned.ok) return loaned;
  const loan = loaned.state.staffing!.loans.at(-1);
  if (loan) {
    for (const item of vacated) loan.cells[item.index] = item.code;
    for (const item of planVacated) loan.cells[item.index] = item.code;
  }
  return { ok: true, state: loaned.state, note: `${note} 已向 ${officeLabel(input.fromOffice)} 借 ${donor.code}。` };
}

function allowsCode(allows: PostKind[], code: string) {
  const kind = postKind(code);
  if (!kind) return false;
  return allows.length === 0 || allows.includes(kind);
}

export function codesAt(staffing: StaffingState, officeId: OfficeId, when: string) {
  const slots = slotStarts(staffing.shiftId);
  const index = slotIndexAt(slots, when, staffing.shiftId);
  const closed = new Set<string>();
  for (const closure of staffing.closures ?? []) {
    if (closure.officeId !== officeId || closure.shiftId !== staffing.shiftId) continue;
    for (const slot of closure.slots) {
      if (slot.index === index) closed.add(slot.code);
    }
  }
  return openPostCodes(officeId, staffing).filter((code) => !closed.has(code));
}

export function checkRoster(staffing: StaffingState, officeId = staffing.officeId): RuleIssue[] {
  const shift = shiftOf(staffing.shiftId);
  const slots = slotStarts(staffing.shiftId);
  const rules = staffing.rules;
  const rows = rosterRows(staffing, officeId);
  const issues: RuleIssue[] = [];
  const maxSlots = Math.max(1, Math.round((rules.maxConsecutiveHours * 60) / SLOT_MINUTES));

  for (const row of rows) {
    let workRun: string[] = [];
    let restRun = 0;
    let bigRun = 0;
    let longestBig = 0;
    let previousWork = "";
    const flushWork = () => {
      if (rules.stickyPost && new Set(workRun).size > 1) {
        issues.push({ level: "error", rule: "粘崗", message: `${row.code} 同一段在崗轉了崗位。` });
      }
      if (rules.limitConsecutive && workRun.length > maxSlots) {
        issues.push({
          level: "error",
          rule: "連續做",
          message: `${row.code} 連續做了 ${workRun.length * 0.5} 小時，上限 ${rules.maxConsecutiveHours} 小時。`,
        });
      }
      workRun = [];
    };
    row.cells.forEach((cell, index) => {
      if (isGapCell(cell)) {
        flushWork();
        restRun = 0;
        longestBig = Math.max(longestBig, bigRun);
        bigRun = 0;
        return;
      }
      if (cell === "R") {
        flushWork();
        restRun += 1;
        longestBig = Math.max(longestBig, bigRun);
        bigRun = 0;
        if (rules.scatterRest && shift.id !== "A" && restRun > 1) {
          issues.push({ level: "error", rule: "日間 R", message: `${row.code} 在 ${slots[index]} 的 R 連格。` });
        }
        return;
      }
      if (cell === "B" || cell === "MB") {
        flushWork();
        restRun = 0;
        if (cell === "B") bigRun += 1;
        else {
          longestBig = Math.max(longestBig, bigRun);
          bigRun = 0;
        }
        return;
      }
      restRun = 0;
      longestBig = Math.max(longestBig, bigRun);
      bigRun = 0;
      if (rules.returnAfterRest && previousWork && cell !== previousWork && workRun.length === 0) {
        const taken = rows.some((other, otherIndex) => other.cells[index] === previousWork && rows.indexOf(row) !== otherIndex);
        if (!taken) {
          issues.push({ level: "warning", rule: "返原崗", message: `${row.code} 在 ${slots[index]} 休息後未返 ${previousWork}。` });
        }
      }
      if (!codesAt(staffing, officeId, slots[index] ?? "").includes(cell)) {
        issues.push({ level: "error", rule: "開崗", message: `${row.code} 的 ${cell} 不在這一頁開崗裡。` });
      }
      const kind = postKind(cell);
      if (rules.respectPreference && row.allows.length > 0 && kind && !row.allows.includes(kind)) {
        issues.push({ level: "error", rule: "喜好", message: `${row.code} 不可派去 ${cell}。` });
      }
      workRun.push(cell);
      previousWork = cell;
    });
    flushWork();
    longestBig = Math.max(longestBig, bigRun);
    if (rules.requireBigRest) {
      const active = row.cells.filter((cell) => cell && !isGapCell(cell)).length;
      const need = Math.round((rules.bigRestMinHours * 60) / SLOT_MINUTES);
      if (active >= need && longestBig < need) {
        issues.push({ level: "error", rule: "大休", message: `${row.code} 大休只有 ${longestBig * 0.5} 小時，最少 ${rules.bigRestMinHours} 小時。` });
      } else if (active < need && longestBig < need) {
        issues.push({ level: "warning", rule: "大休", message: `${row.code} 在更內時間短過大休下限。` });
      }
    }
  }

  slots.forEach((slot, index) => {
    const seen = new Map<string, number>();
    for (const row of rows) {
      const cell = row.cells[index] ?? "";
      if (isGapCell(cell) || isRestCode(cell)) continue;
      seen.set(cell, (seen.get(cell) ?? 0) + 1);
    }
    for (const [code, count] of seen) {
      if (count > 1) issues.push({ level: "error", rule: "重崗", message: `${slot} 的 ${code} 有 ${count} 人。` });
    }
    const missing = codesAt(staffing, officeId, slot).filter((code) => !seen.has(code));
    if (missing.length) {
      issues.push({ level: "warning", rule: "缺人", message: `${slot} 還有 ${missing.length} 個崗位沒人。` });
    }
  });
  return issues;
}

export function rosterRows(staffing: StaffingState, officeId: OfficeId) {
  const local = rowsFor(staffing, officeId, staffing.shiftId).map((row) => ({ ...row, cells: row.cells.slice() }));
  const incoming = staffing.loans.filter((loan) => loan.toOffice === officeId && loan.shiftId === staffing.shiftId);
  for (const loan of incoming) {
    local.push({
      id: `loan:${loan.id}`,
      code: loan.personCode,
      allows: loan.allows,
      cells: loan.cells.slice(),
    });
  }
  return local;
}

export function shiftRoster(staffing: StaffingState, shiftId: ShiftId, source: "stored" | "preview") {
  const key = staffingBookKey(staffing, staffing.officeId, shiftId);
  const stored = staffing.books[key];
  const anchor = shiftId === staffing.shiftId;
  let rows: RosterRow[];
  if (source === "preview" && anchor) {
    rows = generateRoster(staffing.officeId, shiftId, {
      counters: staffing.counters,
      apc: staffing.apc,
      kiosks: staffing.kiosks,
      kioskApc: staffing.kioskApc,
      rules: staffing.rules,
    }, !isExtreme(staffing.rules, shiftId));
  } else if (stored) {
    rows = stored;
  } else {
    const rules = anchor ? staffing.rules : defaultRules(shiftId);
    rows = generateRoster(staffing.officeId, shiftId, {
      counters: staffing.counters,
      apc: staffing.apc,
      kiosks: staffing.kiosks,
      kioskApc: staffing.kioskApc,
      rules,
    }, anchor ? !isExtreme(rules, shiftId) : true);
  }
  const local = rows.map((row) => ({ ...row, allows: row.allows.slice(), cells: row.cells.slice() }));
  const incoming = staffing.loans.filter((loan) => loan.toOffice === staffing.officeId && loan.shiftId === shiftId);
  for (const loan of incoming) {
    local.push({
      id: `loan:${loan.id}`,
      code: loan.personCode,
      allows: loan.allows,
      cells: loan.cells.slice(),
    });
  }
  return local;
}

export function projectBoard(state: BoardState): BoardState {
  if (!state.staffing) return state;
  const staffing = state.staffing;
  const active = shiftsActiveAt(state.now);
  const ordered = [
    ...active.filter((id) => id === staffing.shiftId),
    ...active.filter((id) => id !== staffing.shiftId),
  ];
  const codes = codesAt(staffing, staffing.officeId, state.now);
  const posts: Post[] = codes.map((code, order) => ({
    id: `post-${code.replace(/\s+/g, "-")}`,
    zoneId: postKind(code) === "apc" ? "apc" : postKind(code) === "kiosk" ? "kiosk" : "counter",
    name: code,
    order,
    locked: staffing.lockedCodes.includes(code),
    assigneeId: null,
  }));
  const staff: Staff[] = [];
  const plans = officePlans(staffing);
  for (const shiftId of ordered) {
    const shift = shiftOf(shiftId);
    const slots = slotStarts(shiftId);
    const index = slotIndexAt(slots, state.now, shiftId);
    if (index < 0) continue;
    const slotStart = slots[index] ?? shift.start;
    const slotEnd = formatMinute(timeToMinutes(slotStart) + slotDuration(shiftId, slotStart));
    const selected = shiftId === staffing.shiftId;
    (plans.get(shiftId) ?? []).forEach((row, order) => {
      const cell = row.cells[index] ?? "";
      if (!cell || isLoanMarker(cell)) return;
      const person = personFromRow(row, order, shift, shiftId);
      if (!isWithinDuty(person, state.now)) return;
      if (!selected) {
        person.id = overlapRowId(shiftId, row.id);
        person.code = `${shiftId} ${row.code}`;
      }
      if (cell === EARLY_CELL) {
        person.leaveEarlyAt = row.leaveEarlyAt ?? slotStart;
        staff.push(person);
        return;
      }
      if (cell === "MB") {
        person.breakStart = slotStart;
        person.breakEnd = slotEnd;
      } else if (!isRestCode(cell)) {
        person.dutyPost = cell;
        const post = posts.find((item) => item.name === cell && !item.assigneeId);
        if (post) post.assigneeId = person.id;
      }
      staff.push(person);
    });
  }
  const zones: Zone[] = officeOf(staffing.officeId).kind === "hall"
    ? [
        { id: "counter", title: "櫃位", code: "CTR", templateId: "ARR" },
        { id: "apc", title: "APC", code: "APC", templateId: "STBY" },
      ]
    : [
        { id: "kiosk", title: "崗", code: "KIOSK", templateId: "KIOSK" },
        { id: "apc", title: "APC", code: "APC", templateId: "STBY" },
      ];
  return {
    ...state,
    shiftName: staffing.shiftId,
    zones,
    posts,
    staff,
  };
}

export function absorbShown(base: BoardState, shown: BoardState): BoardState {
  if (!base.staffing || shown.now !== base.now) {
    return { ...base, date: shown.date, now: shown.now };
  }
  const staffing = base.staffing;
  const slots = slotStarts(staffing.shiftId);
  const index = slotIndexAt(slots, base.now, staffing.shiftId);
  if (index < 0) return { ...base, date: shown.date, now: shown.now };
  const rows = activeRows(staffing).map((row) => ({ ...row, cells: row.cells.slice() }));
  const loans = staffing.loans.map((loan) => ({ ...loan, cells: loan.cells.slice() }));
  for (const person of shown.staff) {
    const post = shown.posts.find((item) => item.assigneeId === person.id);
    const rest = person.breakStart ? restToken(rows, loans, person.id, index) : "";
    const value = post?.name ?? rest;
    if (!value) continue;
    if (person.id.startsWith("loan:")) {
      const loan = loans.find((item) => `loan:${item.id}` === person.id);
      if (loan && !isLoanMarker(value)) loan.cells[index] = value;
      continue;
    }
    const row = rows.find((item) => item.id === person.id);
    if (!row || isLoanMarker(row.cells[index] ?? "")) continue;
    row.cells[index] = value;
    row.allows = normalizeAllows(person.allows ?? []);
    row.leaveEarlyAt = person.leaveEarlyAt;
    row.returnLateAt = person.returnLateAt;
    row.restLocked = person.restLocked;
  }
  return {
    ...base,
    date: shown.date,
    now: shown.now,
    staffing: {
      ...withBook(staffing, staffing.officeId, staffing.shiftId, rows),
      loans,
      lockedCodes: shown.posts.filter((post) => post.locked).map((post) => post.name),
    },
  };
}

export type OverlapRoster = {
  slots: string[];
  shifts: ShiftId[];
  rows: RosterRow[];
};

/** Anchor shift plus every shift whose window overlaps it, aligned on one timeline. */
export function combinedRoster(staffing: StaffingState, _source: "stored" | "preview" = "stored"): OverlapRoster {
  const shifts = shiftsOverlapping(staffing.shiftId);
  const anchor = shiftOf(staffing.shiftId);
  const anchorStart = timeToMinutes(anchor.start);
  const overnight = timeToMinutes(anchor.end) < anchorStart;
  const latestOrder = Math.max(...shifts.map((id) => shiftEndOrder(id, anchorStart, overnight)));
  const slotSet = new Set<string>();
  for (const id of shifts) {
    for (const slot of slotStarts(id)) {
      const startOrder = slotOrder(timeToMinutes(slot), anchorStart, overnight);
      if (startOrder + SLOT_MINUTES <= anchorStart) continue;
      if (startOrder >= latestOrder) continue;
      slotSet.add(slot);
    }
  }
  const slots = [...slotSet].sort((left, right) => slotOrder(timeToMinutes(left), anchorStart, overnight) - slotOrder(timeToMinutes(right), anchorStart, overnight));
  const rows: RosterRow[] = [];
  const plans = officePlans(staffing);
  for (const shiftId of shifts) {
    const nativeSlots = slotStarts(shiftId);
    for (const row of plans.get(shiftId) ?? []) {
      const cells = slots.map((slot) => {
        const index = nativeSlots.indexOf(slot);
        return index < 0 ? "" : (row.cells[index] ?? "");
      });
      rows.push({
        id: overlapRowId(shiftId, row.id),
        code: `${shiftId} ${row.code}`,
        allows: row.allows.slice(),
        cells,
        leaveEarlyAt: row.leaveEarlyAt,
        returnLateAt: row.returnLateAt,
        restLocked: row.restLocked,
      });
    }
  }
  return { slots, shifts, rows };
}

export function previewRows(staffing: StaffingState) {
  return combinedRoster(staffing, "preview").rows;
}

/** One person's shift, with every slot of that duty — not clipped to the focused overlap. */
export function shiftBoard(staffing: StaffingState, shiftId: ShiftId): { slots: string[]; rows: RosterRow[] } {
  const slots = slotStarts(shiftId);
  const rows = (officePlans(staffing).get(shiftId) ?? []).map((row) => ({
    ...row,
    allows: row.allows.slice(),
    cells: row.cells.slice(),
    code: row.code.startsWith(`${shiftId} `) ? row.code : `${shiftId} ${row.code}`,
  }));
  return { slots, rows };
}

export function previewFilename(staffing: StaffingState) {
  const office = staffing.officeId;
  const shift = staffing.shiftId.toLowerCase();
  const percent = staffing.percent == null ? "custom" : `${staffing.percent}pct`;
  return `preview-${office}-${shift}-${percent}.xlsx`;
}

export function crewFor(staffing: StaffingState, officeId = staffing.officeId) {
  const shift = shiftOf(staffing.shiftId);
  return requiredCrew(simultaneousPosts(officeId, staffing), shift.hours, awayHours(staffing.shiftId, staffing.rules));
}

/** Top-bar presence for one office. Does not add the other three offices. */
export function officeFocus(state: BoardState, officeId: OfficeId = state.staffing?.officeId ?? "arr-hall") {
  if (!state.staffing) return null;
  const shown = projectBoard({ ...state, staffing: { ...state.staffing, officeId } });
  return {
    officeId,
    label: officeLabel(officeId),
    ...presenceTotals(shown),
    crew: crewFor(state.staffing, officeId),
  };
}

export function siteOverview(state: BoardState) {
  const offices = OFFICES.map((office) => officeFocus(state, office.id)).filter((item) => item != null);
  return {
    offices,
    onSite: offices.reduce((sum, item) => sum + item.onSite, 0),
    filled: offices.reduce((sum, item) => sum + item.filled, 0),
    total: offices.reduce((sum, item) => sum + item.total, 0),
    crew: offices.reduce((sum, item) => sum + item.crew, 0),
  };
}

export function reflowOffice(state: BoardState): { ok: true; state: BoardState } | { ok: false; reason: string } {
  if (!state.staffing) return { ok: false, reason: "未有編崗。" };
  const staffing = state.staffing;
  const blocked = staffing.loans.some(
    (loan) => loan.shiftId === staffing.shiftId && (loan.fromOffice === staffing.officeId || loan.toOffice === staffing.officeId),
  );
  if (blocked) return { ok: false, reason: "這一頁有借調，請先撤銷再重排。" };
  const useSample = !isExtreme(staffing.rules, staffing.shiftId);
  const kept = new Map(activeRows(staffing).map((row) => [row.id, row.allows]));
  const rows = generateRoster(staffing.officeId, staffing.shiftId, staffing, useSample).map((row) => ({
    ...row,
    allows: kept.get(row.id)?.slice() ?? row.allows,
  }));
  return { ok: true, state: { ...state, staffing: withBook(staffing, staffing.officeId, staffing.shiftId, rows) } };
}

export function generateRoster(
  officeId: OfficeId,
  shiftId: ShiftId,
  staffing: OpenCounts & Pick<StaffingState, "rules">,
  useSample = true,
): RosterRow[] {
  if (useSample) {
    const known = sampleRows(officeId, shiftId, staffing.counters, staffing.apc, staffing.kiosks, staffing.kioskApc ?? 0);
    if (known) return known.map((row) => ({ ...row, cells: row.cells.slice(), allows: row.allows.slice() }));
  }
  const rules = staffing.rules;
  const slots = slotStarts(shiftId);
  const posts = openPostCodes(officeId, staffing);
  const plan = buildShiftPlan(shiftId, staffing, posts, false);
  const occupancy = slots.map(() => new Set<string>());
  if (rules.returnAfterRest) {
    assignPeople(plan, posts, occupancy, true, rules.stickyPost);
  } else {
    assignAcrossSlots(plan, posts, occupancy, rules.stickyPost);
  }
  return plan.map((cells, index) => ({
    id: rowId(officeId, `K${index + 1}`),
    code: `K${index + 1}`,
    allows: [],
    cells,
  }));
}

function buildShiftPlan(
  shiftId: ShiftId,
  staffing: Pick<StaffingState, "counters" | "apc" | "kiosks" | "rules">,
  posts: string[],
  staggerMeals: boolean,
  crewSize?: number,
): string[][] {
  const rules = staffing.rules;
  const slots = slotStarts(shiftId);
  const crew = crewSize ?? requiredCrew(posts.length, shiftOf(shiftId).hours, awayHours(shiftId, rules));
  const headcount = crewSize == null ? Math.max(crew, 1) : Math.max(0, crew);
  const restCount = shiftId === "A" ? rules.shortRestTurns : rules.restTurns;
  const rests = new Map<number, Set<number>>();
  for (let slot = 0; slot < slots.length; slot += 1) rests.set(slot, new Set());
  const plan: string[][] = [];
  for (let person = 0; person < headcount; person += 1) {
    const cells = Array.from({ length: slots.length }, () => "");
    const meals = mealSpan(shiftId, slots, rules, person, staggerMeals);
    const restAt = pickRests(slots.length, restCount, meals, person, rests, posts.length);
    for (const index of restAt) cells[index] = "R";
    for (const index of meals) cells[index] = shiftId === "A" ? "B" : "MB";
    if (shiftId === "A" && rules.requireBigRest) {
      const need = Math.max(1, Math.round((rules.bigRestMinHours * 60) / SLOT_MINUTES));
      const start = person % Math.max(1, slots.length - need);
      for (let step = 0; step < need; step += 1) {
        const index = start + step;
        if (cells[index] === "R") rests.get(index)?.delete(person);
        cells[index] = "B";
      }
    }
    plan.push(cells);
  }
  return plan;
}

function assignPeople(
  plan: string[][],
  posts: string[],
  occupancy: Set<string>[],
  returnAfterRest: boolean,
  sticky: boolean,
) {
  for (const cells of plan) {
    let previous = "";
    let chunk: number[] = [];
    const counts = new Map<string, number>();
    const flush = () => {
      if (!chunk.length) return;
      const afterRest = previous !== "";
      let prefer = afterRest && returnAfterRest ? previous : "";
      let avoid = afterRest && !returnAfterRest ? previous : "";
      if (sticky) {
        const whole = choosePost(chunk, prefer, posts, occupancy, { avoid, counts });
        if (whole) {
          for (const slot of chunk) {
            cells[slot] = whole;
            occupancy[slot]?.add(whole);
            counts.set(whole, (counts.get(whole) ?? 0) + 1);
          }
          previous = whole;
          chunk = [];
          return;
        }
      }
      for (const slot of chunk) {
        const code = choosePost([slot], prefer, posts, occupancy, { avoid, counts });
        if (!code) {
          cells[slot] = "R";
          continue;
        }
        cells[slot] = code;
        occupancy[slot]?.add(code);
        counts.set(code, (counts.get(code) ?? 0) + 1);
        if (sticky) prefer = code;
        else prefer = "";
        avoid = "";
      }
      const worked = chunk.map((index) => cells[index] ?? "").filter((value) => value && !isRestCode(value));
      const last = worked[worked.length - 1];
      if (last) previous = last;
      chunk = [];
    };
    cells.forEach((cell, index) => {
      if (cell) flush();
      else chunk.push(index);
    });
    flush();
  }
}

function assignAcrossSlots(plan: string[][], posts: string[], occupancy: Set<string>[], sticky: boolean) {
  const workers = plan.map(() => ({
    previous: "",
    current: "",
    afterRest: false,
    counts: new Map<string, number>(),
  }));
  const slotCount = plan[0]?.length ?? 0;
  for (let slot = 0; slot < slotCount; slot += 1) {
    const needing: number[] = [];
    for (let person = 0; person < plan.length; person += 1) {
      const worker = workers[person];
      if (!worker) continue;
      if (plan[person]?.[slot]) {
        if (worker.current) worker.previous = worker.current;
        worker.current = "";
        worker.afterRest = worker.previous !== "";
        continue;
      }
      needing.push(person);
    }
    const taken = occupancy[slot] ?? new Set<string>();
    const give = (person: number, code: string) => {
      const row = plan[person];
      const worker = workers[person];
      if (!row || !worker) return;
      row[slot] = code;
      taken.add(code);
      worker.current = code;
      worker.counts.set(code, (worker.counts.get(code) ?? 0) + 1);
      worker.afterRest = false;
    };
    if (sticky) {
      for (const person of needing) {
        const worker = workers[person];
        if (!worker?.current || taken.has(worker.current) || !posts.includes(worker.current)) continue;
        give(person, worker.current);
      }
    }
    for (const person of needing) {
      if (plan[person]?.[slot]) continue;
      const worker = workers[person];
      if (!worker) continue;
      const avoid = worker.afterRest ? worker.previous : "";
      const code = choosePost([slot], "", posts, occupancy, { avoid, counts: worker.counts });
      if (!code) {
        const row = plan[person];
        if (row) row[slot] = "R";
        if (worker.current) worker.previous = worker.current;
        worker.current = "";
        worker.afterRest = worker.previous !== "";
        continue;
      }
      give(person, code);
    }
  }
}

function sampleRows(officeId: OfficeId, shiftId: ShiftId, counters: number, apc: number, kiosks: number, kioskApc = 0) {
  const staffing = createDefaultStaffing();
  const key = bookKey(officeId, shiftId, counters, apc, kiosks, kioskApc);
  return staffing.books[key];
}

function choosePost(
  slots: number[],
  prefer: string,
  posts: string[],
  occupancy: Set<string>[],
  options?: { avoid?: string; counts?: Map<string, number> },
) {
  const free = (code: string) => slots.every((slot) => !occupancy[slot]?.has(code));
  if (prefer && posts.includes(prefer) && free(prefer)) return prefer;
  const available = posts.filter(free);
  if (!available.length) return null;
  const avoid = options?.avoid ?? "";
  const unlocked = avoid ? available.filter((code) => code !== avoid) : available;
  const pool = unlocked.length ? unlocked : available;
  const counts = options?.counts;
  if (!counts) return pool[0] ?? null;
  let best = pool[0] ?? null;
  if (!best) return null;
  let bestCount = counts.get(best) ?? 0;
  for (const code of pool) {
    const count = counts.get(code) ?? 0;
    if (count < bestCount) {
      best = code;
      bestCount = count;
    }
  }
  return best;
}

function pickRests(slotCount: number, turns: number, blocked: Set<number>, person: number, rests: Map<number, Set<number>>, posts: number) {
  const picked: number[] = [];
  const targetRest = Math.max(0, slotCount > 0 ? Math.round(((person < 9999 ? turns : turns) * 1) ) : 0);
  void posts;
  for (let turn = 0; turn < targetRest && turns > 0; turn += 1) {
    const seed = Math.floor(((turn + 0.5) * slotCount) / turns + person) % slotCount;
    for (let step = 0; step < slotCount; step += 1) {
      const index = (seed + step) % slotCount;
      if (blocked.has(index) || picked.includes(index)) continue;
      if (picked.some((item) => Math.abs(item - index) === 1)) continue;
      picked.push(index);
      rests.get(index)?.add(person);
      break;
    }
  }
  return picked;
}

type SharedWorker = {
  shiftId: ShiftId;
  rules: RuleSettings;
  slots: string[];
  cells: string[];
  previous: string;
  current: string;
  afterRest: boolean;
  counts: Map<string, number>;
  allows: PostKind[];
};

type Seat = { post: string; start: number; end: number };

function rulesForShift(staffing: StaffingState, shiftId: ShiftId) {
  return shiftId === staffing.shiftId ? staffing.rules : defaultRules(shiftId);
}

const slotsMemo = new Map<ShiftId, string[]>();
const coverCache = new Map<string, Map<ShiftId, string[][]>>();

function memoSlots(shiftId: ShiftId) {
  const known = slotsMemo.get(shiftId);
  if (known) return known;
  const slots = slotStarts(shiftId);
  slotsMemo.set(shiftId, slots);
  return slots;
}

function slotIndexCovering(slots: string[], minute: number, shiftId?: ShiftId) {
  for (let index = 0; index < slots.length; index += 1) {
    const range = shiftId ? slotRangeOf(shiftId, slots, index) : fallbackSlotRange(slots, index);
    if (range && minuteInRange(minute, range)) return index;
  }
  return -1;
}

/** Split one baseline crew across shifts. A shift that is alone still covers the posts; overlaps share them. */
function sharedCrewSizes(postCount: number, rulesFor: (shiftId: ShiftId) => RuleSettings) {
  const sizes = new Map<ShiftId, number>();
  for (const shift of SHIFTS) sizes.set(shift.id, 0);
  if (postCount <= 0) return sizes;
  const avail = new Map<ShiftId, number>();
  const cap = new Map<ShiftId, number>();
  const slotsByShift = new Map<ShiftId, string[]>();
  const samples = new Set<number>();
  for (const shift of SHIFTS) {
    const rules = rulesFor(shift.id);
    const working = shift.hours - awayHours(shift.id, rules);
    avail.set(shift.id, working > 0 ? working / shift.hours : 1);
    cap.set(shift.id, requiredCrew(postCount, shift.hours, awayHours(shift.id, rules)));
    const slots = memoSlots(shift.id);
    slotsByShift.set(shift.id, slots);
    for (const slot of slots) samples.add(timeToMinutes(slot));
  }
  const covers = (shiftId: ShiftId, minute: number) => slotIndexCovering(slotsByShift.get(shiftId) ?? [], minute, shiftId) >= 0;
  const supply = (minute: number) => {
    let total = 0;
    for (const shift of SHIFTS) {
      if (!covers(shift.id, minute)) continue;
      total += (sizes.get(shift.id) ?? 0) * (avail.get(shift.id) ?? 1);
    }
    return total;
  };
  for (let guard = 0; guard < postCount * SHIFTS.length * 4; guard += 1) {
    let worst = 0;
    const worstMinutes: number[] = [];
    for (const minute of samples) {
      if (!SHIFTS.some((shift) => covers(shift.id, minute))) continue;
      const gap = postCount - supply(minute);
      if (gap > worst + 1e-6) {
        worst = gap;
        worstMinutes.length = 0;
        worstMinutes.push(minute);
      } else if (gap > 1e-6 && Math.abs(gap - worst) <= 1e-6) {
        worstMinutes.push(minute);
      }
    }
    if (worst <= 1e-6) break;
    let best: ShiftId | null = null;
    let bestScore = -1;
    for (const shift of SHIFTS) {
      if ((sizes.get(shift.id) ?? 0) >= (cap.get(shift.id) ?? 0)) continue;
      const hit = worstMinutes.filter((minute) => covers(shift.id, minute)).length;
      if (!hit) continue;
      const score = (hit * (avail.get(shift.id) ?? 1)) / ((sizes.get(shift.id) ?? 0) + 1);
      if (score > bestScore) {
        bestScore = score;
        best = shift.id;
      }
    }
    if (!best) break;
    sizes.set(best, (sizes.get(best) ?? 0) + 1);
  }
  return sizes;
}

function buildSizedPlans(staffing: StaffingState, posts: string[], sizes: Map<ShiftId, number>) {
  const plans = new Map<ShiftId, string[][]>();
  for (const shift of SHIFTS) {
    const rules = rulesForShift(staffing, shift.id);
    plans.set(shift.id, buildShiftPlan(shift.id, {
      counters: staffing.counters,
      apc: staffing.apc,
      kiosks: staffing.kiosks,
      rules,
    }, posts, true, sizes.get(shift.id) ?? 0));
  }
  return plans;
}

function trialWorkers(staffing: StaffingState, plans: Map<ShiftId, string[][]>) {
  const workers: SharedWorker[] = [];
  for (const shift of SHIFTS) {
    const slots = memoSlots(shift.id);
    const rules = rulesForShift(staffing, shift.id);
    for (const cells of plans.get(shift.id) ?? []) {
      workers.push({
        shiftId: shift.id,
        rules,
        slots,
        cells: cells.slice(),
        previous: "",
        current: "",
        afterRest: false,
        counts: new Map(),
        allows: [],
      });
    }
  }
  return workers;
}

function filledPosts(workers: SharedWorker[], minute: number) {
  const busy = new Set<string>();
  for (const worker of workers) {
    const index = slotIndexCovering(worker.slots, minute, worker.shiftId);
    if (index < 0) continue;
    const cell = worker.cells[index] ?? "";
    if (!cell || isRestCode(cell)) continue;
    busy.add(cell);
  }
  return busy.size;
}

function shiftStartingAt(minute: number, sizes: Map<ShiftId, number>, staffing: StaffingState, postCount: number, skip?: Set<ShiftId>) {
  let best: ShiftId | null = null;
  let bestScore = -1;
  for (const shift of SHIFTS) {
    if (skip?.has(shift.id)) continue;
    if (!memoSlots(shift.id).some((slot) => timeToMinutes(slot) === minute)) continue;
    const rules = rulesForShift(staffing, shift.id);
    const away = awayHours(shift.id, rules);
    const cap = requiredCrew(postCount, shift.hours, away);
    const size = sizes.get(shift.id) ?? 0;
    if (size >= cap) continue;
    const working = shift.hours - away;
    const avail = working > 0 ? working / shift.hours : 1;
    const score = avail / (size + 1);
    if (score > bestScore) {
      bestScore = score;
      best = shift.id;
    }
  }
  return best;
}

function slotStartIndex(shiftId: ShiftId, minute: number) {
  return memoSlots(shiftId).findIndex((slot) => timeToMinutes(slot) === minute);
}

/** Clear a rest only on a shift whose slot opens at this minute. An earlier overlapping slot cannot take the freed posts. */
function clearRestAtStart(plans: Map<ShiftId, string[][]>, minute: number, code: "R" | "MB") {
  let best: { cells: string[]; index: number; rests: number } | null = null;
  for (const shift of SHIFTS) {
    const index = slotStartIndex(shift.id, minute);
    if (index < 0) continue;
    for (const cells of plans.get(shift.id) ?? []) {
      if (cells[index] !== code) continue;
      const rests = cells.filter((cell) => cell === "R" || cell === "MB").length;
      if (!best || rests > best.rests) best = { cells, index, rests };
    }
  }
  if (!best) return false;
  best.cells[best.index] = "";
  return true;
}

function keepMealOffMinute(cells: string[], shiftId: ShiftId, minute: number) {
  const slots = memoSlots(shiftId);
  const index = slots.findIndex((slot) => timeToMinutes(slot) === minute);
  if (index < 0 || cells[index] !== "MB") return;
  const meal = cells.reduce<number[]>((found, cell, at) => {
    if (cell === "MB") found.push(at);
    return found;
  }, []);
  for (const at of meal) cells[at] = "";
  const len = Math.max(1, meal.length);
  for (let start = 0; start <= cells.length - len; start += 1) {
    if (index >= start && index < start + len) continue;
    for (let step = 0; step < len; step += 1) cells[start + step] = "MB";
    return;
  }
}

function releaseNewRests(plans: Map<ShiftId, string[][]>, shiftId: ShiftId, minute: number, fromRow: number) {
  const index = slotStartIndex(shiftId, minute);
  if (index < 0) return;
  const rows = plans.get(shiftId) ?? [];
  for (let row = fromRow; row < rows.length; row += 1) {
    const cells = rows[row];
    if (cells?.[index] === "R") cells[index] = "";
  }
}

function appendShiftPerson(staffing: StaffingState, posts: string[], plans: Map<ShiftId, string[][]>, sizes: Map<ShiftId, number>, shiftId: ShiftId) {
  const rows = plans.get(shiftId) ?? [];
  const built = buildShiftPlan(shiftId, {
    counters: staffing.counters,
    apc: staffing.apc,
    kiosks: staffing.kiosks,
    rules: rulesForShift(staffing, shiftId),
  }, posts, true, rows.length + 1);
  const added = built[built.length - 1];
  if (!added) return false;
  rows.push(added);
  plans.set(shiftId, rows);
  sizes.set(shiftId, rows.length);
  return true;
}

function coverSharedPlans(staffing: StaffingState, posts: string[]) {
  const key = `${staffing.officeId}|${staffing.shiftId}|${posts.length}|${staffing.counters}|${staffing.apc}|${staffing.kiosks}|${staffing.kioskApc ?? 0}|${JSON.stringify(staffing.rules)}`;
  const cached = coverCache.get(key);
  if (cached) return cached;
  const sizes = sharedCrewSizes(posts.length, (shiftId) => rulesForShift(staffing, shiftId));
  const plans = buildSizedPlans(staffing, posts, sizes);
  const samples = [...new Set(SHIFTS.flatMap((shift) => memoSlots(shift.id).map((slot) => timeToMinutes(slot))))];
  const stalled = new Set<number>();
  let clearing = true;
  for (let guard = 0; guard < samples.length + posts.length; guard += 1) {
    const workers = trialWorkers(staffing, plans);
    assignShared(workers, posts);
    const gaps: { minute: number; gap: number }[] = [];
    for (const minute of samples) {
      if (stalled.has(minute)) continue;
      const gap = posts.length - filledPosts(workers, minute);
      if (gap > 0) gaps.push({ minute, gap });
    }
    if (!gaps.length) break;
    gaps.sort((left, right) => right.gap - left.gap);
    if (clearing) {
      let cleared = false;
      for (const item of gaps) {
        for (let step = 0; step < item.gap; step += 1) {
          if (!clearRestAtStart(plans, item.minute, "R")) break;
          cleared = true;
        }
      }
      clearing = false;
      if (cleared) continue;
    }
    const worst = gaps[0];
    if (!worst) break;
    const skip = new Set<ShiftId>();
    let filled = false;
    while (!filled) {
      const shiftId = shiftStartingAt(worst.minute, sizes, staffing, posts.length, skip);
      if (!shiftId) {
        stalled.add(worst.minute);
        break;
      }
      const previous = (plans.get(shiftId) ?? []).map((cells) => cells.slice());
      const previousSize = sizes.get(shiftId) ?? 0;
      if (!appendShiftPerson(staffing, posts, plans, sizes, shiftId)) {
        skip.add(shiftId);
        continue;
      }
      const added = plans.get(shiftId)?.[previousSize];
      if (added) keepMealOffMinute(added, shiftId, worst.minute);
      releaseNewRests(plans, shiftId, worst.minute, previousSize);
      const check = trialWorkers(staffing, plans);
      assignShared(check, posts);
      if (posts.length - filledPosts(check, worst.minute) >= worst.gap) {
        sizes.set(shiftId, previousSize);
        plans.set(shiftId, previous);
        skip.add(shiftId);
        continue;
      }
      filled = true;
    }
  }
  coverCache.set(key, plans);
  return plans;
}

/** One post pool for the office. Overlapping shifts share it; a post is never doubled. */
function officePlans(staffing: StaffingState): Map<ShiftId, RosterRow[]> {
  const posts = openPostCodes(staffing.officeId, staffing);
  const sized = coverSharedPlans(staffing, posts);
  const workers: SharedWorker[] = [];
  const allowedByShift = new Map<ShiftId, number>();
  for (const shift of SHIFTS) {
    const rules = rulesForShift(staffing, shift.id);
    const slots = memoSlots(shift.id);
    for (const cells of sized.get(shift.id) ?? []) {
      const count = (allowedByShift.get(shift.id) ?? 0) + 1;
      allowedByShift.set(shift.id, count);
      workers.push({
        shiftId: shift.id,
        rules,
        slots,
        cells: cells.slice(),
        previous: "",
        current: "",
        afterRest: false,
        counts: new Map(),
        allows: storedAllows(staffing, shift.id, `K${count}`),
      });
    }
  }
  assignShared(workers, posts);
  const grouped = new Map<ShiftId, RosterRow[]>();
  for (const shift of SHIFTS) grouped.set(shift.id, []);
  const seen = new Map<ShiftId, number>();
  for (const worker of workers) {
    const count = (seen.get(worker.shiftId) ?? 0) + 1;
    seen.set(worker.shiftId, count);
    const code = `K${count}`;
    grouped.get(worker.shiftId)?.push({
      id: rowId(staffing.officeId, code),
      code,
      allows: [],
      cells: worker.cells,
    });
  }
  for (const shift of SHIFTS) {
    const key = staffingBookKey(staffing, staffing.officeId, shift.id);
    overlayDutyEdits(grouped.get(shift.id) ?? [], staffing.books[key]);
  }
  for (const shift of SHIFTS) {
    const rows = grouped.get(shift.id);
    if (!rows) continue;
    for (const loan of staffing.loans) {
      if (loan.toOffice !== staffing.officeId || loan.shiftId !== shift.id) continue;
      rows.push({
        id: `loan:${loan.id}`,
        code: loan.personCode,
        allows: loan.allows.slice(),
        cells: loan.cells.slice(),
      });
    }
  }
  dropClosedPosts(grouped, staffing);
  seatIncomingLoans(grouped, staffing, posts);
  applyCovers(grouped, staffing.covers);
  return grouped;
}

function dropClosedPosts(grouped: Map<ShiftId, RosterRow[]>, staffing: StaffingState) {
  for (const closure of staffing.closures ?? []) {
    if (closure.officeId !== staffing.officeId) continue;
    const native = slotStarts(closure.shiftId);
    for (const slot of closure.slots) {
      const when = native[slot.index];
      if (!when) continue;
      for (const [shiftId, rows] of grouped) {
        const index = slotStarts(shiftId).indexOf(when);
        if (index < 0) continue;
        for (const row of rows) {
          if ((row.cells[index] ?? "") === slot.code) row.cells[index] = "R";
        }
      }
    }
  }
}

function applyCovers(grouped: Map<ShiftId, RosterRow[]>, covers: PostCover[] | undefined) {
  for (const cover of covers ?? []) {
    const row = grouped.get(cover.shiftId)?.find((item) => item.id === cover.rowId);
    if (!row) continue;
    const current = row.cells[cover.index] ?? "";
    if (current === EARLY_CELL || isLoanMarker(current)) continue;
    const slot = slotStarts(cover.shiftId)[cover.index] ?? "";
    releasePost(grouped, slot, cover.code, row.id);
    row.cells[cover.index] = cover.code;
  }
}

/** Put each borrowed person on a receiving post for the loan window, freeing a local holder when the pool is full. */
function seatIncomingLoans(grouped: Map<ShiftId, RosterRow[]>, staffing: StaffingState, posts: string[]) {
  for (const loan of staffing.loans) {
    if (loan.toOffice !== staffing.officeId) continue;
    const row = grouped.get(loan.shiftId)?.find((item) => item.id === `loan:${loan.id}`);
    if (!row) continue;
    const slots = slotStarts(loan.shiftId);
    for (let index = 0; index < row.cells.length; index += 1) {
      const cell = row.cells[index] ?? "";
      if (!cell || isLoanMarker(cell) || cell === EARLY_CELL) continue;
      const slot = slots[index] ?? "";
      if (!isRestCode(cell)) {
        releasePost(grouped, slot, cell, row.id);
        continue;
      }
      const claimed = claimPost(grouped, slot, posts, row.id);
      if (claimed) row.cells[index] = claimed;
    }
  }
}

function releasePost(grouped: Map<ShiftId, RosterRow[]>, slot: string, code: string, exceptId: string) {
  for (const [shiftId, rows] of grouped) {
    const index = slotStarts(shiftId).indexOf(slot);
    if (index < 0) continue;
    for (const row of rows) {
      if (row.id === exceptId) continue;
      if ((row.cells[index] ?? "") === code) row.cells[index] = "R";
    }
  }
}

function claimPost(grouped: Map<ShiftId, RosterRow[]>, slot: string, posts: string[], exceptId: string) {
  const used = new Set<string>();
  for (const [shiftId, rows] of grouped) {
    const index = slotStarts(shiftId).indexOf(slot);
    if (index < 0) continue;
    for (const row of rows) {
      if (row.id === exceptId) continue;
      const cell = row.cells[index] ?? "";
      if (cell && !isRestCode(cell) && !isLoanMarker(cell) && cell !== EARLY_CELL) used.add(cell);
    }
  }
  const free = posts.find((code) => !used.has(code));
  if (free) return free;
  for (const [shiftId, rows] of grouped) {
    const index = slotStarts(shiftId).indexOf(slot);
    if (index < 0) continue;
    for (const row of rows) {
      if (row.id === exceptId || row.id.startsWith("loan:")) continue;
      const cell = row.cells[index] ?? "";
      if (!cell || isRestCode(cell) || isLoanMarker(cell) || cell === EARLY_CELL) continue;
      row.cells[index] = "R";
      return cell;
    }
  }
  return null;
}

function overlayDutyEdits(rows: RosterRow[], stored: RosterRow[] | undefined) {
  if (!stored) return;
  const byId = new Map(stored.map((row) => [row.id, row]));
  for (const row of rows) {
    const source = byId.get(row.id);
    if (!source) continue;
    source.cells.forEach((cell, index) => {
      if (index >= row.cells.length) return;
      if (cell === EARLY_CELL || isLoanMarker(cell)) row.cells[index] = cell;
    });
    if (source.leaveEarlyAt) row.leaveEarlyAt = source.leaveEarlyAt;
    if (source.returnLateAt) row.returnLateAt = source.returnLateAt;
    if (source.restLocked) row.restLocked = source.restLocked;
    if (source.allows.length) row.allows = source.allows.slice();
  }
}

function assignShared(workers: SharedWorker[], posts: string[]) {
  const seats: Seat[] = [];
  const starts = new Set<string>();
  for (const worker of workers) {
    for (const slot of worker.slots) starts.add(slot);
  }
  const times = [...starts].sort((left, right) => timeToMinutes(left) - timeToMinutes(right));
  const order = SHIFTS.map((shift) => shift.id);
  for (const slot of times) {
    const start = timeToMinutes(slot);
    const endFor = (shiftId: ShiftId) => start + slotDuration(shiftId, slot);
    const end = start + SLOT_MINUTES;
    const taken = postsBusy(seats, start, end);
    const holding = new Map<ShiftId, number>();
    const needing: { worker: SharedWorker; index: number }[] = [];
    for (const worker of workers) {
      const index = worker.slots.indexOf(slot);
      if (index < 0) continue;
      const cell = worker.cells[index] ?? "";
      if (cell) {
        if (worker.current) worker.previous = worker.current;
        worker.current = "";
        worker.afterRest = worker.previous !== "";
        continue;
      }
      needing.push({ worker, index });
    }
    for (const job of needing) {
      const worker = job.worker;
      const allowed = postsForWorker(worker, posts);
      if (!worker.rules.stickyPost || !worker.current || taken.has(worker.current) || !allowed.includes(worker.current)) continue;
      giveShared(worker, job.index, worker.current, taken, seats, start, endFor(worker.shiftId));
      holding.set(worker.shiftId, (holding.get(worker.shiftId) ?? 0) + 1);
    }
    const queues = new Map<ShiftId, { worker: SharedWorker; index: number }[]>();
    for (const job of needing) {
      if (job.worker.cells[job.index]) continue;
      const queue = queues.get(job.worker.shiftId);
      if (queue) queue.push(job);
      else queues.set(job.worker.shiftId, [job]);
    }
    let cursor = 0;
    while (queues.size) {
      let bestShift: ShiftId | null = null;
      let bestHold = Number.POSITIVE_INFINITY;
      for (let step = 0; step < order.length; step += 1) {
        const shiftId = order[(cursor + step) % order.length];
        const queue = queues.get(shiftId);
        if (!queue?.length) continue;
        const hold = holding.get(shiftId) ?? 0;
        if (hold < bestHold) {
          bestHold = hold;
          bestShift = shiftId;
        }
      }
      if (!bestShift) break;
      const queue = queues.get(bestShift);
      const job = queue?.shift();
      if (!queue?.length) queues.delete(bestShift);
      if (!job) break;
      cursor = (order.indexOf(bestShift) + 1) % order.length;
      const worker = job.worker;
      const allowed = postsForWorker(worker, posts);
      const avoid = !worker.rules.returnAfterRest && worker.afterRest ? worker.previous : "";
      const prefer = worker.rules.returnAfterRest && worker.afterRest ? worker.previous : "";
      const code = choosePost([0], allowed.includes(prefer) ? prefer : "", allowed, [taken], { avoid, counts: worker.counts });
      if (!code) {
        worker.cells[job.index] = "R";
        if (worker.current) worker.previous = worker.current;
        worker.current = "";
        worker.afterRest = worker.previous !== "";
        continue;
      }
      giveShared(worker, job.index, code, taken, seats, start, endFor(worker.shiftId));
      holding.set(worker.shiftId, (holding.get(worker.shiftId) ?? 0) + 1);
    }
  }
}

function storedAllows(staffing: StaffingState, shiftId: ShiftId, code: string): PostKind[] {
  if (!rulesForShift(staffing, shiftId).respectPreference) return [];
  const key = staffingBookKey(staffing, staffing.officeId, shiftId);
  return staffing.books[key]?.find((row) => row.code === code)?.allows.slice() ?? [];
}

function postsForWorker(worker: SharedWorker, posts: string[]) {
  if (!worker.rules.respectPreference || worker.allows.length === 0) return posts;
  return posts.filter((code) => allowsCode(worker.allows, code));
}

function giveShared(
  worker: SharedWorker,
  index: number,
  code: string,
  taken: Set<string>,
  seats: Seat[],
  start: number,
  end: number,
) {
  worker.cells[index] = code;
  taken.add(code);
  seats.push({ post: code, start, end });
  worker.current = code;
  worker.counts.set(code, (worker.counts.get(code) ?? 0) + 1);
  worker.afterRest = false;
}

function postsBusy(seats: Seat[], start: number, end: number) {
  const taken = new Set<string>();
  for (const seat of seats) {
    if (seat.start < end && start < seat.end) taken.add(seat.post);
  }
  return taken;
}

function mealSpan(shiftId: ShiftId, slots: string[], rules: RuleSettings, person: number, stagger: boolean) {
  const blocked = new Set<number>();
  if (shiftId === "A" || !rules.applyMeal) return blocked;
  if (!stagger) {
    for (const index of mealIndexes(shiftId, slots, rules)) blocked.add(index);
    return blocked;
  }
  const mealLen = Math.max(1, Math.round(rules.mealMinutes / SLOT_MINUTES));
  const startMinute = timeToMinutes(shiftOf(shiftId).mealStart ?? "11:00");
  const first = slots.findIndex((slot) => timeToMinutes(slot) >= startMinute);
  if (first < 0) return blocked;
  const lastStart = Math.max(first, slots.length - mealLen);
  const start = first + (person % Math.max(1, lastStart - first + 1));
  for (let step = 0; step < mealLen && start + step < slots.length; step += 1) blocked.add(start + step);
  return blocked;
}

function mealIndexes(shiftId: ShiftId, slots: string[], rules: RuleSettings) {
  const blocked = new Set<number>();
  if (shiftId === "A") return blocked;
  if (!rules.applyMeal) return blocked;
  const start = timeToMinutes(shiftOf(shiftId).mealStart ?? "11:00");
  const end = start + rules.mealMinutes;
  slots.forEach((slot, index) => {
    const minute = timeToMinutes(slot);
    if (minute >= start && minute < end) blocked.add(index);
  });
  return blocked;
}

function fillLoanCells(slots: string[], window: number[], destRows: RosterRow[], rules: RuleSettings, allows: PostKind[], open: string[]) {
  const cells = Array.from({ length: slots.length }, () => "");
  const occupancy = slots.map((_, index) => {
    const taken = new Set<string>();
    for (const row of destRows) {
      const value = row.cells[index] ?? "";
      if (value && !isRestCode(value) && !isLoanMarker(value)) taken.add(value);
    }
    return taken;
  });
  const allowed = open.filter((code) => {
    const kind = postKind(code);
    return !kind || allows.length === 0 || allows.includes(kind);
  });
  const maxSlots = rules.limitConsecutive ? Math.max(1, Math.round((rules.maxConsecutiveHours * 60) / SLOT_MINUTES)) : window.length;
  let previous = "";
  let run = 0;
  for (const index of window) {
    const needRest = rules.scatterRest && run >= maxSlots;
    if (needRest) {
      cells[index] = "R";
      run = 0;
      continue;
    }
    const choice = choosePost([index], previous, allowed, occupancy);
    if (!choice) {
      cells[index] = "R";
      run = 0;
      continue;
    }
    cells[index] = choice;
    occupancy[index]?.add(choice);
    previous = choice;
    run += 1;
  }
  return cells;
}

function slotWindow(slots: string[], start: string, end: string) {
  const from = timeToMinutes(start);
  const to = timeToMinutes(end);
  const spans: [number, number][] = to > from ? [[from, to]] : [[from, DAY_MINUTES], [0, to]];
  const indexes: number[] = [];
  slots.forEach((slot, index) => {
    const begin = timeToMinutes(slot);
    const next = slots[index + 1];
    let finish = begin + SLOT_MINUTES;
    if (next) {
      const nextMin = timeToMinutes(next);
      finish = nextMin > begin ? nextMin : nextMin + DAY_MINUTES;
    }
    const pieces: [number, number][] = finish <= DAY_MINUTES ? [[begin, finish]] : [[begin, DAY_MINUTES], [0, finish - DAY_MINUTES]];
    if (pieces.some((piece) => spans.some((span) => rangesOverlap(piece, span)))) indexes.push(index);
  });
  return indexes;
}

/** Morning hours of an overnight anchor sort after the evening, not before it. */
function slotOrder(minute: number, anchorStart: number, overnight: boolean) {
  if (!overnight) return minute;
  if (minute >= anchorStart) return minute;
  if (minute < 12 * 60) return minute + DAY_MINUTES;
  return minute;
}

function shiftEndOrder(shiftId: ShiftId, anchorStart: number, overnight: boolean) {
  const shift = shiftOf(shiftId);
  const start = timeToMinutes(shift.start);
  const end = timeToMinutes(shift.end);
  if (end < start) return end + DAY_MINUTES;
  return slotOrder(end, anchorStart, overnight);
}

function personFromRow(row: RosterRow, order: number, shift: ShiftDef, shiftId: ShiftId): Staff {
  return {
    id: row.id,
    code: row.code,
    shift: shiftId,
    dutyStart: shift.start,
    dutyEnd: shift.end,
    breakStart: null,
    breakEnd: null,
    leaveEarlyAt: row.leaveEarlyAt ?? null,
    returnLateAt: row.returnLateAt ?? null,
    restLocked: row.restLocked ?? false,
    restOrder: order,
    allows: row.allows,
  };
}

function restToken(rows: RosterRow[], loans: StaffLoan[], personId: string, index: number) {
  const row = rows.find((item) => item.id === personId);
  const current = row?.cells[index] ?? loans.find((loan) => `loan:${loan.id}` === personId)?.cells[index] ?? "";
  if (current === "B" || current === "MB") return current;
  return "R";
}

function cloneRows(rows: RosterRow[], officeId: OfficeId) {
  return rows.map((row) => ({ ...row, id: rowId(officeId, row.code), allows: row.allows.slice(), cells: row.cells.slice() }));
}

function rowId(officeId: OfficeId, code: string) {
  return `${officeId}:${code}`;
}

function numbers(count: number) {
  return Array.from({ length: Math.max(0, count) }, (_, index) => index + 1);
}

function formatMinute(value: number) {
  const minute = ((value % (24 * 60)) + 24 * 60) % (24 * 60);
  return `${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`;
}

function splitCsv(line: string) {
  return line.split(",").map((cell) => cell.trim());
}

function normalizeAllows(allows: PostKind[]) {
  const unique = [...new Set(allows)];
  return unique.length >= 3 ? [] : unique;
}
