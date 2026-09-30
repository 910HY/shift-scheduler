import { describe, expect, it } from "vitest";
import { chipLabel, chipShown, chipTone } from "@/logic/chip";
import type { Staff } from "@/types";

function staff(extra: Partial<Staff> = {}): Staff {
  return {
    id: "s",
    code: "01",
    dutyStart: "07:00",
    dutyEnd: "15:30",
    breakStart: null,
    breakEnd: null,
    leaveEarlyAt: null,
    returnLateAt: null,
    restLocked: false,
    restOrder: 0,
    ...extra,
  };
}

describe("chipTone", () => {
  it("marks an empty seat vacant", () => {
    expect(chipTone(undefined, "13:10", true)).toBe("vacant");
  });

  it("uses on-duty green when the person is on a post", () => {
    expect(chipTone(staff(), "13:10", true)).toBe("onduty");
  });

  it("uses break amber when the person is in rest", () => {
    expect(chipTone(staff(), "13:10", false)).toBe("break");
  });

  it("lets an active exception override location", () => {
    expect(chipTone(staff({ leaveEarlyAt: "12:30" }), "13:10", true)).toBe("exception");
    expect(chipTone(staff({ returnLateAt: "14:00" }), "13:10", false)).toBe("exception");
    expect(chipTone(staff({ leaveEarlyAt: "14:00" }), "13:10", true)).toBe("onduty");
  });
});

describe("chipShown", () => {
  it("keeps every tone when the filter is all", () => {
    expect(chipShown("onduty", "all")).toBe(true);
    expect(chipShown("vacant", "all")).toBe(true);
  });

  it("matches only the selected tone", () => {
    expect(chipShown("break", "break")).toBe(true);
    expect(chipShown("onduty", "break")).toBe(false);
  });
});

describe("chipLabel", () => {
  it("keeps a short code and trims longer text to four characters", () => {
    expect(chipLabel(" 03 ")).toBe("03");
    expect(chipLabel("臨時問詢")).toBe("臨時問詢");
    expect(chipLabel("12345")).toBe("1234");
  });
});
