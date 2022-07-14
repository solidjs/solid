import { createRenderer as createRendererDX } from "./universal";
import type { RendererOptions, Renderer } from "./universal";
import { mergeProps } from "solid-js";

export function createRenderer<NodeType>(options: RendererOptions<NodeType>): Renderer<NodeType> {
  const renderer = createRendererDX(options);
  renderer.mergeProps = mergeProps;
  return renderer;
}
