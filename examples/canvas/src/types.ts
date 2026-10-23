// The canvas as it crosses the wire.

export type Kind = "rect" | "ellipse" | "note";

export interface Shape {
  id: string;
  kind: Kind;
  /** Top-left corner and size, in canvas pixels. */
  x: number;
  y: number;
  w: number;
  h: number;
  color: string;
  /** A note's words; empty for the other kinds. */
  text: string;
}

export interface Identity {
  id: string;
  name: string;
}

export interface Member extends Identity {
  since: number;
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

/** Where a member's pointer is, and what it holds. */
export interface Pointer extends Identity {
  x: number;
  y: number;
  drag?: Drag;
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
}
