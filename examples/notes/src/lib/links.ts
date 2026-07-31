// The sidebar filter IS the `?searchText` query param — the root preload reads
// it, so the notes-list server component refetches whenever it changes. That
// makes it navigation state, not component state: a link that drops it clears
// the search box and refetches the unfiltered list the moment you click a
// note. Every in-app link therefore carries the current filter forward.
import { useLocation } from "@solidjs/router";

export function useSearchLink() {
  const location = useLocation();
  return (path: string) => {
    const searchText = location.query.searchText;
    return searchText ? `${path}?searchText=${encodeURIComponent(String(searchText))}` : path;
  };
}
