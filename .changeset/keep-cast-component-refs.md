---
"@solidjs/compiler": patch
---

The native compiler keeps a component `ref` whose value is wrapped in a TypeScript `as` cast, non-null `!` or `satisfies`, such as `ref={[setRef, props.ref] as any}`, instead of silently dropping the prop; the universal generate also keeps array refs on components, as the Babel plugin does.
