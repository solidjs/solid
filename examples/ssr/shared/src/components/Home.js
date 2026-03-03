import { createSignal, createMemo } from "solid-js";
const Home = () => {
  const [n, setN] = createSignal(0);
  const doubleQuery = createMemo(() => n() * 2);

  return (
    <div>
      <div>n: {n()}</div>
      <div>double: {doubleQuery()}</div>
      <button onClick={() => setN(n() + 1)}>Increase</button>
    </div>
  );
};

export default Home;
