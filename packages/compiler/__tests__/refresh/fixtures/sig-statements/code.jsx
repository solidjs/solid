export const App = () => {
  'use strict';
  let a, b;
  var c = 1,
    d;
  if (a) b();else if (c) d();else { e(); }
  for (let i = 0, j = 1; i < 10; i++, j--) log(i);
  for (const { a: x, b: y = 2 } of xs) use(x, y);
  for (const k in obj) log(k);
  while (cond()) step();
  do tick(); while (more());
  switch (a) {
    case b:
      {
        c();
        break;
      }
    case 'str':
      d();
    default:
  }
  try { risky(); } catch (e) { report(e); } finally { done(); }
  label: for (;;) { break label; }
  const [x1, , x2 = 5, ...rest] = arr;
  const { p, q: r, ...others } = obj;
  return null;
};
