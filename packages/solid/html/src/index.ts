import { createHTML } from "./lit";
import type { HTMLTag } from "./lit";
import {
  effect,
  style,
  insert,
  untrack,
  spread,
  createComponent,
  delegateEvents,
  classList,
  dynamicProperty,
  mergeProps,
  setAttribute,
  setAttributeNS,
  addEventListener,
  Aliases,
  getPropAlias,
  Properties,
  ChildProperties,
  DelegatedEvents,
  SVGElements,
  SVGNamespace
} from "solid-js/web";

const html: HTMLTag = createHTML({
  effect,
  style,
  insert,
  untrack,
  spread,
  createComponent,
  delegateEvents,
  classList,
  mergeProps,
  dynamicProperty,
  setAttribute,
  setAttributeNS,
  addEventListener,
  Aliases,
  getPropAlias,
  Properties,
  ChildProperties,
  DelegatedEvents,
  SVGElements,
  SVGNamespace
});

export default html;
