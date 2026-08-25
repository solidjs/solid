import { createTaggedJSXRuntime } from "./tagged-jsx.js";
import type { TaggedJSXInstance } from "./tagged-jsx.js";
import {
  insert,
  spread,
  createComponent,
  mergeProps,
  claimElement,
  SVGElements,
  MathMLElements,
  VoidElements,
  RawTextElements
} from "@solidjs/web";

// Annotate through the local `./tagged-jsx.js` implementation so the
// emitted `.d.ts` references `import("./tagged-jsx.js").TaggedJSXInstance<{}>`.
const html: TaggedJSXInstance<{}> = createTaggedJSXRuntime({
  insert,
  spread,
  createComponent,
  mergeProps,
  claimElement,
  SVGElements,
  MathMLElements,
  VoidElements,
  RawTextElements
});

export default html;
