import { useEffect, useState, type DragEvent } from "react";
import { InlineText } from "@/components/InlineText";
import { chipLabel, chipShown, type FloorFilter } from "@/logic/chip";
import { postOfStaff, staffById } from "@/logic/board";
import { nowPlace, type NowPlace } from "@/logic/presence";
import { layoutPosts, restRect, ZONE_LABEL, type StandRect } from "@/logic/stands";
import { formatSpan } from "@/logic/time";
import type { BoardState, Staff } from "@/types";
import { cn } from "@/lib/utils";

const RELIEF_LABEL: Record<"mb" | "r" | "sl" | "uvl", string> = {
  mb: "MB",
  r: "R",
  sl: "S/L",
  uvl: "UVL",
};

const RELIEF_RANK: Record<"mb" | "r" | "sl" | "uvl", number> = {
  mb: 0,
  r: 1,
  sl: 2,
  uvl: 3,
};

type Anchor = { kind: "post" | "rest"; id: string };

export function FloorApron({
  state,
  selectedId,
  selectedPostId,
  filter,
  onActivatePost,
  onSelectStaff,
  onDropStaff,
  onDropRest,
  onSwap,
  onEditStaff,
  onRenameZone,
  onClear,
}: {
  state: BoardState;
  selectedId: string | null;
  selectedPostId: string | null;
  filter: FloorFilter;
  onActivatePost: (postId: string) => void;
  onSelectStaff: (staffId: string) => void;
  onDropStaff: (postId: string, staffId: string) => void;
  onDropRest: (staffId: string) => void;
  onSwap: (fromId: string, toId: string) => void;
  onEditStaff: (staffId: string) => void;
  onRenameZone: (zoneId: string, patch: { title?: string; code?: string }) => void;
  onClear: () => void;
}) {
  const [overPost, setOverPost] = useState<string | null>(null);
  const [overRest, setOverRest] = useState(false);
  const [anchor, setAnchor] = useState<Anchor | null>(null);
  const rects = layoutPosts(state);
  const relief = state.staff
    .map((person) => ({ person, place: nowPlace(state, person) }))
    .filter((item): item is { person: Staff; place: "mb" | "r" | "sl" | "uvl" } => item.place !== "stand" && item.place !== "off")
    .sort(
      (a, b) =>
        RELIEF_RANK[a.place] - RELIEF_RANK[b.place] ||
        a.person.restOrder - b.person.restOrder ||
        a.person.code.localeCompare(b.person.code),
    );

  useEffect(() => {
    if (!selectedId && !selectedPostId) setAnchor(null);
  }, [selectedId, selectedPostId]);

  const card = nameCard(state, selectedId, selectedPostId);

  return (
    <div
      className="floor-map"
      onClick={onClear}
      onDragOver={(event) => {
        if (event.dataTransfer.types.includes("text/plain")) event.preventDefault();
      }}
    >
      <section className="zone-post apron-wash" style={{ left: "2%", top: "4%", width: "64%", height: "92%" }}>
        <h2 className="zone-label-post">崗位</h2>
      </section>
      <section
        className={cn("zone-rest apron-wash", overRest && "is-over")}
        data-testid="rest-zone"
        style={{ left: "68%", top: "4%", width: "30%", height: "92%" }}
        onDragOver={(event) => {
          event.preventDefault();
          setOverRest(true);
        }}
        onDragLeave={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOverRest(false);
        }}
        onDrop={(event) => {
          event.preventDefault();
          setOverRest(false);
          const staffId = event.dataTransfer.getData("text/plain");
          if (staffId) onDropRest(staffId);
        }}
      >
        <h2 className="zone-label-rest">休息 · MB／R</h2>
      </section>

      {state.zones.map((zone) => {
        const spot = ZONE_LABEL[zone.id];
        if (!spot) return null;
        return (
          <div key={zone.id} className="bay-label" style={{ left: `${spot.x}%`, top: `${spot.y}%` }} data-testid={`zone-${zone.id}`}>
            <InlineText
              label="區域代號"
              value={zone.code}
              onCommit={(code) => onRenameZone(zone.id, { code: code.toUpperCase() })}
              className="zone-group-label w-16 bg-transparent uppercase outline-none"
            />
            <InlineText
              label="區域名稱"
              value={zone.title}
              onCommit={(title) => onRenameZone(zone.id, { title })}
              className="zone-group-label w-16 bg-transparent outline-none"
            />
          </div>
        );
      })}

      {state.posts.map((post) => {
        const person = post.assigneeId ? staffById(state, post.assigneeId) : undefined;
        const place = person ? nowPlace(state, person) : "empty";
        const onStand = place === "stand";
        const tone = onStand ? "onduty" : "vacant";
        const rect = rects.get(post.id) ?? { x: 4, y: 16, w: 14.5, h: 16 };
        const subtitle = standSubtitle(place, person);
        return (
          <Stand
            key={post.id}
            rect={rect}
            code={chipLabel(post.name)}
            subtitle={subtitle}
            tone={tone}
            locked={post.locked}
            selected={anchor?.kind === "post" && anchor.id === post.id && (person ? person.id === selectedId : post.id === selectedPostId)}
            dimmed={!chipShown(tone, filter)}
            testId={onStand && person ? `staff-${person.id}` : post.assigneeId ? `relieved-${post.id}` : `vacancy-${post.id}`}
            postTestId={`post-${post.id}`}
            draggable={Boolean(onStand && person)}
            over={overPost === post.id}
            onClick={() => {
              setAnchor({ kind: "post", id: post.id });
              if (person) onSelectStaff(person.id);
              else onActivatePost(post.id);
            }}
            onDoubleClick={onStand && person ? () => onEditStaff(person.id) : undefined}
            onDragStart={
              onStand && person
                ? (event) => {
                    event.dataTransfer.setData("text/plain", person.id);
                    event.dataTransfer.effectAllowed = "move";
                  }
                : undefined
            }
            onDragOver={() => setOverPost(post.id)}
            onDragLeave={() => setOverPost((current) => (current === post.id ? null : current))}
            onDrop={(staffId) => onDropStaff(post.id, staffId)}
          />
        );
      })}

      {relief.map((item, index) => {
        const rect = restRect(index);
        const tone = item.place === "sl" || item.place === "uvl" ? "exception" : "break";
        return (
          <Stand
            key={item.person.id}
            rect={rect}
            code={RELIEF_LABEL[item.place]}
            subtitle={item.person.code}
            time={reliefWindow(item.person, item.place)}
            tone={tone}
            locked={item.person.restLocked}
            selected={item.person.id === selectedId && (anchor?.kind !== "post" || anchor.id === item.person.id)}
            dimmed={!chipShown(tone, filter)}
            testId={`staff-${item.person.id}`}
            draggable
            over={false}
            onClick={() => {
              setAnchor({ kind: "rest", id: item.person.id });
              onSelectStaff(item.person.id);
            }}
            onDoubleClick={() => onEditStaff(item.person.id)}
            onDragStart={(event) => {
              event.dataTransfer.setData("text/plain", item.person.id);
              event.dataTransfer.effectAllowed = "move";
            }}
            onDragOver={() => undefined}
            onDragLeave={() => undefined}
            onDrop={(staffId) => {
              if (staffId !== item.person.id) onSwap(staffId, item.person.id);
            }}
          />
        );
      })}

      {card && anchor && (
        <div
          className="name-card"
          role="dialog"
          aria-label="姓名卡"
          data-testid="name-card"
          style={cardStyle(anchorRect(anchor, rects, relief))}
          onClick={(event) => event.stopPropagation()}
        >
          <p className="name-card-code">{card.code}</p>
          <p className="name-card-title">{card.title}</p>
          {card.lines.map((line) => (
            <p key={line} className="ink-secondary">
              {line}
            </p>
          ))}
        </div>
      )}
    </div>
  );
}

