"use server";
// The React demo's Note.server.js. The demo switched one server component on
// `isEditing`; here each mode is its own route, so each is its own server
// component with its own cache key — `noteView` renders the preview (markdown
// through the shared NotePreview, on the server), `noteEditView` fills the
// NoteEditor client slot with the note's raw text as slot args.
import { format } from "date-fns";
import type { ComponentProps } from "solid-js";
import type { Slot } from "@solidjs/web/frames";
import { allNotes } from "~/lib/db";
import EditButton from "~/components/EditButton";
import NotePreview from "~/components/NotePreview";
import type NoteEditor from "~/components/NoteEditor";

function notFound(id: number) {
  return () => (
    <div class="note--empty-state">
      <span class="note-text--empty-state">Couldn't find note with id {id}.</span>
    </div>
  );
}

export async function noteView(id: number) {
  const note = (await allNotes()).find(note => note.id === id);
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
}

export async function noteEditView(id: number) {
  const note = (await allNotes()).find(note => note.id === id);
  if (!note) return notFound(id);

  return (props: { editor: Slot<ComponentProps<typeof NoteEditor>> }) => (
    <props.editor noteId={note.id} initialTitle={note.title} initialBody={note.body} />
  );
}
