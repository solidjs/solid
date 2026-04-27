export * from "dom-expressions/src/client.js";
// `dom-expressions@0.50.0-next.3` ships `VoidElements` / `RawTextElements` from
// `client.js` at runtime but its hand-maintained `client.d.ts` does not list
// them. Re-export from `constants` directly so type consumers (e.g. the sld
// runtime wired up in `@solidjs/html`) can import them through `@solidjs/web`.
export { VoidElements, RawTextElements } from "dom-expressions/src/constants.js";
