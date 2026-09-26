// @ts-nocheck
/**
 * FrameSink — the frame-chunk side of the renderToStream emission seam.
 *
 * `renderToStream` (server.js) routes all emission through semantic sink
 * methods — data / fragment / reveal / asset / shell — with the document sink
 * (inline <script>/<template>/<link> output) as the default. This module is
 * the other side of that seam: a sink emitting the transport-agnostic
 * FrameChunk stream, plus `renderToFrameStream`, the producer entry that
 * wires it up with a frame envelope (start/complete chunks) in place of the
 * document writable. Same render core, different assembly.
 *
 * What stays in the shared render core, unchanged:
 *   - the render context API and resolveSSRNode
 *   - root-hole resolution, blockingPromises, flush scheduling
 *   - the registerFragment registry, reveal groups, waitForFragments,
 *     propagateBoundaryStyles
 *   - asset tracking (createAssetTracking)
 *
 * Call-site map (server.js core -> sink method -> frame chunks):
 *
 *   serializer onData                 -> data(payload)             -> data
 *   doShell                           -> shell(html, meta)         -> [assets,] html
 *   registerFragment resolve (post-flush)
 *                                     -> fragment(key, html, meta) -> [assets,] fragment [, reveal when eager]
 *   revealFragments / revealFallbacks -> reveal(keys, meta)        -> reveal
 *   registerAsset (post-flush)        -> asset(type, value)        -> assets
 *   envelope completion               -> end()                     -> complete
 *   error paths (not yet routed)      -> error(id, err)            -> error
 *
 * Deliberately does NOT flush `<script>` tags, wrap data in the document
 * `$HY` bootstrap, or do string injection: control flow is passive records,
 * not active scripts (the reason the frame consumer must not reuse the $df*
 * helpers).
 */
import {
  createOwner,
  createMemo,
  sharedConfig,
  getOwner,
  runWithOwner,
  NoHydration,
  Hydration
} from "solid-js";
import {
  runInServerComponentScope,
  ssrHandleError,
  ssrSanitizeError,
  creationStamp,
  shareAsyncIterable
} from "solid-js/internal";

// EXPERIMENTAL — the frames/server-components surface ships as an
// experimental preview, excluded from the 2.0 stability guarantee: API
// shapes and the wire format may change between prereleases (RFC 11).
// Every export in this module is @experimental.
import { FrameChunk } from "./frame-client.js";

/**
 * Addresses a frame stream: the boundary id and this response's version.
 * @experimental
 */
export interface FrameAddress {
  id: string;
  version: number;
}

/**
 * Options shared by the frame producers.
 * @experimental
 */
export interface FrameStreamOptions {
  /** Boundary address; defaults to `{ id: "", version: 1 }`. */
  frame?: { id?: string; version?: number };
  /**
   * The request's abort: tears the render down as a client disconnect would
   * (see `renderToStream`'s `signal`). `serverComponentResponse` and
   * `frameFlightResponse` chain it with their own body's `cancel`.
   */
  signal?: AbortSignal;
  /**
   * The call arrived at the live address — a `live` loop is reading
   * (`getServerFunctionInvocation().live`). `serverComponentResponse` then
   * frames the chunks as server-sent events, as the codec stream is framed
   * there (`text/event-stream`, `no-store`, the idle heartbeat, the dev
   * chaos knob), so the loop reads the frame stream through the reader it
   * already has and a proxy holds the connection open as it would any
   * event stream. The chunk protocol is unchanged; only the framing is.
   */
  live?: boolean;
  /**
   * A RESUME (RFC 11 §9.5): the have-list the reconnecting client sent —
   * the digests it holds for this address, keyed as the chunks carry them
   * (`""` the root skeleton, `lh:N` / `lha:N` holes, `pl-N` revealed
   * fragments; see `FRAME_HAVE_HEADER`). With it the render is
   * conditional: the root html is skipped when its skeleton digest matches,
   * and a hole or fragment is emitted only once it has settled and its
   * digest differs — so a no-op reconnect transfers nothing and a fallback
   * is never emitted over content. Absent, the render is the progressive
   * stream it always was. `frameTransformResult` reads it off the request.
   */
  resume?: { have: Record<string, string> };
  /** Remaining `renderToStream` options (plugins, onError, manifest, ...). */
  [key: string]: unknown;
}

/**
 * A produced frame stream: pipe chunks, or await the collected array.
 * @experimental
 */
export interface FrameStream extends PromiseLike<FrameChunk[]> {
  pipe(writable: { write(chunk: FrameChunk): void; end?(): void }): void;
}

const runWithHydrationScope = (id, fn) => runWithOwner(createOwner({ id }), fn);
const ssrAsyncValue = value => createMemo(() => value, { serialize: false });

// The reactive-scope creation stamp (same gate the live-holes engine uses,
// see server.js): an arg expression whose evaluation CREATES reactive scopes
// (a projection, a memo minted inline) is not idempotently re-runnable —
// each ledger sweep would mint a fresh scope with a fresh identity and
// re-emit forever (a per-eval projection re-ships a new trace per commit and
// its pump never ends: the hung-stream disease). Such args latch: they ship
// their first value and the scope they minted carries its own liveness.
// Cores without the stamp fall back to "never moved" (bindings stay open).
const scopeStamp = typeof creationStamp === "function" ? creationStamp : () => 0;

/**
 * Render server-owned output under NoHydration semantics (mimicking solid's
 * `<NoHydration>`): elements emit no hydration keys and async values skip
 * hydration serialization — adopted server content's HTML IS its data, so
 * per-element keys are pure tax ("hydration:false regions"). Ids are still
 * CONSUMED (the zone's owner inherits normally), so sibling key sequences
 * and fragment/Loading ids are untouched. Client positions re-enter through
 * `Hydration` in the document slot props. Cores without the
 * components fall back to plain evaluation (keys stay, nothing breaks).
 */
function serverOwned(render) {
  return NoHydration
    ? NoHydration({
        get children() {
          return render();
        }
      })
    : render();
}

/**
 * The server component's own render runs inside the core's context barrier
 * (when the core provides one): user context does not cross a server
 * component root. A refetch or mutation region renders standalone — no app
 * tree above it — so a t=0 inline read that resolved an app-level provider
 * would silently diverge on the next response; the barrier makes both
 * renders agree by construction. Boundary plumbing (Loading / error /
 * reveal coordination) still crosses — the back-and-forth between a server
 * component's async content and the enclosing boundaries at t=0 is
 * intentional. Client positions are unaffected: they re-enter the zone
 * owner captured OUTSIDE the barrier (see createDocumentSlotProps), so the
 * client's own components keep full app context during document SSR.
 */
function serverComponentScope(render, live = false) {
  return runInServerComponentScope
    ? runInServerComponentScope(render, live ? { live: true } : undefined)
    : render();
}

// The in-process `live` declaration's brand (a registered symbol, so
// separately bundled copies agree): stamped on the component function a
// live server function answers with in process (server-functions/server
// `brandLive`). The document face reads it at scope entry — see
// `frameTransformDirectResult`.
const LIVE_SOURCE = Symbol.for("solid.LiveSource");
import {
  renderToStream,
  createLiveHoles,
  CLAIM_PROP,
  CLAIMS_STREAM,
  CLAIMS_DOCUMENT
} from "../../src/server.js";
import { createJSONSerializer } from "../../serialization/src/serializer.js";
import { isContainerTraced, toBorderForm } from "./frame-container-plugin.js";
import {
  ChunkReader,
  createChunk,
  createEventChunk,
  frameAddress,
  serializeStream,
  textDigest
} from "../../server-functions/src/shared.js";
import {
  armLiveBody,
  getEventServerFunctionInvocation,
  guardFailures
} from "../../server-functions/src/server.js";
import { isResponseEnvelope } from "../../src/response.js";
import { observeFrame } from "../../src/server-observe.js";
import {
  FRAME_HAVE_HEADER,
  FRAME_STREAM_HEADER,
  decodeHaveList,
  SERVER_COMPONENT,
  SERVER_COMPONENT_ADDRESS,
  SERVER_COMPONENT_SOURCE,
  flightCodec,
  setServerComponentBootstrap
} from "./frame-transport.js";

// The brands and the codec plugin live with the transport (the client half
// resolves flight references against its live registry, so they must be
// importable from client bundles); re-exported here because this module is
// where server integrations import the document-SSR surface from.
export {
  SERVER_COMPONENT,
  SERVER_COMPONENT_SOURCE,
  SERVER_COMPONENT_ADDRESS,
  ServerComponentPlugin
} from "./frame-transport.js";

function wirePreload(entry) {
  return entry.href ? { href: entry.href, attrs: entry.attrs } : { attrs: entry.attrs };
}

/**
 * The client-side `_$SC` registry as an idempotent expression: evaluates to
 * the registry, creating it only if absent. Idempotence matters — the
 * bootstrap travels with the FIRST serialized reference of each hydration
 * script (see `ServerComponentPlugin.serialize`; loading this module
 * installs the text there, keeping it out of client bundles), so several
 * scripts in one document may each carry a copy and only the first may
 * define it: a redefinition would wipe the `a` address records registered
 * in between.
 *
 * `r(id, address?)` memoizes one stable placeholder component per server
 * function (`_$SC.impl` is installed later by the frames client runtime) and
 * files the call's address -> id record (`a`, plus the live `reg` hook once
 * the client installs one). Placeholders forward a caller-provided address
 * binding (`b`, the frame transport's second-argument convention for mount
 * components) through to `impl`.
 *
 * An ADDRESSED reference (`r(id, address)` — a call's answer riding as
 * hydration data, e.g. an async `dynamic()` instance's record) resolves to
 * the call's BINDING (`b`, one per address): the placeholder wrapped with
 * its constant address accessor and branded `COMPONENT_BINDING`
 * (`Symbol.for("solid.component-binding")`, the frame transport's contract),
 * the same shape the transport's own `bindingFor` mints for a network or
 * intercept answer — so an equals-gated reader (`dynamic`) that adopted the
 * reference keeps its instance when a post-load answer for the same call
 * arrives, and a mount from it binds the frame's pull to the address. An
 * unaddressed read (`r(id)`) stays the bare placeholder.
 */
const SERVER_COMPONENT_BOOTSTRAP_EXPR =
  "(self._$SC||(self._$SC={c:{},a:{},b:{},r(i,a){var c=this.c[i]||(this.c[i]=(p,b)=>self._$SC.impl(i,p,b));" +
  "if(!a)return c;this.a[a]=i;this.reg&&this.reg(a,i);" +
  'return this.b[a]||(this.b[a]=Object.assign(p=>c(p,()=>a),{[Symbol.for("solid.component-binding")]:{component:c,address:a}}))}}))';

// Serializer contexts (one per emitted script — see seroval's
// crossSerializeStream) whose script already carries the bootstrap; later
// references in the same script are bare registry reads.
const bootstrappedScripts = new WeakSet();
setServerComponentBootstrap(ctx => {
  if (bootstrappedScripts.has(ctx)) return "self._$SC";
  bootstrappedScripts.add(ctx);
  return SERVER_COMPONENT_BOOTSTRAP_EXPR;
});

/**
 * Statement form of the registry bootstrap, for a document shell that wants
 * to install `_$SC` ahead of every data script (e.g. a plugin injecting it
 * into `<head>`). No longer required — serialized references self-bootstrap
 * — but kept for integrations still emitting it; the idempotent form makes
 * the double-definition harmless. Never splice it before the authored
 * `<head>` elements: a head-open script claims as the first walked child at
 * hydration and drifts every positional claim after it.
 */
export const SERVER_COMPONENT_BOOTSTRAP = SERVER_COMPONENT_BOOTSTRAP_EXPR + ";"; /**
 * The emission surface `renderToStream` routes through when producing a
 * frame stream instead of a document (see the `sink` render option). Each
 * method emits transport-agnostic chunks; `emit` is the envelope boundary.
 * @internal Compiler/renderer wiring — use `renderToFrameStream` or
 * `renderServerComponent` instead.
 * @experimental
 */
export function createFrameSink(
  emit: (chunk: FrameChunk) => void,
  frame: FrameAddress,
  have?: Record<string, string>
): Record<string, (...args: any[]) => void>;

