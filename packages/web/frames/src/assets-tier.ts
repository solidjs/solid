/**
 * `@solidjs/web/frames/assets` — the frames client's ASSETS tier (frames
 * savings pass §3 row C5): what a segment's `seg:<k>:assets` record does to
 * the document head, loaded on demand through the tier mechanism
 * (`prepareTier("assets")`, frame-client.ts).
 *
 * What rides in this chunk, and so leaves the eager frames client: the
 * import-free mirror of the client asset registry's head conventions
 * (`ensureStylesheet` / `ensurePreload` / `ensureModulePreload` /
 * `applyInlineStyles`, `findHeadElement`'s attribute-compared lookup and
 * head.ts's `qualifierValue`), the per-frame flush a pending stylesheet
 * wakes, and the assets pass over a record (modules, typed preloads, inline
 * styles). The eager client keeps the record itself (`chunkToRecords`'
 * `assets` case, the host's `seg::assets` accumulate), the pass's walk over
 * the store, and the reveal's READINESS TERM: a segment whose assets record
 * names stylesheets while this tier is not resident is not ready — the
 * server's `<Loading>` fallback stays on screen; the reveal happens at
 * max(tier load, stylesheet load) (frames savings pass §1, "assets": no
 * FOUC, no blank). A segment without stylesheets never waits on this tier:
 * modules, preloads and inline styles are not reveal-gating and apply when
 * the tier is resident — at the record's arrival, or at the install's flush.
 *
 * The module's exports ARE its dispatch: `prepareTier` stamps the load with
 * the module once it has resolved (`tierLoads.assets.r`), and the eager
 * client calls `gate` from `#segmentReady` and `apply` from `#flush`'s
 * assets walk off that stamp. No `install()`: the tier registers nothing
 * and imports nothing of the client — it needs no shared instance, only
 * the frame handed to `gate` (its `apply` is the flush a settled sheet
 * triggers).
 *
 * The server announces this tier wherever it emits an assets chunk
 * (`sink.needs("assets")` — the shell's pre-flush assets, a style-gated
 * fragment's, a late module / preload; frame-sink.ts): `X-Frame-Tiers` /
 * `chunk.tiers` on a stream, `_$HY.r["sc:tiers"]` + a `modulepreload` on a
 * document — so the load is a warm start; an un-announced record starts it
 * from the readiness check or the walk and the segment waits (the same DOM,
 * later).
 * @experimental
 */
import type { Frame } from "./frame-client.js";

/** A stylesheet entry as the sink writes it: a url, or `{ href, attrs }`. */
export type StylesheetEntry = string | { href: string; attrs?: Record<string, string> };
/** A typed preload entry (`<link rel="preload">`): request-qualifying attributes, optional href. */
export interface PreloadEntry {
  href?: string;
  attrs: Record<string, string>;
}
/** An inline style entry (`<style data-asset>`). */
export interface InlineStyleEntry {
  id: string;
  content?: string;
  attrs?: Record<string, string>;
}
/** The head-affecting members of a `seg:<k>:assets` record. */
export interface AssetsRecord {
  modules?: string[];
  styles?: StylesheetEntry[];
  inlineStyles?: InlineStyleEntry[];
  preloads?: PreloadEntry[];
}

// Minimal, import-free mirror of the client asset registry's conventions
// (client.js acquireAsset): data-asset ids for inline styles, attribute-
// compared lookup instead of selector interpolation, adopt elements already
// in the document. The Solid binding can swap in the ref-counted registry
// later; the gate only needs "are this segment's stylesheets loaded, and
// call me back when they settle".

// Mirrors head.ts without importing it into the standalone frame client.
const PRELOAD_QUALIFIERS = ["as", "crossorigin", "type", "media", "imagesrcset", "imagesizes"];

// Mirrors head.ts's qualifierValue — keep them in step. `as` folds ASCII
// case; an empty source set or size reads as absent (registration never
// emits one); `crossorigin` is three states, not a string range, so `""`, a
// bare attribute and `anonymous` are one request. Frame `attrs` are already
// canonical strings, but the document may carry any spelling.
function qualifierValue(name: string, value: string | null) {
  if (value == null) return null;
  if (name === "imagesrcset" || name === "imagesizes") return value === "" ? null : value;
  if (name === "as") return value.replace(/[A-Z]/g, c => String.fromCharCode(c.charCodeAt(0) + 32));
  if (name !== "crossorigin") return value;
  return value.length === 15 && value.toLowerCase() === "use-credentials"
    ? "use-credentials"
    : "anonymous";
}

