// EXPERIMENTAL — the frames/server-components surface ships as an
// experimental preview, excluded from the 2.0 stability guarantee: API
// shapes and the wire format may change between prereleases (RFC 11).
// Every export in this module is @experimental.
import { FrameChunk, FrameHost } from "./frame-client.js";
import { JSONCodecOptions } from "./serializer-decode.js";

// Structural mirror of server-functions/shared.js's FlightDataConsumer:
// this file may only reference siblings that ship with it when integrations
// copy the frames declaration set (solid-web's types build), and the
// server-functions declarations are copied to a different root.
type FlightConsumer = (data: unknown, context: { response: Response }) => void | Promise<void>;

/**
 * Header tagging a Response as a frame stream; its value is the producing
 * frame's id. Frame-owned wire contract — deliberately not a server-function
 * `BodyFormat` entry, since the body is frame chunks, not a serialized value.
 * @experimental
 */
export const FRAME_STREAM_HEADER: "X-Frame-Stream";

/**
 * Whether a fetch Response carries a frame stream.
 * @experimental
 */
export function isFrameStreamResponse(response: Response): boolean;

/**
 * Options for `applyFrameResponse`.
 * @experimental
 */
export interface ApplyFrameResponseOptions {
  /**
   * Remap the producer's root frame id onto a local one — the id your
   * insertable/frame registered under — so navigations to the same boundary
   * reuse the same frame regardless of what the server called it. Boundary
   * identity belongs to the client.
   */
  as?: string;
  /**
   * Restamp every chunk of the response with this version (one response IS
   * one version). Versions belong to the client too: the producer cannot
   * know how many streams a boundary has consumed, so pass the Nth-response
   * counter to make policy A's stale-guard real across navigations. A
   * single-flight response addresses several boundaries, each with its own
   * history — pass a function and it is called once per frame in the
   * response.
   */
  version?: number | ((frameId: string) => number);
  /**
   * Receives the payload text of each `outcome` chunk — the response-scoped
   * single-flight envelope, the caller's result rather than anything the
   * host renders.
   */
  onOutcome?(payload: string): void;
}

/**
 * Reads a frame-stream Response to completion, applying every chunk to
 * `host`. Chunks are length-prefixed JSON over the server-function wire
 * framing. Resolves with the id the chunks were applied under once the
 * stream ends; rejects on a malformed or errored stream.
 *
 * @example
 * ```ts
 * const response = await getStory(id); // frame-tagged server function result
 * if (isFrameStreamResponse(response)) {
 *   await applyFrameResponse(response, host, { as: "story-pane" });
 * }
 * ```
 * @experimental
 */
export function applyFrameResponse(
  response: Response,
  host: FrameHost,
  options?: ApplyFrameResponseOptions
): Promise<string>;

/**
 * Brands an inline-rendered server component with its function id.
 * @experimental
 */
export const SERVER_COMPONENT: unique symbol;

/**
 * The unwrapped server component behind an inline-render wrap.
 * @experimental
 */
export const SERVER_COMPONENT_SOURCE: unique symbol;

/**
 * The call's wire address (`frameAddress`), for regions to be emitted under.
 * @experimental
 */
export const SERVER_COMPONENT_ADDRESS: unique symbol;

/**
 * The binding brand on values the transport resolves: `{ component, address }`
 * — the identity split (DR-1). `component` is the mount identity, one per
 * server function; `address` names the call's content store. An equals-gated
 * reader compares `component` across resolutions: same function means "same
 * instance, new binding" — keep the mounted instance and deliver the new
 * address into it; a different function swaps normally. `Symbol.for`, so
 * frameworks can honor it without importing this module.
 * @experimental
 */
export const COMPONENT_BINDING: unique symbol;

/**
 * The value under `COMPONENT_BINDING` on a transport-resolved binding.
 * @experimental
 */
export interface ComponentBinding<C = unknown> {
  /** The per-function mount component (the equals-gate identity). */
  component: C;
  /** The call's intrinsic (function, arguments) address — its store's key. */
  address: string;
}

