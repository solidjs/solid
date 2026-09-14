---
"@solidjs/web": patch
---

Deprecate `<Dynamic>` in favor of `dynamic()`

`<Dynamic component={…}>` is the same primitive as `dynamic()` with a worse shape: the tag travels in the props bag, so every instance merges `component` in at the call site, `omit`s it back out inside, and builds a fresh `dynamic()` factory (with its memo) because a JSX wrapper has nowhere to hoist one. Polymorphic-component libraries end up omitting `as`, handing the tag to `<Dynamic>`, which merges it back in under `component` to omit it again. `dynamic()` has none of that for one extra line:

```tsx
// before
<Dynamic component={multiline() ? RichTextEditor : "input"} value={value()} />;

// after — hoist per component instance, or per module for a constant tag
const Field = dynamic(() => (multiline() ? RichTextEditor : "input"));
<Field value={value()} />;
```

`Dynamic` and `DynamicProps` are marked `@deprecated` (editors strike them through; no runtime warning). They remain available in 2.0 — the RCs are past public API removals — but new code should use `dynamic()`. The migration guide and control-flow RFC are updated accordingly.
