import { postOfStaff } from "@/logic/board";
import { isLateActive, isLeaveActive, isOnBreak, isWithinDuty } from "@/logic/time";
import type { BoardState, Staff } from "@/types";

export type Presence = "onduty" | "break" | "away";

/** Where this person is at 現場時刻. off = outside the duty window, not drawn. */
export type NowPlace = "stand" | "mb" | "r" | "sl" | "uvl" | "off";

export function nowPlace(state: BoardState, person: Staff): NowPlace {
  if (isLeaveActive(person, state.now)) return "sl";
  if (isLateActive(person, state.now)) return "uvl";
  if (!isWithinDuty(person, state.now)) return "off";
  if (isOnBreak(person, state.now)) return "mb";
  if (postOfStaff(state, person.id) || person.dutyPost) return "stand";
  return "r";
}

export function personPresence(state: BoardState, person: Staff): Presence {
  const place = nowPlace(state, person);
  if (place === "stand") return "onduty";
  if (place === "mb" || place === "r") return "break";
  return "away";
}

export function presenceTotals(state: BoardState): {
  onSite: number;
  onduty: number;
  rest: number;
  filled: number;
  total: number;
} {
  let onduty = 0;
  let rest = 0;
  for (const person of state.staff) {
    const presence = personPresence(state, person);
    if (presence === "onduty") onduty += 1;
    else if (presence === "break") rest += 1;
  }
  return {
    onSite: onduty + rest,
    onduty,
    rest,
    filled: state.posts.filter((post) => post.assigneeId).length,
    total: state.posts.length,
  };
}
