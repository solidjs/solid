import { root, memo } from "rxcore";
import { resolveSSRNode } from "./ssr";
export * from "./ssr";

export function renderToString(code, options = {}) {
  options = { timeoutMs: 30000, ...options };
  const hydration = globalThis._$HYDRATION || (globalThis._$HYDRATION = {});
  hydration.context = { id: "0", count: 0 };
  hydration.asyncSSR = true;
  hydration.resources = {};
  return root(() => {
    const rendered = code();
    if (typeof rendered === "object" && "then" in rendered) {
      const timeout = new Promise((_, reject) =>
        setTimeout(() => reject("renderToString timed out"), options.timeoutMs)
      );
      return Promise.race([rendered, timeout]).then(resolveSSRNode);
    }
    return resolveSSRNode(rendered);
  });
}

export function ssr(t, ...nodes) {
  if (!nodes.length) return { t };

  for (let i = 0; i < nodes.length; i++) {
    const n = nodes[i];
    if (typeof n === "function") nodes[i] = memo(() => resolveSSRNode(n()));
  }

  return {
    t: () => {
      let result = "";
      for (let i = 0; i < t.length; i++) {
        result += t[i];
        const node = nodes[i];
        if (node !== undefined) result += resolveSSRNode(node);
      }
      return result;
    }
  };
}

export function generateHydrationScript({
  eventNames = ["click", "input", "blur"]
} = {}) {
  let s = `(()=>{_$HYDRATION={events:[],completed:new WeakSet};const t=e=>e&&e.hasAttribute&&(e.hasAttribute("data-hk")&&e||t(e.host&&e.host instanceof Node?e.host:e.parentNode)),e=e=>{let o=e.composedPath&&e.composedPath()[0]||e.target,s=t(o);s&&!_$HYDRATION.completed.has(s)&&_$HYDRATION.events.push([s,e])};["${eventNames.join(
    '","'
  )}"].forEach(t=>document.addEventListener(t,e))})();`;
  s += `_$HYDRATION.resources = JSON.parse('${JSON.stringify(_$HYDRATION.resources || {})}');`;
  return s;
}
