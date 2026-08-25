/**
 * The container tier at the slot border: reactive containers (projections)
 * cross serialization boundaries as TRACES — an async iterable whose first
 * yield is a full state snapshot and whose later yields are patch batches —
 * and materialize back into live local containers. Renderer-agnostic glue;
 * the reactive core injects both halves. See frame-container-plugin.js.
 * @experimental
 */

/** A container's border serialization: one subscribe() per consumer. */
export interface ContainerTrace {
  subscribe(): AsyncIterable<any>;
  /** Whether the container's root is an array — the consumer's seed shape. */
  array: boolean;
}

/** The eval-face wire literal a trace decodes to before materialization. */
export interface ContainerTraceMarker {
  $tr: AsyncIterable<any>;
  $ta?: number;
}

/** Server half: install the reactive core's trace resolver. */
export function setContainerTraceResolver(fn: (value: unknown) => ContainerTrace | undefined): void;

/** Client half: install the reactive core's trace materializer. */
export function setContainerTraceMaterializer(fn: (marker: ContainerTraceMarker) => unknown): void;

/** Whether a value is a traced container (server side; WeakMap probe, trap-safe). */
export function isContainerTraced(value: unknown): boolean;

/**
 * Whether a value is a container this module materialized (client side;
 * WeakSet probe, trap-safe — a pending container's property reads throw
 * not-ready, so classify with this BEFORE any async probe or compare).
 */
export function isMaterializedContainer(value: unknown): boolean;

/**
 * Replace traced containers anywhere in a value with serialization
 * envelopes (copy-on-write). What the sink passes to the serializer —
 * seroval's own classification (constructor reads, array claims) runs
 * before plugins, so raw containers can't be intercepted reliably.
 */
export function envelopeContainerTraces(value: unknown): unknown;

/** Whether a decoded value is a trace marker (client side, eval face). */
export function isContainerTraceMarker(value: unknown): value is ContainerTraceMarker;

/** Deep-revive trace markers inside a decoded value (document-face slot args). */
export function reviveContainerTraces(value: unknown): unknown;

/** Seroval plugin carrying reactive containers across boundaries as traces. */
export const ContainerTracePlugin: {
  tag: string;
  test(value: unknown): boolean;
  parse: object;
  serialize(node: any, ctx: any): string;
  deserialize(node: any, ctx: any): unknown;
};
