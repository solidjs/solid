// The slide. When the board's arrangement changes, every card and list that
// ends up somewhere else travels there from where it was, instead of
// appearing there. One path for every cause: this tab's drop, another tab's
// move, and a refused write going back.
//
// It works because a card is one element for as long as the card exists. An
// effect has two halves, and they run on either side of the DOM update: the
// first reads the arrangement — so it runs again when the arrangement
// changes, before anything on screen has moved — and measures where things
// are. The second runs after the DOM has been updated, measures again, and
// plays the difference backwards (first, last, invert, play). An element
// caught mid-slide is measured where it visibly is, so a second move starts
// from there.
import { createEffect } from "solid-js";

const MOVING = "[data-card], [data-list]";

type Rects = Map<Element, DOMRect>;

function measure(root: HTMLElement | undefined): Rects {
  const rects: Rects = new Map();
  if (root)
    for (const el of root.querySelectorAll(MOVING)) rects.set(el, el.getBoundingClientRect());
  return rects;
}

function slide(el: Element, from: DOMRect, to: DOMRect) {
  const dx = from.left - to.left;
  const dy = from.top - to.top;
  if (Math.abs(dx) < 1 && Math.abs(dy) < 1) return;
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  for (const running of el.getAnimations()) if (running.id === "flip") running.cancel();
  el.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: "none" }], {
    id: "flip",
    duration: 200,
    easing: "cubic-bezier(0.2, 0, 0, 1)"
  });
}

// Where an element was let go, when that is not where the page has it: a
// dragged card is dropped from under the pointer, not from its old slot.
const released = new WeakMap<Element, DOMRect>();

/**
 * Says `el` was at `from` a moment ago. Its next slide starts there — the
 * one the drop's write causes, or, if the drop changed nothing, one back to
 * where it already is.
 */
export function releaseFrom(el: Element, from: DOMRect) {
  released.set(el, from);
  requestAnimationFrame(() => {
    if (released.get(el) !== from) return;
    released.delete(el);
    slide(el, from, el.getBoundingClientRect());
  });
}

/**
 * Slides the cards and lists under `root` whenever `arrangement` changes.
 * `arrangement` only has to read what decides where things are; what it
 * returns is ignored.
 */
export function createFlip(root: () => HTMLElement | undefined, arrangement: () => unknown) {
  createEffect(
    () => {
      arrangement();
      return measure(root());
    },
    first => {
      for (const [el, last] of measure(root())) {
        const from = released.get(el) ?? first.get(el);
        released.delete(el);
        if (from) slide(el, from, last); // else new on screen: nothing to slide from
      }
    }
  );
}
