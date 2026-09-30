import { useState, type ReactNode } from "react";
import { PersonChip } from "@/components/PersonChip";
import { restGroups, staffById } from "@/logic/board";
import { chipLabel, chipShown, chipTone, type FloorFilter } from "@/logic/chip";
import { isOnBreak } from "@/logic/time";
import type { BoardState, Staff } from "@/types";
import { cn } from "cn";

function RestChip({
  person,
  now,
  selected,
  filter,
  onSelect,
  onEdit,
  onSwap,
}: {
  person: Staff;
  now: string;
  selected: boolean;
  filter: FloorFilter;
  onSelect: () => void;
  onEdit: () => void;
  onSwap: (staffId: string) => void;
}) {
  const tone = chipTone(person, now, false);
  const breaking = isOnBreak(person, now);
  let meta = "待派";
  if (person.leaveEarlyAt && tone === "exception") meta = `已早走 ${person.leaveEarlyAt}`;
  else if (person.returnLateAt && tone === "exception") meta = `未返 ${person.returnLateAt}`;
  else if (person.breakStart && person.breakEnd) {
    meta = `${breaking ? "休息中" : "休息"} ${person.breakStart}–${person.breakEnd}`;
  }

  return (
    <div
      className="station"
      onDragOver={(event) => event.preventDefault()}
      onDrop={(event) => {
        event.preventDefault();
        event.stopPropagation();
        const staffId = event.dataTransfer.getData("text/plain");
        if (staffId && staffId !== person.id) onSwap(staffId);
      }}
    >
      <PersonChip
        label={chipLabel(person.code)}
        tone={tone}
        selected={selected}
        locked={person.restLocked}
        dimmed={!chipShown(tone, filter)}
        draggable
        testId={`staff-${person.id}`}
        onClick={onSelect}
        onDoubleClick={onEdit}
        onDragStart={(event) => {
          event.dataTransfer.setData("text/plain", person.id);
          event.dataTransfer.effectAllowed = "move";
        }}
      />
      <p className="station-meta">{meta}</p>
    </div>
  );
}

export function RestColumn({
  state,
  selectedId,
  filter,
  onSelect,
  onDropStaff,
  onSwap,
  onEdit,
}: {
  state: BoardState;
  selectedId: string | null;
  filter: FloorFilter;
  onSelect: (staffId: string) => void;
  onDropStaff: (staffId: string) => void;
  onSwap: (fromId: string, toId: string) => void;
  onEdit: (staffId: string) => void;
}) {
  const [over, setOver] = useState(false);
  const groups = restGroups(state);
  const selected = selectedId ? staffById(state, selectedId) : undefined;
  const showVacant = chipShown("vacant", filter);

  return (
    <section
      data-testid="rest-zone"
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
      className={cn("zone-rest flex min-h-64 w-full max-w-[420px] flex-col p-4", over && "is-over")}
    >
      <h2 className="zone-label-rest">休息區 BREAK</h2>
      <div className="mt-4 flex flex-1 flex-col gap-4">
        <Group label="待派">
          {groups.floor.map((person) => (
            <RestChip
              key={person.id}
              person={person}
              now={state.now}
              selected={person.id === selectedId}
              filter={filter}
              onSelect={() => onSelect(person.id)}
              onEdit={() => onEdit(person.id)}
              onSwap={(fromId) => onSwap(fromId, person.id)}
            />
          ))}
          <div className="station">
            <PersonChip
              label="空"
              tone="vacant"
              selected={false}
              dimmed={!showVacant}
              testId="rest-vacant"
              onClick={() => {
                if (selected) onDropStaff(selected.id);
              }}
            />
            <p className="station-meta">拖進來離崗</p>
          </div>
        </Group>
        <Group label="未返">
          {groups.late.map((person) => (
            <RestChip
              key={person.id}
              person={person}
              now={state.now}
              selected={person.id === selectedId}
              filter={filter}
              onSelect={() => onSelect(person.id)}
              onEdit={() => onEdit(person.id)}
              onSwap={(fromId) => onSwap(fromId, person.id)}
            />
          ))}
        </Group>
        <Group label="已早走">
          {groups.left.map((person) => (
            <RestChip
              key={person.id}
              person={person}
              now={state.now}
              selected={person.id === selectedId}
              filter={filter}
              onSelect={() => onSelect(person.id)}
              onEdit={() => onEdit(person.id)}
              onSwap={(fromId) => onSwap(fromId, person.id)}
            />
          ))}
        </Group>
      </div>
    </section>
  );
}

function Group({ label, children }: { label: string; children: ReactNode }) {
  const items = (Array.isArray(children) ? children : [children]).filter(Boolean);
  if (!items.length) return null;
  return (
    <div>
      <h3 className="zone-group-label mb-2">{label}</h3>
      <div className="flex flex-wrap gap-x-3 gap-y-4">{children}</div>
    </div>
  );
}
