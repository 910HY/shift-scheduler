import { isAvailable, isLateActive, isLeaveActive, isOnBreak } from "@/logic/time";
import { TEMPLATES, type BoardState, type Post, type SolvePayload, type Staff, type TemplateId } from "@/types";

export type OpResult =
  | { ok: true; state: BoardState }
  | { ok: false; state: BoardState; reason: string };

function ok(state: BoardState): OpResult {
  return { ok: true, state };
}

function fail(state: BoardState, reason: string): OpResult {
  return { ok: false, state, reason };
}

function nextId(prefix: string): string {
  return `${prefix}-${crypto.randomUUID()}`;
}

export function staffById(state: BoardState, id: string): Staff | undefined {
  return state.staff.find((person) => person.id === id);
}

export function postById(state: BoardState, id: string): Post | undefined {
  return state.posts.find((post) => post.id === id);
}

export function postOfStaff(state: BoardState, staffId: string): Post | undefined {
  return state.posts.find((post) => post.assigneeId === staffId);
}

export function postsInZone(state: BoardState, zoneId: string): Post[] {
  return state.posts
    .filter((post) => post.zoneId === zoneId)
    .sort((a, b) => a.order - b.order || a.name.localeCompare(b.name, "zh-Hant"));
}

export function restingStaff(state: BoardState): Staff[] {
  const assigned = new Set(state.posts.map((post) => post.assigneeId).filter((id): id is string => Boolean(id)));
  return state.staff
    .filter((person) => !assigned.has(person.id))
    .sort((a, b) => a.restOrder - b.restOrder || a.code.localeCompare(b.code));
}

export function restGroups(state: BoardState): { floor: Staff[]; late: Staff[]; left: Staff[] } {
  const resting = restingStaff(state);
  return {
    left: resting.filter((person) => isLeaveActive(person, state.now)),
    late: resting.filter((person) => !isLeaveActive(person, state.now) && isLateActive(person, state.now)),
    floor: resting.filter((person) => isAvailable(person, state.now)),
  };
}

export function placementLabel(state: BoardState, staffId: string): string {
  const post = postOfStaff(state, staffId);
  if (!post) return "R";
  const zone = state.zones.find((item) => item.id === post.zoneId);
  return `${zone?.title ?? "在崗"} · ${post.name}`;
}

export function nextStaffCode(state: BoardState): string {
  const numbers = state.staff.map((person) => Number(person.code)).filter((value) => Number.isInteger(value));
  const next = (numbers.length ? Math.max(...numbers) : 0) + 1;
  return String(next).padStart(2, "0");
}

export function suggestPostName(state: BoardState, zoneId: string, templateId: TemplateId): string {
  const template = TEMPLATES.find((item) => item.id === templateId);
  const count = state.posts.filter((post) => post.zoneId === zoneId).length + 1;
  return `${template?.label ?? "崗位"} ${count}`;
}

export function summarize(state: BoardState): {
  onDuty: number;
  resting: number;
  left: number;
  late: number;
  vacancies: number;
  posts: number;
} {
  const assignedIds = new Set(state.posts.map((post) => post.assigneeId).filter((id): id is string => Boolean(id)));
  let onDuty = 0;
  for (const post of state.posts) {
    if (!post.assigneeId) continue;
    const person = staffById(state, post.assigneeId);
    if (person && isAvailable(person, state.now)) onDuty += 1;
  }
  return {
    onDuty,
    resting: state.staff.filter((person) => !assignedIds.has(person.id)).length,
    left: state.staff.filter((person) => isLeaveActive(person, state.now)).length,
    late: state.staff.filter((person) => isLateActive(person, state.now)).length,
    vacancies: state.posts.filter((post) => !post.locked && !post.assigneeId).length,
    posts: state.posts.length,
  };
}

export function lockedAssigneeMap(state: BoardState): Map<string, string | null> {
  const fixed = new Map<string, string | null>();
  for (const post of state.posts) {
    if (post.locked) fixed.set(post.id, post.assigneeId);
  }
  return fixed;
}

