export function LazyScope({ model }) @{
  let &{ count, label } = model;
  const outer = () => count;
  const inner = count => count + 1;
  const snapshot = { count, label };
  const update = () => {
    count += 1;
    count++;
    ++count;
    count = inner(count);
  };

  <button data-count={snapshot.count} onClick={update}>
    {label}: {outer()}
  </button>
}
