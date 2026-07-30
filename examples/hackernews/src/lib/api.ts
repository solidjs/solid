// The client-facing data surface, mirroring ../hackernews-spa/src/lib/api.ts:
// the server components wrapped in the router's `query` — cache identity and
// preload participation. Hovering a link preloads the route's server
// component and the navigation reads the same cache entry, so one request
// serves both. The nav view is chrome, not data (never refetched), so it
// stays on `dynamic()` alone in app.tsx.
import { query } from "@solidjs/router";
import { storiesView, storyView, userView } from "./views";

export const getStories = query(storiesView, "stories");
export const getStory = query(storyView, "story");
export const getUser = query(userView, "user");
