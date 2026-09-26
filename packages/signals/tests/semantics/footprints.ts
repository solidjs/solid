import { Model, type Values } from "./model.js";
import type { ReaderSpec } from "./scenario.js";

export interface PathWork {
  key: string;
  node: number;
  inputs: number[];
  state: "waiting" | "resolved";
}
export interface Witness {
  at: string;
  write: number;
}

/** History is allocated only for boundary regions. Permission records an
 * exact generated request on a declared requested path, after a real reader
 * attempted that prefix. It never derives an obligation from Solid's blocker
 * list, and never grants permission to a new request merely sharing a node. */
export class Footprint {
  requested: Uint8Array;
  published: Uint8Array;
  readonly retained = new Map<PathWork, Witness>();
  attempted = 0;
  publishedKnown = false;
  readonly anchored: boolean;
  readonly sources: number;
  constructor(
    private model: Model,
    private reader: ReaderSpec
  ) {
    let sources = 0;
    for (const ref of reader.refs) sources |= model.sourceMask(ref);
    this.sources = sources;
    this.anchored = (sources & model.anchorMask) === sources;
    this.requested = new Uint8Array(model.size);
    this.published = new Uint8Array(model.size);
  }
  update(
    values: Values,
    published: Values,
    showingContent: boolean,
    active: boolean,
    find: (node: number, inputs: number[]) => PathWork | undefined,
    nodeIds: readonly number[],
    at: string,
    write: number
  ): void {
    for (const [work] of this.retained) if (work.state === "resolved") this.retained.delete(work);
    this.requested = this.model.select(this.reader.refs, values, active ? this.attempted : 0);
    if (showingContent && this.anchored) {
      this.published = this.model.select(this.reader.refs, published);
      this.publishedKnown = true;
    }
    for (let i = 0; i < this.model.nodes.length; i++) {
      const node = this.model.nodes[i];
      if (!this.requested[node.slot]) continue;
      const work = find(nodeIds[i], values.inputs(i));
      if (work?.state === "waiting" && !this.retained.has(work))
        this.retained.set(work, { at, write });
    }
  }
  /** A region that has published the current complete answer closes its old
   * waiting interval; those requests cannot gain permission on a later reload. */
  clear(): void {
    this.retained.clear();
  }
}
