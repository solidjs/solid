// The route tree and root preload, in their own module because two consumers
// need them: the app root (app.tsx) builds the Router from them, and the
// server-function config (server-config.ts) hands them to the single-flight
// collector — which reruns exactly these preloads for a mutation's target URL
// to produce the response's regions and data.
import { lazy } from "solid-js";
import { defineRoute, defineRoutes, type RoutePreloadFunc } from "@solidjs/router";
import { getNote, getNoteEdit, getNoteList } from "~/lib/api";
import Home from "~/routes/home";
import Note from "~/routes/note";
import NotFound from "~/routes/not-found";

// The editor routes are the only client code that needs the markdown library
// (NoteEditor's live preview), so they load lazily: `marked` stays out of the
// initial bundle and only downloads when you head to an editor — the router
// even warms the chunk on link hover, alongside the route's data preload.
// Everything ELSE renders markdown on the server (NotePreview inside the
// noteView server component), where the library never ships at all.
const NewNote = lazy(() => import("~/routes/new"));
const EditNote = lazy(() => import("~/routes/edit"));

export const routes = defineRoutes([
  defineRoute({ path: "/", component: Home }),
  defineRoute({ path: "/new", component: NewNote }),
  defineRoute({
    path: "/notes/:id",
    component: Note,
    preload: ({ params }) => void getNote(+params.id)
  }),
  defineRoute({
    path: "/notes/:id/edit",
    component: EditNote,
    preload: ({ params }) => void getNoteEdit(+params.id)
  }),
  defineRoute({ path: "*404", component: NotFound })
]);

// The sidebar list preloads at the root — it shows on every route, filtered
// by the search param.
export const preload: RoutePreloadFunc = ({ location }) =>
  void getNoteList(String(location.query.searchText || ""));
