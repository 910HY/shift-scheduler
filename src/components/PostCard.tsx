import { useState } from "react";
import { InlineText } from "@/components/InlineText";
import { PersonChip } from "@/components/PersonChip";
import { chipLabel, chipShown, chipTone, type FloorFilter } from "@/logic/chip";
import { isLateActive, isLeaveActive, isOnBreak } from "@/logic/time";
import type { Post, Staff } from "@/types";
import { cn } from "cn";

export function PostCard({
  post,
  person,
  now,
  selected,
  filter,
  onActivate,
  onSelectStaff,
  onDropStaff,
  onRename,
  onEditStaff,
}: {
  post: Post;
  person: Staff | undefined;
  now: string;
  selected: boolean;
  filter: FloorFilter;
  onActivate: () => void;
  onSelectStaff: () => void;
  onDropStaff: (staffId: string) => void;
  onRename: (name: string) => void;
  onEditStaff: () => void;
}) {
  const [over, setOver] = useState(false);
  const tone = chipTone(person, now, true);
  const left = person ? isLeaveActive(person, now) : false;
  const late = person ? isLateActive(person, now) : false;
  const onBreak = person ? isOnBreak(person, now) : false;

  let meta = "缺人";
  if (person) meta = `${person.dutyStart}–${person.dutyEnd}`;
  else if (post.locked) meta = "鎖定空位";

  let note = "";
  if (person && left && person.leaveEarlyAt) note = `已早走 ${person.leaveEarlyAt}`;
  else if (person && late && person.returnLateAt) note = `未返 ${person.returnLateAt}`;
  else if (person && person.leaveEarlyAt) note = `早走 ${person.leaveEarlyAt}`;
  else if (person && person.returnLateAt) note = `遲返 ${person.returnLateAt}`;
  else if (onBreak && person?.breakStart && person.breakEnd) note = `休息中 ${person.breakStart}–${person.breakEnd}`;

  return (
    <article
      data-testid={`post-${post.id}`}
      onClick={onActivate}
      onDragOver={(event) => {
        event.preventDefault();
        setOver(true);
      }}
      onDragLeave={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOver(false);
      }}
      onDrop={(event) => {
        event.preventDefault();
        setOver(false);
        const staffId = event.dataTransfer.getData("text/plain");
        if (staffId) onDropStaff(staffId);
      }}
      className={cn("station", over && "is-over")}
    >
      <InlineText
        label={`${post.name} 的名稱`}
        value={post.name}
        onCommit={onRename}
        className="station-label"
      />
      <p className="station-meta">{meta}</p>
      <PersonChip
        label={person ? chipLabel(person.code) : "空"}
        tone={tone}
        selected={selected}
        locked={post.locked}
        dimmed={!chipShown(tone, filter)}
        draggable={Boolean(person)}
        testId={person ? `staff-${person.id}` : post.locked ? "held-empty" : "vacancy"}
        onClick={() => (person ? onSelectStaff() : onActivate())}
        onDoubleClick={person ? onEditStaff : undefined}
        onDragStart={
          person
            ? (event) => {
                event.dataTransfer.setData("text/plain", person.id);
                event.dataTransfer.effectAllowed = "move";
              }
            : undefined
        }
      />
      <p className="station-meta">{note}</p>
    </article>
  );
}