function Stand({
  rect,
  code,
  subtitle,
  time,
  tone,
  locked = false,
  selected,
  dimmed,
  testId,
  postTestId,
  draggable = false,
  over,
  onClick,
  onDoubleClick,
  onDragStart,
  onDragOver,
  onDragLeave,
  onDrop,
}: {
  rect: StandRect;
  code: string;
  subtitle: string;
  time?: string;
  tone: "onduty" | "break" | "exception" | "vacant";
  locked?: boolean;
  selected: boolean;
  dimmed: boolean;
  testId: string;
  postTestId?: string;
  draggable?: boolean;
  over: boolean;
  onClick: () => void;
  onDoubleClick?: () => void;
  onDragStart?: (event: DragEvent<HTMLButtonElement>) => void;
  onDragOver: () => void;
  onDragLeave: () => void;
  onDrop: (staffId: string) => void;
}) {
  return (
    <button
      type="button"
      className={cn("stand", `is-${tone}`, selected && "is-selected", dimmed && "is-dim", over && "is-over")}
      style={{ left: `${rect.x}%`, top: `${rect.y}%`, width: `${rect.w}%`, height: `${rect.h}%` }}
      data-testid={testId}
      data-post={postTestId}
      draggable={draggable}
      onClick={(event) => {
        event.stopPropagation();
        onClick();
      }}
      onDoubleClick={(event) => {
        event.stopPropagation();
        onDoubleClick?.();
      }}
      onDragStart={onDragStart}
      onDragOver={(event) => {
        event.preventDefault();
        event.stopPropagation();
        onDragOver();
      }}
      onDragLeave={onDragLeave}
      onDrop={(event) => {
        event.preventDefault();
        event.stopPropagation();
        const staffId = event.dataTransfer.getData("text/plain");
        if (staffId) onDrop(staffId);
      }}
    >
      <span className="stand-code">{code}</span>
      {subtitle && <span className="stand-sub">{subtitle}</span>}
      {time && <span className="stand-time">{time}</span>}
      {locked && <span className="stand-lock">鎖</span>}
    </button>
  );
}

