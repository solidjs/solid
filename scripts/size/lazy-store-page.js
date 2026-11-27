import { createStore, createOptimisticStore, createProjection } from "solid-js";

export default () => {
  const [s] = createStore({ n: 0 });
  const [o] = createOptimisticStore({ n: 0 });
  const p = createProjection(
    d => {
      d.n = s.n + o.n;
    },
    { n: 0 }
  );
  return p.n;
};
