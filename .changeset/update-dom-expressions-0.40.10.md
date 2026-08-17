---
"solid-js": patch
"babel-preset-solid": patch
---

Update DOM Expressions to 0.40.10. This picks up SSR attribute coercion and template-literal quote escaping, nullish `value`/`defaultValue` on spread inputs, the SSR `!!` wrap for component-prop conditionals, and opt-in `omitServerOnlyTemplates`.