// ---- hole digests (Stage 8 B4) ----
//
// Every content emission carries a server-minted digest of what it emits,
// and a root/fragment emission additionally carries the digests of the live
// holes INSIDE it (`holes`), so the client's per-address ledger can name
// what it holds without ever hashing DOM. A live-hole range is
// `<!--lh:N-->…<!--lh:/N-->`; the lazy body with the id backreference
// matches the OUTERMOST range at each position (an inner range closes with
// its own id), so a top-level scan sees each root hole once and nested
// holes are reached by recursing into the body.
const HOLE_RANGE = /<!--lh:(\d+)-->([\s\S]*?)<!--lh:\/\1-->/g;
const SLOT_RANGE = /<!--slot:([^>]*?):start-->[\s\S]*?<!--slot:\1:end-->/g;
const ATTR_ADDRESS = / data-lha="([^"]*)"/g;
// The hole's digest is over its marker-FREE html — the same baseline the
// engine equality-gates on (`b.last`), so a sweep's re-emission and a
// resume's compare agree on what "unchanged" means.
const stripHoleMarkers = html => html.replace(/<!--lh:\/?\d+-->/g, "");

/**
 * The root's SKELETON: its html with every live-hole range and slot range
 * emptied (markers kept). What remains is the structure hole emissions
 * address into — static markup, marker ids and their nesting, placeholder
 * ids and fallbacks. Equal skeletons mean equal hole/fragment keys, which
 * is what makes emitting into the client's existing DOM sound; a differing
 * one re-ships the root whole (structure changed — a hole count that moved
 * with data, a static branch that flipped).
 */
export function frameSkeleton(html) {
  return html
    .replace(HOLE_RANGE, "<!--lh:$1--><!--lh:/$1-->")
    .replace(SLOT_RANGE, "<!--slot:$1:start--><!--slot:$1:end-->");
}

/**
 * Digests of every live-hole range in `html` (nested included) and of every
 * attr hole addressed in it whose baseline text the sink holds.
 */
function holeDigests(html, attrText, into = {}) {
  for (const m of html.matchAll(HOLE_RANGE)) {
    into["lh:" + m[1]] = textDigest(stripHoleMarkers(m[2]));
    holeDigests(m[2], null, into);
  }
  if (attrText) {
    for (const m of html.matchAll(ATTR_ADDRESS)) {
      const key = "lha:" + m[1];
      const text = attrText.get(key);
      if (text !== undefined) into[key] = textDigest(text);
    }
  }
  return into;
}

/** Attach a `holes` map to a chunk when it names anything (wire hygiene). */
function withHoles(chunk, holes) {
  for (const _ in holes) {
    chunk.holes = holes;
    break;
  }
  return chunk;
}

/**
 * A sink emitting the transport-agnostic FrameChunk stream. `emit(chunk)` is
 * the envelope boundary (array push in tests, an encoded write over a real
 * transport). `id`/`version` address the frame. `have` is a resume's
 * have-list (see `FrameStreamOptions.resume`): present, the sink emits
 * conditionally against it.
 *
 * @param {(chunk: object) => void} emit
 * @param {{ id: string, version: number }} frame
 * @param {Record<string, string>} [have]
 */
export function createFrameSink(emit, frame, have) {
  const { id, version } = frame;
  // Conditional emission (Stage 8 B4, RFC 11 §9.5 Server face 2). `have`
  // is the client's ledger for this address; `conditional` arms once the
  // shell decides the client's structure stands (skeleton digests equal)
  // — from then on, fragments the list names are skipped in favor of the
  // holes inside them that differ, and reveals over them (fallback reveals
  // included) never ship. A skeleton that differs re-ships the root and the
  // render proceeds as the progressive stream it always was: the client
  // resets its ledger on a root html, so nothing it then holds is stale.
  let conditional = false;
  const skipped = new Set();
  // Attr-hole baselines by key (`lha:N` → attribute text), registered by
  // the live-hole engine as it addresses elements. Attr text is not
  // recoverable from html the way a content range is, so the digests ride
  // from here.
  const attrText = new Map();
  // Emit what differs inside `html` against the have-list: each top-level
  // hole whose digest moved (its nested holes ride inside it, markers kept,
  // so they stay individually live), each addressed attr whose text moved.
  // An equal top-level hole covers its interior — the digest is over the
  // whole range — so nothing below it needs a look.
  const emitDiffering = html => {
    for (const m of html.matchAll(HOLE_RANGE)) {
      const key = "lh:" + m[1];
      const digest = textDigest(stripHoleMarkers(m[2]));
      if (have[key] === digest) continue;
      emit(
        withHoles({ type: "hole", id, version, key, html: m[2], digest }, holeDigests(m[2], null))
      );
    }
    // (Attr chunks are keyed by the bare address, as the engine emits them;
    // the ledger keys them `lha:N`.)
    for (const m of html.matchAll(ATTR_ADDRESS)) {
      const text = attrText.get("lha:" + m[1]);
      if (text === undefined) continue;
      const digest = textDigest(text);
      if (have["lha:" + m[1]] === digest) continue;
      emit({ type: "attr", id, version, key: m[1], attrs: text, digest });
    }
  };
  // Fragments that streamed styles ahead of a grouped reveal; the group's
  // reveal chunk must tell the consumer to wait on them.
  const styledKeys = new Set();
  // The binding ledger (DR-2 case 1): open bindings for re-runnable slot
  // args — compiled getters, thunks, memos passed whole — re-evaluated at
  // every commit the response observes. A commit is any settlement the sink
  // sees flow through it: a data flush (a serialized promise resolving, an
  // iterator yielding), a fragment resolving, a pending arg's retry
  // succeeding. Sweeps coalesce per microtask and are equality-gated inside
  // each binding, so a quiet ledger costs one comparison per binding per
  // commit. Refs MINTED by sweeps are excluded from the funnel — their own
  // flushes must not re-trigger the sweep that produced them, or a getter
  // returning fresh object identities would loop the response forever; each
  // real commit then drives at most one re-emit per binding.
  //
  // Keyed by `(occurrence, arg)`, replace-on-reopen: one live binding per
  // arg position. A re-render of the same occurrence within one response —
  // the same `$key` rendered twice, or (designed, not yet built) a
  // generator component's next yield — SUPERSEDES the previous render's
  // binding: the stale closure stops sweeping the moment the fresh one
  // opens, instead of both re-emitting per commit.
  const bindings = new Map();
  const sweepMinted = new Set();
  const argRefVersions = new Map();
  let sweepScheduled = false;
  let closed = false;
  // The commit epoch: bumped once per sweep batch, exposed so the reactive
  // core can cache sync derivations per epoch (a memo pulled twice in one
  // sweep computes once; a memo pulled across commits recomputes — the
  // client contract applied to the server, without a subscriber graph).
  let epoch = 0;
  const sweep = () => {
    epoch++;
    for (const b of [...bindings.values()]) {
      try {
        b.sweep();
      } catch (_) {
        // A sweep failure (a serializer already closed at the end-of-response
        // latch) must not take the stream down: the binding's last emitted
        // value stands.
      }
    }
  };
  const scheduleSweep = () => {
    if (closed || sweepScheduled || !bindings.size) return;
    sweepScheduled = true;
    queueMicrotask(() => {
      sweepScheduled = false;
      if (!closed) sweep();
    });
  };
  // Fragment keys registered while a REGION (a `{$frame}` slot arg) resolves,
  // mapped to that region's childId. A region is a nested frame the client
  // owns end-to-end, so its Suspense fragment/reveal must route to the region,
  // not this root frame — else the root store carries the region's segment
  // state and the region's independent morph across responses desyncs from it.
  // First write wins so a fragment inside a nested region is tagged with the
  // innermost region (the region wrap runs before the enclosing one).
  const regionKeys = new Map();
  const frameOf = key => regionKeys.get(key) || id;
  return {
    // Tag a fragment key to the region resolving around its registration, so
    // its later fragment/reveal chunks address the region frame.
    tagRegion(key, childId) {
      if (!regionKeys.has(key)) regionKeys.set(key, childId);
    },
    shell(html, meta = {}) {
      const digest = textDigest(frameSkeleton(html));
      // A resume whose structure the client already shows: no root, no
      // assets it loaded with it — only the holes that moved.
      if (have && have[""] === digest) {
        conditional = true;
        emitDiffering(html);
        return;
      }
      // Pre-flush assets (entry modules, hoisted boundary styles) are head
      // splices in the document sink; a frame carries them as an assets chunk
      // ahead of the shell html.
      if ((meta.preloads && meta.preloads.size) || meta.preloadLinks) {
        const chunk = { type: "assets", id, version, key: "" };
        if (meta.preloads && meta.preloads.size) {
          const styles = [];
          const modules = [];
          for (const url of meta.preloads) {
            (url.endsWith(".css") ? styles : modules).push(url);
          }
          if (styles.length) chunk.styles = styles;
          if (modules.length) chunk.modules = modules;
        }
        if (meta.preloadLinks) {
          chunk.preloads = [];
          for (const entry of meta.preloadLinks) {
            chunk.preloads.push(wirePreload(entry));
          }
        }
        emit(chunk);
      }
      emit(withHoles({ type: "html", id, version, html, digest }, holeDigests(html, attrText)));
    },
    data(record) {
      // Keyed codec record ({ key, node, initial }) from createJSONSerializer
      // — the frame wire format: eval-free SerovalNode data the consumer
      // applies to its record table (createJSONDataTable). A plain string
      // (hydration script from createHydrationSerializer) still passes
      // through as a `payload` chunk for eval-style consumers.
      //
      // The DOCUMENT hydration protocol's bookkeeping — fragment-resume
      // promises (`<id>_fr`) and ssrSource memo auto-serializations (bare
      // hydration-id keys, pure digits under a frame render) — has no
      // frame-side reader: the stream's own fragment/reveal chunks supersede
      // it. Dropped (measured at 26% of a navigation payload). Deliberate
      // serializations (codec `arg:` records, user keys) pass through.
      if (
        record &&
        typeof record.key === "string" &&
        (record.key.endsWith("_fr") || /^\d+$/.test(record.key))
      ) {
        return;
      }
      if (typeof record === "string") {
        emit({ type: "data", id, version, payload: record });
        scheduleSweep();
      } else {
        emit({
          type: "data",
          id,
          version,
          key: record.key,
          node: record.node,
          initial: record.initial
        });
        if (!sweepMinted.has(record.key)) scheduleSweep();
      }
    },
    fragment(key, value, meta = {}) {
      // meta.styles is the core's { links, inline } split: stylesheet URLs
      // gate the reveal (they load async); inline styles are CSS content that
      // applies on insertion, carried by value, no gating.
      const fid = frameOf(key);
      // A resume, and the client shows this fragment revealed: the reveal
      // is not owed (nor its styles — they loaded with it). What may be
      // owed is inside: holes the content settled differently. A fragment
      // the list does NOT name is one the client shows as a fallback — it
      // streams as it settles, as any reveal the client lacks does.
      if (conditional && fid === id && have[key] !== undefined) {
        skipped.add(key);
        scheduleSweep();
        // An errored re-render stands behind the content the client keeps;
        // the failure still surfaces as the keyed diagnostic it always was.
        if (meta.error) {
          emit({
            type: "error",
            id: fid,
            version,
            key,
            error: { message: String((meta.error && meta.error.message) || meta.error) }
          });
        } else emitDiffering(value);
        return;
      }
      const links = (meta.styles && meta.styles.links) || [];
      const inline = (meta.styles && meta.styles.inline) || [];
      if (links.length || inline.length) {
        if (links.length) styledKeys.add(key);
        const chunk = { type: "assets", id: fid, version, key };
        // Link entries are urls or attributed gate entries; the wire form
        // drops the document-sink markup (`attrHtml`) and keeps the
        // setAttribute record.
        if (links.length) {
          chunk.styles = links.map(e =>
            typeof e === "string" ? e : e.attrs ? { href: e.href, attrs: e.attrs } : e.href
          );
        }
        if (inline.length) {
          chunk.inlineStyles = inline.map(e => ({ id: e.id, content: e.content, attrs: e.attrs }));
        }
        emit(chunk);
      }
      emit(
        withHoles(
          { type: "fragment", id: fid, version, key, html: value, digest: textDigest(value) },
          holeDigests(value, attrText)
        )
      );
      // A fragment resolving is a settlement: values its async work produced
      // are now visible to watched args.
      scheduleSweep();
      // A fragment that ERRORED still reveals (its html is the fallback /
      // error template), but the failure is surfaced as a keyed error chunk
      // — the frame protocol has no `<key>_fr` rejection to ride.
      if (meta.error) {
        emit({
          type: "error",
          id: fid,
          version,
          key,
          error: { message: String((meta.error && meta.error.message) || meta.error) }
        });
      }
      // An eagerly-revealed fragment (no reveal group) carries its own
      // reveal; grouped fragments wait for an explicit reveal() call.
      if (!meta.revealGroup) {
        emit({ type: "reveal", id: fid, version, keys: [key], waitForStyles: !!links.length });
      }
    },
    reveal(keys, meta = {}) {
      // Keys in one reveal group can belong to different frames (a region's
      // fragment shares a group with the root's). Split by frame so each
      // reveal chunk addresses the frame that owns those placeholders, keeping
      // registration order within each frame.
      const byFrame = new Map();
      for (const key of keys) {
        // A resume never reveals over content the client shows — neither
        // the fragment it skipped nor a fallback in its place.
        if (conditional && (skipped.has(key) || (meta.fallback && have[key] !== undefined)))
          continue;
        const fid = frameOf(key);
        let group = byFrame.get(fid);
        if (!group) byFrame.set(fid, (group = []));
        group.push(key);
      }
      for (const [fid, groupKeys] of byFrame) {
        let waitForStyles = false;
        for (const key of groupKeys) if (styledKeys.has(key)) waitForStyles = true;
        const chunk = { type: "reveal", id: fid, version, keys: groupKeys, waitForStyles };
        if (meta.fallback) chunk.fallback = true;
        emit(chunk);
      }
    },
    asset(type, value) {
      // Post-flush styles ride their fragment's assets chunk (fragment() gets
      // them via meta.styles) — same as the document sink, which only writes
      // style links on the fragment path. Emitting them here too would
      // duplicate, mis-keyed to the root.
      if (type === "module") {
        emit({ type: "assets", id, version, key: "", modules: [value] });
      } else if (type === "preload") {
        emit({ type: "assets", id, version, key: "", preloads: [wirePreload(value)] });
      }
    },
    end() {
      // The end-of-response latch: one final synchronous sweep so a commit
      // that landed in the last flush still ships before `complete` (the
      // scheduled microtask would lose that race). Completion latches every
      // binding's last value as final.
      if (bindings.size) sweep();
      closed = true;
      emit({ type: "complete", id, version });
    },
    error(errorId, error) {
      emit({ type: "error", id, version, key: errorId, error });
    },
    // A named slot invocation from the slot props proxy: the client's
    // render callback for the occurrence's prop is called with these args.
    // No document-sink counterpart — slots only exist in frame streams.
    slot(key, args) {
      emit({ type: "slot", id, version, key, args });
    },
    // A nested server-content region (a `{$frame}` slot arg): its html is a
    // chunk addressed to the CHILD frame id — the consumer binds a nested
    // frame to the arg's marker range and the host routes/buffers by id.
    region(childId, html) {
      emit({ type: "html", id: childId, version, html });
    },
    // A live-hole re-emission (Stage 3): the hole's re-resolved HTML, keyed
    // by its marker id — the consumer morphs the marked range in place.
    hole(key, html) {
      emit({ type: "hole", id, version, key, html, digest: textDigest(html) });
    },
    // A live attr-hole re-emission: the addressed element's rebuilt
    // attribute text, plus the names that vanished since the last emission
    // (the server holds the previous text — the client never tracks name
    // history).
    attr(key, attrs, removed) {
      const chunk = { type: "attr", id, version, key, attrs, digest: textDigest(attrs) };
      if (removed && removed.length) chunk.removed = removed;
      emit(chunk);
    },
    // An attr hole's first-render text, keyed by its address — the digest
    // source for root/fragment `holes` maps and the resume compare.
    attrBaseline(key, text) {
      attrText.set(key, text);
    },
    // ---- the binding ledger (DR-2 case 1) ----
    /**
     * Open a watched-arg binding under its `(occurrence, arg)` key; it
     * sweeps until the response completes or a re-render of the same
     * position supersedes it.
     */
    openBinding(key, b) {
      bindings.set(key, b);
    },
    /** A real error is terminal for its binding — same as the retry loop. */
    closeBinding(key) {
      bindings.delete(key);
    },
    /** Exclude a sweep-minted data ref's flushes from the commit funnel. */
    mintRef(ref) {
      sweepMinted.add(ref);
    },
    /**
     * Allocate the next versioned-ref number for an arg position. Owned by
     * the sink (not the binding) because data refs are write-once in the
     * codec and positions outlive bindings: a superseding render's fresh
     * binding must continue the position's sequence, never restart it.
     */
    nextArgRef(ledgerKey) {
      const n = (argRefVersions.get(ledgerKey) || 0) + 1;
      argRefVersions.set(ledgerKey, n);
      return n;
    },
    /** An out-of-band commit signal (a pending arg's retry settling). */
    commit: scheduleSweep,
    /** The current commit epoch (see the ledger comment above). */
    get epoch() {
      return epoch;
    }
  };
} /**
 * Render to a FrameChunk stream: the same render core as `renderToStream`
 * with emission swapped to the frame sink and the document writable replaced
 * by a chunk envelope (`start` up front, `complete` at stream end). Data
 * records default to the keyed JSON codec (decode with
 * `createJSONDataTable`).
 * @experimental
 */
