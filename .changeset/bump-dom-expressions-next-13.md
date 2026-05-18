---
"@solidjs/web": patch
"babel-preset-solid": patch
---

Bump dom-expressions and babel-plugin-jsx-dom-expressions to 0.50.0-next.13.

This picks up the following runtime/compiler updates:

- **Slot-owned node tagging** (resolves solidjs/solid#2030, solidjs/solid#2357): a single DOM node referenced from multiple JSX slots, or wrapped into a new slot's value between renders, no longer crashes `replaceChild` with "new child contains the parent" or vanishes during sibling-slot cleanup. Each runtime insertion now tags the inserted node with a per-slot symbol; destructive operations are gated on parent-and-tag ownership so foreign refs and migrated nodes are left alone. DOM renderer only.
- **Init-throw scope cleanup**: when a user's render function (or anything inside `render()` / `hydrate()` init) throws, the partial render scope is now disposed instead of being orphaned, preventing leaked effects and stale subscriptions after a failed mount.
- **Event-listener helper rename**: the compiler-emitted runtime helper that was previously `addEventListener` is now `addEvent`, avoiding the name collision with the native `EventTarget.addEventListener`. Compiler output reflects the new name automatically; runtime/userland code that imported `addEventListener` from `@solidjs/web` should switch to `addEvent`.
- **JSX namespace cleanup**: previously tolerated `class:foo` and `style:foo` namespace syntax no longer gets special handling — both fall through to literal HTML attributes. Use `class={{ ... }}` for class toggles and `style={{ ... }}` for style properties.
- **Static JSX marker**: the `/*@once*/` marker is removed from Solid's public JSX model. The compiler still recognizes a renamed `/*@static*/` marker for low-level cases (e.g. compiler internals), but Solid 2.0 guidance is to use normal reactive JSX, `defaultValue` / `defaultChecked` for DOM initial state, and `untrack` for intentional one-time JavaScript reads — not a marker-based replacement.