/**
 * Seroval plugin for a server component crossing a serialization boundary:
 * a branded component serializes as a REFERENCE — a per-function document
 * placeholder in the hydration serializer, a live-registry lookup by call
 * address in the JSON codec (single-flight envelopes) — its markup never
 * rides as data.
 * @experimental
 */
export const ServerComponentPlugin: unknown;

/**
 * Installs the hydration-serializer registry prefix: given the emitted
 * script's serializer context, returns the expression the next serialized
 * reference reads the `_$SC` registry through (the self-bootstrapping form
 * on a script's first reference, a bare read after). Loaded document-SSR
 * modules install this (see frame-sink); client bundles never carry the
 * bootstrap text.
 * @experimental
 */
export function setServerComponentBootstrap(resolve: (ctx: unknown) => string): void;

/**
 * The codec options for a single-flight envelope: `codec` plus
 * `ServerComponentPlugin` (deduped by tag). Injected by the protocol on both
 * legs; exported for integrations composing their own flight carriers.
 * @experimental
 */
export function flightCodec(codec?: JSONCodecOptions): JSONCodecOptions;

/**
 * Options for `createServerComponentHandler`.
 * @experimental
 */
export interface ServerComponentHandlerOptions<C = unknown> {
  host: FrameHost;
  /**
   * Builds the framework's mount component for a server FUNCTION. Invoked
   * once per function and cached — this is the equals-gate identity every
   * call of the function resolves through. The component is CALLED (by the
   * binding wrapper or a gated reader), receiving its current address as a
   * second argument (`() => string`); it should (re-)bind its frame's pull
   * to that address's store. Multi-mount fans out per site.
   */
  component(fnId: string): C;
  /**
   * A new response is about to stream into an address: rotate
   * response-scoped state (codec data tables) here. `version` is the
   * client-owned stream counter the chunks will be stamped with.
   */
  onStream?(address: string, version: number, response: Response): void;
  /**
   * Answer a call SYNCHRONOUSLY before any request is made (t = 0 local
   * answers — e.g. a boundary the document already carries). Returning a
   * non-undefined value resolves the call with it; a hydrating consumer
   * never observes a pending beat.
   */
  intercept?(info: { id: string; meta: unknown; args: unknown[] }): C | undefined;
  /**
   * Reads the registered single-flight consumer at delivery time. The
   * consumer is module state in the server-function client's SHARED
   * instance; pass a getter reading that instance when your bundling gives
   * this module a private copy. Defaults to the local copy's reader.
   */
  consumer?(): FlightConsumer | undefined;
  /**
   * Reads the configured codec options at decode time — same instance-
   * identity contract as `consumer`. Defaults to the local copy's reader.
   */
  codec?(): JSONCodecOptions | undefined;
}

/**
 * The client mirror of `frameTransformResult`, shaped for the server-function
 * client's `responseHandler` seam: frame-stream responses resolve the call
 * with a **binding** — a callable wrapper branded `COMPONENT_BINDING` — so
 * an equals-gated consumer (Solid's `dynamic`) never remounts across
 * refetches or argument changes; the response streams into the address's
 * resident store as the only observable effect.
 *
 * The identity split (DR-1): stores are keyed per-ADDRESS — the call's
 * intrinsic (function, arguments) name, one-to-one with a query cache's
 * per-args entries — while mounts are per-SITE, rendering the per-function
 * component and following delivered addresses. An address nothing is bound
 * to warms its store (preload isolation is the default, not a rule).
 * @experimental
 */
export function createServerComponentHandler<C>(options: ServerComponentHandlerOptions<C>): {
  intercept?(info: { id: string; meta: unknown; args: unknown[] }): unknown;
  handle(
    response: Response,
    ctx: { id: string; meta: unknown; args: unknown[]; context: unknown }
  ): unknown;
  /**
   * Declares that the document is showing a call: hydration-data references
   * carry their call's address (`_$SC.r(id, address)`) but never travel
   * through the transport, so the integration forwards those records here.
   * Mints the call's binding (a post-load refetch then resolves a value
   * whose component matches what the document mounted) and brands the
   * per-function component so cache-seeded readers deliver instead of
   * remounting when their site later switches calls.
   */
  showing(address: string, functionId: string): void;
};