export function renderToFrameStream(code: () => unknown, options?: FrameStreamOptions): FrameStream;

/**
 * Render to a FrameChunk stream: the same render core as `renderToStream`,
 * with emission swapped to `createFrameSink` and the document writable
 * replaced by a chunk envelope. The envelope emits `start` up front and
 * `complete` at stream end; no document text is ever written.
 *
 *   renderToFrameStream(code, { frame: { id: "f0", version: 1 } })
 *     .pipe({ write(chunk) { ... }, end() { ... } });
 *
 *   const chunks = await renderToFrameStream(code, opts); // collected array
 *
 * Remaining `renderToStream` options (renderId, plugins, onError, manifest,
 * ...) pass through; `options.sink` is owned by this entry.
 *
 * @param {() => unknown} code
 * @param {{ frame?: { id?: string, version?: number } } & object} options
 */
export function renderToFrameStream(code, options = {}) {
  return frameStream(() => code, options);
} /**
 * Render a **server component** — a `props => JSX` function, typically
 * returned from a server function — to a FrameChunk stream. `props` is a
 * slot-props proxy, not data:
 *
 * - reading a prop as a child emits a marker range the client fills;
 * - calling a prop as a render function emits a `slot` chunk for a fresh
 *   occurrence (a primitive `$key` arg names it, so client state follows the
 *   entity across responses — the slot-level analogue of For's `keyed`
 *   function; positional otherwise, which is the right default for most
 *   flows);
 * - primitive args ride the chunk; server JSX args stream as nested regions
 *   (`{$frame}` — html once, never data); other values serialize as `{$ref}`
 *   data records with referential dedupe.
 *
 * The props a *client* passes never reach the server — server inputs are the
 * function's arguments.
 * @experimental
 */
export function renderServerComponent(
  component: (props: Record<string, any>) => unknown,
  options?: FrameStreamOptions
): FrameStream;

/**
 * Render a **server component** — a `props => JSX` function, typically
 * returned from a server function — to a FrameChunk stream. `props` is a
 * slot-props proxy, not data: reading a prop as a child emits a slot
 * marker range the client fills with its own content; calling a prop as a
 * render function additionally emits a `slot` chunk carrying the call's
 * args (one occurrence per call, so iteration and state-follows-id reorder
 * work on the consumer). Args serialize through the frame's data codec —
 * primitives ride literally, everything else becomes a `{ $ref }` the
 * consumer resolves against its data table.
 *
 * This is the producing half of the convention "a function returned from a
 * server function is a server component"; the props the *client* passes
 * never reach the server — the server only marks where they go.
 *
 * @param {(props: object) => unknown} component
 * @param {{ frame?: { id?: string, version?: number } } & object} options
 */
export function renderServerComponent(component, options = {}) {
  return frameStream((sink, frame) => {
    const props = createSlotProps(sink, frame);
    return () => {
      // The out-of-band commit hook for the binding ledger. A server-owned
      // render serializes nothing (the HTML is the data), so an async value
      // settling INSIDE it — a promise memo resolving, an iterator memo
      // yielding — produces no sink flush for the commit funnel to see. The
      // reactive core pokes this hook at those settles (and pumps iterator
      // memos only while it exists), so watched slot args reading them stay
      // live for the response window.
      const ctx = sharedConfig.context;
      if (ctx) {
        ctx.commit = sink.commit;
        // Per-epoch memo caching (the ledger's derivation story): the core
        // compares this at memo reads so sync derivations recompute across
        // commits and stay cached within one.
        ctx.commitEpoch = () => sink.epoch;
        // Live markup holes (Stage 3): thunk content holes in this render
        // mark their ranges and open ledger bindings — the call-driven face
        // is live for the response window. The document face never sets
        // this (t=0 latches to the V1 snapshot).
        ctx.liveHoles = createLiveHoles(sink);
        // Behavior claims (Stage 6): arm the compiled guard for the whole
        // response — everything here is the component's own render.
        ctx.claims = CLAIMS_STREAM;
      }
      return serverComponentScope(() => component(props));
    };
  }, options);
}

// The shared chunk envelope: `start` up front, the frame sink for all render
// emission, `complete` + end on the stream settling. `makeCode` builds the
// render thunk with access to the sink/frame (the slot-props proxy needs
// both); no document text is ever written.
function frameStream(makeCode, options) {
  const { id = "", version = 1 } = options.frame || {};
  const frame = { id, version };
  function stream(w) {
    // Observe tier: the server half of the `"frame"` record
    // (`OBSERVE.records`, see `FrameProducedEvent`) — start → complete, with
    // the chunk census. Nothing is read, not even the clock, without a
    // listener.
    const observation = observeFrame(frame);
    const emit = observation
      ? chunk => {
          observation.chunk(chunk);
          w.write(chunk);
        }
      : chunk => w.write(chunk);
    const sink = createFrameSink(emit, frame, options.resume && options.resume.have);
    w.write({ type: "start", id, version });
    const code = makeCode(sink, frame);
    try {
      // Frames default to the keyed JSON codec for data records (eval-free
      // nodes; decode with createJSONDataTable). `options.serializer` can
      // override — e.g. createHydrationSerializer for eval-style payloads.
      // The whole stream render is server-owned: client positions never
      // render server-side post-load, so nothing in a frame stream carries
      // hydration keys or async-value hydration records.
      renderToStream(() => serverOwned(code), {
        serializer: createJSONSerializer,
        ...options,
        sink
      }).pipe({
        // Every document emission is intercepted by the frame sink, so no
        // text arrives here; the writable exists only for the completion
        // signal.
        write() {},
        end() {
          sink.end();
          observation && observation.settle("complete");
          w.end && w.end();
        }
      });
    } catch (err) {
      // A synchronous render failure travels as a structured chunk — the
      // consumer stores an `:error` record instead of seeing a truncated
      // stream. (Async fragment errors already ride their rejected `_fr`
      // promise through the data codec.) What the chunk carries is the wire
      // policy's (#3468); the record beside it keeps the original.
      const wire = ssrSanitizeError(err, null);
      sink.error("", wire instanceof Error ? wire.message : String(wire));
      sink.end();
      observation && observation.settle("error", err);
      w.end && w.end();
    }
  }
  return {
    pipe: stream,
    then(onFulfilled, onRejected) {
      return new Promise((resolve, reject) => {
        const chunks = [];
        try {
          stream({ write: chunk => chunks.push(chunk), end: () => resolve(chunks) });
        } catch (err) {
          reject(err);
        }
      }).then(onFulfilled, onRejected);
    }
  };
}

/** The slot marker range for an occurrence, as a pre-rendered SSR value.
 * `$slot` opts the range out of live-hole marking: a slot is a client-owned
 * position — the server can never re-render it, so a live binding over one
 * would be permanently inert and its markers pure tax. */
