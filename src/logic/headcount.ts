import {
  SHIFTS,
  awayHours,
  defaultRules,
  postsForPercent,
  requiredCrew,
  shiftsActiveAt,
} from "@/logic/staffing";
import type { ShiftId, StaffingState } from "@/types";

export type HeadcountLine = {
  shiftId: ShiftId;
  start: string;
  end: string;
  band: "day" | "night";
  percent: number;
  openPosts: number;
  /** People needed if this shift covered the open posts by itself, including rest and meal. */
  suggested: number;
};

export type OverlapExplain = {
  at: string;
  active: ShiftId[];
  suggestedSum: number;
  simultaneousPosts: number;
  mixedPercent: boolean;
  message: string;
};

const SAMPLE_TIMES = ["09:15", "11:15", "16:00", "22:00", "23:00"];

function rulesFor(staffing: StaffingState, shiftId: ShiftId) {
  return shiftId === staffing.shiftId ? staffing.rules : defaultRules(shiftId);
}

/** Per-shift solo crew at the day/A open percents, plus overlap samples that must not be summed. */
export function headcountTrial(staffing: StaffingState, dayPercent: number, nightPercent: number): {
  lines: HeadcountLine[];
  overlaps: OverlapExplain[];
} {
  const lines: HeadcountLine[] = SHIFTS.map((shift) => {
    const band = shift.id === "A" ? "night" : "day";
    const percent = band === "night" ? nightPercent : dayPercent;
    const openPosts = postsForPercent(staffing, percent).length;
    const rules = rulesFor(staffing, shift.id);
    return {
      shiftId: shift.id,
      start: shift.start,
      end: shift.end,
      band,
      percent,
      openPosts,
      suggested: requiredCrew(openPosts, shift.hours, awayHours(shift.id, rules)),
    };
  });
  const overlaps = SAMPLE_TIMES.flatMap((at) => {
    const active = shiftsActiveAt(at);
    if (active.length < 2) return [];
    const activeLines = lines.filter((line) => active.includes(line.shiftId));
    const suggestedSum = activeLines.reduce((sum, line) => sum + line.suggested, 0);
    const simultaneousPosts = activeLines.reduce((max, line) => Math.max(max, line.openPosts), 0);
    const percents = new Set(activeLines.map((line) => line.percent));
    const mixedPercent = percents.size > 1;
    const names = active.join("、");
    const message = mixedPercent
      ? `${at} 重疊 ${names}。各更單獨建議相加 ${suggestedSum} 人。日更同 A 開崗％唔同，同時在崗上限 ${simultaneousPosts}，唔等於 ${suggestedSum}。共需仍然係一個崗位池，唔好每更各乘一次。`
      : `${at} 重疊 ${names}。各更單獨建議相加 ${suggestedSum} 人，同時在崗只有 ${simultaneousPosts}（共用一個崗位池，唔等於 ${suggestedSum}）。`;
    return [{ at, active, suggestedSum, simultaneousPosts, mixedPercent, message }];
  });
  return { lines, overlaps };
}
