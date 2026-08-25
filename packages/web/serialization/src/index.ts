// Bridge entry: rollup bundles the runtime implementation through this
// specifier (seroval stays external). There is no tsc pass for this entry —
// the types build copies serializer.d.ts to serialization/types/index.d.ts.
export * from "../../src/serializer.js";
