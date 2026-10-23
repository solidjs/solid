---
"@solidjs/compiler": patch
---

Validate SSR templates rooted at an SVG or MathML element (such as `<image>` or `<g>` under control flow, in a fragment, or as a component root) inside their `<svg>`/`<math>` owner, as DOM templates already are, so valid SVG partials no longer fail the `validate` check.
