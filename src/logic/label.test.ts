import { describe, expect, it } from "vitest";
import { splitStaffCode } from "@/logic/label";

describe("splitStaffCode", () => {
  it("prefixes a bare post code with the shift", () => {
    expect(splitStaffCode("K1", "B2")).toEqual({ shift: "B2", code: "K1", label: "B2 K1" });
    expect(splitStaffCode("K2", "B1")).toEqual({ shift: "B1", code: "K2", label: "B1 K2" });
  });

  it("keeps an existing shift prefix and does not confuse E with E1", () => {
    expect(splitStaffCode("B1 K1").label).toBe("B1 K1");
    expect(splitStaffCode("B2 K1").label).toBe("B2 K1");
    expect(splitStaffCode("E1 K3").shift).toBe("E1");
    expect(splitStaffCode("E K3").shift).toBe("E");
    expect(splitStaffCode("B1 K1").label).not.toBe(splitStaffCode("B2 K1").label);
    expect(splitStaffCode("B1 K1").label).not.toBe(splitStaffCode("B2 K2").label);
  });
});
