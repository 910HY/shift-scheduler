import type { BoardState, Post } from "@/types";

export type StandRect = {
  x: number;
  y: number;
  w: number;
  h: number;
};

const CELL_W = 14.5;
const CELL_H = 16;
const GAP = 1.6;

const ZONE_AREA: Record<string, { x: number; y: number; cols: number }> = {
  arr: { x: 4, y: 16, cols: 2 },
  dep: { x: 36, y: 16, cols: 2 },
  kiosk: { x: 4, y: 56, cols: 2 },
  stby: { x: 36, y: 56, cols: 2 },
};

export const ZONE_LABEL: Record<string, { x: number; y: number }> = {
  arr: { x: 4, y: 11 },
  dep: { x: 36, y: 11 },
  kiosk: { x: 4, y: 51 },
  stby: { x: 36, y: 51 },
};

export function standRect(zoneId: string, col: number, row: number): StandRect {
  const area = ZONE_AREA[zoneId] ?? ZONE_AREA.arr;
  return {
    x: round(area.x + col * (CELL_W + GAP)),
    y: round(area.y + row * (CELL_H + GAP)),
    w: CELL_W,
    h: CELL_H,
  };
}

export function restRect(index: number): StandRect {
  const col = index % 2;
  const row = Math.floor(index / 2);
  return {
    x: round(70 + col * 14.5),
    y: round(16 + row * 17.5),
    w: 13,
    h: 15.5,
  };
}

export function layoutPosts(state: BoardState): Map<string, StandRect> {
  const grouped = new Map<string, Post[]>();
  for (const post of state.posts) {
    const list = grouped.get(post.zoneId) ?? [];
    list.push(post);
    grouped.set(post.zoneId, list);
  }
  const rectById = new Map<string, StandRect>();
  for (const [zoneId, posts] of grouped) {
    const ordered = [...posts].sort((a, b) => a.order - b.order || a.name.localeCompare(b.name, "zh-Hant"));
    const area = ZONE_AREA[zoneId] ?? ZONE_AREA.arr;
    ordered.forEach((post, index) => {
      const col = index % area.cols;
      const row = Math.floor(index / area.cols);
      rectById.set(post.id, standRect(zoneId, col, row));
    });
  }
  return rectById;
}

function round(value: number): number {
  return Math.round(value * 10) / 10;
}
