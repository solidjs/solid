let count = 0;
let obj = {};
export const App = () => {
  count++;
  obj.prop = count;
  const local = count + window.outer;
  return <div>{local}</div>;
};
