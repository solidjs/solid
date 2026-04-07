import { createHTML } from "./lit.js";
import type { HTMLTag } from "./lit.js";
import {
  effect,
  style,
  insert,
  untrack,
  spread,
  createComponent,
  delegateEvents,
  className,
  dynamicProperty,
  mergeProps,
  setAttribute,
  setAttributeNS,
  addEventListener,
  ChildProperties,
  DelegatedEvents,
  SVGElements,
  MathMLElements,
  Namespaces,
} from "@solidjs/web";

const html: HTMLTag = createHTML({
  effect,
  style,
  insert,
  untrack,
  spread,
  createComponent,
  delegateEvents,
  className,
  mergeProps,
  dynamicProperty,
  setAttribute,
  setAttributeNS,
  addEventListener,
  ChildProperties,
  DelegatedEvents,
  SVGElements,
  MathMLElements,
  Namespaces,
});

export default html;