export function applySolverResult(state: BoardState, proposed: Record<string, string | null>): BoardState {
  const fixed = lockedAssigneeMap(state);
  const frozen = new Set<string>();
  for (const personId of fixed.values()) {
    if (personId) frozen.add(personId);
  }
  for (const person of state.staff) {
    if (person.restLocked) frozen.add(person.id);
  }

  const used = new Set<string>(frozen);
  const next = new Map<string, string | null>();
  for (const post of state.posts) {
    if (fixed.has(post.id)) {
      next.set(post.id, fixed.get(post.id) ?? null);
      continue;
    }
    const want = proposed[post.id] ?? null;
    const legal = Boolean(want && state.staff.some((person) => person.id === want) && !used.has(want));
    if (want && legal) {
      next.set(post.id, want);
      used.add(want);
    } else {
      next.set(post.id, null);
    }
  }

  for (const person of state.staff) {
    if (!person.restLocked) continue;
    for (const [postId, personId] of next) {
      if (personId === person.id && !fixed.has(postId)) next.set(postId, null);
    }
  }

  return {
    ...state,
    posts: state.posts.map((post) => ({ ...post, assigneeId: next.get(post.id) ?? null })),
  };
}

export function locksHeld(before: BoardState, after: BoardState): boolean {
  const postsHeld = before.posts.every((post) => {
    if (!post.locked) return true;
    const next = after.posts.find((item) => item.id === post.id);
    return Boolean(next && next.locked && next.assigneeId === post.assigneeId);
  });
  const restHeld = before.staff.every((person) => {
    if (!person.restLocked) return true;
    return !after.posts.some((post) => post.assigneeId === person.id && !post.locked);
  });
  return postsHeld && restHeld;
}

export function describeRecompute(after: BoardState): string {
  const vacancies = after.posts.filter((post) => !post.locked && post.assigneeId == null);
  const heldEmpty = after.posts.filter((post) => post.locked && post.assigneeId == null);
  const idle = after.staff.filter(
    (person) =>
      isAvailable(person, after.now) &&
      !person.restLocked &&
      !after.posts.some((post) => post.assigneeId === person.id),
  );
  const parts = ["已重算未鎖定崗位。鎖定格子維持原位。"];
  if (!after.posts.length) {
    return "板上還沒有崗位。";
  }
  if (vacancies.length) {
    parts.push(`尚缺 ${vacancies.length} 人，空位會標成「缺人」。`);
  } else if (after.posts.some((post) => !post.locked)) {
    parts.push("未鎖定崗位都已補上。");
  }
  if (heldEmpty.length && idle.length) {
    parts.push(`還有 ${idle.length} 人在休息區，但剩下的空位已鎖定，不會填進去。`);
  }
  return parts.join("");
}

export function buildSolvePayload(state: BoardState): SolvePayload {
  const postByStaff = new Map<string, string>();
  for (const post of state.posts) {
    if (post.assigneeId) postByStaff.set(post.assigneeId, post.id);
  }
  return {
    posts: state.posts.map((post) => ({
      id: post.id,
      locked: post.locked,
      assignee_id: post.assigneeId,
    })),
    staff: state.staff.map((person) => ({
      id: person.id,
      locked: person.restLocked,
      available: isAvailable(person, state.now),
      post_id: postByStaff.get(person.id) ?? null,
      assign_penalty: isOnBreak(person, state.now) ? 3 : 0,
    })),
  };
}

export function assignStaff(state: BoardState, staffId: string, postId: string | null): OpResult {
  const person = staffById(state, staffId);
  if (!person) return fail(state, "找不到這個人。");
  const from = postOfStaff(state, staffId);
  if (from?.locked) return fail(state, "此格已鎖定，不能調離。");
  if (!postId) {
    if (!from) return ok(state);
    return ok({
      ...state,
      posts: state.posts.map((post) => (post.id === from.id ? { ...post, assigneeId: null } : post)),
    });
  }
  const target = postById(state, postId);
  if (!target) return fail(state, "找不到崗位。");
  if (target.locked) return fail(state, "此格已鎖定，不能覆蓋。");
  if (target.assigneeId === staffId) return ok(state);
  if (!from && person.restLocked) return fail(state, "此人鎖定在休息區，不能抽調。");
  return ok({
    ...state,
    posts: state.posts.map((post) => {
      if (post.id === target.id) return { ...post, assigneeId: staffId };
      if (from && post.id === from.id) return { ...post, assigneeId: target.assigneeId };
      return post;
    }),
    staff: state.staff.map((item) => (item.id === staffId ? { ...item, restLocked: false } : item)),
  });
}

