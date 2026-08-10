// Bridge entry like ../index.ts: rollup bundles the DECODE half of the
// runtime serializer through this specifier (seroval stays external). Lazy
// client consumers (the frames data tables, `deserializeStream`) load this
// instead of the full entry so the encode machinery (the eval-style
// hydration Serializer, toCrossJSONStream) never ships to a browser that
// only reads. No tsc pass here — the types build copies the runtime's
// serializer-decode.d.ts into serialization/types (types:copy-serialization).
export * from "@dom-expressions/runtime/src/serializer-decode.js";
