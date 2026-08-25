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
 * The emission surface `renderToStream` routes through when producing a
 * frame stream instead of a document (see the `sink` render option). Each
 * method emits transport-agnostic chunks; `emit` is the envelope boundary.
 * @internal Compiler/renderer wiring — use `renderToFrameStream` or
 * `renderServerComponent` instead.
 * @experimental
 */
export function createFrameSink(
  emit: (chunk: FrameChunk) => void,
  frame: FrameAddress
): Record<string, (...args: any[]) => void>;

/**
 * Options shared by the frame producers.
 * @experimental
 */
export interface FrameStreamOptions {
  /** Boundary address; defaults to `{ id: "", version: 1 }`. */
  frame?: { id?: string; version?: number };
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

/**
 * Render to a FrameChunk stream: the same render core as `renderToStream`
 * with emission swapped to the frame sink and the document writable replaced
 * by a chunk envelope (`start` up front, `complete` at stream end). Data
 * records default to the keyed JSON codec (decode with
 * `createJSONDataTable`).
 * @experimental
 */
export function renderToFrameStream(code: () => unknown, options?: FrameStreamOptions): FrameStream;

/**
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

/**
 * A server component as an HTTP Response: the chunk stream framed with the
 * server-function wire convention, tagged `X-Frame-Stream: <frame id>` for
 * the client and `X-Content-Raw` so the server-function handler forwards it
 * untouched. `init` (headers/status, e.g. from a `respond()` envelope)
 * merges in; the frame tags win on conflict.
 * @experimental
 */
export function serverComponentResponse(
  component: (props: Record<string, any>) => unknown,
  options?: FrameStreamOptions,
  init?: { headers?: HeadersInit; status?: number }
): Response;

/**
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

// === Document SSR (t = 0) ===

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

/**
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

// The brands and the codec plugin live with the transport (client bundles
// resolve flight references against the live registry); re-exported here for
// server integrations importing the document-SSR surface.
export {
  SERVER_COMPONENT,
  SERVER_COMPONENT_ADDRESS,
  SERVER_COMPONENT_SOURCE,
  ServerComponentPlugin
} from "./frame-transport.js";

/**
 * Statement form of the `self._$SC` placeholder-registry bootstrap
 * (idempotent — first definition wins). No longer required in the document
 * shell: each hydration script's first serialized server-component reference
 * self-bootstraps the registry. Kept for integrations still installing it
 * document-wide; the client upgrades the registry via
 * `installServerComponents()`.
 * @experimental
 */
export const SERVER_COMPONENT_BOOTSTRAP: string;
