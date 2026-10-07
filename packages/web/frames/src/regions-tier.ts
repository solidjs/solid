/**
 * `@solidjs/web/frames/regions` — the frames client's REGIONS tier (frames
 * savings pass §3 row C4): nested server-content regions, loaded on demand
 * through the tier mechanism (`prepareTier("regions")`, frame-client.ts).
 *
 * A region is server content passed as a PROP to a client fill (`{$frame}`
 * in the occurrence's record, the arg's wire id): a `<solid-frame>` region
 * ELEMENT the wrapper places like any node — the platform moves the subtree
 * as one — with a frame bound over it that the host routes the region's
 * chunks to, so the region fills and morphs wherever (and whether) the
 * wrapper placed it. Occluded regions (not placed yet — behind an expand)
 * bind and fill off-DOM, then reveal in place when the wrapper inserts the
 * single node. On the document face a used region's content is already in
 * the adopted interior, and the record's `{$frame}` resolves to THAT
 * element (claim wiring, not identity recovery — A5).
 *
 * What rides in this chunk, and so leaves the eager frames client: the
 * per-frame region cache (arg name -> entry), element discovery in an
 * adopted interior, the `{$frame}` arm of the frame's arg resolution
 * (mint / reuse / rename), binding a frame over each region element with
 * the parent's slot resolution threaded down, and disposal. The eager
 * client keeps one test — a record naming a region while this tier is
 * absent WAITS (`needsRegions`: a fresh mount in the held set, the frame's
 * hold registered under frames-rulings 3.1 on the adopt path; a mounted
 * occurrence's new record pending in the store) — and the document face's
 * `sc:region:` drain, which lands an occluded region's html in the host
 * store regardless (the frame this tier binds seeds from it on install).
 *
 * The module's exports ARE its appliers: `prepareTier` records the module
 * in the runtime's dispatch table (`tierModules.regions`) and the frame
 * calls `resolve` / `bind` / `unmount` / `changed` / `frames` through it;
 * no `install()` is needed — nothing of this tier lives outside the
 * runtime's dispatch. After the install, one flush per live frame re-syncs
 * what the tier made applicable: a held occurrence mounts with its region
 * element, a pending record applies.
 *
 * The server announces this tier where it mints a region (`sink.needs
 * ("regions")` in `region()`, the document face's `documentNeeds("regions")`
 * where a slot arg is server content — frame-sink.ts), so the load is a
 * warm start; an un-announced record starts it from the readiness check
 * and waits (the same DOM, later).
 *
 * Region identity and wire names: the cache keys by ARG NAME, because
 * `(occurrence, arg)` IS the region's identity while its `$frame` childId
 * is a per-stream wire name — producers prefix it differently (the
 * document and direct responses render under the function id, a
 * single-flight region under the call's address). A re-sent ref whose only
 * change is the wire name keeps the region — same element, same live
 * interior — and the bound frame REBINDS to the new name so the incoming
 * stream's chunks reach it (`rename`). This is the compensation
 * server-components-principles.md §4 row 19 names; it deletes when regions
 * become store substructure keyed `(parent address, occurrence, arg)` (§5.3,
 * the SC audit's S7) and the wire id normalizes at the store boundary — not
 * here, where a direct response and a flight refresh of the same boundary
 * still address one region by two names.
 * @experimental
 */
// The eager frames client — the SHARED instance the app runs (external in the
// dist build: rollup.config.js's externalizeFramesClient resolves this to
// `@solidjs/web/frames`; a bundled copy would mint frames nobody routes to).
// `createFrame` is how the tier binds a frame over a region element: the
// runtime's own class, registered with the parent's host.
import { createFrame } from "./client.js";
// Pure DOM helpers, bundled into this chunk as their own copy (no module
// state, no instance to keep in agreement — frame-client is importless by
// design).
import { eachInRange, isFrameElement, makeFrameElement, FRAME_ID_ATTR } from "./frame-client.js";

