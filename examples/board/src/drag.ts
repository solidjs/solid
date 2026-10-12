// Dragging, with pointer events: mouse, pen and touch alike. Nothing here
// knows about the board's data. A drag is client state from the moment the
// pointer goes down to the moment it comes up — it is not a write until
// then, and one that is cancelled never was.
//
// While dragging, the grabbed element is lifted out of the page's flow and
// follows the pointer, and `over` says where it would land: before which
// row, in which list. The board opens a gap there. Letting go reports the
// drop and hands the element back, saying where it was released so that it
// slides into place from under the pointer (see flip.ts).
import { createSignal, latest } from "solid-js";
import { releaseFrom } from "~/flip";

export type Kind = "card" | "list";

export interface Over {
  kind: Kind;
  /** The row being dragged. */
  id: string;
  /** The list a card would land in. */
  listId?: string;
  /** The row it would land in front of; null for the end. */
  beforeId: string | null;
  /** Where that is, counting the rows that are not being dragged. */
  index: number;
}

const idOf = (el: Element, kind: Kind) => (el as HTMLElement).dataset[kind]!;

/** How far the pointer travels before a press becomes a drag and not a click. */
const SLOP = 5;

export function createDrag(options: {
  root: () => HTMLElement | undefined;
  onDrop: (over: Over) => void;
}) {
  const [over, setOver] = createSignal<Over | null>(null);

  function locate(kind: Kind, el: HTMLElement, x: number, y: number, gap: number): Over {
    const root = options.root()!;
    const id = idOf(el, kind);
    const current = over();
    const lists = [...root.querySelectorAll<HTMLElement>("[data-list]")];

    // Rows are measured where they would be with no gap open, or the gap
    // itself would change the answer and the two would chase each other.
    const place = (rows: HTMLElement[], horizontal: boolean, open: Over | null) => {
      let shift = 0;
      for (let index = 0; index < rows.length; index++) {
        const rect = rows[index].getBoundingClientRect();
        if (open && open.beforeId === idOf(rows[index], kind)) shift = gap;
        const middle = horizontal
          ? rect.left - shift + rect.width / 2
          : rect.top - shift + rect.height / 2;
        if ((horizontal ? x : y) < middle) return index;
      }
      return rows.length;
    };

    if (kind === "list") {
      const rows = lists.filter(list => list !== el);
      const index = place(rows, true, current);
      return { kind, id, index, beforeId: rows[index] ? idOf(rows[index], kind) : null };
    }

    // The list under the pointer, or the nearest one sideways.
    let list = lists[0];
    let nearest = Infinity;
    for (const candidate of lists) {
      const rect = candidate.getBoundingClientRect();
      const distance = x < rect.left ? rect.left - x : x > rect.right ? x - rect.right : 0;
      if (distance < nearest) [nearest, list] = [distance, candidate];
    }
    const listId = idOf(list, "list");
    const rows = [...list.querySelectorAll<HTMLElement>("[data-card]")].filter(row => row !== el);
    const index = place(rows, false, current?.listId === listId ? current : null);
    return { kind, id, listId, index, beforeId: rows[index] ? idOf(rows[index], kind) : null };
  }

  /** A `pointerdown` handler for the element that carries `data-card` / `data-list`. */
  function grab(kind: Kind, el: HTMLElement, e: PointerEvent) {
    // Not from a field or a button that does something else, and only the
    // primary button.
    if (e.button !== 0 || (e.target as Element).closest("input, .archive, form")) return;
    const startX = e.clientX;
    const startY = e.clientY;
    const pointer = e.pointerId;
    let lifted: { dx: number; dy: number; gap: number; style: string } | undefined;

    const lift = () => {
      const rect = el.getBoundingClientRect();
      const root = options.root()!;
      const gap = (kind === "card" ? rect.height : rect.width) + 8;
      lifted = { dx: startX - rect.left, dy: startY - rect.top, gap, style: el.style.cssText };
      root.style.setProperty("--gap", `${gap}px`);
      root.classList.add("dragging");
      Object.assign(el.style, {
        position: "fixed",
        width: `${rect.width}px`,
        height: `${rect.height}px`,
        left: `${rect.left}px`,
        top: `${rect.top}px`,
        zIndex: "10",
        pointerEvents: "none"
      });
      el.classList.add("lifted");
      // Keeps the moves coming to this element while it is under the pointer
      // and transparent to it. A pointer that is already gone cannot be
      // captured; the drag then ends on the next event anyway.
      try {
        el.setPointerCapture(pointer);
      } catch {}
    };

    const move = (e: PointerEvent) => {
      if (e.pointerId !== pointer) return;
      if (!lifted) {
        if (Math.hypot(e.clientX - startX, e.clientY - startY) < SLOP) return;
        lift();
      }
      el.style.left = `${e.clientX - lifted!.dx}px`;
      el.style.top = `${e.clientY - lifted!.dy}px`;
      setOver(locate(kind, el, e.clientX, e.clientY, lifted!.gap));
    };

    const finish = (drop: boolean) => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", cancel);
      window.removeEventListener("keydown", escape, true);
      if (!lifted) return; // a click: the page handles it
      const target = over();
      const from = el.getBoundingClientRect();
      el.style.cssText = lifted.style;
      el.classList.remove("lifted");
      options.root()?.classList.remove("dragging");
      if (el.hasPointerCapture(pointer)) el.releasePointerCapture(pointer);
      // The press ended a drag, so the click it would also be is not one.
      window.addEventListener("click", stop, { capture: true, once: true });
      setTimeout(() => window.removeEventListener("click", stop, { capture: true }));
      releaseFrom(el, from);
      setOver(null);
      if (drop && target) options.onDrop(target);
    };
    const stop = (e: Event) => e.stopPropagation();
    const up = (e: PointerEvent) => e.pointerId === pointer && finish(true);
    const cancel = (e: PointerEvent) => e.pointerId === pointer && finish(false);
    const escape = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || !lifted) return;
      e.preventDefault();
      e.stopPropagation();
      finish(false);
    };

    // On the window: a fast pointer is off the element before the first move.
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", cancel);
    window.addEventListener("keydown", escape, true);
  }

  return {
    grab,
    // A drop clears this in the same tick as the write it starts, which
    // would hold the clearing until that write settles; `latest` shows it
    // now.
    over: () => latest(over)
  };
}
