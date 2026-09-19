---
name: solid-control-flow
description: How to use Solid's control-flow components in JSX. Use when writing or reviewing markup that needs conditionals, lists, error handling, or async fallbacks, or that reaches for Show, For, Repeat, Switch, Match, Dynamic, Loading, Errored, Reveal, or Portal. Covers the callback-child and keyed semantics that decide whether content remounts.
---

# Solid control flow

Never use a ternary or `.map()` where one of these fits. They exist so the
runtime can keep DOM across updates instead of rebuilding it.

## Show

Renders children when `when` is truthy, otherwise `fallback`.

```tsx
<Show when={user()} fallback={<SignIn />}>
  <Greeting />
</Show>
```

A function child receives the narrowed value, and `keyed` decides its shape
and its remount behavior.

```tsx
// Default. The child gets an accessor and is preserved across truthy values.
<Show when={user()}>{u => <Greeting name={u().name} />}</Show>

// Keyed. The child gets the raw value and remounts when identity changes.
<Show when={user()} keyed>{u => <Greeting name={u.name} />}</Show>
```

The narrowing only holds while the condition is truthy. Reading the accessor
after the block has gone throws. Do not stash it in a timer or an async
continuation.

## For

Renders a list. The child is a callback, not markup.

```tsx
<For each={items()} fallback={<div>No items</div>}>
  {(item, index) => <div data-index={index()}>{item.label}</div>}
</For>
```

The `keyed` prop picks which argument is reactive, so it decides what remounts
when the list changes:

- default or `keyed={true}`: `(item, index)` where `item` is the raw row and
  `index` is an accessor. Rows remount when the row value changes.
- `keyed={false}`: `(item, index)` where `item` is an accessor and `index` is
  a plain number. Rows survive value changes and update in place. This is what
  Solid 1.x called `Index`.
- `keyed={item => item.id}`: both arguments are accessors, and identity is the
  returned key. Use this for rows that move.

`each` accepts `undefined`, `null`, and `false` as an empty list, so a
not-yet-loaded list renders the fallback without a guard.

## Repeat

A list from a count rather than from data.

```tsx
<Repeat count={10} fallback={<Empty />}>
  {index => <Row index={index} />}
</Repeat>
```

`from` shifts the starting index. The child may be static markup instead of a
callback.

## Switch and Match

Mutually exclusive conditions. The first truthy `Match` wins.

```tsx
<Switch fallback={<NotFound />}>
  <Match when={state.route === "home"}>
    <Home />
  </Match>
  <Match when={state.route === "settings"}>
    <Settings />
  </Match>
</Switch>
```

`Match` takes the same function-child and `keyed` semantics as `Show`. Only
`Match` elements may be direct children of `Switch`.

## Loading

The async boundary. Any read that is still pending throws, and the nearest
`Loading` swaps to its fallback until everything settles.

```tsx
<Loading fallback={<Spinner />}>
  <Profile />
</Loading>
```

Scope it around the data-dependent slot, not the surrounding shell. Wrapping
the header, nav, and footer in the same boundary as the data means a
revalidation replaces the whole screen with the fallback. Chrome rendered
outside the boundary stays stable while only the data slot flips.

The `on` prop scopes the boundary to transitions caused by specific sources,
so writes elsewhere leave the current content up.

## Errored

Catches uncaught errors in its subtree.

```tsx
<Errored fallback={(err, reset) => <div onClick={reset}>Failed: {String(err())}</div>}>
  <Widget />
</Errored>
```

The fallback may be markup or a callback taking the error accessor and a
`reset` function. Errors thrown by the fallback itself reach the parent
boundary.

## Dynamic

An element or component chosen at runtime.

```tsx
<Dynamic component={multiline() ? RichTextEditor : "input"} value={value()} onInput={onInput} />
```

Every other prop is forwarded. Prefer a plain tag when the choice is static,
because a literal tag compiles into the template and a `Dynamic` does not.

## Portal and Reveal

`Portal` renders into a different mount point, for overlays and modals.
`Reveal` with `createRevealOrder` controls the order in which sibling async
content appears, replacing Solid 1.x's `SuspenseList`.

## Compiler note

These components are auto-imported by the compiler when the name is not
otherwise bound, so a bare `<Show>` works without an import. An explicit
`import { Show } from "solid-js"` works too, including under an alias. A local
binding of the same name shadows the built-in and is treated as an ordinary
component.
