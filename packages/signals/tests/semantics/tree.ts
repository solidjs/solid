import {
  createLoadingBoundary,
  createRenderEffect,
  createRoot,
  onCleanup
} from "../../src/index.js";
import type { Output } from "./rules.js";
import type { ReaderSpec } from "./scenario.js";

interface Content {
  output: Output;
  children: Region[];
  disposed: boolean;
}
interface Region {
  spec: ReaderSpec;
  generation: number;
  attached: boolean;
  disposed: boolean;
  view?: Content | "loading";
  dispose: () => void;
}
export interface TreeHost {
  read(spec: ReaderSpec): Output;
  reset: () => number;
  born(spec: ReaderSpec, dispose: () => void): number;
  gone(spec: ReaderSpec, generation: number): void;
  publish(spec: ReaderSpec, output: Output, generation: number): void;
  covered(spec: ReaderSpec): void;
  stale(spec: ReaderSpec): void;
}

/** A tiny renderer for nested boundary regions. Allocation follows structural
 * mounting/reset, not each flush. A child's apply may prepare detached content;
 * only its enclosing boundary's published content makes that child visible. */
export function mountTree(
  root: ReaderSpec,
  children: Map<number, ReaderSpec[]>,
  host: TreeHost
): void {
  const cover = (region: Region) => {
    region.attached = false;
    host.covered(region.spec);
    if (region.view && region.view !== "loading")
      for (const child of region.view.children) cover(child);
  };
  const publish = (region: Region) => {
    if (!region.view) return;
    if (region.view === "loading") host.publish(region.spec, "loading", region.generation);
    else {
      host.publish(region.spec, region.view.output, region.generation);
      for (const child of region.view.children) {
        child.attached = true;
        publish(child);
      }
    }
  };
  const mount = (spec: ReaderSpec): Region =>
    createRoot(disposeRoot => {
      const region: Region = {
        spec,
        generation: 0,
        attached: false,
        disposed: false,
        dispose() {
          if (region.disposed) return;
          region.disposed = true;
          host.gone(spec, region.generation);
          disposeRoot();
        }
      };
      region.generation = host.born(spec, region.dispose);
      const content = (): Content => {
        const result: Content = { output: "absent", children: [], disposed: false };
        onCleanup(() => {
          result.disposed = true;
        });
        // Child effects live in the enclosing Loading context, just as compiled
        // JSX's individual text/attribute effects do. An inner boundary catches
        // its own work; an unbounded child suspends the outer region instead.
        createRenderEffect(
          () => host.read(spec),
          output => {
            if (region.disposed || result.disposed) {
              host.stale(spec);
              return;
            }
            result.output = output;
            if (region.attached && region.view === result)
              host.publish(spec, output, region.generation);
          }
        );
        const nested = children.get(spec.id);
        if (nested)
          for (const child of nested) {
            const scope = mount(child);
            result.children.push(scope);
            onCleanup(scope.dispose);
          }
        return result;
      };
      if (spec.boundary === "none") region.view = content();
      else {
        const view = createLoadingBoundary(
          content,
          () => "loading" as const,
          spec.boundary === "reset" ? { on: host.reset } : undefined
        );
        createRenderEffect(view, next => {
          if (region.disposed) {
            host.stale(spec);
            return;
          }
          if (region.attached && region.view && region.view !== "loading")
            for (const child of region.view.children) cover(child);
          region.view = next;
          if (region.attached) publish(region);
        });
      }
      return region;
    });
  const region = mount(root);
  region.attached = true;
  publish(region);
}
