// The sidebar filter IS the `?searchText` query param — the root preload reads
// it, so the notes-list server component refetches whenever it changes. That
// makes it navigation state, not component state: a link that drops it clears
// the search box and refetches the unfiltered list the moment you click a
// note. Client-rendered links (the note-open anchors) carry the filter
// forward with this hook. The server-rendered New/Edit anchors can't — the
// shell renders once and never sees the live query — so entering the editor
// intentionally leaves the browse filter behind.
import { useLocation } from "@solidjs/router";

export function useSearchLink() {
  const location = useLocation();
  return (path: string) => {
    const searchText = location.query.searchText;
    return searchText ? `${path}?searchText=${encodeURIComponent(String(searchText))}` : path;
  };
}
