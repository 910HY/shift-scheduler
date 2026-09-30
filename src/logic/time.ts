import type { Staff } from "@/types";

export function timeToMinutes(value: string): number {
  const match = /^(\d{2}):(\d{2})$/.exec(value);
  if (!match) return 0;
  return Number(match[1]) * 60 + Number(match[2]);
}

export function addMinutes(value: string, minutes: number): string {
  const total = Math.max(0, Math.min(23 * 60 + 59, timeToMinutes(value) + minutes));
  const hours = Math.floor(total / 60);
  const mins = total % 60;
  return `${String(hours).padStart(2, "0")}:${String(mins).padStart(2, "0")}`;
}

export function isLeaveActive(staff: Staff, now: string): boolean {
  if (!staff.leaveEarlyAt) return false;
  return timeToMinutes(now) >= timeToMinutes(staff.leaveEarlyAt);
}

export function isLateActive(staff: Staff, now: string): boolean {
  if (!staff.returnLateAt) return false;
  return timeToMinutes(now) < timeToMinutes(staff.returnLateAt);
}

/** Duty may cross midnight (overnight 10K). End is exclusive. */
export function isWithinDuty(staff: Staff, now: string): boolean {
  const start = timeToMinutes(staff.dutyStart);
  const end = timeToMinutes(staff.dutyEnd);
  const current = timeToMinutes(now);
  if (end > start) return current >= start && current < end;
  if (end < start) return current >= start || current < end;
  return false;
}

export function isAvailable(staff: Staff, now: string): boolean {
  return isWithinDuty(staff, now) && !isLeaveActive(staff, now) && !isLateActive(staff, now);
}

export function isOnBreak(staff: Staff, now: string): boolean {
  if (!staff.breakStart || !staff.breakEnd) return false;
  const start = timeToMinutes(staff.breakStart);
  const end = timeToMinutes(staff.breakEnd);
  if (end <= start) return false;
  const current = timeToMinutes(now);
  return current >= start && current < end;
}

export function formatSpan(start: string, end: string): string {
  return `${start}–${end}`;
}