function slotRange(occurrence) {
  return { t: `<!--slot:${occurrence}:start--><!--slot:${occurrence}:end-->`, $slot: true };
}

// Occurrence ids embed user data (`$key`), and they land in contexts with
// hard character constraints: HTML comment markers (`-->` terminates the
// comment — the Qwik marker-XSS class, GHSA-m6jq-g7gq-5w3c), unquoted `_hk`
// attribute values (whitespace/quotes/`=`/`<`/`>`/backtick truncate or split
// the attribute), and `#`, which is the occurrence separator `propOf` splits
// on. Keys are percent-encoded onto a conservative alphabet at the single
// point occurrences are minted; both proxies and the wire carry the encoded
// form, and the client never decodes — occurrence identity only requires the
// two sides to agree byte-for-byte. `%` itself encodes, so the mapping is
// injective and distinct keys can never collide.
const OCCURRENCE_UNSAFE = /[^A-Za-z0-9_.-]/g;
function encodeOccurrenceKey(key) {
  return String(key).replace(OCCURRENCE_UNSAFE, c => {
    const code = c.codePointAt(0);
    return "%" + (code < 16 ? "0" : "") + code.toString(16);
  });
}

/**
 * Mint the occurrence id for one render-prop call: `prop#<$key>` when the
 * caller named the occurrence, positional `prop#<n>` otherwise. Shared by the
 * stream and document proxies so identity is byte-identical across t=0
 * adoption and every later stream.
 */
function occurrenceId(prop, raw, counts) {
  const k = raw.$key;
  // Numbers encode too: exponent forms ("1e+21") carry `+`.
  if (typeof k === "string" || typeof k === "number") {
    return `${prop}#${encodeOccurrenceKey(k)}`;
  }
  const n = counts[prop] || 0;
  counts[prop] = n + 1;
  return `${prop}#${n}`;
}

/** An async value in the DR-2 value-tier sense: passed whole, rides the data
 *  channel, and the consumer's READ settles. */
function isAsyncValue(v) {
  return (
    !!v &&
    typeof v === "object" &&
    (typeof v.then === "function" || typeof v[Symbol.asyncIterator] === "function")
  );
}

/**
 * One source, two consumers (document face): the inline read wants the
 * iterable's first step, the record wants every step — and the server
 * component may be reading the same source itself. Two seats on the
 * runtime's shared multicast of it (`shareAsyncIterable`): the record's,
 * reserved first; the read's, which takes one value and leaves. The seat
 * the record ships replays from its reservation, so the adopted client
 * sees the complete sequence.
 */
function tapFirstYield(iterable) {
  const rest = shareAsyncIterable(iterable);
  const iter = shareAsyncIterable(iterable)[Symbol.asyncIterator]();
  // Normalized: protocol-loose producers may return a bare IteratorResult
  // when a value is already buffered (seroval's deserialized streams do).
  const first = Promise.resolve(iter.next()).then(r => {
    if (!r.done) iter.return?.();
    return r.done ? undefined : r.value;
  });
  return { first, rest };
}

/**
 * Document-mode slot props — the t = 0 counterpart of
 * `createSlotProps`. During initial document SSR a server component
 * renders INLINE, and (the one hydration-time exception) the client's real
 * props render server-side inside its positions. This proxy hands the
 * server component those real props while emitting the same marker dialect
 * the chunk producer uses — proj ranges around positions, frame ranges
 * around nested server content — so the client's `adopt` binds slots and
 * regions onto the server-rendered ranges and post-load streams morph them
 * in place. Occurrence identity (`$key`/positional) matches the chunk
 * producer exactly; nothing here is serialized — the page IS the payload.
 */
/**
 * Mint-suppress a slot FILL's render (document face): fill content is
 * client-owned DOM the adopting frame claims, so nothing inside it may
 * grow live-hole markers, `data-lha` addresses, or bindings — a server op
 * morphing inside a claimed fill would replace nodes the client's reactive
 * bindings hold. Compiled templates resolve their holes AT RENDER (`ssr()`
 * call time), so the window wraps the render itself; async escalations
 * inside it stay suppressed through `buildAsyncWrap`'s tag propagation,
 * and walk-time holes (bare-thunk fills) are covered by the `$slot` tag on
 * the range. Fill liveness is the RECORD's story: arg re-emissions update
 * the adopted occurrence's props.
 */
function suppressedFill(render) {
  const live = sharedConfig.context && sharedConfig.context.liveHoles;
  if (!live) return render();
  live.suppressed++;
  try {
    return render();
  } finally {
    live.suppressed--;
  }
} // === Document SSR (t = 0) ===

/**
 * Document-mode slot props — the t = 0 counterpart of
 * `createSlotProps`: the server component renders INLINE in the
 * document and the client's real props render server-side inside its
 * positions (the one hydration-time exception), wrapped in the same marker
 * dialect the chunk producer emits so the adopting client binds slots and
 * regions onto the server-rendered ranges.
 * @experimental
 */
export function createDocumentSlotProps(
  clientProps: Record<string, unknown>,
  frameId: string
): Record<string, unknown>;

export function createDocumentSlotProps(clientProps, frameId) {
  const counts = Object.create(null);
  const getters = new Map();
  // `$slot`-tagged like the stream face's slotRange: the engine resolves a
  // slot-tagged value MINT-SUPPRESSED, so fill content — client-owned DOM
  // the adopting frame claims — never grows live-hole markers or bindings.
  // (A server hole op morphing inside a claimed fill would replace nodes
  // the client's reactive bindings hold.) Fill liveness is the RECORD's
  // story: arg re-emissions update the adopted occurrence's props. One
  // known coarsening: a region (server JSX arg) placed by the fill resolves
  // inside this suppressed span, so its interior holes keep the t=0 latch.
  const range = (occurrence, content) => {
    const r = [
      { t: `<!--slot:${occurrence}:start-->` },
      content,
      { t: `<!--slot:${occurrence}:end-->` }
    ];
    r.$slot = true;
    return r;
  };
  // Client content renders under a per-occurrence hydration-key OWNER
  // scope, so the adopting client re-renders each slot under the SAME
  // scope and solid's registry claims the server-rendered nodes by key —
  // templates never ship as data (the claim IS the transfer). Key chains
  // derive from the owner id on both sides (getNextChildId), which is why
  // this is an owner, not a render-context poke. Inside the serverOwned
  // (NoHydration) zone this is the `<Hydration id>` re-entry — same owner,
  // plus re-enabling key emission for the client position's subtree.
  //
  // The zone owner is captured HERE (proxy creation happens inside
  // serverOwned) because a position hole can evaluate later under an
  // ambient owner outside the zone: template holes re-enter their
  // registration owner (ssrScope), but a position sitting in a top-level
  // fragment resolves as an array element at flush time — Hydration would
  // see "no NoHydration zone" and pass through, leaking ambient-chain keys
  // onto the wrapper instead of its sc- occurrence namespace.
  const zoneOwner = getOwner ? getOwner() : null;
  const scoped = (occurrence, render) => {
    const id = `sc-${frameId}-${occurrence}-`;
    const run = () =>
      Hydration
        ? Hydration({
            id,
            get children() {
              return render();
            }
          })
        : runWithHydrationScope(id, render);
    return zoneOwner ? runWithOwner(zoneOwner, run) : run();
  };
  return new Proxy(Object.create(null), {
    has() {
      return true;
    },
    get(_, prop) {
      if (typeof prop !== "string") return undefined;
      if (prop === "then") return undefined;
      let fn = getters.get(prop);
      if (!fn) {
        fn = (...callArgs) => {
          // Direct-insert position: the client's content renders inline,
          // wrapped in the range the adopting frame will claim.
          if (callArgs.length === 0 || callArgs[0] === undefined) {
            // Direct-insert positions are key-scoped like render props —
            // there is no natural id parity across the boundary, so BOTH
            // sides evaluate inside the occurrence scope. The prop is read
            // INSIDE scoped(): compiled component props are getters, so the
            // client's JSX evaluates lazily at access under the same keys —
            // plain JSX, no thunk convention.
            return suppressedFill(() =>
              scoped(prop, () => {
                const value = clientProps[prop];
                return range(prop, typeof value === "function" ? value() : value);
              })
            );
          }
          const raw = callArgs[0];
          const occurrence = occurrenceId(prop, raw, counts);
          const slot = clientProps[prop];
          if (typeof slot !== "function") return range(occurrence, undefined);
          const resolved = {};
          // Usage tracking (dispatch case 3, document face): regions ride as
          // THUNKS, so SSR hole resolution evaluating one IS the usage
          // signal. A wrapper that never renders an arg (collapsed by
          // default) leaves its thunk unevaluated — that content would
          // vanish from the page, so after the wrapper's render it FLIPS:
          // serialized once as hydration-data records (the occurrence's args
          // + the region html, keyed for the adopting frame's store) and the
          // client mounts it from there when the wrapper finally renders it.
          // Unwrap function-valued args (a function can't be serialized, so
          // it is a thunk producing content or a getter producing data),
          // then classify the result — region detection and the t=0 arming
          // below see the same classified value. This is how top-level
          // one-shot reactive control flow (<For>/<Show>) reaches the region
          // path when it arrives as a thunk/memo.
          //
          // The evaluator is captured from the property DESCRIPTOR exactly
          // as on the stream face (createSlotProps): compiled JSX props are
          // getters — the SAME authored shape as a markup hole — and that
          // re-runnable handle is what the case-1 ledger sweeps, so an
          // expression arg stays as live at t=0 as it is on a call-driven
          // stream. A NOT-READY first evaluation is pending per-arg, never
          // a hold on the whole occurrence: the retry-loop promise takes
          // the value's place and flows down the value-tier path — the
          // inline fill's read suspends into the fill's OWN boundary (the
          // client read's semantics exactly), the record ships the promise
          // (the hydration serializer patches it on settle), and the
          // binding opens unsettled, re-armed by the retry's onSettle.
          const liveArgs =
            sharedConfig.context && sharedConfig.context.live && sharedConfig.context.live.args;
          const vals = {};
          const evals = {};
          // Per-key ledger state: `settled` + the equality baseline. Kept
          // as the PRE-TAP value — `vals` entries get replaced for tapped
          // iterables (the rest-wrapper below), and comparing a
          // re-evaluation against the wrapper would re-emit spuriously.
          const states = {};
          // Keys whose evaluation minted reactive scopes (scopeStamp moved):
          // not re-runnable, so no watched binding opens for them below.
          const minted = {};
          for (const key of Object.keys(raw)) {
            if (key === "$key") continue;
            const desc = Object.getOwnPropertyDescriptor(raw, key);
            let evaluate = null;
            let value;
            if (desc.get) {
              const get = desc.get;
              evaluate = () => unwrapThunks(get.call(raw));
            } else {
              value = desc.value;
              if (typeof value === "function") {
                const fn = value;
                evaluate = () => unwrapThunks(fn);
              }
            }
            if (evaluate) {
              evals[key] = evaluate;
              const stampBefore = scopeStamp();
              try {
                value = evaluate();
                states[key] = { settled: true, last: value };
              } catch (err) {
                const blocked = ssrHandleError && ssrHandleError(err);
                if (!blocked) throw err;
                const state = (states[key] = { settled: false, last: undefined });
                value = retryArgUntilSettled(evaluate, blocked, key, occurrence, v => {
                  state.settled = true;
                  state.last = v;
                  // The settle is a commit: other bindings may read the
                  // same source. (This binding's own re-emission stays
                  // gated on inequality with the value just recorded.)
                  if (liveArgs) liveArgs.commit();
                });
              }
              if (scopeStamp() !== stampBefore) minted[key] = true;
            }
            vals[key] = value;
          }
          const regions = [];
          for (const key of Object.keys(vals)) {
            const value = vals[key];
            if (isContainerTraced(value)) {
              // Container tier (DR-2 case 3): a traced container is DATA
              // however object-shaped it is, and the check comes FIRST — the
              // classifiers below read properties, and a pending projection
              // proxy throws not-ready at any string-key get (isAsyncValue's
              // `.then` probe would detonate here). The fill reads the proxy
              // itself: settled reads pass through; a pending read throws
              // not-ready into the hole machinery — a per-arg suspend, the
              // value tier's own behavior. The record ships the proxy, which
              // the serializer's trace plugin carries as snapshot + patches.
              resolved[key] = value;
            } else if (isServerContent(value)) {
              const childId = `${frameId}.${occurrence}.${key}`;
              const region = { key, childId, value, used: false, locked: false };
              regions.push(region);
              resolved[key] = () => {
                // Streaming occlusion lock: the usage flip below runs at the
                // wrapper's SYNCHRONOUS return, but a wrapper that places this
                // region behind an async boundary (a Suspense that resolves
                // after the shell flush) calls this thunk LATER — after the
                // flip already deemed the region occluded and serialized its
                // content once as a data record. Re-emitting it as markup now
                // would double-ship the same content (data + markup), the one
                // thing single-copy forbids. So a locked region contributes
                // nothing — identical to a region the wrapper never placed; the
                // client mounts it from the `sc:region:` record on placement.
                if (region.locked) return [];
                region.used = true;
                // A region is a frame ELEMENT the client wrapper adopts —
                // the same DOM contract as the boundary, one level down.
                return [{ t: frameElementOpen(childId) }, value, { t: FRAME_ELEMENT_CLOSE }];
              };
            } else if (ssrAsyncValue && isAsyncValue(value)) {
              // DR-2 value tier, document face: the inline fill's read of an
              // async arg must SUSPEND (throw not-ready into the engine's
              // hole machinery, which re-pulls on settle), not read the raw
              // promise — a raw read renders empty markup the adopted client
              // then contradicts (it reads the record's settled value): a
              // hydration mismatch instead of a covered pending state. The
              // record is untouched — the async value itself still ships
              // there and the document's data scripts stream its resolution,
              // exactly as before.
              //
              // An async ITERABLE has two consumers here (this read wants
              // the first yield; the record's serialization wants every
              // yield) and possibly a third — the server component reading
              // the same source — so each takes a seat on the runtime's
              // shared multicast of it: the read settles on the first yield
              // — markup is the V1 snapshot, later yields are the adopted
              // client's story — and the record's seat carries the full
              // sequence.
              let readable = value;
              if (typeof value.then !== "function") {
                const { first, rest } = tapFirstYield(value);
                readable = first;
                vals[key] = rest;
              }
              const read = ssrAsyncValue(readable);
              Object.defineProperty(resolved, key, {
                get: read,
                enumerable: true,
                configurable: true
              });
            } else {
              resolved[key] = value;
            }
          }
          const out = suppressedFill(() =>
            scoped(occurrence, () => range(occurrence, slot(resolved)))
          );
          const unused = regions.filter(r => !r.used);
          if (sharedConfig.context) {
            // One record shape (A5, server-components-principles.md): the
            // t=0 document emits the record a stream would — every invoked
            // occurrence gets one, and EVERY region arg rides as its
            // `{$frame}` address ref, used or not. The ref is addressing,
            // not content: a used region's content ships once as page
            // markup (the adopting client resolves the ref to the element
            // already in the interior), an occluded one ships once as its
            // `sc:region:` record. Primitive args always ship — a scalar
            // the client needs AS DATA to re-invoke the wrapper is not a
            // single-copy concern (value-from-page recovery is a
            // template-mode question, never a substring guess: the old
            // heuristic dropped correct args on any markup coincidence).
            const args = {};
            for (const key of Object.keys(vals)) {
              const value = vals[key];
              const region = regions.find(r => r.key === key);
              if (region) {
                args[key] = { $frame: region.childId };
                continue;
              }
              // Container check first for exactness: a store whose STATE has
              // a `t` key would satisfy isServerContent's shape probe.
              if (!isContainerTraced(value) && isServerContent(value)) continue;
              // Containers (at any depth) ride the record as trace envelopes;
              // everything else passes through by reference.
              args[key] = toBorderForm(value, true);
            }
            // A CLONE serializes; `args` stays canonical for the ledger
            // below — re-emissions mutate it and clone again, so the
            // initial record can never change under a consumer.
            sharedConfig.context.serialize(`sc:slot:${frameId}:${occurrence}`, { ...args });
            for (const region of unused) {
              // Lock BEFORE returning: the content is now committed to the data
              // channel, so any later async placement of this region must
              // suppress its markup (see the thunk above) — that is what makes
              // "serialize once at flush" a guarantee rather than a race.
              region.locked = true;
              // Resolve the region's server content through the live render
              // context. Sync content serializes directly; async content
              // serializes as a PROMISE of its final html — the hydration
              // serializer holds the stream and patches the record when it
              // settles (resolveRegionHtml re-pulls holes as their promises
              // land, the resolveRootHoles shape).
              sharedConfig.context.serialize(
                `sc:region:${region.childId}`,
                resolveRegionHtml(sharedConfig.context, region.value)
              );
            }
            // The document arg ledger (DR-2 case 1 at t=0): every
            // re-runnable arg that classified as DATA opens a watched
            // binding AFTER its record emitted, mirroring the stream face —
            // the same authored getter shape stays live on both faces. Only
            // on an armed document (live.args): the hostless fallback
            // latches, like everything else at t=0.
            if (liveArgs) {
              for (const key of Object.keys(evals)) {
                if (regions.some(r => r.key === key)) continue;
                if (minted[key]) continue; // scope-minting eval: latched
                const ledgerKey = `${frameId}:${occurrence}:${key}`;
                openArgBinding(
                  liveArgs,
                  ledgerKey,
                  occurrence,
                  key,
                  evals[key],
                  states[key],
                  value => {
                    args[key] = toBorderForm(value, true);
                    liveArgs.slot(frameId, occurrence, { ...args });
                  }
                );
              }
            }
          }
          return out;
        };
        // A slot getter placed directly as a child (`{props.children}`) is a
        // function-shaped hole; the tag opts it out of live-hole marking the
        // same way it does on the stream face (the impurity gates would
        // latch it anyway — this makes it exact rather than incidental).
        fn.$lhSkip = true;
        // The claim brand (Stage 6): a stub placed in a ref/on* position
        // instead of being called claims by prop name — `ssrClaim` reads
        // this to mint `_bnd`.
        fn[CLAIM_PROP] = prop;
        getters.set(prop, fn);
      }
      return fn;
    }
  });
}

