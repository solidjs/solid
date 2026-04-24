---
"@solidjs/web": patch
---

Reshape `createDynamic` into a `dynamic` factory.

`createDynamic(source, props): JSX.Element` is replaced by `dynamic(source): Component<P>` — a `lazy`-style factory returning a stable component whose identity is driven by a reactive (and optionally async) source. `source` may return `null | undefined | false` to render nothing, so `() => cond() && Comp` works directly.

```tsx
const Active = dynamic(() => isEditing() ? Editor : Viewer);
return <Active value={value()} />;
```

The `<Dynamic component={...}>` JSX wrapper is unchanged at the call site; it now delegates to `dynamic` internally. Direct callers of `createDynamic(source, props)` should use `<Dynamic>` or `createComponent(dynamic(source), props)`.
