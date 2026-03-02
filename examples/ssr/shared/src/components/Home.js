import { createSignal, Errored, Loading, onSettled } from "solid-js";
const Home = () => {
  const [count, setCount] = createSignal(0);
  const props = {
    test: "test",
    test2: "test2"
  };
  return (
    <div>
      <Link count={1} />
      <Link count={2} />
    </div>
  );
};

function Link(props) {
  const linkProps = {
    href: "/",
    onClick: e => {
      e.preventDefault();
      console.log("clicked", props.count);
    }
  };

  return <a {...linkProps}>My Link {props.count}</a>;
}

export default Home;
