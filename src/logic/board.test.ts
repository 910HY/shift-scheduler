import { describe, expect, it } from "vitest";
import {
  addPost,
  applySolverResult,
  assignStaff,
  buildSolvePayload,
  deletePost,
  describeRecompute,
  locksHeld,
  moveToTop,
  postsInZone,
  renamePost,
  swapStaff,
} from "@/logic/board";
import { createSeed } from "@/logic/seed";
import { parseStoredBoard, serializeBoard } from "@/logic/storage";
import { isAvailable, isLateActive, isLeaveActive, isOnBreak } from "@/logic/time";
import { STORAGE_VERSION, type BoardState, type Post, type Staff } from "@/types";

function person(id: string, extra: Partial<Staff> = {}): Staff {
  return {
    id,
    code: id,
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

function post(id: string, extra: Partial<Post> = {}): Post {
  return {
    id,
    zoneId: "arr",
    name: id,
    order: 0,
    locked: false,
    assigneeId: null,
    ...extra,
  };
}

function board(posts: Post[], staff: Staff[], now = "13:10"): BoardState {
  return {
    date: "2026-09-28",
    shiftName: "早更",
    now,
    zones: [
      { id: "arr", title: "到達區", code: "ARR", templateId: "ARR" },
      { id: "kiosk", title: "櫃檯區", code: "KIOSK", templateId: "KIOSK" },
    ],
    posts,
    staff,
  };
}

describe("locked cells", () => {
  it("does not send a locked person to rest", () => {
    const state = board([post("P1", { locked: true, assigneeId: "S1" })], [person("S1")]);
    const result = assignStaff(state, "S1", null);
    expect(result.ok).toBe(false);
    expect(result.state.posts[0]?.assigneeId).toBe("S1");
  });

  it("does not overwrite a locked cell by dropping someone else", () => {
    const state = board(
      [post("P1", { locked: true, assigneeId: "S1" })],
      [person("S1"), person("S2", { restOrder: 1 })],
    );
    const result = assignStaff(state, "S2", "P1");
    expect(result.ok).toBe(false);
    expect(result.state.posts[0]?.assigneeId).toBe("S1");
  });

  it("does not swap a locked cell", () => {
    const state = board(
      [
        post("P1", { locked: true, assigneeId: "S1", order: 0 }),
        post("P2", { assigneeId: "S2", order: 1 }),
      ],
      [person("S1"), person("S2")],
    );
    const result = swapStaff(state, "S1", "S2");
    expect(result.ok).toBe(false);
    expect(result.state.posts.map((item) => item.assigneeId)).toEqual(["S1", "S2"]);
  });

  it("does not pull a rest-locked person onto a post", () => {
    const state = board([post("P1")], [person("S1", { restLocked: true })]);
    const result = assignStaff(state, "S1", "P1");
    expect(result.ok).toBe(false);
    expect(result.state.posts[0]?.assigneeId).toBeNull();
  });

  it("ignores a solver payload that tries to move a locked cell", () => {
    const state = board(
      [
        post("P1", { locked: true, assigneeId: "S1" }),
        post("P2", { assigneeId: "S2", order: 1 }),
      ],
      [person("S1"), person("S2")],
    );
    const next = applySolverResult(state, { P1: "S2", P2: "S1" });
    expect(next.posts.find((item) => item.id === "P1")?.assigneeId).toBe("S1");
    expect(next.posts.find((item) => item.id === "P2")?.assigneeId).not.toBe("S1");
    expect(locksHeld(state, next)).toBe(true);
  });

  it("does not place a rest-locked person even if the solver asks", () => {
    const state = board([post("P1")], [person("S1", { restLocked: true })]);
    const next = applySolverResult(state, { P1: "S1" });
    expect(next.posts[0]?.assigneeId).toBeNull();
    expect(locksHeld(state, next)).toBe(true);
  });
});

describe("live reassignment", () => {
  it("swaps two unlocked posts", () => {
    const state = board(
      [post("P1", { assigneeId: "S1" }), post("P2", { assigneeId: "S2", order: 1 })],
      [person("S1"), person("S2")],
    );
    const result = swapStaff(state, "S1", "S2");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.state.posts.map((item) => item.assigneeId)).toEqual(["S2", "S1"]);
    }
  });

  it("moves an unlocked person to rest and back", () => {
    const state = board([post("P1", { assigneeId: "S1" }), post("P2")], [person("S1")]);
    const toRest = assignStaff(state, "S1", null);
    expect(toRest.ok).toBe(true);
    if (!toRest.ok) return;
    expect(toRest.state.posts[0]?.assigneeId).toBeNull();
    const back = assignStaff(toRest.state, "S1", "P2");
    expect(back.ok).toBe(true);
    if (back.ok) expect(back.state.posts[1]?.assigneeId).toBe("S1");
  });

  it("moves a post to the front of its zone without changing who is on it", () => {
    const state = board(
      [post("P1", { assigneeId: "S1", order: 0 }), post("P2", { assigneeId: "S2", order: 1 })],
      [person("S1"), person("S2")],
    );
    const result = moveToTop(state, "S2");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(postsInZone(result.state, "arr").map((item) => item.id)).toEqual(["P2", "P1"]);
    expect(result.state.posts.find((item) => item.id === "P2")?.assigneeId).toBe("S2");
  });
});