function standSubtitle(place: NowPlace | "empty", person: Staff | undefined): string {
  if (place === "stand" && person) return person.code;
  if (place === "mb") return "MB";
  if (place === "sl") return "S/L";
  if (place === "uvl") return "UVL";
  if (place === "off") return "外";
  return "空";
}

function reliefWindow(person: Staff, place: "mb" | "r" | "sl" | "uvl"): string {
  if (place === "mb" && person.breakStart && person.breakEnd) return formatSpan(person.breakStart, person.breakEnd);
  if (place === "sl" && person.leaveEarlyAt) return person.leaveEarlyAt;
  if (place === "uvl" && person.returnLateAt) return person.returnLateAt;
  return formatSpan(person.dutyStart, person.dutyEnd);
}

function anchorRect(anchor: Anchor, rects: Map<string, StandRect>, relief: { person: Staff }[]): StandRect {
  if (anchor.kind === "post") return rects.get(anchor.id) ?? { x: 4, y: 16, w: 14.5, h: 16 };
  const index = relief.findIndex((item) => item.person.id === anchor.id);
  return restRect(index < 0 ? 0 : index);
}

function cardStyle(rect: StandRect): { left: string; top: string } {
  const right = rect.x + rect.w;
  const left = right > 72 ? rect.x - 24 : right + 1;
  const top = rect.y > 68 ? rect.y - 18 : rect.y;
  return { left: `${Math.max(1, left)}%`, top: `${Math.max(4, top)}%` };
}

function nameCard(state: BoardState, selectedId: string | null, selectedPostId: string | null): { code: string; title: string; lines: string[] } | null {
  const person = selectedId ? staffById(state, selectedId) : undefined;
  const post = selectedPostId ? state.posts.find((item) => item.id === selectedPostId) : person ? postOfStaff(state, person.id) : undefined;
  if (!person && !post) return null;
  if (!person) {
    return { code: post?.name ?? "空", title: "空缺", lines: ["此格現在沒有人"] };
  }
  const place = nowPlace(state, person);
  const assigned = postOfStaff(state, person.id);
  const where =
    place === "stand"
      ? assigned?.name ?? "在崗"
      : place === "off"
        ? "外更"
        : RELIEF_LABEL[place];
  const lines = [`崗位 In ${person.dutyStart}  Out ${person.dutyEnd}`];
  if (person.breakStart && person.breakEnd) lines.push(`MB In ${person.breakStart}  Out ${person.breakEnd}`);
  if (person.leaveEarlyAt) lines.push(`S/L ${person.leaveEarlyAt}`);
  if (person.returnLateAt) lines.push(`UVL ${person.returnLateAt}`);
  if (assigned && place !== "stand") lines.push(`崗位 ${assigned.name}`);
  const shift = person.shift ? `${person.shift} · ${where}` : where;
  return { code: person.code, title: shift, lines };
}
