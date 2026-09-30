import type { DragEvent } from "react";
import { cn } from "cn";
import type { ChipTone } from "@/logic/chip";

export function PersonChip({
  label,
  tone,
  selected,
  locked,
  dimmed,
  draggable = false,
  testId,
  onClick,
  onDoubleClick,
  onDragStart,
}: {
  label: string;
  tone: ChipTone;
  selected: boolean;
  locked?: boolean;
  dimmed?: boolean;
  draggable?: boolean;
  testId?: string;
  onClick: () => void;
  onDoubleClick?: () => void;
  onDragStart?: (event: DragEvent<HTMLButtonElement>) => void;
}) {
  return (
    <button
      type="button"
      draggable={draggable}
      data-testid={testId}
      data-tone={tone}
      onClick={(event) => {
        event.stopPropagation();
        onClick();
      }}
      onDoubleClick={(event) => {
        event.stopPropagation();
        onDoubleClick?.();
      }}
      onDragStart={onDragStart}
      className={cn(
        "person-chip",
        draggable ? "cursor-grab active:cursor-grabbing" : "cursor-pointer",
        tone === "onduty" && "is-onduty",
        tone === "break" && "is-break",
        tone === "exception" && "is-exception",
        tone === "vacant" && "is-vacant",
        selected && "is-selected",
        dimmed && "is-dim",
      )}
    >
      <span>{label}</span>
      {locked && <span className="chip-lock">鎖</span>}
    </button>
  );
}
