import { describe, expect, it } from "vitest";
import { nowPlace, personPresence, presenceTotals } from "@/logic/presence";
import { createSeed } from "@/logic/seed";
import { layoutPosts } from "@/logic/stands";
import { isAvailable, isWithinDuty } from "@/logic/time";
import type { Staff } from "@/types";

describe("presence totals", () => {
  it("cuts overlapping shifts at 13:10", () => {
    const state = createSeed();
    expect(presenceTotals(state)).toMatchObject({ onSite: 9, onduty: 5, rest: 4, filled: 10, total: 12 });
    expect(nowPlace(state, by(state, "s03"))).toBe("stand");
    expect(nowPlace(state, by(state, "s04"))).toBe("mb");
    expect(nowPlace(state, by(state, "s07"))).toBe("mb");
    expect(nowPlace(state, by(state, "s10"))).toBe("mb");
    expect(nowPlace(state, by(state, "s12"))).toBe("r");
    expect(nowPlace(state, by(state, "s06"))).toBe("sl");
    expect(nowPlace(state, by(state, "s09"))).toBe("uvl");
    expect(nowPlace(state, by(state, "s11"))).toBe("off");
    expect(nowPlace(state, by(state, "s13"))).toBe("off");
    expect(personPresence(state, by(state, "s06"))).toBe("away");
    expect(personPresence(state, by(state, "s11"))).toBe("away");
  });

  it("brings 06 back before S/L and 09 onto the stand after UVL", () => {
    const seed = createSeed();
    const morning = { ...seed, now: "12:00" };
    expect(nowPlace(morning, by(morning, "s06"))).toBe("stand");
    expect(nowPlace(morning, by(morning, "s09"))).toBe("uvl");
    const afternoon = { ...seed, now: "14:00" };
    expect(nowPlace(afternoon, by(afternoon, "s09"))).toBe("stand");
    expect(nowPlace(afternoon, by(afternoon, "s06"))).toBe("sl");
    expect(nowPlace(afternoon, by(afternoon, "s13"))).toBe("r");
    expect(nowPlace(afternoon, by(afternoon, "s04"))).toBe("stand");
  });

  it("shows overnight 10K only inside the wrapped duty", () => {
    const seed = createSeed();
    const night = { ...seed, now: "23:00" };
    expect(nowPlace(night, by(night, "s11"))).toBe("r");
    expect(isWithinDuty(by(night, "s11"), "06:30")).toBe(true);
    expect(isWithinDuty(by(night, "s11"), "13:10")).toBe(false);
    expect(isAvailable(by(seed, "s11"), seed.now)).toBe(false);
    expect(isAvailable(by(seed, "s03"), seed.now)).toBe(true);
  });
});

describe("stand layout", () => {
  it("gives every seed post its own bay inside the apron", () => {
    const state = createSeed();
    const rects = layoutPosts(state);
    expect(rects.size).toBe(state.posts.length);
    const keys = new Set<string>();
    for (const post of state.posts) {
      const rect = rects.get(post.id);
      expect(rect?.w).toBeGreaterThanOrEqual(12);
      expect(rect?.h).toBeGreaterThanOrEqual(12);
      expect(rect!.x).toBeGreaterThanOrEqual(0);
      expect(rect!.y).toBeGreaterThanOrEqual(0);
      expect(rect!.x + rect!.w).toBeLessThanOrEqual(100);
      keys.add(`${rect!.x},${rect!.y}`);
    }
    expect(keys.size).toBe(state.posts.length);
  });
});

function by(state: { staff: Staff[] }, id: string): Staff {
  const person = state.staff.find((item) => item.id === id);
  if (!person) throw new Error(id);
  return person;
}
