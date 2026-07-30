// The client-facing data surface: the server components wrapped in the
// router's `query` (cache identity + preload participation — and the names
// single-flight collection is keyed by), the mutations wrapped in `action`.
// Note what ISN'T here: the shell (server/App.tsx) is chrome, not data — it
// renders once and is never refetched, so it goes through `dynamic()` alone.
import { action, query } from "@solidjs/router";
import { noteListView } from "~/server/NoteList";
import { noteEditView, noteView } from "~/server/Note";
import { deleteNote as deleteNoteImpl, saveNote as saveNoteImpl } from "~/server/actions";

export const getNoteList = query(noteListView, "notes");
export const getNote = query(noteView, "note");
export const getNoteEdit = query(noteEditView, "note-edit");

export const saveNote = action(saveNoteImpl);
export const deleteNote = action(deleteNoteImpl);
