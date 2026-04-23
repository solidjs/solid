import {
  createRenderer as baseCreateRenderer,
  type RendererOptions,
  type Renderer
} from "dom-expressions/src/universal.js";
import { createRoot, flush } from "solid-js";

export * from "dom-expressions/src/universal.js";

/**
 * Wraps `dom-expressions`' `createRenderer` so the returned `render` defers
 * the top-level mount through the effect queue (`schedule: true`) and drains
 * it with a tail `flush()`. This gives every custom universal renderer the
 * same deferred-mount semantics as `@solidjs/web`'s `render` — uncaught
 * top-level async holds the initial commit on the active transition and
 * attaches atomically once it settles.
 */
export function createRenderer<NodeType>(options: RendererOptions<NodeType>): Renderer<NodeType> {
  const base = baseCreateRenderer(options);
  const baseInsert = base.insert as unknown as (
    parent: NodeType,
    accessor: unknown,
    marker?: NodeType | null,
    initial?: unknown,
    options?: { schedule?: boolean }
  ) => NodeType;
  return {
    ...base,
    render(code: () => NodeType, element: NodeType): () => void {
      let dispose!: () => void;
      createRoot(d => {
        dispose = d;
        // Pass tree as an accessor so insert() always takes the effect path
        // (a concrete node would short-circuit insertExpression and skip the
        // schedule option).
        const tree = code();
        baseInsert(element, () => tree, undefined, undefined, { schedule: true });
      });
      flush();
      return dispose;
    }
  };
}
