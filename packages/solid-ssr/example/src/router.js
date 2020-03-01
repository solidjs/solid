import { createSignal, createContext, useContext, useTransition } from "solid-js";

// Super simplistic pushstate router that matches on absolute paths
const RouterContext = createContext();
function RouteHOC(Comp) {
  return (props = {}) => {
    const [location, setLocation] = createSignal(
        (props.url ? props.url : window.location.pathname).slice(1) || "home"
      ),
      matches = match => match === (location() || "home"),
      [, start] = useTransition({ timeoutMs: 250 });
    return (
      <RouterContext.Provider
        value={[location, { setLocation: v => start(() => setLocation(v)), matches }]}
      >
        <Comp />
      </RouterContext.Provider>
    );
  };
}

const Link = props => {
  const [, { setLocation }] = useContext(RouterContext);
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
