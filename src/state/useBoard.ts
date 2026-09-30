import { useEffect, useState } from "react";
import { solveBoard } from "@/api";
import {
  applySolverResult,
  buildSolvePayload,
  describeRecompute,
  locksHeld,
  type OpResult,
} from "@/logic/board";
import { createAppSeed, ensureStaffing } from "@/logic/seed";
import { loadStoredBoard, saveBoard } from "@/logic/storage";
import type { BoardState } from "@/types";

export function useBoard() {
  const [boot] = useState(() => loadStoredBoard());
  const [state, setState] = useState<BoardState>(() => ensureStaffing(boot.state));
  const [persist, setPersist] = useState(boot.persist);
  const [mismatch, setMismatch] = useState(boot.mismatch);
  const [notice, setNotice] = useState<string | null>(boot.notice);
  const [solving, setSolving] = useState(false);

  useEffect(() => {
    if (!persist) return;
    saveBoard(state);
  }, [state, persist]);

  function commit(result: OpResult): boolean {
    if (!result.ok) {
      setNotice(result.reason);
      return false;
    }
    setPersist(true);
    setMismatch(false);
    setState(result.state);
    setNotice(null);
    return true;
  }

  function replace(next: BoardState) {
    setPersist(true);
    setMismatch(false);
    setState(next);
  }

  async function recompute() {
    setSolving(true);
    try {
      const response = await solveBoard(buildSolvePayload(state));
      const next = applySolverResult(state, response.assignments);
      if (!locksHeld(state, next)) {
        setNotice("這次重算沒有套用，因為鎖定格子對不上。");
        return;
      }
      setPersist(true);
      setMismatch(false);
      setState(next);
      setNotice(describeRecompute(next));
    } catch {
      setNotice("求解服務沒有回應。手動調動仍可用，鎖定格子不會被拖走。");
    } finally {
      setSolving(false);
    }
  }

  function resetDemo() {
    setPersist(true);
    setMismatch(false);
    setState(createAppSeed());
    setNotice("已回復 B2 Arr Hall 示範。現場時刻是 13:10。");
  }

  function acceptUpgrade() {
    setPersist(true);
    setMismatch(false);
    setNotice("已用目前版本覆蓋本機紀錄。");
  }

  return {
    state,
    notice,
    setNotice,
    solving,
    mismatch,
    persist,
    commit,
    replace,
    recompute,
    resetDemo,
    acceptUpgrade,
  };
}
