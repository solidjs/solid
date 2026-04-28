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
 * Returns just the accessor — the value is set externally via `location.hash`
 * (see the `<a href="#/...">` links in `<Footer>`), so there's no public
 * setter. The `hashchange` listener is attached after the current activity
 * settles (post-render / post-transition) and removed via the returned
 * cleanup on owner disposal, so this is safe to call from any owner scope
 * and doesn't leak across SSR requests.
 */
export function createHashFilter(): () => Filter {
  const [filter, setFilter] = createSignal<Filter>(parseHash(location.hash));
  onSettled(() => {
    const onChange = () => setFilter(parseHash(location.hash));
    window.addEventListener("hashchange", onChange);
    return () => window.removeEventListener("hashchange", onChange);
  });
  return filter;
}
