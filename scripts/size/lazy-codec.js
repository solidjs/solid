// Stands in for `@solidjs/web/serialization` and `/decode` in the page
// scenarios. The frames client loads the seroval codec through a dynamic
// import (its `prepareData` hook), so in production it is a separate chunk
// fetched on the first `data` record. size-limit bundles without code
// splitting and would inline that chunk (~5 KB brotli of seroval) into the
// eager number; aliasing the specifiers here keeps the import site and
// leaves the codec's own cost to the serialization tests.
export function createJSONDeserializer() {}
export function createJSONDataTable() {}
export function serializeJSON() {}
