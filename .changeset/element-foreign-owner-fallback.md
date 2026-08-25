---
"@solidjs/element": patch
---

Fall back to an ownerless root when the looked-up `_$owner` was stamped by a different copy of the Solid runtime (#3053). A compiled element library bundles its own solid-js; when embedded in a Solid host page, the host's JSX output stamps `_$owner` with an owner whose field layout the bundled copy cannot link into, and owner adoption crashed inside `connectedCallback`, leaving the shadow root empty. `withSolid` now catches a throw that occurs before the root body runs (which can only be the adoption wiring itself), warns, and renders in an independent root — the same behavior the element has on any non-Solid page. Errors thrown by the component itself still propagate. Same-runtime owner adoption (context into custom elements) is unchanged, and core pays no bytes for this.
