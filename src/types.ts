export const STORAGE_VERSION = 1;
export const STORAGE_KEY = "zaaban.board.v1";

export const TEMPLATES = [
  { id: "ARR", label: "到達", code: "ARR", zoneId: "arr", blurb: "入境、行李、轉機" },
  { id: "DEP", label: "出發", code: "DEP", zoneId: "dep", blurb: "值機、登機、超額" },
  { id: "KIOSK", label: "櫃檯", code: "KIOSK", zoneId: "kiosk", blurb: "自助、問詢" },
  { id: "STBY", label: "候命", code: "STBY", zoneId: "stby", blurb: "機動、閘口候命" },
] as const;

export type TemplateId = (typeof TEMPLATES)[number]["id"];

export type Zone = {
  id: string;
  title: string;
  code: string;
  templateId: TemplateId;
};

export type Post = {
  id: string;
  zoneId: string;
  name: string;
  order: number;
  locked: boolean;
  assigneeId: string | null;
};

export type PostKind = "counter" | "apc" | "kiosk";

export type Staff = {
  id: string;
  code: string;
  /** E3 / E4 / E / 10K, or a V10 shift id such as B2. */
  shift?: string;
  dutyStart: string;
  dutyEnd: string;
  breakStart: string | null;
  breakEnd: string | null;
  leaveEarlyAt: string | null;
  returnLateAt: string | null;
  restLocked: boolean;
  restOrder: number;
  /** Empty means Counter, APC and Kiosk are all allowed. */
  allows?: PostKind[];
  /** Post this person is working, even when another shift already holds that bay. */
  dutyPost?: string | null;
};

export type OfficeId = "arr-hall" | "dep-hall" | "arr-kiosk" | "dep-kiosk";

export type ShiftId = "B2" | "B1" | "C2" | "E1" | "E3" | "E4" | "E" | "A";

export type RuleSettings = {
  scatterRest: boolean;
  stickyPost: boolean;
  returnAfterRest: boolean;
  respectPreference: boolean;
  restTurns: number;
  restTurnMinutes: number;
  mealMinutes: number;
  applyMeal: boolean;
  bigRestMinHours: number;
  shortRestTurns: number;
  shortRestMinutes: number;
  maxConsecutiveHours: number;
  limitConsecutive: boolean;
  requireBigRest: boolean;
};

export type RosterRow = {
  id: string;
  code: string;
  allows: PostKind[];
  cells: string[];
  leaveEarlyAt?: string | null;
  returnLateAt?: string | null;
  restLocked?: boolean;
};

export type PostClosure = {
  id: string;
  officeId: OfficeId;
  shiftId: ShiftId;
  /** Slot indexes whose post code is closed, so a gap does not count as missing. */
  slots: { index: number; code: string }[];
};

/** Someone else covers a post after an early leave. */
export type PostCover = {
  shiftId: ShiftId;
  rowId: string;
  index: number;
  code: string;
};

export type StaffLoan = {
  id: string;
  personId: string;
  personCode: string;
  fromOffice: OfficeId;
  toOffice: OfficeId;
  shiftId: ShiftId;
  start: string;
  /** Empty end means until the shift finishes. */
  end: string | null;
  allows: PostKind[];
  cells: string[];
  sourceShadow: string[];
};

export type StaffingState = {
  officeId: OfficeId;
  shiftId: ShiftId;
  /** Null when the open counts were typed by hand instead of a shortcut. */
  percent: number | null;
  counters: number;
  apc: number;
  kiosks: number;
  /** APC posts open in a Kiosk office. Hall APC stays on `apc`. */
  kioskApc: number;
  gates: number;
  gatesPerPost: number;
  counterMax: number;
  kioskMax: number;
  kioskApcMax: number;
  rules: RuleSettings;
  lockedCodes: string[];
  books: Record<string, RosterRow[]>;
  loans: StaffLoan[];
  closures: PostClosure[];
  covers?: PostCover[];
};

export type BoardState = {
  date: string;
  shiftName: string;
  now: string;
  zones: Zone[];
  posts: Post[];
  staff: Staff[];
  staffing?: StaffingState;
};

export type StoredBoard = {
  version: number;
  state: BoardState;
};

export type SolvePayload = {
  posts: { id: string; locked: boolean; assignee_id: string | null }[];
  staff: {
    id: string;
    locked: boolean;
    available: boolean;
    post_id: string | null;
    assign_penalty: number;
  }[];
};

export type SolveResponse = {
  assignments: Record<string, string | null>;
  vacancies: string[];
  held_empty: string[];
  idle_staff: string[];
};
