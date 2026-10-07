// The tables the attribute runtime (client/attributes.ts) consults when it
// writes a prop onto an element, shared with the SSR element serializer
// (server.ts) and the hydration script's event capture. Their own module,
// apart from constants.ts: a bundler assigns modules to chunks whole, and
// constants.ts sits in every page's eager graph (the slot / host symbols the
// children runtime tags nodes with), so these four would be pinned there for
// a lazy chunk that imports `assign` — the frames bind tier on a server-
// component page — instead of travelling with it. Nothing here depends on
// anything else in the package.

/**
 * Flags
 *
 * - 1 - Stateful property - value derives from reactive state
 * - 2 - Locked to property - value not specially treated
 */
const DOMWithState: Record<string, Record<string, 1 | 2>> = {
  INPUT: { value: 1, defaultValue: 2, checked: 1, defaultChecked: 2 },
  SELECT: { value: 1 },
  OPTION: { value: 1, selected: 1, defaultSelected: 2 },
  TEXTAREA: { value: 1, defaultValue: 2 },
  VIDEO: { muted: 1, defaultMuted: 2 },
  AUDIO: { muted: 1, defaultMuted: 2 }
};

const ChildProperties = /*#__PURE__*/ new Set([
  "innerHTML",
  "textContent",
  "innerText",
  "children"
]);

// list of Element events that will be delegated
const DelegatedEvents = /*#__PURE__*/ new Set([
  "beforeinput",
  "click",
  "dblclick",
  "contextmenu",
  "focusin",
  "focusout",
  "input",
  "keydown",
  "keyup",
  "mousedown",
  "mousemove",
  "mouseout",
  "mouseover",
  "mouseup",
  "pointerdown",
  "pointermove",
  "pointerout",
  "pointerover",
  "pointerup",
  "touchend",
  "touchmove",
  "touchstart"
]);

const Namespaces: Record<string, string> = {
  svg: "http://www.w3.org/2000/svg",
  mathml: "http://www.w3.org/1998/Math/MathML",
  xlink: "http://www.w3.org/1999/xlink",
  xml: "http://www.w3.org/XML/1998/namespace"
};

export { DOMWithState, ChildProperties, DelegatedEvents, Namespaces };
