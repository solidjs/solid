// What can be drawn, shared by both sides: the browser sizes its optimistic
// shape with these, and the server checks against them.
import type { Kind } from "~/types";

/** A new shape's width and height. */
export const SIZES: Record<Kind, [w: number, h: number]> = {
  rect: [160, 100],
  ellipse: [130, 130],
  note: [200, 130]
};

export const PALETTE = ["#579dff", "#f87168", "#4bce97", "#e2b203", "#9f8fef", "#dee4ea"];

/** A person's colour, from their id: the same in every tab. */
export function colorOf(id: string): string {
  let hash = 0;
  for (const char of id) hash = (hash * 31 + char.charCodeAt(0)) | 0;
  return PALETTE[Math.abs(hash) % (PALETTE.length - 1)];
}
