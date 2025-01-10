import { createHyperScript } from "./hyperscript.js";
import type { HyperScript } from "./hyperscript.js";
import {
  spread,
  assign,
  insert,
  createComponent,
  dynamicProperty,
  SVGElements
} from "solid-js/web";

const h: HyperScript = createHyperScript({
  spread,
  assign,
  insert,
  createComponent,
  dynamicProperty,
  SVGElements
});

export default h;