export function swapStaff(state: BoardState, aId: string, bId: string): OpResult {
  if (aId === bId) return ok(state);
  const personA = staffById(state, aId);
  const personB = staffById(state, bId);
  if (!personA || !personB) return fail(state, "找不到人員。");
  const postA = postOfStaff(state, aId);
  const postB = postOfStaff(state, bId);
  if (postA?.locked || postB?.locked) return fail(state, "鎖定的格子不能對調。");
  if (!postA && personA.restLocked) return fail(state, "休息區鎖定的人不能對調出去。");
  if (!postB && personB.restLocked) return fail(state, "休息區鎖定的人不能對調出去。");
  if (!postA && !postB) {
    return ok({
      ...state,
      staff: state.staff.map((person) => {
        if (person.id === aId) return { ...person, restOrder: personB.restOrder };
        if (person.id === bId) return { ...person, restOrder: personA.restOrder };
        return person;
      }),
    });
  }
  return ok({
    ...state,
    posts: state.posts.map((post) => {
      if (postA && post.id === postA.id) return { ...post, assigneeId: bId };
      if (postB && post.id === postB.id) return { ...post, assigneeId: aId };
      return post;
    }),
    staff: state.staff.map((person) =>
      person.id === aId || person.id === bId ? { ...person, restLocked: false } : person,
    ),
  });
}

export function moveToTop(state: BoardState, staffId: string): OpResult {
  const person = staffById(state, staffId);
  if (!person) return fail(state, "找不到這個人。");
  const post = postOfStaff(state, staffId);
  if (post) {
    const peers = state.posts.filter((item) => item.zoneId === post.zoneId);
    const min = peers.length ? Math.min(...peers.map((item) => item.order)) : 0;
    return ok({
      ...state,
      posts: state.posts.map((item) => (item.id === post.id ? { ...item, order: min - 1 } : item)),
    });
  }
  const min = state.staff.length ? Math.min(...state.staff.map((item) => item.restOrder)) : 0;
  return ok({
    ...state,
    staff: state.staff.map((item) => (item.id === staffId ? { ...item, restOrder: min - 1 } : item)),
  });
}

export function setPostLocked(state: BoardState, postId: string, locked: boolean): BoardState {
  return {
    ...state,
    posts: state.posts.map((post) => (post.id === postId ? { ...post, locked } : post)),
  };
}

export function renamePost(state: BoardState, postId: string, name: string): BoardState {
  const trimmed = name.trim();
  if (!trimmed) return state;
  return {
    ...state,
    posts: state.posts.map((post) => (post.id === postId ? { ...post, name: trimmed } : post)),
  };
}

export function deletePost(state: BoardState, postId: string): BoardState {
  return { ...state, posts: state.posts.filter((post) => post.id !== postId) };
}

export function movePostToZone(state: BoardState, postId: string, zoneId: string): BoardState {
  if (!state.zones.some((zone) => zone.id === zoneId)) return state;
  const peers = state.posts.filter((post) => post.zoneId === zoneId && post.id !== postId);
  const order = peers.length ? Math.max(...peers.map((post) => post.order)) + 1 : 0;
  return {
    ...state,
    posts: state.posts.map((post) => (post.id === postId ? { ...post, zoneId, order } : post)),
  };
}

export function addPost(state: BoardState, input: { zoneId: string; name: string }): BoardState {
  if (!state.zones.some((zone) => zone.id === input.zoneId)) return state;
  const peers = state.posts.filter((post) => post.zoneId === input.zoneId);
  const order = peers.length ? Math.max(...peers.map((post) => post.order)) + 1 : 0;
  const post: Post = {
    id: nextId("post"),
    zoneId: input.zoneId,
    name: input.name.trim() || "未命名崗位",
    order,
    locked: false,
    assigneeId: null,
  };
  return { ...state, posts: [...state.posts, post] };
}

export function renameZone(state: BoardState, zoneId: string, patch: { title?: string; code?: string }): BoardState {
  return {
    ...state,
    zones: state.zones.map((zone) => {
      if (zone.id !== zoneId) return zone;
      const title = patch.title?.trim();
      const code = patch.code?.trim();
      return {
        ...zone,
        title: title || zone.title,
        code: code || zone.code,
      };
    }),
  };
}

export function updateStaff(state: BoardState, staffId: string, patch: Partial<Omit<Staff, "id">>): BoardState {
  return {
    ...state,
    staff: state.staff.map((person) => (person.id === staffId ? { ...person, ...patch } : person)),
  };
}

export function addStaff(state: BoardState, input: Omit<Staff, "id" | "restOrder">): BoardState {
  const restOrder = state.staff.length ? Math.max(...state.staff.map((person) => person.restOrder)) + 1 : 0;
  const person: Staff = { ...input, id: nextId("staff"), restOrder };
  return { ...state, staff: [...state.staff, person] };
}

export function removeStaff(state: BoardState, staffId: string): BoardState {
  return {
    ...state,
    staff: state.staff.filter((person) => person.id !== staffId),
    posts: state.posts.map((post) => (post.assigneeId === staffId ? { ...post, assigneeId: null } : post)),
  };
}
