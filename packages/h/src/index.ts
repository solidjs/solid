import { createHyperScript } from "./hyperscript.js";
import type { HyperScript } from "./hyperscript.js";
import {
  spread,
  assign,
  insert,
  createComponent,
  dynamicProperty,
  untrack,
  SVGElements,
  MathMLElements,
  Namespaces
} from "@solidjs/web";

const h: HyperScript = createHyperScript({
  spread,
  assign,
  insert,
  createComponent,
  dynamicProperty,
  untrack,
  SVGElements,
  MathMLElements,
  Namespaces
});

export default h;
