---
"@solidjs/signals": patch
"@solidjs/web": patch
---

`dynamic(source, { static })` and `isStatic(o, key)`

`dynamic()` pays for a factory memo plus a per-instance memo so the source can
change. A great many call sites never change: a runtime `styled()` that always
renders `"li"`, and — the case this exists for — a polymorphic component whose
`as` arrived as a literal. The compiler encodes `as="button"` at a call site as
a data property and `as={isLink() ? "a" : "button"}` as a getter, so which one
the caller wrote is readable at runtime.

`isStatic(o, key)` reads it: one descriptor lookup, no read of the value,
nothing tracked, looking through `merge()`/`omit()` views to the leaf that owns
the key. Data property or absent-from-a-fixed-key-set is static; a getter, a
store key, or a memo-backed `merge()` source is not.

`dynamic(source, { static: true })` then says the source cannot change: it is
called once, untracked, at `dynamic()` time, and each instance renders the
result with no computation of its own — a tag goes to the compiled element path
(create or claim, spread), a component is called directly. No owner is created
on either side, so hydration ids stay aligned between server and client. A
static source may not return a promise.

```tsx
function Polymorphic(props) {
  const Tag = dynamic(() => props.as, { static: isStatic(props, "as") });
  return <Tag {...omit(props, "as")} />;
}
```

`as` stays public and reactive; the literal case stops paying for it. Note the
two paths produce DIFFERENT hydration ids (the memo path's element sits one
owner deeper), which is fine because `isStatic` reads the same descriptors on
both sides — but it is why the classification must be per instance rather than
per component.