/** Attribute-compared head lookup so href/id values never need escaping. */
function findHeadElement(
  selector: string,
  attr: string,
  value: string | null,
  qualifiers?: Record<string, string>
) {
  candidate: for (const node of document.head.querySelectorAll(selector)) {
    if (node.getAttribute(attr) !== value) continue;
    if (!qualifiers) return node;
    for (let i = 0; i < PRELOAD_QUALIFIERS.length; i++) {
      const name = PRELOAD_QUALIFIERS[i];
      if (
        qualifierValue(name, node.getAttribute(name)) !==
        qualifierValue(name, qualifiers[name] ?? null)
      )
        continue candidate;
    }
    return node;
  }
  return null;
}

/** Ensure one typed preload exists, preserving request-qualifying attributes. */
function ensurePreload(entry: PreloadEntry) {
  const attrs = entry.attrs;
  const href = entry.href;
  if (findHeadElement('link[rel="preload"]', "href", href || null, attrs)) return;
  const link = document.createElement("link");
  link.rel = "preload";
  for (const name in attrs) link.setAttribute(name, attrs[name]);
  if (href) link.setAttribute("href", href);
  document.head.appendChild(link);
}

/**
 * Ensure a stylesheet link exists and report whether it has settled. A link
 * this loader created tracks waiters until load/error (error unblocks too —
 * same policy as the document runtime's $dfc gate); a link that was
 * already in the document counts as settled. `entry` is a url string or an
 * attributed record `{ href, attrs }` (fetch-metadata attributes carried by
 * useHead stylesheets).
 */
function ensureStylesheet(entry: StylesheetEntry, onSettle: () => void) {
  const href = typeof entry === "string" ? entry : entry.href;
  let link = findHeadElement('link[rel="stylesheet"]', "href", href) as any;
  if (!link) {
    link = document.createElement("link");
    link.rel = "stylesheet";
    if (typeof entry !== "string" && entry.attrs) {
      for (const name in entry.attrs) link.setAttribute(name, entry.attrs[name]);
    }
    link.href = href;
    const waiters = new Set<() => void>();
    link._$frWaiters = waiters;
    const settle = () => {
      link._$frWaiters = null;
      for (const fn of waiters) fn();
    };
    link.addEventListener("load", settle);
    link.addEventListener("error", settle);
    document.head.appendChild(link);
  }
  const waiters = link._$frWaiters;
  if (waiters == null) return true; // settled, or document-owned
  waiters.add(onSettle);
  return false;
}

/** Ensure a modulepreload link exists for `href` (deduped, adopt existing). */
function ensureModulePreload(href: string) {
  if (findHeadElement('link[rel="modulepreload"]', "href", href)) return;
  const link = document.createElement("link");
  link.rel = "modulepreload";
  link.href = href;
  document.head.appendChild(link);
}

/** Insert inline-style entries into the head, deduped by data-asset id. */
function applyInlineStyles(inlineStyles: InlineStyleEntry[]) {
  for (const entry of inlineStyles) {
    if (findHeadElement("style[data-asset]", "data-asset", entry.id)) continue;
    const el = document.createElement("style");
    el.setAttribute("data-asset", entry.id);
    if (entry.attrs) {
      for (const name in entry.attrs) el.setAttribute(name, entry.attrs[name]);
    }
    el.textContent = entry.content || "";
    document.head.appendChild(el);
  }
}

// The flush a settled stylesheet wakes, one per frame: a pending link holds
// at most one waiter per frame across repeated readiness checks (the
// waiters are a Set — identity dedupes). An empty write at the frame's own
// version is the re-flush (`prepareTier`'s install does the same); a
// disposed frame's `apply` is a no-op.
const flushers = new WeakMap<Frame, () => void>();

/**
 * The stylesheet gate for one segment (`#segmentReady`'s style term, once
 * the tier is resident): ensure every named sheet is in the head — pending
 * links are inserted now, even while another prerequisite is missing, so
 * the load overlaps the rest of the stream — and report whether all have
 * settled. `frame` is re-flushed when a pending one settles.
 */
export function gate(entries: StylesheetEntry[], frame: Frame): boolean {
  let flush = flushers.get(frame);
  if (!flush) flushers.set(frame, (flush = () => frame.apply({ version: frame.version!, r: {} })));
  let ready = true;
  for (const entry of entries) ready = ensureStylesheet(entry, flush) && ready;
  return ready;
}

/**
 * The assets pass for one record (`#flush`'s walk, once per record identity
 * per mount): module preloads, typed preloads, inline styles. Stylesheets
 * are the gate's (`gate`) — never applied here.
 */
export function apply(record: AssetsRecord): void {
  if (record.modules) for (const href of record.modules) ensureModulePreload(href);
  if (record.preloads) for (const entry of record.preloads) ensurePreload(entry);
  if (record.inlineStyles) applyInlineStyles(record.inlineStyles);
}
