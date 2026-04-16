import { createSignal, onSettled } from "solid-js";

const Home = () => {
  const [s, set] = createSignal(0);

  onSettled(() => {
    const t = setInterval(() => {
      set(s() + 1);
    }, 100);

    return () => {
      clearInterval(t);
    };
  });

  return (
    <>
      <h1>Welcome to this Simple Routing Example</h1>
      <p>Click the links in the Navigation above to load different routes.</p>
      <span>{s()}</span>
    </>
  );
};

export default Home;