// The boundary element vocabulary — the t=0 DOM contract with the client
// consumer (frame-client.js `FRAME_TAG`/`FRAME_ID_ATTR`, which creates and
// adopts the same element). The boundary is an element, not a comment range:
// a first-class node the client adopts by attribute query and that `insert`
// places natively (see docs/frame-seams-decision.md). Kept in sync with the
// consumer by convention — the two don't share a module (server-only vs
// client-only). `display:contents` keeps it layout-transparent.
const FRAME_TAG = "solid-frame";
const FRAME_ID_ATTR = "data-fid";

/** Open tag for a boundary/region element with `id`. `id` is developer-owned
 *  (a server-function id), but attribute-escaped defensively. */
function frameElementOpen(id) {
  const escaped = sharedConfig.context ? sharedConfig.context.escape(String(id), true) : String(id);
  return `<${FRAME_TAG} ${FRAME_ID_ATTR}="${escaped}" style="display:contents">`;
}
const FRAME_ELEMENT_CLOSE = `</${FRAME_TAG}>`;

/**
 * The document face's live-hole plumbing (Stage 4): one engine per document
 * render, armed lazily by the first server component that renders inline.
 *
 * The engine is the same Stage 3 ledger the stream face runs — what changes
 * is the sink (ops ride ONE `sc:live` hydration record whose value is a
 * ReadableStream the data scripts keep feeding) and the arming scope (the
 * engine gates minting on the server-component context barrier, so plain
 * document content keeps its t=0 latch and its exact bytes). The record
 * serializes EAGERLY at arming: nothing re-notifies an adopted boundary
 * about a late `_$HY.r` key, so the channel must exist in the data scripts
 * before adoption drains — an empty closed stream costs a few bytes on
 * documents whose holes never re-emit.
 *
 * The commit funnel is the adapter's own microtask sweep: the reactive core
 * pokes `ctx.commit` at async settles (and pumps iterator memos only while
 * it exists), exactly as on the stream face. `ctx.live.end` is the response
 * latch — `flushEnd` runs it before the serializer flush: one final sweep
 * ships last values, then the channel closes (an open stream would hold the
 * response forever).
 *
 * CONTEXT GEOMETRY: components render under per-component context CLONES,
 * so the ctx a server component arms under is usually not the root object
 * the renderer's flush loop reads. Everything read DOWNWARD (`liveHoles`,
 * `commit` — consumed by the subtree under the arm point) rides the clone:
 * descendants spread-copy it. Everything read at the ROOT (the end latch,
 * and the once-per-document arming dedupe — a second component elsewhere
 * arms under a sibling clone that never saw the first) rides `ctx.live`,
 * the shared slot the root context creates and every clone carries by
 * reference.
 */
function armDocumentLiveHoles(ctx) {
  if (!ctx || ctx.liveHoles !== undefined) return;
  const live = ctx.live;
  // A second server component under a fresh clone: adopt the document's
  // already-armed engine (or its already-decided latch).
  if (live && live.holes !== undefined) {
    ctx.liveHoles = live.holes;
    if (live.holes) {
      ctx.commit = live.commit;
      ctx.commitEpoch = live.commitEpoch;
    }
    return;
  }
  // Sync renders (no streaming serializer / no shared slot), noScripts
  // documents (no data channel), and hostless environments latch at t=0:
  // mark nothing. `null` records the decision (the arming checks are
  // `!== undefined`).
  if (
    !live ||
    !ctx.async ||
    ctx.noHydrate ||
    !ctx.serialize ||
    typeof ReadableStream !== "function"
  ) {
    ctx.liveHoles = null;
    if (live) live.holes = null;
    return;
  }
  const bindings = new Map();
  let epoch = 0;
  let sweepScheduled = false;
  let closed = false;
  const sweep = () => {
    epoch++;
    for (const b of [...bindings.values()]) {
      try {
        b.sweep();
      } catch (_) {
        // A sweep failure must not take the document down: the binding's
        // last emitted value stands.
      }
    }
  };
  const scheduleSweep = () => {
    if (closed || sweepScheduled || !bindings.size) return;
    sweepScheduled = true;
    queueMicrotask(() => {
      sweepScheduled = false;
      if (!closed) sweep();
    });
  };
  let channel;
  ctx.serialize(
    "sc:live",
    new ReadableStream({
      start(c) {
        channel = c;
      }
    })
  );
  const push = op => {
    if (!closed) channel.enqueue(op);
  };
  ctx.liveHoles = live.holes = createLiveHoles(
    {
      openBinding(key, b) {
        bindings.set(key, b);
      },
      closeBinding(key) {
        bindings.delete(key);
      },
      // Every emission carries its digest on every face (§9.5, Hole
      // hashes) — the document channel's ops included, so a ledger seeded
      // from the document can follow what the channel later re-emits.
      hole(key, html) {
        push({ type: "hole", key, html, digest: textDigest(html) });
      },
      attr(key, attrs, removed) {
        const op = { type: "attr", key, attrs, digest: textDigest(attrs) };
        if (removed && removed.length) op.removed = removed;
        push(op);
      },
      error(key, error) {
        push({ type: "error", key, error });
      },
      commit: scheduleSweep,
      get epoch() {
        return epoch;
      }
    },
    /* scoped */ true
  );
  ctx.commit = live.commit = scheduleSweep;
  ctx.commitEpoch = live.commitEpoch = () => epoch;
  // The document ARG ledger (DR-2 case 1 at t=0): slot-props invocations
  // open watched-arg bindings into the same sweep set as the holes, and a
  // re-emission ships the occurrence's whole record as a `slot` op on the
  // same channel — values ride inline (the hydration serializer carries
  // objects and promises natively; no versioned-ref indirection like the
  // codec's). Store-keyed rather than geometry-routed, so ops carry the
  // producing frame's id and only the owning boundary applies them.
  // The arg-binding sink for the document face: same `openBinding`/
  // `closeBinding`/`commit` surface as the stream sink, so `openArgBinding`
  // serves both faces (only the emit strategy differs at the call sites).
  live.args = {
    openBinding(key, b) {
      bindings.set(key, b);
    },
    closeBinding(key) {
      bindings.delete(key);
    },
    slot(fid, occurrence, args) {
      push({ type: "slot", fid, key: occurrence, args });
    },
    commit: scheduleSweep
  };
  live.end = () => {
    if (closed) return;
    if (bindings.size) sweep();
    closed = true;
    channel.close();
  };
} /**
 * The in-process mirror of `frameTransformResult` for DOCUMENT SSR: install
 * as `configureServerFunctionsServer({ transformDirectResult })` and a
 * direct (same-process) server-function result that is a function comes back
 * as an inline-renderable server component (frame markers + document
 * slot props), branded with its function id and the call's wire address.
 * Non-function results pass through.
 * @experimental
 */
