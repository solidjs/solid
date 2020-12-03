import { Readable } from "stream";
import { resolveSSRNode } from "./ssr";
export * from "./ssr";

export function renderToNodeStream(code) {
  const stream = new Readable({
    read() {}
  });
  const hydration = globalThis._$HYDRATION || (globalThis._$HYDRATION = {});
  hydration.context = { id: "0", count: 0 };
  let count = 0,
    completed = 0,
    checkEnd = () => {
      if (completed === count) {
        stream.push(null);
        delete hydration.context;
      }
    };
  hydration.register = p => {
    const id = ++count;
    p.then(d => {
      stream.push(`<script>_$HYDRATION.resolveResource(${id}, ${JSON.stringify(d)})</script>`);
      ++completed && checkEnd();
    });
  };
  stream.push(resolveSSRNode(code()));
  setTimeout(checkEnd);
  return stream;
}

export function renderToWebStream(code) {
  const { readable, writable } = new TransformStream();
  const writer = writable.getWriter();
  const encoder = new TextEncoder();
  const hydration = globalThis._$HYDRATION || (globalThis._$HYDRATION = {});
  hydration.context = { id: "0", count: 0 };
  let count = 0,
    completed = 0,
    checkEnd = () => {
      if (completed === count) {
        writer.close();
        delete hydration.context;
      }
    };
  hydration.register = p => {
    const id = ++count;
    p.then(d => {
      writer.write(
        encoder.encode(`<script>_$HYDRATION.resolveResource(${id}, ${JSON.stringify(d)})</script>`)
      );
      ++completed && checkEnd();
    });
  };
  writer.write(encoder.encode(resolveSSRNode(code())));
  setTimeout(checkEnd);
  return readable;
}

export function renderToString(code) {
  const hydration = globalThis._$HYDRATION || (globalThis._$HYDRATION = {});
  hydration.context = { id: "0", count: 0 };
  return resolveSSRNode(code());
}

export function ssr(t, ...nodes) {
  if (nodes.length) {
    let result = "";
    for (let i = 0; i < t.length; i++) {
      result += t[i];
      const node = nodes[i];
      if (node !== undefined) result += resolveSSRNode(node);
    }
    t = result;
  }
  return { t };
}

export function generateHydrationScript({
  eventNames = ["click", "input", "blur"],
  streaming
} = {}) {
  let s = `(()=>{_$HYDRATION={events:[],completed:new WeakSet};const t=e=>e&&e.hasAttribute&&(e.hasAttribute("data-hk")&&e||t(e.host&&e.host instanceof Node?e.host:e.parentNode)),e=e=>{let o=e.composedPath&&e.composedPath()[0]||e.target,s=t(o);s&&!_$HYDRATION.completed.has(s)&&_$HYDRATION.events.push([s,e])};["${eventNames.join(
    '","'
  )}"].forEach(t=>document.addEventListener(t,e))})();`;
  if (streaming) {
    s += `(()=>{const e=_$HYDRATION,r={};let o=0;e.resolveResource=((e,o)=>{const t=r[e];if(!t)return r[e]=o;delete r[e],t(o)}),e.loadResource=(()=>{const e=++o,t=r[e];if(!t){let o,t=new Promise(e=>o=e);return r[e]=o,t}return delete r[e],Promise.resolve(t)})})();`;
  }
  return s;
}
