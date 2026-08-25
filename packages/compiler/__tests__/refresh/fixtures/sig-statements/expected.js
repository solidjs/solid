import { $$component as _$$component } from "solid-refresh";
import { $$refresh as _$$refresh } from "solid-refresh";
import { $$registry as _$$registry } from "solid-refresh";
const _REGISTRY = _$$registry();
export const App = _$$component(_REGISTRY, "App", () => {
  "use strict";

  let a, b;
  var c = 1,
    d;
  if (a) b();else if (c) d();else {
    e();
  }
  for (let i = 0, j = 1; i < 10; i++, j--) log(i);
  for (const {
    a: x,
    b: y = 2
  } of xs) use(x, y);
  for (const k in obj) log(k);
  while (cond()) step();
  do tick(); while (more());
  switch (a) {
    case b:
      {
        c();
        break;
      }
    case "str":
      d();
    default:
  }
  try {
    risky();
  } catch (e) {
    report(e);
  } finally {
    done();
  }
  label: for (;;) {
    break label;
  }
  const [x1,, x2 = 5, ...rest] = arr;
  const {
    p: p,
    q: r,
    ...others
  } = obj;
  return null;
}, {
  location: "src/sig-statements.jsx:1:19",
  signature: "6e9beb28",
  dependencies: () => ({
    e: e,
    log: log,
    xs: xs,
    use: use,
    obj: obj,
    cond: cond,
    step: step,
    tick: tick,
    more: more,
    risky: risky,
    report: report,
    done: done,
    arr: arr
  })
});
if (import.meta.hot) {
  import.meta.hot.accept();
  _$$refresh("vite", import.meta.hot, _REGISTRY);
}
