---
"@solidjs/web": patch
---

`event.locals` gets its typing augmentation point: `RequestEvent.locals` is typed by the exported, module-augmentable `RequestEventLocals` interface, replacing Start's ambient `App.RequestEventLocals` namespace (a plain exported interface, no global `App.*`). Augment `@solidjs/web` and the merge flows to `getRequestEvent()!.locals` everywhere the event surfaces — the main entry, `createRequestEvent`, the server-functions event — through one shared interface identity:

```ts
declare module "@solidjs/web" {
  interface RequestEventLocals {
    user: User;
  }
}
```

The interface keeps the index signature the inline `Record` type had, so un-augmented code stays exactly as permissive as before (`event.locals.whatever = x` keeps typechecking); augmentation adds precision for the keys it names. The trade, matching Start's precedent: unaugmented keys read as `any` rather than erroring.
