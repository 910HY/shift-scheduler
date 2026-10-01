const SHIFT_IDS = ["E1", "E3", "E4", "B2", "B1", "C2", "E", "A"] as const;

/** Shift code plus post code, so B1 K1 and B2 K1 stay distinct. */
export function splitStaffCode(code: string, shift?: string): { shift: string; code: string; label: string } {
  const text = code.trim();
  for (const id of SHIFT_IDS) {
    if (text === id || text.startsWith(`${id} `)) {
      const rest = text.slice(id.length).trim();
      return { shift: id, code: rest, label: rest ? `${id} ${rest}` : id };
    }
  }
  if (shift) return { shift, code: text, label: text ? `${shift} ${text}` : shift };
  return { shift: "", code: text, label: text };
}
