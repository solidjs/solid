// The canvas as it crosses the wire.

/** What can be placed with a click. A stroke is drawn instead. */
export type Kind = "rect" | "ellipse" | "note";

export interface Shape {
  id: string;
  kind: Kind | "stroke";
  /** Top-left corner and size, in canvas pixels. */
  x: number;
  y: number;
  w: number;
  h: number;
  color: string;
  /** A note's words; empty for the other kinds. */
  text: string;
  /** A stroke's points, flat (`x0, y0, x1, y1, …`), from its top-left corner. */
  points?: number[];
}

export interface Identity {
  id: string;
  name: string;
}

export interface Member extends Identity {
  since: number;
  /** Can point, draw and write. Everyone else is watching. */
  seated: boolean;
}

/** What only this viewer is told: its seat token, which every write names; null while watching. */
export interface Presence {
  seat: string | null;
}

/** A shape someone is dragging, where they have it now. */
export interface Drag {
  /** The shape. */
  id: string;
  /** The drag's own id, which is also the mutation id of the move that ends it. */
  key: string;
  x: number;
  y: number;
}

/**
 * A stroke someone is drawing, as far as it has reached the server, in
 * canvas coordinates. Its points are kept in chunks of a fixed size: only
 * the last chunk grows, and a full one never changes, so each value sends
 * the last chunk and refers to the rest.
 */
export interface Ink {
  /** The stroke's own id, which is also the id of the shape it becomes. */
  key: string;
  color: string;
  chunks: number[][];
}

/** Where a member's pointer is, and what it holds or draws. */
export interface Pointer extends Identity {
  x: number;
  y: number;
  drag?: Drag;
  ink?: Ink;
  /** When the browser sent it (its clock): for measuring, not shown. */
  t: number;
}

export interface Room {
  /** In stacking order: the last is on top. */
  shapes: Shape[];
  // The acknowledgement. Ids of the room's most recent writes to shapes that
  // exist, from everyone, in the order they were applied. A write is
  // confirmed when its id shows up here, in the same value that carries its
  // effect.
  applied: string[];
  pointers: Pointer[];
  /** Who is here, longest first. */
  members: Member[];
  /** How many of them can point, draw and write. */
  seats: number;
}