export function frameTransformDirectResult<T>(
  value: T,
  options: { id: string; args?: unknown[] }
): T;

/**
 * The in-process mirror of `frameTransformResult`, for DOCUMENT SSR:
 * install as `configureServerFunctionsServer({ transformDirectResult })`
 * and a server function whose direct (same-process) call resolves to a
 * function comes back as an inline-renderable server component — the boundary
 * ELEMENT around it, document-mode slot props inside. HTTP calls are
 * untouched (`frameTransformResult` owns that leg).
 */
export function frameTransformDirectResult(value, { id, args }) {
  if (typeof value !== "function") return value;
  const component = value;
  const wrapped = props => [
    { t: frameElementOpen(id) },
    // Slot props are created OUTSIDE the context barrier: their zone owner
    // (captured at proxy creation) is what client positions re-enter, so
    // the client's content keeps full app context while the component's
    // own render is context-isolated.
    serverOwned(() => {
      armDocumentLiveHoles(sharedConfig.context);
      // Behavior claims (Stage 6): arm the compiled guard for this subtree
      // (descendant context clones spread-copy it). Minting is additionally
      // scope-gated inside ssrClaim, so client fill content — which
      // re-enters the zone owner outside the component barrier — neither
      // claims nor warns.
      sharedConfig.context.claims = CLAIMS_DOCUMENT;
      const slotProps = createDocumentSlotProps(props, id);
      // A `live` answer (the declaration's in-process brand lands on this
      // wrapper after it is made, before it renders) marks the scope live:
      // every async source inside takes its first value and closes — the
      // document completes, and the standing render is the client's
      // connection after hydration (RFC 11 §9.5, Server face 3). Read at
      // render, not at wrap: the brand arrives from `live`, outside.
      return serverComponentScope(() => component(slotProps), !!wrapped[LIVE_SOURCE]);
    }),
    { t: FRAME_ELEMENT_CLOSE }
  ];
  // Branded so the hydration serializer can write it as a reference (see
  // ServerComponentPlugin) instead of meeting an unserializable function.
  wrapped[SERVER_COMPONENT] = id;
  // The wrap is for rendering INLINE in a document. A direct call also
  // happens where there is no document — collecting single-flight data, where
  // the component becomes a region in a frame stream instead — so the
  // original stays reachable for that producer to render on its own terms,
  // under the address the calling client derived for the same call.
  wrapped[SERVER_COMPONENT_SOURCE] = component;
  wrapped[SERVER_COMPONENT_ADDRESS] = frameAddress(id, args);
  return wrapped;
}

/**
 * Resolves server content to its final html, riding out async holes: waits
 * each pass's promises, re-pulls the holes, splices — recursively, since a
 * re-pulled hole can yield further holes. Returns the html directly when
 * everything is sync (no promise wrapper on the common path).
 */
function resolveRegionHtml(ctx, node) {
  const res = ctx.resolve(node);
  if (!res || !res.t) return String(res ?? "");
  if (!res.h || !res.h.length) return res.t[0];
  return Promise.all(res.p).then(() => {
    let out = Promise.resolve(res.t[0]);
    for (let i = 0; i < res.h.length; i++) {
      const hole = res.h[i];
      const tail = res.t[i + 1];
      out = out.then(acc =>
        Promise.resolve(resolveRegionHtml(ctx, hole)).then(part => acc + part + tail)
      );
    }
    return out;
  });
}

/**
 * The props proxy handed to a server component. Every prop resolves to a
 * function (SSR hole resolution invokes child-position functions with no
 * arguments, so one shape serves both uses):
 *
 *  - invoked with no args (child position — `{props.children}`): renders as
 *    the direct-insert marker range for the prop. Stable per prop; placing
 *    the same prop twice repeats the same occurrence id and the consumer
 *    mounts the first range found.
 *  - invoked with an args object (render prop — `props.item({...})`): emits
 *    a `slot` chunk for a fresh `prop#N` occurrence and renders as that
 *    occurrence's marker range. Primitive args pass literally; other values
 *    serialize under `arg:<occurrence>:<key>` ids (referential dedupe across
 *    occurrences comes from the codec's shared refs — the no-double-data
 *    invariant at the args level).
 *
 * Serialization goes through the live render context, so the proxy must
 * only be *used* during the frame's render.
 */
/** Whether a slot-arg value is server JSX: an SSR template object, or an
 *  array made entirely of them (compiled children lists). */
function isServerContent(value) {
  if (value && typeof value === "object") {
    if ("t" in value) return true;
    if (Array.isArray(value) && value.length > 0) {
      for (const item of value) {
        if (!(item && typeof item === "object" && "t" in item)) return false;
      }
      return true;
    }
  }
  return false;
}

/** Bounded thunk unwrap: resolve nested thunks/memos to their value. */
function unwrapThunks(value) {
  for (let d = 0; typeof value === "function" && d < 16; d++) value = value();
  return value;
}

/** The DR-3 rule-1 rejection: async slot args are data-only. */
function contentArgError(key, occurrence) {
  return new Error(
    "Async slot arg resolved to JSX (arg '" +
      key +
      "' of " +
      occurrence +
      "). Async args must resolve to serializable values; render async content through a boundary instead."
  );
}

/**
 * The arg-level markup-hole retry loop (DR-2 value tier): a slot arg whose
 * evaluation threw not-ready ships as this pending promise, re-evaluated
 * each time the blocking async settles until an evaluation succeeds — then
 * the promise resolves with that value and seroval's streaming
 * serialization patches the record's data ref. A retry that throws a real
 * error rejects the promise (the client `Loading` covering the consumption
 * read errors instead of hanging). Retries run under the evaluation's
 * owner, like `buildAsyncWrap`'s markup holes, so context reads inside the
 * getter keep resolving. `onSettle` fires before the resolve — the watched
 * binding (case 1) syncs its last-value there, and the settle doubles as a
 * commit for the rest of the ledger.
 */
function retryArgUntilSettled(evaluate, blocked, key, occurrence, onSettle) {
  const owner = getOwner();
  return new Promise((resolve, reject) => {
    const retry = () => {
      try {
        const value = owner ? runWithOwner(owner, evaluate) : evaluate();
        if (isServerContent(value)) {
          // DR-3 rule 1: markup emission is long past by the time this
          // settles — there is no placeholder to fill retroactively.
          reject(contentArgError(key, occurrence));
          return;
        }
        if (onSettle) onSettle(value);
        resolve(value);
      } catch (err) {
        const next = ssrHandleError && ssrHandleError(err);
        if (next) next.then(retry, retry);
        else reject(err);
      }
    };
    blocked.then(retry, retry);
  });
}

/**
 * A watched-arg binding (DR-2 case 1): the ledger entry for one re-runnable
 * slot arg, shared by BOTH faces. Opened after the occurrence's record
 * emits; the sink sweeps it at every commit until the response completes. A
 * sweep re-evaluates the arg under its render owner and, reference-equality
 * gated, re-emits the occurrence's record through `emit` — the per-face
 * transport strategy:
 *
 *   - stream face: scalars ride the record literally; objects mint a
 *     VERSIONED ref (`arg:<occ>:<key>@<n>` — data refs are write-once in
 *     the codec) and serialize the new value;
 *   - document face: values ride INLINE in a fid-tagged `slot` op on the
 *     `sc:live` channel — the hydration serializer carries objects and
 *     promises natively per chunk, so there is no ref indirection.
 *
 * Shared semantics regardless of face:
 *
 *   - settled -> not-ready re-enters pending-with-previous: the emitted
 *     pending promise is settled by the retry loop while the client's read
 *     suspends holding its latest value;
 *   - a real error is terminal: the arg re-ships rejected (the client read
 *     throws into its covering boundary, diagnosably) and the binding
 *     closes, mirroring the retry loop's rejection semantics;
 *   - a re-evaluation producing JSX is the DR-3 rule-1 violation, rejected
 *     with the same diagnostic as the retry loop.
 *   - a re-evaluation that CREATES reactive scopes (scopeStamp moved —
 *     e.g. a projection minted inline in the arg expression) closes the
 *     binding and discards the minted duplicate: the expression is not
 *     idempotently re-runnable, and the scope its first render shipped
 *     carries its own liveness. The same latch the live-holes engine
 *     applies to owner-creating holes.
 *
 * Pending bindings don't sweep — the retry loop owns their progress and its
 * settle re-arms the ledger (`state` is shared with the retry's onSettle).
 * Record re-emissions clone the canonical args object so in-process
 * consumers (tests, same-tab transports) never see later mutations through
 * an already-delivered chunk.
 */
function openArgBinding(sink, ledgerKey, occurrence, key, evaluate, state, emit) {
  const owner = getOwner();
  sink.openBinding(ledgerKey, {
    sweep() {
      if (!state.settled) return;
      let value;
      const stampBefore = scopeStamp();
      try {
        value = owner ? runWithOwner(owner, evaluate) : evaluate();
      } catch (err) {
        const blocked = ssrHandleError && ssrHandleError(err);
        if (!blocked) {
          sink.closeBinding(ledgerKey);
          emit(Promise.reject(err instanceof Error ? err : new Error(String(err))));
          return;
        }
        if (scopeStamp() !== stampBefore) {
          // The re-evaluation minted reactive scopes before blocking: arming
          // the retry loop would mint MORE per retry. Latch on the value
          // already shipped instead.
          sink.closeBinding(ledgerKey);
          return;
        }
        state.settled = false;
        emit(
          retryArgUntilSettled(evaluate, blocked, key, occurrence, v => {
            state.settled = true;
            state.last = v;
            sink.commit();
          })
        );
        return;
      }
      if (scopeStamp() !== stampBefore) {
        // Scope-minting evaluation (first render pre-dated the gate, or the
        // expression turned impure): the minted value is a DUPLICATE scope,
        // not an update — discard it and latch, exactly as the live-holes
        // engine latches owner-creating holes.
        sink.closeBinding(ledgerKey);
        return;
      }
      if (value === state.last) return;
      state.last = value;
      if (isServerContent(value)) {
        sink.closeBinding(ledgerKey);
        emit(Promise.reject(contentArgError(key, occurrence)));
        return;
      }
      emit(value);
    }
  });
} /**
 * The slot props proxy used by `renderServerComponent`. Every key
 * virtually exists (`in` is always true — a prop is a position the client
 * may fill), enumeration is empty by design, and serialization goes through
 * the live render context, so it must only be used during the frame's
 * render.
 * @internal Exposed for framework bindings composing their own producers.
 * @experimental
 */
export function createSlotProps(
  sink: ReturnType<typeof createFrameSink>,
  frame: FrameAddress
): Record<string, any>;

