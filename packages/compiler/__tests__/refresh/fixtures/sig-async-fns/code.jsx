export const App = () => {
  const f = async () => await fetch(url);
  const g = async function inner() { return (await a) + (await b) * c; };
  function* gen() { const x = yield a; yield* b; }
  return [f, g, gen];
};
