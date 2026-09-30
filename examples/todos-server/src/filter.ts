import { createSignal, onSettled } from "solid-js";

export type Filter = "all" | "active" | "completed";

function parseHash(hash: string): Filter {
  if (hash === "#/active") return "active";
  if (hash === "#/completed") return "completed";
  return "all";
}

/**
 * View-state primitive that mirrors the URL hash into a reactive filter.
 *
 * The SPA twin reads `location.hash` at creation. Here the app is
 * server-rendered and the server cannot see the hash, so the signal starts
 * at "all" on both faces (the hydrated HTML matches what the client's first
 * pass computes) and takes the real hash once the initial activity settles —
 * at the same moment the `hashchange` listener attaches.
 */
export function createHashFilter(): () => Filter {
  const [filter, setFilter] = createSignal<Filter>("all");
  onSettled(() => {
    const onChange = () => setFilter(parseHash(location.hash));
    onChange();
    window.addEventListener("hashchange", onChange);
    return () => window.removeEventListener("hashchange", onChange);
  });
  return filter;
}
