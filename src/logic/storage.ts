import { createSeed } from "@/logic/seed";
import { STORAGE_KEY, STORAGE_VERSION, type BoardState, type StoredBoard } from "@/types";

export type ParseResult =
  | { status: "restored"; state: BoardState }
  | { status: "mismatch"; found: number }
  | { status: "invalid" };

export function serializeBoard(state: BoardState): string {
  const envelope: StoredBoard = { version: STORAGE_VERSION, state };
  return JSON.stringify(envelope);
}

function isBoardState(value: unknown): value is BoardState {
  if (!value || typeof value !== "object") return false;
  const board = value as BoardState;
  return (
    typeof board.date === "string" &&
    typeof board.shiftName === "string" &&
    typeof board.now === "string" &&
    Array.isArray(board.zones) &&
    Array.isArray(board.posts) &&
    Array.isArray(board.staff)
  );
}

export function parseStoredBoard(raw: string): ParseResult {
  try {
    const parsed = JSON.parse(raw) as Partial<StoredBoard>;
    if (!parsed || typeof parsed.version !== "number") return { status: "invalid" };
    if (parsed.version !== STORAGE_VERSION) return { status: "mismatch", found: parsed.version };
    if (!isBoardState(parsed.state)) return { status: "invalid" };
    return { status: "restored", state: parsed.state };
  } catch {
    return { status: "invalid" };
  }
}

export function loadStoredBoard(): {
  state: BoardState;
  persist: boolean;
  mismatch: boolean;
  notice: string | null;
} {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(STORAGE_KEY);
  } catch {
    return {
      state: createSeed(),
      persist: false,
      mismatch: false,
      notice: "讀不到本機儲存，這次先用示範板。",
    };
  }
  if (!raw) {
    return { state: createSeed(), persist: true, mismatch: false, notice: null };
  }
  const parsed = parseStoredBoard(raw);
  if (parsed.status === "restored") {
    return { state: parsed.state, persist: true, mismatch: false, notice: null };
  }
  if (parsed.status === "mismatch") {
    return {
      state: createSeed(),
      persist: false,
      mismatch: true,
      notice: `本機紀錄版本是 ${parsed.found}，程式讀取的是 version ${STORAGE_VERSION}。畫面先顯示示範板，還沒覆蓋舊檔。`,
    };
  }
  return {
    state: createSeed(),
    persist: true,
    mismatch: false,
    notice: "本機紀錄讀不出來，已改用示範板。",
  };
}

export function saveBoard(state: BoardState): void {
  localStorage.setItem(STORAGE_KEY, serializeBoard(state));
}
