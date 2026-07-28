---
"@solidjs/web": patch
---

Export a `Slot<P>` type from `@solidjs/web/frames` for typing server-component client positions.

A server component describes its client positions as props the server renders where client-owned markup belongs. Typing those by hand meant restating the client component's shape and adding `$key` to it, which pushed apps toward wrapper types per component. `Slot<P>` takes the client component's own props and adds the optional `$key`, so the hole is described with the same type that fills it:

```ts
type ToggleSlot = Slot<ComponentProps<typeof Toggle>>;
```

The type is exported from both halves of the subpath — server components are authored in universal code, so it has to resolve under the browser condition too. It is type-only, so nothing crosses into the client bundle.
