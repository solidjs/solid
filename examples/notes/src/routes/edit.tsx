import type { RouteProps } from "@solidjs/router";
import { createMemo, Show } from "solid-js";
import NoteEditor from "~/components/NoteEditor";
import { getNoteEdit } from "~/routes/note";

export default function EditNote(props: RouteProps<"/notes/:id/edit">) {
  const note = createMemo(() => getNoteEdit(+props.params.id));
  // Keyed: the editor seeds its draft from the note once, so another note
  // (edit/1 -> edit/2 reuses this route) must mount a fresh editor.
  return (
    <Show
      when={note()}
      keyed
      fallback={
        <div class="note--empty-state">
          <span class="note-text--empty-state">Couldn't find note with id {props.params.id}.</span>
        </div>
      }
    >
      {note => <NoteEditor noteId={note.id} initialTitle={note.title} initialBody={note.body} />}
    </Show>
  );
}