describe("mutable posts", () => {
  it("adds a freely named post and can rename or delete it", () => {
    const state = board([], []);
    const added = addPost(state, { zoneId: "kiosk", name: "臨時問詢" });
    expect(added.posts).toHaveLength(1);
    expect(added.posts[0]?.name).toBe("臨時問詢");
    const renamed = renamePost(added, added.posts[0]!.id, "午間櫃");
    expect(renamed.posts[0]?.name).toBe("午間櫃");
    expect(deletePost(renamed, renamed.posts[0]!.id).posts).toHaveLength(0);
  });
});

describe("markers and solver payload", () => {
  it("treats leave-early and return-late against the board clock", () => {
    const left = person("S1", { leaveEarlyAt: "12:30" });
    const late = person("S2", { returnLateAt: "14:00" });
    const breaking = person("S3", { breakStart: "13:00", breakEnd: "13:40" });
    expect(isLeaveActive(left, "13:10")).toBe(true);
    expect(isAvailable(left, "13:10")).toBe(false);
    expect(isLateActive(late, "13:10")).toBe(true);
    expect(isLateActive(late, "14:00")).toBe(false);
    expect(isOnBreak(breaking, "13:10")).toBe(true);
  });

  it("marks a person on break as available but more expensive to pull", () => {
    const state = board(
      [],
      [person("S1", { breakStart: "13:00", breakEnd: "13:40" }), person("S2", { leaveEarlyAt: "12:30" })],
    );
    const payload = buildSolvePayload(state);
    expect(payload.staff.find((item) => item.id === "S1")).toMatchObject({ available: true, assign_penalty: 3 });
    expect(payload.staff.find((item) => item.id === "S2")?.available).toBe(false);
  });

  it("describes leftover vacancies", () => {
    const state = board([post("P1"), post("P2", { locked: true })], []);
    expect(describeRecompute(state)).toContain("缺人");
    expect(describeRecompute(state)).toContain("鎖定");
  });
});

describe("storage version", () => {
  it("round-trips version 1 and rejects a different version", () => {
    const state = createSeed();
    const raw = serializeBoard(state);
    const parsed = parseStoredBoard(raw);
    expect(parsed.status).toBe("restored");
    if (parsed.status === "restored") expect(parsed.state.shiftName).toBe(state.shiftName);
    const mismatch = parseStoredBoard(JSON.stringify({ version: 9, state }));
    expect(mismatch).toEqual({ status: "mismatch", found: 9 });
    expect(STORAGE_VERSION).toBe(1);
    expect(raw).toContain(`"version":${STORAGE_VERSION}`);
  });
});