/** One region of an occurrence: its wire id, its element, the frame bound
 *  over it once `bind` ran, and whether the element was adopted from the
 *  document (its content is already there). */
interface RegionEntry {
  childId: string;
  element: Element;
  frame: any;
  adopt?: boolean;
}
type Regions = Map<string, RegionEntry>;

// Per frame: occurrence -> (arg name -> entry). Weak, so a frame that goes
// away takes its cache with it even if `unmount` never ran for it.
const byFrame = new WeakMap<object, Map<string, Regions>>();

const regionsFor = (frame: any, occurrence: string): Regions => {
  let slots = byFrame.get(frame);
  if (!slots) byFrame.set(frame, (slots = new Map()));
  let regions = slots.get(occurrence);
  if (!regions) slots.set(occurrence, (regions = new Map()));
  return regions;
};

/**
 * Collect the OUTERMOST frame region elements in `node`'s subtree into
 * `regions` (keyed by arg name — the childId's final segment, always the
 * dot-free arg identifier — seeded for adoption). A region is opaque — its
 * own deeper regions belong to its occurrences, discovered when they claim —
 * so the walk stops descending at each region element. Client wrapper
 * elements around a region are descended through.
 */
function collectRegionElements(node: Node, regions: Regions): void {
  if (node.nodeType !== 1) return;
  if (isFrameElement(node)) {
    const childId = (node as Element).getAttribute(FRAME_ID_ATTR);
    // Region ids are dotted (`<producer frame>.<occurrence>.<arg>`); bare ids
    // belong to nested document BOUNDARIES, which own their interiors (the
    // walk stops at every frame element, so a nested boundary's own regions
    // are never reachable from here). The producer prefix is wire-relative —
    // a mount registered under a call ADDRESS still adopts markup produced
    // under the function id — so region membership is structural
    // (outermost-in-this-interior), not prefix-matched.
    if (childId && childId.includes(".")) {
      const argKey = childId.slice(childId.lastIndexOf(".") + 1);
      if (!regions.has(argKey))
        regions.set(argKey, { childId, element: node as Element, frame: undefined, adopt: true });
    }
    return;
  }
  for (let c = node.firstChild; c; c = c.nextSibling) collectRegionElements(c, regions);
}

/**
 * Element discovery for the adopt path — claim wiring only (A5): the t=0
 * record names every region arg by `{$frame}` address, and this walk
 * locates the already-rendered ELEMENTS those addresses resolve to,
 * seeding entries (marked `adopt`) so `resolve` reuses the adopted node
 * instead of minting an empty one. Seed from the OUTERMOST region elements
 * in the interior (a region's own deeper regions belong to its
 * occurrences and are discovered recursively when those claim); `bind`
 * then constructs adopting frames over them, which run their own slot
 * sync — this is what wires nested occurrences at boot. A data occurrence
 * (`start` is its consumer list) has no interior: its args are data, and a
 * region arg has nowhere to render at an attribute position.
 */
function discover(frame: any, occurrence: string, start: unknown): void {
  if (!start || Array.isArray(start)) return;
  const regions = regionsFor(frame, occurrence);
  eachInRange(start, occurrence, (n: Node) => collectRegionElements(n, regions));
}

/**
 * Point a cached region entry at a new wire name: the identity (occurrence,
 * arg) and the live element/interior stay, while the bound frame re-registers
 * under the id the incoming stream addresses its content by. An entry not
 * bound yet (discovery just seeded it) only updates its element's id — the
 * eager bind that follows registers under the new name.
 */
function rename(entry: RegionEntry, childId: string): void {
  entry.childId = childId;
  if (entry.frame) entry.frame.rebind(childId);
  else entry.element.setAttribute(FRAME_ID_ATTR, childId);
}

/**
 * The `{$frame}` arm of a frame's arg resolution: for each region arg of
 * the record (`regions`: arg name -> wire id), the region ELEMENT the
 * wrapper places goes into `props` — cached per occurrence, so a re-call
 * re-places the SAME element (no marker range to walk, no fragment refill)
 * and the bound frame's parent follows live. `start` is given on the
 * adopt-time mount (the frame's `claiming`): the interior's region elements
 * are discovered first, so the record's addresses resolve to them.
 */
