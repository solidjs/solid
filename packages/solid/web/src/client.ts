export * from "dom-expressions/src/client.js";
import { spread as baseSpread } from "dom-expressions/src/client.js";

const childPropNames = ["children", "innerHTML", "textContent", "innerText"];

export function spread(
  node: Element,
  props: Record<string, unknown> = {},
  isSVG?: boolean,
  skipChildren?: boolean
) {
  return baseSpread(
    node,
    props,
    isSVG,
    skipChildren || !childPropNames.some(prop => prop in props)
  );
}
