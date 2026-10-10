---
"@solidjs/compiler": patch
---

The native compiler no longer drops a component `ref` whose value is wrapped in a TypeScript `as` cast, non-null `!` or `satisfies`, such as `ref={[setRef, props.ref] as any}`; it classified the wrapper instead of the value inside and emitted no `ref` prop. The universal generate also keeps array refs on components and unwraps `as` and `!` on element refs, so `<view ref={myRef as any} />` assigns the element to `myRef`, as the Babel plugin does.