export function createSlotProps(sink, frame) {
  const counts = Object.create(null);
  const getters = new Map();
  return new Proxy(Object.create(null), {
    // Every key virtually exists — a prop is a *position* the client may
    // fill, and the server cannot know which ones the client supplied. This
    // is what routes reactive-core merge utilities down their proxy path
    // ($PROXY in source) and resolves per-property lookups (property in s)
    // to us; it also means merged defaults never override a slot —
    // correct, since slot fallbacks belong to the client slot.
    // Enumeration stays empty by nature (positions aren't listable), so
    // spreads copy nothing: server components should read props directly.
    has() {
      return true;
    },
    get(_, prop) {
      if (typeof prop !== "string") return undefined;
      // `has: true` + callable gets would otherwise make the proxy thenable
      // — a stray await/Promise.resolve would "call" a phantom then slot.
      if (prop === "then") return undefined;
      let fn = getters.get(prop);
      if (!fn) {
        fn = (...callArgs) => {
          if (callArgs.length === 0 || callArgs[0] === undefined) {
            return slotRange(prop);
          }
          // Slot records are emit-once: occurrence identity is positional
          // (`counts`), so a live-hole re-evaluation reaching a called slot
          // would mint new occurrences and re-serialize args — the double-
          // data disease. First render stamps the engine so the enclosing
          // hole latches instead of binding; a sweep that gets here anyway
          // (the escalated-first-render case) aborts and closes the binding.
          const live = sharedConfig.context && sharedConfig.context.liveHoles;
          if (live) {
            if (live.sweeping) {
              live.gateHit = true;
              return { t: "", $slot: true };
            }
            live.recordStamp++;
          }
          const raw = callArgs[0];
          // Occurrence identity (RFC open question 1): a primitive `$key` arg
          // names the occurrence, so client state follows the entity across
          // responses — the slot-level analogue of For's `keyed`
          // function, for the case where references can't carry identity
          // (every response re-creates everything). Without it, identity is
          // positional per prop — the right default for most flows: a state
          // reset across different lists is usually correct, and equivalent
          // re-sends dedupe anyway. `$key` matters when a live list reorders.
          const occurrence = occurrenceId(prop, raw, counts);
          const args = {};
          // Watched-arg bindings to open AFTER the record emits (the ledger
          // must never re-emit a record ahead of its first emission).
          const opened = [];
          for (const key of Object.keys(raw)) {
            if (key === "$key") continue; // occurrence identity, not client data
            // Region ids derive from occurrence + arg name — stable across
            // responses (allocation order isn't), so a later stream's region
            // content routes to the same bound region and morphs in place, and
            // keyed dedupe holds under reorders. Known before we resolve, so
            // any Suspense boundary the arg renders can tag its fragment to it.
            const childId = `${frame.id}.${occurrence}.${key}`;
            const ctx = sharedConfig.context;
            // A Suspense inside this arg registers its fragment as it renders —
            // during the unwrap below (an eager component thunk) or the resolve
            // (a deferred hole). Route those fragments to the region for the
            // whole window: the arg may not classify as content, but only
            // server content registers fragments, so a stray tag is inert.
            const origRegister = ctx.registerFragment;
            ctx.registerFragment = (fragKey, fragOptions) => {
              sink.tagRegion(fragKey, childId);
              return origRegister.call(ctx, fragKey, fragOptions);
            };
            try {
              // A function cannot be serialized, so a function-valued arg must
              // be a thunk producing content (or a getter producing a scalar):
              // resolve it one-shot, then classify the result. This is how
              // top-level one-shot reactive control flow (<For>/<Show>) reaches
              // the content path when it arrives as a thunk/memo rather than an
              // eager node. Bounded against a pathological self-returning fn.
              //
              // The evaluator is captured from the property DESCRIPTOR, not
              // the property read: compiled JSX props are getters (evaluation
              // happens at the read itself, so a not-ready `raw[key]` inside
              // the catch would throw again), while author thunks and memos
              // arrive as function values. Either shape yields a re-runnable
              // `evaluate` — the handle both the retry loop and the watched
              // binding (case 1) re-run.
              const desc = Object.getOwnPropertyDescriptor(raw, key);
              let evaluate = null;
              let value;
              // Shared with the retry loop's onSettle and the binding's
              // sweeps: whether the arg has a successful value, and which.
              let state = null;
              const stampBefore = scopeStamp();
              try {
                if (desc.get) {
                  const get = desc.get;
                  evaluate = () => unwrapThunks(get.call(raw));
                  value = evaluate();
                } else {
                  value = desc.value;
                  if (typeof value === "function") {
                    const fn = value;
                    evaluate = () => unwrapThunks(fn);
                    value = evaluate();
                  }
                }
              } catch (err) {
                // DR-2 value tier: a not-ready evaluation (an async memo, or a
                // getter reading one) never holds the record and never kills
                // the stream — the arg ships NOW as a pending promise and the
                // markup-hole retry loop runs at the arg level: re-evaluate
                // when the blocking async settles, settle the promise at the
                // first successful evaluation. The client suspends at the
                // consumption read, not here.
                const blocked = ssrHandleError && ssrHandleError(err);
                if (!blocked) throw err;
                state = { settled: false, last: undefined };
                const pendingState = state;
                value = retryArgUntilSettled(evaluate, blocked, key, occurrence, v => {
                  pendingState.settled = true;
                  pendingState.last = v;
                  // The settle is a commit: other watched args may read the
                  // same source. (This binding's own re-emission stays gated
                  // on inequality with the value just recorded.)
                  sink.commit();
                });
              }
              // Snapshot BEFORE classification: resolve/serialize below may
              // create scopes of their own, which say nothing about the
              // expression's re-runnability.
              const mintedEval = scopeStamp() !== stampBefore;
              const t = typeof value;
              if (value == null || t === "string" || t === "number" || t === "boolean") {
                args[key] = value;
                if (evaluate) state = { settled: true, last: value };
              } else if (!isContainerTraced(value) && isServerContent(value)) {
                // Containers fall through to the data path below (their
                // serialization is the trace plugin's), and the guard keeps a
                // store whose state has a `t` key out of the content path.
                // Server JSX flows as a nested region, never as data — the
                // no-double-serialize invariant (transport dispatch case 1):
                // its html is the transfer; the client wraps the range without
                // re-rendering it. Nested occurrence markers evaluated inside
                // this content already emitted their slot chunks against this
                // frame — the consumer threads record lookup up the frame tree.
                const resolved = ctx.resolve(value);
                if (resolved.h.length) {
                  // A Suspense boundary keeps its async out of `h` (it catches,
                  // renders a fallback, and streams its fragment — now routed
                  // to the region). A residual hole here is a BARE async read
                  // with no boundary: nothing to show while it settles, and no
                  // fragment to reveal into.
                  throw new Error(
                    "Async server content in a slot arg needs a boundary (arg '" +
                      key +
                      "' of " +
                      occurrence +
                      "). Wrap the async read in a <Suspense>, or move it above the slot."
                  );
                }
                sink.region(childId, resolved.t[0]);
                args[key] = { $frame: childId };
              } else {
                const ref = `arg:${occurrence}:${key}`;
                // Containers (at any depth) swap for their trace envelopes
                // before the value meets seroval — see toBorderForm.
                ctx.serialize(ref, toBorderForm(value, true));
                args[key] = { $ref: ref };
                if (evaluate && !state) state = { settled: true, last: value };
              }
              // A re-runnable arg that classified as DATA (settled or
              // pending) is a watched binding — case 1's within-response
              // liveness. Content args stay one-shot: a thunk producing JSX
              // was the control-flow handoff into the region path, and
              // regions have their own update story (DR-3). An eval that
              // minted reactive scopes latches instead (see scopeStamp).
              if (evaluate && state && !mintedEval) opened.push({ key, evaluate, state });
            } finally {
              ctx.registerFragment = origRegister;
            }
          }
          // Deliver a CLONE and keep the canonical object for the ledger:
          // re-emissions mutate `args` and clone again, so an in-process
          // consumer's already-applied record never changes under it.
          sink.slot(occurrence, { ...args });
          const ctx = sharedConfig.context;
          for (const b of opened) {
            const key = b.key;
            const ledgerKey = `${occurrence}:${key}`;
            openArgBinding(sink, ledgerKey, occurrence, key, b.evaluate, b.state, value => {
              const t = typeof value;
              if (value == null || t === "string" || t === "number" || t === "boolean") {
                args[key] = value;
              } else {
                const ref = `arg:${occurrence}:${key}@${sink.nextArgRef(ledgerKey)}`;
                sink.mintRef(ref);
                ctx.serialize(ref, toBorderForm(value, true));
                args[key] = { $ref: ref };
              }
              sink.slot(occurrence, { ...args });
            });
          }
          return slotRange(occurrence);
        };
        // A slot getter placed directly as a child (`{props.children}`) is a
        // function-shaped hole; the tag opts it out of live-hole marking the
        // same way `$slot` opts out its returned range.
        fn.$lhSkip = true;
        // The claim brand (Stage 6): see createDocumentSlotProps — same
        // contract on the stream face.
        fn[CLAIM_PROP] = prop;
        getters.set(prop, fn);
      }
      return fn;
    }
  });
}

/**
 * A server component as an HTTP Response: `renderServerComponent`'s chunk
 * stream, framed with the server-function wire convention (length-prefixed
 * JSON — see frame-transport.js for the reader). Tagged with
 * `X-Frame-Stream: <frame id>` for the client and `X-Content-Raw` so the
 * server-function handler forwards it untouched instead of codec-encoding
 * it. `init` (headers/status, e.g. from a `respond()` envelope) merges in;
 * the frame tags win on conflict.
 */
// Copy a response-init's headers preserving multiple `Set-Cookie` values:
// Headers-to-Headers copying through the constructor folds them into one
// comma-joined entry on some runtimes (a folded Set-Cookie is corrupt).
// Plain-object inits cannot carry duplicates and pass through as-is.
function copyInitHeaders(init) {
  if (!init || !init.getSetCookie) return new Headers(init);
  const headers = new Headers();
  init.forEach((value, key) => {
    if (key !== "set-cookie") headers.append(key, value);
  });
  for (const cookie of init.getSetCookie()) headers.append("Set-Cookie", cookie);
  return headers;
} /**
 * A server component as an HTTP Response: the chunk stream framed with the
 * server-function wire convention — length-prefixed, or as server-sent
 * events when `options.live` says a `live` loop is reading — tagged
 * `X-Frame-Stream: <frame id>` for the client and `X-Content-Raw` so the
 * server-function handler forwards it untouched. `init` (headers/status,
 * e.g. from a `respond()` envelope) merges in; the frame tags win on
 * conflict.
 * @experimental
 */
export function serverComponentResponse(
  component: (props: Record<string, any>) => unknown,
  options?: FrameStreamOptions,
  init?: { headers?: HeadersInit; status?: number }
): Response;

export function serverComponentResponse(component, options = {}, init = {}) {
  const { id = "", version = 1 } = options.frame || {};
  const live = !!options.live;
  const headers = copyInitHeaders(init.headers);
  headers.set(FRAME_STREAM_HEADER, id);
  headers.set("X-Content-Raw", "1");
  // A live loop's answer rides in event-stream framing (the same framing the
  // codec stream takes at the live address; see `encodeLiveResult`): one
  // chunk per `data:` event, `no-store` (a standing answer is a moment, not
  // a cacheable value), `X-Accel-Buffering: no` for proxies that buffer by
  // default. The client picks its reader off the content type; the chunks
  // themselves are the same records either way.
  if (live) {
    headers.set("Content-Type", "text/event-stream");
    headers.set("Cache-Control", "no-store");
    headers.set("X-Accel-Buffering", "no");
  } else headers.set("Content-Type", "application/x-frame-stream");
  const frame = live ? createEventChunk : createChunk;
  // The render lives as long as someone reads the response. A client
  // disconnect reaches this body as `cancel()`; the host's request abort
  // reaches it as `options.signal` (the request's, from
  // `frameTransformResult`). Either tears the render down through
  // `renderToStream`'s own disconnect path — in-flight reactive work is
  // disposed, every async source still being pulled is returned, holds are
  // released — instead of letting it produce for nobody until its sources
  // happen to end. A frame render's emission never touches the document
  // writable, so without this the render could not learn its reader was
  // gone.
  const teardown = new AbortController();
  const disarm = followSignal(options.signal, teardown);
  const stream = renderServerComponent(component, {
    ...options,
    signal: teardown.signal,
    frame: { id, version }
  });
  // Writes after the reader is gone must drop, not throw: an ERR_INVALID_STATE
  // escaping through a serializer flush is an unhandled process-level error.
  let closed = false;
  // The live body's heartbeat and dev chaos (see armLiveBody); disarmed on
  // every road the body ends by.
  let stopLive = null;
  const body = new ReadableStream({
    start(controller) {
      const end = () => {
        if (closed) return;
        closed = true;
        disarm();
        if (stopLive) stopLive();
        try {
          controller.close();
        } catch (_) {}
      };
      // A torn-down render never ends its sink (nobody is listening), so the
      // body closes here when the abort came from the request rather than
      // from this body's own cancel — including a request gone before the
      // body was ever read.
      if (teardown.signal.aborted) return end();
      teardown.signal.addEventListener("abort", end, { once: true });
      // Chaos ends the body as a dying connection would: the render is torn
      // down first (its sources returned, as on a real disconnect), then
      // the body errors with the frame still open — a death to the reader.
      if (live)
        stopLive = armLiveBody(controller, () => {
          closed = true;
          disarm();
          teardown.abort();
        });
      stream.pipe({
        write(chunk) {
          if (closed) return;
          try {
            controller.enqueue(frame(JSON.stringify(chunk)));
          } catch (_) {
            closed = true;
          }
        },
        end
      });
    },
    cancel() {
      closed = true;
      disarm();
      if (stopLive) stopLive();
      teardown.abort();
    }
  });
  return new Response(body, { status: init.status || 200, headers });
}

