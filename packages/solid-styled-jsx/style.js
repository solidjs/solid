import StyleSheetRegistry from "styled-jsx/dist/stylesheet-registry";
import { onCleanup, createEffect } from "solid-js";

const styleSheetRegistry = new StyleSheetRegistry();

export default function JSXStyle(props) {
  createEffect(prev => {
    if (prev) {
      styleSheetRegistry.remove(prev);
    }
    const next = { ...props };
    styleSheetRegistry.add(next);
    return next;
  });
  onCleanup(() => styleSheetRegistry.remove({ ...props }));
}

JSXStyle.dynamic = info => {
  return info
    .map(tagInfo => {
      const baseId = tagInfo[0];
      const props = tagInfo[1];
      return styleSheetRegistry.computeId(baseId, props);
    })
    .join(" ");
};

export function flush() {
  const cssRules = styleSheetRegistry.cssRules();
  styleSheetRegistry.flush();
  return cssRules;
}