export function resolve(
  frame: any,
  occurrence: string,
  regions: Record<string, string>,
  props: Record<string, unknown>,
  start?: unknown
): void {
  if (start) discover(frame, occurrence, start);
  const cache = regionsFor(frame, occurrence);
  for (const key in regions) {
    const childId = regions[key];
    let entry = cache.get(key);
    if (!entry)
      cache.set(key, (entry = { childId, element: makeFrameElement(childId), frame: undefined }));
    else if (entry.childId !== childId) rename(entry, childId);
    props[key] = entry.element;
  }
}

/**
 * Bind a frame over each of the occurrence's region elements that has none
 * yet — those `resolve` minted during the invoke or, on the adopt path,
 * discovered in the interior before the fill ran (the fill owns its range
 * through the framework's insert; the frame never reads its output back).
 * Bind eagerly — the region ELEMENT always exists (unlike a marker range,
 * which needs placement to count).
 * This is what makes an OCCLUDED region work: its element is created when
 * args resolve but the wrapper doesn't place it until (e.g.) expand, so it
 * must bind and fill (from buffered/streamed chunks) off-DOM, then reveal
 * in place when the wrapper finally inserts the single node. Host
 * buffering flushes any queued childId chunks. The region inherits this
 * frame's slot resolution (`parent`), so client slots revealed in its
 * streamed content are filled by the same callbacks the client threaded
 * down — no global registry.
 */
export function bind(frame: any, occurrence: string): void {
  const regions = byFrame.get(frame)?.get(occurrence);
  if (!regions) return;
  const o = frame.options;
  for (const entry of regions.values()) {
    if (!entry.frame) {
      entry.frame = createFrame(entry.element, {
        id: entry.childId,
        host: o.host,
        // Regions discovered from adopted document elements already hold
        // their server-rendered content (adopt); streamed regions start
        // empty. Claim scoping threads the root boundary's id down.
        adopt: entry.adopt,
        claimScope: o.claimScope ?? o.id,
        // Element-claim sweeps in the region bind cleanup to the same
        // boundary owner as the root's.
        ownerScope: o.ownerScope,
        parent: frame
      } as any);
    }
  }
}

/**
 * Dispose the frames bound over an occurrence's regions and forget them;
 * without an occurrence, every region of the frame (the frame is being
 * disposed).
 */
export function unmount(frame: any, occurrence?: string): void {
  const slots = byFrame.get(frame);
  if (!slots) return;
  const dispose = (regions: Regions) => {
    for (const { frame: bound } of regions.values()) bound?.dispose();
  };
  if (occurrence === undefined) {
    for (const regions of slots.values()) dispose(regions);
    byFrame.delete(frame);
  } else {
    const regions = slots.get(occurrence);
    if (regions) {
      dispose(regions);
      slots.delete(occurrence);
    }
  }
}

/**
 * For the staged preview (`Frame.preview`): whether the record adds a
 * region to the occurrence or renames one of its regions — its chunks ride
 * the new name, so the rename must land with them at the commit, not in
 * the preview. Read off the host's note of the record's `{$frame}` args.
 */
export function changed(
  frame: any,
  occurrence: string,
  record: { regions?: Record<string, string> }
): boolean {
  const regions = byFrame.get(frame)?.get(occurrence);
  for (const key in record.regions) {
    const entry = regions && regions.get(key);
    if (!(entry && entry.childId === record.regions[key])) return true;
  }
  return false;
}

/** The frames bound over the frame's regions (the staged preview recurses
 *  into them). */
export function frames(frame: any): any[] {
  const out: any[] = [];
  const slots = byFrame.get(frame);
  if (slots)
    for (const regions of slots.values())
      for (const { frame: bound } of regions.values()) if (bound) out.push(bound);
  return out;
}
