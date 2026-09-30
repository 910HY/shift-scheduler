import { Plus } from "lucide-react";
import { InlineText } from "@/components/InlineText";
import { PostCard } from "@/components/PostCard";
import { Button } from "@/components/ui/button";
import { postsInZone, staffById } from "@/logic/board";
import type { FloorFilter } from "@/logic/chip";
import type { BoardState, Zone } from "@/types";

export function ZoneBay({
  state,
  zone,
  selectedId,
  selectedPostId,
  filter,
  onActivatePost,
  onSelectStaff,
  onDropStaff,
  onRenamePost,
  onEditStaff,
  onRenameZone,
  onAdd,
}: {
  state: BoardState;
  zone: Zone;
  selectedId: string | null;
  selectedPostId: string | null;
  filter: FloorFilter;
  onActivatePost: (postId: string) => void;
  onSelectStaff: (staffId: string) => void;
  onDropStaff: (postId: string, staffId: string) => void;
  onRenamePost: (postId: string, name: string) => void;
  onEditStaff: (staffId: string) => void;
  onRenameZone: (zoneId: string, patch: { title?: string; code?: string }) => void;
  onAdd: () => void;
}) {
  const posts = postsInZone(state, zone.id);

  return (
    <section data-testid={`zone-${zone.id}`} className="min-w-0">
      <header className="mb-3 flex items-center gap-2">
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
          className="zone-group-label min-w-0 flex-1 bg-transparent outline-none"
        />
        <Button type="button" size="icon" variant="outline" aria-label={`在${zone.title}加崗位`} onClick={onAdd}>
          <Plus />
        </Button>
      </header>
      {posts.length === 0 ? (
        <Button type="button" variant="outline" onClick={onAdd}>
          用模板新增
        </Button>
      ) : (
        <div className="flex flex-wrap gap-x-3 gap-y-4">
          {posts.map((post) => {
            const person = post.assigneeId ? staffById(state, post.assigneeId) : undefined;
            const selected = person ? person.id === selectedId : post.id === selectedPostId;
            return (
              <PostCard
                key={post.id}
                post={post}
                person={person}
                now={state.now}
                selected={selected}
                filter={filter}
                onActivate={() => onActivatePost(post.id)}
                onSelectStaff={() => person && onSelectStaff(person.id)}
                onDropStaff={(staffId) => onDropStaff(post.id, staffId)}
                onRename={(name) => onRenamePost(post.id, name)}
                onEditStaff={() => person && onEditStaff(person.id)}
              />
            );
          })}
        </div>
      )}
    </section>
  );
}
