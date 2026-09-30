import type { SolvePayload, SolveResponse } from "@/types";

export async function solveBoard(payload: SolvePayload): Promise<SolveResponse> {
  const response = await fetch("/api/solve", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!response.ok) throw new Error(`solve ${response.status}`);
  return (await response.json()) as SolveResponse;
}
