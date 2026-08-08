// Module-form `.d.ts` augmentation of the blessed target — the shape an
// application's hand-written declaration file takes. Two traps this file's
// own shape documents:
//
// - The `export {}` is load-bearing: it makes this file a MODULE, so the
//   `declare module` block below is an augmentation. Without it the file is
//   a global script and the same block would be an ambient module
//   DECLARATION — TypeScript replaces `@solidjs/web`'s types with it
//   wholesale (every import in the project breaks with "has no exported
//   member", and augmentations elsewhere stop applying).
// - The basename is deliberately distinct from every sibling `.ts` file: a
//   `foo.d.ts` next to a `foo.ts` is treated as that file's compiled OUTPUT
//   and silently dropped from the program — the augmentation simply never
//   applies, with no error anywhere.
//
// The merge assertions live in request-event-locals.type-tests.ts.
export {};

declare module "@solidjs/web" {
  interface RequestEventLocals {
    augmentedFromDts?: { source: "dts" };
  }
}
