import { createSignal, createContext, useContext } from "solid-js";
import { isServer } from "@solidjs/web";

// Super simplistic pushstate router that matches on absolute paths
const RouterContext = createContext();
function RouteHOC(Comp) {
  return (props = {}) => {
    const [location, setLocation] = createSignal(
        (props.url ? props.url : window.location.pathname).slice(1) || "index"
      ),
      matches = match => match === (location() || "index");
    !isServer && (window.onpopstate = () => setLocation(window.location.pathname.slice(1)));

    return (
      <RouterContext value={[location, () => false, { setLocation: v => setLocation(v), matches }]}>
        <Comp />
      </RouterContext>
    );
  };
}

const Link = props => {
  const [, , { setLocation }] = useContext(RouterContext);
  const navigate = e => {
    if (e) e.preventDefault();
    window.history.pushState("", "", `/${props.path}`);
    setLocation(props.path);
  };
  return (
    <a class="link" href={`/${props.path}`} onClick={navigate}>
      {props.children}
    </a>
  );
};

export { RouteHOC, RouterContext, Link };
