---
"@solidjs/web": patch
---

`dynamic()` / `Dynamic` with a tag-name source honor an `xmlns` prop when creating the element (#3386)

The compiler resolves a tag's namespace from its parent at build time; the `dynamic()` runtime path creates the element before it has a parent, so a tag that exists in both HTML and SVG (`a`, `script`, `style`, `title`) was always created as an HTML element — `<svg><Link href=…/></svg>` with `Link = dynamic(() => "a")` produced an HTML anchor inside the SVG tree. The instance can now say which one it means with the same attribute compiled JSX uses for the same purpose: `<Link xmlns="http://www.w3.org/2000/svg" href=…/>`. Like `is`, `xmlns` is read once, untracked, at creation (the DOM can't re-namespace a node) and then applied as an ordinary attribute, so a client-rendered element carries the same attribute the server serializes. Without `xmlns` the namespace is still inferred from the tag name. Hydration is unaffected: it claims the parser-namespaced node.

Types: `dynamic()` now returns `Component<DynamicComponentProps<T>>`, which adds `xmlns?: string` for tag-name targets only.
