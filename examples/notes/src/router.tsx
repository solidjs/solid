// The router lives in its own module so app.tsx (render) and server-config.ts
// (the single-flight collector) share one instance, as in the fullstack
// template. The collector reruns these routes' server calls and preloads for
// a mutation's target URL, so the sidebar list's query lives here too: the
// root preload names it, on every route, filtered by the search param.
import { createRouter, defineRoute, query } from "@solidjs/router";
import { lazy, type ComponentProps } from "solid-js";
import type { Slot } from "@solidjs/web/frames";
import { format, isToday } from "date-fns";
import { marked } from "marked";
import * as db from "~/server/db";
import type SidebarNoteContent from "~/components/SidebarNoteContent";
import Home from "~/routes/home";
import Note, { getNoteEdit } from "~/routes/note";
import NotFound from "~/routes/not-found";

type ItemSlot = Slot<ComponentProps<typeof SidebarNoteContent>>;

const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  "#39": "'"
};

/**
 * The demo's excerpt: the rendered note as plain text, cut to 20 words. It
 * runs on the server, so `marked` costs the sidebar nothing in the browser.
 * The decode undoes the five characters marked escapes, so JSX escapes them
 * once.
 */
function excerpt(body: string) {
  const text = (marked(body) as string)
    .replace(/<[^>]*>/g, "")
    .replace(/&(amp|lt|gt|quot|#39);/g, (_, name) => ENTITIES[name]);
  const words = text.split(/\s+/).filter(Boolean);
  const summary = words.slice(0, 20).join(" ");
  return words.length > 20 ? summary + "…" : summary;
}

// The React demo's NoteList.js + SidebarNote.js: the sidebar list, keyed by
// the search text. Each note's header and excerpt are server markup handed
// into the SidebarNoteContent client slot, which owns the expand/collapse
// state, the active highlight, and the flash animation — the demo's split,
// expressed as a slot instead of a client import.
//
// `$key: note.id` gives each occurrence entity identity: when a mutation
// morphs this list (a note added, removed, or renamed reorders positions),
// per-note client state and the title-change flash follow the note rather
// than the position.
export const getNoteList = query(async (searchText: string) => {
  "use server";
  const notes = await db.findNotes(searchText);

  // The sidebar filter IS the `?searchText` query param, so a note-open link
  // that drops it would clear the search box on click. This component
  // re-renders with the current searchText on every change, so it bakes the
  // carry-forward href right into the slot args — no client-side URL
  // plumbing. (The shell's New/Edit anchors never see the live query, so
  // entering the editor intentionally leaves the filter behind.)
  const search = searchText ? `?searchText=${encodeURIComponent(searchText)}` : "";

  return (props: { item: ItemSlot }) =>
    notes.length ? (
      <ul class="notes-list">
        {notes.map(note => {
          const updatedAt = new Date(note.updatedAt);
          const summary = excerpt(note.body);
          return (
            <li>
              <props.item
                $key={note.id}
                id={note.id}
                title={note.title}
                href={`/notes/${note.id}${search}`}
                expandedChildren={
                  <p class="sidebar-note-excerpt">{summary || <i>(No content)</i>}</p>
                }
              >
                <header class="sidebar-note-header">
                  <strong>{note.title}</strong>
                  <small>
                    {isToday(updatedAt)
                      ? format(updatedAt, "h:mm bb")
                      : format(updatedAt, "M/d/yy")}
                  </small>
                </header>
              </props.item>
            </li>
          );
        })}
      </ul>
    ) : (
      <div class="notes-empty">
        {searchText ? `Couldn't find any notes titled "${searchText}".` : "No notes created yet!"}
      </div>
    );
}, "notes");

// The editor routes are the only client code that needs the markdown library
// (NoteEditor's live preview), so they load lazily: `marked` stays out of the
// initial bundle and only downloads when you head to an editor — the router
// warms the chunk on link hover, alongside the route's data preload.
// Everything else renders markdown on the server, where the library never
// ships at all.
const NewNote = lazy(() => import("~/routes/new"));
const EditNote = lazy(() => import("~/routes/edit"));

export const Router = createRouter({
  routes: [
    defineRoute({ path: "/", component: Home }),
    defineRoute({ path: "/new", component: NewNote }),
    defineRoute({ path: "/notes/:id", component: Note }),
    defineRoute({
      path: "/notes/:id/edit",
      component: EditNote,
      preload: ({ params }) => void getNoteEdit(+params.id)
    }),
    defineRoute({ path: "*404", component: NotFound })
  ],
  preload: ({ location }) => void getNoteList(String(location.query.searchText || ""))
});
