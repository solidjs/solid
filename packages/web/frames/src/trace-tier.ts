/**
 * `@solidjs/web/frames/trace` — the frames client's TRACES tier (frames
 * savings pass §3 row C3): the container tier's client half, loaded on
 * demand through the tier mechanism (`prepareTier("trace")`, frame-client.ts).
 *
 * What rides in this chunk, and so leaves the eager frames client: solid's
 * container-trace materializer (`solid-js/internal/container-trace` — the
 * store engine's one edge into a server-component page, ~8 KB brotli with
 * the projection/reconcile machinery it builds on) and the plugin's client
 * half that reaches it (`frame-container-plugin.js`: the shared hook state,
 * the materialization memo, the marker test, the deep arg-revive walk, the
 * container probe). The eager client keeps only the trigger: the loader
 * entry (`tierLoaders.trace`), the held-set predicate (a `{ $tr }` marker in
 * an adopt-time record's args while this tier is absent — the occurrence is
 * HELD, its server interior on screen, the frame's hold registered under
 * frames-rulings 3.1), and the container probe through the plugin's
 * registered state object.
 *
 * `install()` is the tier's one export, called once by `prepareTier` when
 * the import resolves — before the install's flush re-syncs every live
 * frame, so a held occurrence mounts with the materializer in place:
 *   - the materializer goes onto the plugin's shared state
 *     (`setContainerTraceMaterializer`), where the lazy codec's own copy of
 *     the plugin reads it at decode (a `data` chunk that carries a trace
 *     awaits this tier through its `tiers` announcement, so the decode
 *     finds it installed);
 *   - the shared host's `revive` becomes the deep arg-revive walk
 *     (`reviveContainerTraces`): document-face markers in a record's
 *     literal args materialize at the mount's arg-read, with the mount's
 *     `claiming` hint — an adopt-time mount's trace parks its backlog
 *     beyond the snapshot until hydration ends (frames-rulings 3.6 (iii)).
 *
 * The server announces this tier where it serializes a trace (`sink.needs
 * ("trace")`: `X-Frame-Tiers` / `chunk.tiers` on a stream, `_$HY.r["sc:
 * tiers"]` + a `modulepreload` on a document — frame-sink.ts), so the load
 * is a warm start; an un-announced marker starts it from the readiness
 * check and holds (the same DOM, later).
 * @experimental
 */
import { materializeContainerTrace } from "solid-js/internal/container-trace";
// The eager frames client — the SHARED instance the app runs (external in the
// dist build: rollup.config.js's externalizeFramesClient resolves this to
// `@solidjs/web/frames`; a bundled copy would wire a host nobody mounts in).
import { getFrameHost } from "./client.js";
import { reviveContainerTraces, setContainerTraceMaterializer } from "./frame-container-plugin.js";

/** Install the traces tier into the frames client (called by `prepareTier`). */
export function install(): void {
  setContainerTraceMaterializer(materializeContainerTrace);
  getFrameHost().revive = reviveContainerTraces;
}
