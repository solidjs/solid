import { createContext, createSignal, useContext, type Component, type ParentProps } from "solid-js";
import { isServer } from "@solidjs/web";

type RouterValue = [
  () => string,
  {
    setLocation: (value: string) => void;
    matches: (match: string) => boolean;
  }
];

const RouterContext = createContext<RouterValue>();

function RouteHOC(Comp: Component): Component<{ url?: string }> {
  return (props = {}) => {
    const initialPath = props.url ?? (isServer ? "/" : window.location.pathname);
    const [location, setLocation] = createSignal(initialPath.slice(1) || "index");
    const matches = (match: string) => match === (location() || "index");

    if (!isServer) {
      window.onpopstate = () => setLocation(window.location.pathname.slice(1) || "index");
    }

    return (
      <RouterContext value={[location, { setLocation: value => setLocation(value), matches }]}>
        <Comp />
      </RouterContext>
    );
  };
}

function useRouter() {
  const router = useContext(RouterContext);
  if (!router) {
    throw new Error("RouterContext is not available");
  }
  return router;
}

function Link(props: ParentProps<{ path: string }>) {
  const [, { setLocation }] = useRouter();

  function navigate(event: MouseEvent) {
    event.preventDefault();
    window.history.pushState("", "", `/${props.path}`);
    setLocation(props.path);
  }

  return (
    <a class="link" href={`/${props.path}`} onClick={navigate}>
      {props.children}
    </a>
  );
}

export { Link, RouteHOC, RouterContext, useRouter };
