---
"@solidjs/web": patch
---

`RequestEventLocals` reaches the public types through a real (non-type-only) re-export: the types build rewrites the copied `client.d.ts`'s `export type { RequestEventLocals }` to a plain re-export (failing loudly if upstream drifts), so `declare module "@solidjs/web"` augmentation identity never depends on TypeScript's `export type` alias handling. Acceptance type tests now cover augmentation from a `.ts` module that imports nothing from the package and from a module-form `.d.ts`, and RFC 12 documents the two sharp edges reproduced while investigating: a `declare module` block in a global *script* file (a `.d.ts` with no top-level import/export) is an ambient module declaration that replaces the package's types wholesale rather than augmenting them, and a `foo.d.ts` sharing a sibling `foo.ts`'s basename is treated as compiled output and silently dropped from the program.
