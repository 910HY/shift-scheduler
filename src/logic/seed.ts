import { createDefaultStaffing, FOCUS_BANDS, shiftOf, shiftsActiveAt } from "@/logic/staffing";
import type { BoardState, Staff } from "@/types";

function person(
  id: string,
  code: string,
  restOrder: number,
  shift: string,
  extra: Partial<Staff> = {},
): Staff {
  return {
    id,
    code,
    shift,
    dutyStart: "07:00",
    dutyEnd: "15:30",
    breakStart: null,
    breakEnd: null,
    leaveEarlyAt: null,
    returnLateAt: null,
    restLocked: false,
    restOrder,
    ...extra,
  };
}

/** Breaking / ICO sheet language. 13:10 cuts overlapping E3, E4, E, and overnight 10K. */
export function createSeed(): BoardState {
  return {
    date: "2026-09-28",
    shiftName: "E3／E4／E／10K",
    now: "13:10",
    zones: [
      { id: "arr", title: "到達", code: "ARR", templateId: "ARR" },
      { id: "dep", title: "出發", code: "DEP", templateId: "DEP" },
      { id: "kiosk", title: "大堂", code: "HALL", templateId: "KIOSK" },
      { id: "stby", title: "外勤", code: "SD", templateId: "STBY" },
    ],
    posts: [
      { id: "p-a14", zoneId: "arr", name: "A14", order: 0, locked: true, assigneeId: "s03" },
      { id: "p-a15", zoneId: "arr", name: "A15", order: 1, locked: false, assigneeId: "s07" },
      { id: "p-ack", zoneId: "arr", name: "ACK", order: 2, locked: false, assigneeId: "s04" },
      { id: "p-a3", zoneId: "arr", name: "A3", order: 3, locked: false, assigneeId: "s06" },
      { id: "p-d14", zoneId: "dep", name: "D14", order: 0, locked: false, assigneeId: "s01" },
      { id: "p-d15", zoneId: "dep", name: "D15", order: 1, locked: false, assigneeId: "s02" },
      { id: "p-dck", zoneId: "dep", name: "DCK", order: 2, locked: false, assigneeId: null },
      { id: "p-d3", zoneId: "dep", name: "D3", order: 3, locked: false, assigneeId: "s09" },
      { id: "p-hall", zoneId: "kiosk", name: "HALL", order: 0, locked: false, assigneeId: "s05" },
      { id: "p-umb", zoneId: "kiosk", name: "UMB", order: 1, locked: false, assigneeId: "s10" },
      { id: "p-fb", zoneId: "kiosk", name: "FB", order: 2, locked: false, assigneeId: null },
      { id: "p-sd", zoneId: "stby", name: "SD", order: 0, locked: false, assigneeId: "s08" },
    ],
    staff: [
      person("s01", "01", 0, "E4", { dutyStart: "06:30", dutyEnd: "14:30" }),
      person("s02", "02", 1, "E4"),
      person("s03", "03", 2, "E3"),
      person("s04", "04", 3, "E", {
        dutyStart: "08:00",
        dutyEnd: "16:30",
        breakStart: "12:55",
        breakEnd: "13:20",
      }),
      person("s05", "05", 4, "E3", { dutyStart: "07:30", dutyEnd: "16:00" }),
      person("s06", "06", 5, "E3", { leaveEarlyAt: "12:30" }),
      person("s07", "07", 6, "E3", { breakStart: "13:00", breakEnd: "13:45" }),
      person("s08", "08", 7, "E", { dutyStart: "09:00", dutyEnd: "17:30" }),
      person("s09", "09", 8, "E4", { returnLateAt: "14:00" }),
      person("s10", "10", 9, "E4", {
        dutyStart: "08:00",
        dutyEnd: "16:00",
        breakStart: "12:50",
        breakEnd: "13:20",
      }),
      person("s11", "11", 10, "10K", { dutyStart: "22:15", dutyEnd: "07:00" }),
      person("s12", "12", 11, "E", { dutyStart: "08:00", dutyEnd: "16:00" }),
      person("s13", "13", 12, "E", { dutyStart: "14:00", dutyEnd: "22:00" }),
    ],
  };
}

/** V10 four-office roster. The legacy seed stays for the earlier presence tests. */
export function createAppSeed(): BoardState {
  return { ...createSeed(), now: "10:00", shiftName: "B2", staffing: createDefaultStaffing() };
}

/** Demo and restored boards open inside the selected shift. A manual clock change stays put. */
export function alignNowToSelectedShift(state: BoardState): BoardState {
  const shiftId = state.staffing?.shiftId;
  if (!shiftId) return state;
  if (shiftsActiveAt(state.now).includes(shiftId)) return state;
  const prepare = FOCUS_BANDS.find((band) => band.id === shiftId)?.prepare ?? shiftOf(shiftId).start;
  return { ...state, now: prepare };
}

export function ensureStaffing(state: BoardState): BoardState {
  const next: BoardState = state.staffing?.books
    ? {
        ...state,
        staffing: {
          ...state.staffing,
          closures: state.staffing.closures ?? [],
          loans: state.staffing.loans ?? [],
        },
      }
    : { ...state, shiftName: "B2", staffing: createDefaultStaffing() };
  return alignNowToSelectedShift(next);
}
