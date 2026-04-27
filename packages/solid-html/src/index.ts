import { createSLDRuntime } from "./sld.js";
import type { SLDInstance } from "./sld.js";
import {
  insert,
  spread,
  createComponent,
  mergeProps,
  SVGElements,
  MathMLElements,
  VoidElements,
  RawTextElements
} from "@solidjs/web";

// Annotate explicitly through the local `./sld.js` re-export so the emitted
// `.d.ts` references `import("./sld.js").SLDInstance<{}>` instead of
// `import("sld-dom-expressions").SLDInstance<{}>`. The upstream package only
// ships an ESM `.d.mts`, which TS Node16 CJS resolution rejects without a
// `with { "resolution-mode": "import" }` attribute. Routing through the
// locally copied `./types/sld.d.ts` (and its `./types-cjs/sld.d.cts` twin)
// avoids the issue entirely.
const html: SLDInstance<{}> = createSLDRuntime({
  insert,
  spread,
  createComponent,
  mergeProps,
  SVGElements,
  MathMLElements,
  VoidElements,
  RawTextElements
});

export default html;
