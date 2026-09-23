---
"@solidjs/compiler": patch
"@solidjs/babel-plugin": patch
---

JSX passed through a prop other than `children` (a layout's `header`, an object of slots, a context value) now hydrates when another id-allocating hole follows it (#3567). Both compilers' hole-scope predicate treated only `props.children` as able to build hydratable content, so a `{props.header}` hole compiled to a transparent insert: the server reserved the scoped sibling's slot at registration and gave the header's elements the next id, while the client allocated in source order, and every key after the slot shifted. The predicate is now a denylist: a dynamic hole takes a scope unless its value is provably a primitive (literals, template literals, unary, binary and update expressions), so property reads, optional calls, the left operand of `||`/`??`, sequence and assignment expressions, and array literals with hydratable entries are all scoped. Ids of elements after such a hole shift by one slot on both sides.