/**
 * Chain an upstream signal (the request's) into a response's own teardown
 * controller. Returns the disarm for the upstream listener, so a response
 * that completes does not hold a closure on the request past its own end.
 */
function followSignal(upstream, controller) {
  if (!upstream) return () => {};
  if (upstream.aborted) {
    controller.abort(upstream.reason);
    return () => {};
  }
  const forward = () => controller.abort(upstream.reason);
  upstream.addEventListener("abort", forward, { once: true });
  return () => upstream.removeEventListener("abort", forward);
} /**
 * The server-component convention as a `transformResult` policy for
 * `handleServerFunctionRequest`: a function result — or a `respond()`
 * envelope whose value is a function — becomes a frame-stream Response,
 * with the frame id defaulting to the server function's id so repeat calls
 * target the same client boundary. Everything else passes through.
 *
 * @example
 * ```ts
 * handleServerFunctionRequest(request, {
 *   transformResult: frameTransformResult,
 *   provideEvent
 * });
 * ```
 * @experimental
 */
export function frameTransformResult(event: unknown, result: unknown): unknown;

/**
 * The server-component convention as a `transformResult` policy for
 * `handleServerFunctionRequest`: **a function returned from a server
 * function is a server component** — it renders as a frame-stream Response
 * (frame id defaulting to the server function's id, so repeat calls target
 * the same client boundary and policy A morphs in place). A `respond()`
 * envelope whose value is a function contributes its headers/status to the
 * frame Response. Everything else passes through untouched.
 *
 * A single-flight call is the exception: the component stays a component
 * here, because the mutation's markup is only one part of the payload and
 * the whole stream is assembled once flight data is in hand
 * (`frameTransformFlightResult`). Building a Response now would commit to a
 * body that can no longer take the invalidated regions or the outcome.
 */
export function frameTransformResult(event, result, context) {
  let init;
  if (isResponseEnvelope(result)) {
    const { response, value } = result;
    if (typeof value !== "function") return result;
    init = response ? { headers: response.headers, status: response.status } : undefined;
    result = value;
  }
  if (typeof result !== "function") return result;
  if (context && context.collectsFlight) return init ? { response: init, value: result } : result;
  const invocation = getEventServerFunctionInvocation(event);
  const live = !!(invocation && invocation.live);
  // A live loop's reconnect names what it holds (the have-list header,
  // §9.5 Resume request): the render is conditional against it. Read only
  // at the live address — the header never rides a cacheable read.
  const have = live ? decodeHaveList(requestHeader(event, FRAME_HAVE_HEADER)) : undefined;
  return serverComponentResponse(
    result,
    {
      frame: { id: (invocation && invocation.id) || "" },
      signal: requestSignal(event),
      // A call at the live address is a `live` loop's: frame the answer as
      // the event stream the loop reads (RFC 10, `live(fn)` → Framing).
      live,
      resume: have && { have }
    },
    init
  );
}

/** The request's abort, when the event carries a standards-shaped request. */
function requestSignal(event) {
  const request = event && event.request;
  return request && request.signal instanceof AbortSignal ? request.signal : undefined;
}

/** A request header, when the event carries a standards-shaped request. */
function requestHeader(event, name) {
  const request = event && event.request;
  const headers = request && request.headers;
  return headers && typeof headers.get === "function" ? headers.get(name) : null;
} /**
 * The frame half of single-flight, as a `transformFlightResult` policy for
 * `handleServerFunctionRequest`: when part of what a mutation invalidated is
 * markup (a component-valued flight-data entry), the frame stream carries
 * the whole payload — each component's content as a region addressed by its
 * call, the `{ value, data }` envelope as `outcome` chunks with the
 * component entries serialized as flight references. Returns `undefined`
 * when nothing invalidated is markup (the response stays the plain
 * single-flight envelope).
 * @experimental
 */
export function frameTransformFlightResult(
  event: unknown,
  outcome: { value: unknown; data: unknown },
  context?: unknown
): Promise<Response | undefined>;

/**
 * The frame half of single-flight, as a `transformFlightResult` policy: when
 * some of what a mutation invalidated is *markup*, the frame stream carries
 * the whole payload.
 *
 * `data` is the fold's keyed envelope, `{ [source]: slice }` — one slice per
 * flight-data source, the unnamed collector's under its reserved id "true"
 * (see `foldFlightData`). Markup lives one level down: a slice is an
 * integration's map of invalidated keys to values, and a component-valued
 * entry in it is not a different KIND of payload, just a different
 * representation of one. It stays in its slice like any other value —
 * serialized as a flight reference (see `ServerComponentPlugin`) that
 * resolves client-side to the very component the boundary showing that
 * call holds, so the integration seeds its cache through its ordinary path
 * and freshness falls out for free. Its CONTENT rides alongside as a region
 * addressed by the call (`frameAddress` — the one name both peers derive
 * independently), so markup travels as html exactly once and the envelope
 * carries only a pointer to it. The source keys are preserved: the client
 * routes each slice to its consumer by them, exactly as for a plain body.
 *
 * With nothing to frame this returns `undefined`, and the response is the
 * plain single-flight envelope, byte for byte.
 */
export async function frameTransformFlightResult(event, outcome, context) {
  const { value, data } = outcome;
  const regions = [];
  let serialized = data;
  if (data && typeof data === "object") {
    serialized = {};
    for (const source of Object.keys(data)) {
      const slice = data[source];
      // Only a keyed map is scanned: a slice can be any codec-serializable
      // value, and nothing but an integration's key -> value map holds
      // components. Everything else rides through untouched.
      if (!slice || typeof slice !== "object" || Array.isArray(slice)) {
        serialized[source] = slice;
        continue;
      }
      // Collected entries arrive unresolved (an integration's cache stores
      // the in-flight promise), and a value has to be in hand to know
      // whether it is markup. So a mutation's payload settles before its
      // response starts, where a data-only one streams as the codec
      // produces it — the cost of knowing what kind of thing each entry is.
      // A rejected entry keeps riding as its rejected promise: the codec's
      // failure guard sanitizes it for the client like any other, and one
      // failed key never costs the mutation's outcome or the other keys.
      const keys = Object.keys(slice);
      const settled = await Promise.allSettled(keys.map(key => slice[key]));
      const out = (serialized[source] = {});
      for (let i = 0; i < keys.length; i++) {
        const result = settled[i];
        const entry = result.status === "fulfilled" ? result.value : slice[keys[i]];
        if (typeof entry !== "function") {
          out[keys[i]] = entry;
          continue;
        }
        // A branded component (a direct call's result through
        // `frameTransformDirectResult`) carries its call address and the
        // component it wraps: the region is addressed by the call, and the
        // entry itself serializes as the reference. A BARE function — the
        // "a function is a server component" convention applied to a flight
        // entry — has no call to be addressed by, so its key is its address
        // (the one name the integration and this response share), and a
        // branded stand-in carries that address through the codec.
        const address = entry[SERVER_COMPONENT_ADDRESS] || keys[i];
        regions.push({ id: address, component: entry[SERVER_COMPONENT_SOURCE] || entry });
        if (SERVER_COMPONENT in entry) {
          out[keys[i]] = entry;
        } else {
          const reference = () => undefined;
          reference[SERVER_COMPONENT] = keys[i];
          reference[SERVER_COMPONENT_ADDRESS] = address;
          out[keys[i]] = reference;
        }
      }
    }
  }
  const invocation = getEventServerFunctionInvocation(event);
  // The called function's own markup keeps the function id as its address,
  // the same boundary a non-flight call targets.
  const primary =
    typeof value === "function"
      ? { id: (invocation && invocation.id) || "", component: value }
      : undefined;
  if (!primary && !regions.length) return undefined;
  return frameFlightResponse({
    primary,
    regions,
    outcome: {
      // The mutation's own return value is markup or data, never both: when
      // it is a component the client resolves it to that frame's component.
      value: primary ? undefined : value,
      data: serialized
    },
    codec: context && context.codec,
    signal: requestSignal(event)
  });
}

/**
 * A framed response carrying several frames and a single-flight outcome:
 * each frame's chunks in order (the host routes and buffers by id), then the
 * `{ value, data }` envelope as `outcome` chunks.
 *
 * Those chunks carry the codec's own nodes, one per chunk, so async values
 * inside flight data settle progressively exactly as they do in a plain
 * single-flight body — the consumer replays them into the same decoder.
 *
 * `signal` is the request's abort (`frameTransformFlightResult` passes it):
 * with the body's own `cancel`, either tears the frame in progress down and
 * ends the response.
 */
export function frameFlightResponse({ primary, regions = [], outcome, codec, signal }, init = {}) {
  const frames = primary ? [primary, ...regions] : regions;
  const headers = copyInitHeaders(init.headers);
  headers.set("Content-Type", "application/x-frame-stream");
  headers.set(FRAME_STREAM_HEADER, primary ? primary.id : "");
  headers.set("X-Content-Raw", "1");
  // The single-flight header is the FOLD's (`foldFlightData`): its value is
  // the folded source list the client routes slices by, which only the fold
  // knows — it stamps every body shape, this one included.
  // Same teardown as serverComponentResponse: this body's cancel and the
  // request's abort (`signal`) tear the frame in progress down and skip the
  // rest; post-cancel writes drop instead of throwing through a serializer
  // flush.
  const teardown = new AbortController();
  const disarm = followSignal(signal, teardown);
  let closed = false;
  const body = new ReadableStream({
    async start(controller) {
      const write = chunk => {
        if (closed) return;
        try {
          controller.enqueue(createChunk(JSON.stringify(chunk)));
        } catch (_) {
          closed = true;
        }
      };
      try {
        // Sequential: chunk order matters within a frame, not across them.
        for (const { id, component } of frames) {
          if (teardown.signal.aborted) break;
          // A torn-down render never ends its sink; the abort settles the
          // wait in its place.
          await new Promise(resolve => {
            teardown.signal.addEventListener("abort", resolve, { once: true });
            renderServerComponent(component, {
              frame: { id, version: 1 },
              signal: teardown.signal
            }).pipe({
              write,
              end: () => {
                teardown.signal.removeEventListener("abort", resolve);
                resolve();
              }
            });
          });
        }
        if (teardown.signal.aborted) {
          closed = true;
          try {
            controller.close();
          } catch (_) {}
          return;
        }
        if (outcome) {
          // Component-valued entries serialize as flight references — the
          // protocol injects its own plugin (see `flightCodec`), so nothing
          // registers it.
          // Guarded like every other server-function body: this sink has its
          // own serializer, so a rejection nested in flight data would
          // otherwise reach the wire with its message and own-properties
          // intact — under a 200, since the head is long committed.
          const reader = new ChunkReader(
            serializeStream(guardFailures(outcome), flightCodec(codec))
          );
          for (let node = await reader.next(); !node.done; node = await reader.next()) {
            write({ type: "outcome", payload: node.value });
          }
        }
        if (!closed) {
          closed = true;
          controller.close();
        }
      } catch (err) {
        if (!closed) {
          closed = true;
          controller.error(err);
        }
      } finally {
        disarm();
      }
    },
    cancel() {
      closed = true;
      disarm();
      teardown.abort();
    }
  });
  return new Response(body, { status: init.status || 200, headers });
}
