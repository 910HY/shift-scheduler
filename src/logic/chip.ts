import { isLateActive, isLeaveActive } from "@/logic/time";
import type { Staff } from "@/types";

export type ChipTone = "onduty" | "break" | "exception" | "vacant";
export type FloorFilter = "all" | ChipTone;

export function chipTone(person: Staff | undefined, now: string, onPost: boolean): ChipTone {
  if (!person) return "vacant";
  if (isLeaveActive(person, now) || isLateActive(person, now)) return "exception";
  return onPost ? "onduty" : "break";
}

export function chipShown(tone: ChipTone, filter: FloorFilter): boolean {
  return filter === "all" || filter === tone;
}

export function chipLabel(code: string): string {
  const text = code.trim();
  if (text.length <= 4) return text;
  return text.slice(0, 4);
}
