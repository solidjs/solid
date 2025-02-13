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
  getPropAlias,
  Properties,
  ChildProperties,
  DelegatedEvents,
  SVGElements,
  SVGNamespace
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
  getPropAlias,
  Properties,
  ChildProperties,
  DelegatedEvents,
  SVGElements,
  SVGNamespace
});

export default html;
