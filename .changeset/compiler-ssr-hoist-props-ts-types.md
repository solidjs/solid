---
"@solidjs/compiler": patch
---

SSR `hoistProps` no longer captures names in TypeScript type positions (type parameters, annotations, `as`/`satisfies` targets, type arguments, `typeof x` queries, local `type`/`interface` declarations, `implements`/`extends` heritage) as constructor arguments, which threw `ReferenceError` once the types were stripped (#3828). A `type` or `interface` that shares a value's name no longer makes that value count as redeclared, so its site still hoists.
