// The React demo's Note.js. The demo switched one server component on
// `isEditing`; here each mode is its own query with its own cache key.
// `getNote` is the preview route itself — a server route, so the router
// makes the call from the match on navigation and on link hover, and the
// single-flight collector reruns it after a save. The preview is markup, so
// it is a server component; the editor needs the note's raw text as data, so
// `getNoteEdit` answers the note itself. It lives here because the edit route
// is lazy (it is the only client code that needs `marked`) while the route
// table must preload it eagerly.
//
// Nothing below the imports reaches the browser except the route: the
// client build replaces each `"use server"` body with a reference, and
// NotePreview, date-fns and the store are imported by those bodies alone.
import {
  query,
  serverRouteComponent,
  type RouteParams,
  type ServerRouteArgs
} from "@solidjs/router";
import { format } from "date-fns";
import * as db from "~/server/db";
import EditButton from "~/components/EditButton";
import NotePreview from "~/components/NotePreview";

function notFound(id: number) {
  return () => (
    <div class="note--empty-state">
      <span class="note-text--empty-state">Couldn't find note with id {id}.</span>
    </div>
  );
}

const getNote = query(async ({ params }: ServerRouteArgs<RouteParams<"/notes/:id">>) => {
  "use server";
  const id = +params.id;
  const note = await db.getNote(id);
  if (!note) return notFound(id);

  const updatedAt = format(new Date(note.updatedAt), "d MMM yyyy 'at' h:mm bb");
  // EditButton renders on the server: it's a plain anchor, and document-level
  // link interception makes server-rendered hrefs SPA-navigate — no slot, no
  // client module.
  return () => (
    <div class="note">
      <div class="note-header">
        <h1 class="note-title">{note.title}</h1>
        <div class="note-menu" role="menubar">
          <small class="note-updated-at" role="status">
            Last updated on {updatedAt}
          </small>
          <EditButton noteId={note.id}>Edit</EditButton>
        </div>
      </div>
      <NotePreview body={note.body} />
    </div>
  );
}, "note");

export const getNoteEdit = query(async (id: number) => {
  "use server";
  return (await db.getNote(id)) ?? null;
}, "note-edit");

export default serverRouteComponent(getNote);
