// Bridge entry: rollup bundles the runtime implementation through this
// specifier (seroval stays external). The types build copies the
// server-functions d.ts files into types/server-functions/.
export * from "../../src/server-functions/client.js";
