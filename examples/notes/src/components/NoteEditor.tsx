/**
 * Copyright (c) Facebook, Inc. and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 */
// The demo's NoteEditor.client.js. The forms post through the router's
// actions: `saveNote` / `deleteNote` answer with a redirect, and because the
// server registered a flight collector, that one response also carries the
// fresh sidebar list and (for save) the fresh note view — submit to settled
// UI in a single round trip. The live preview reuses the same NotePreview the
// note's server component renders — the shared-module half of the demo.
import { createSignal, untrack } from "solid-js";
import { deleteNote, saveNote } from "~/lib/api";
import NotePreview from "./NotePreview";

export default function NoteEditor(props: {
  noteId?: number;
  initialTitle: string;
  initialBody: string;
}) {
  // Slot args are live — a server morph can push fresh values through these
  // props. This editor seeds its own state from them ONCE by contract (the
  // `initial*` names), so read them under `untrack` to declare that intent.
  const initial = untrack(() => ({
    noteId: props.noteId,
    title: props.initialTitle,
    body: props.initialBody
  }));
  const [title, setTitle] = createSignal(initial.title);
  const [body, setBody] = createSignal(initial.body);
  const noteId = initial.noteId;

  return (
    <div class="note-editor">
      <form
        action={saveNote.with(noteId)}
        method="post"
        class="note-editor-form"
        id="note-editor"
        autocomplete="off"
      >
        <label class="offscreen" for="note-title-input">
          Enter a title for your note
        </label>
        <input
          id="note-title-input"
          type="text"
          name="title"
          placeholder="Title"
          required={true}
          value={title()}
          onInput={e => {
            setTitle(e.currentTarget.value);
          }}
        />
        <label class="offscreen" for="note-body-input">
          Enter the body for your note
        </label>
        <textarea
          name="body"
          id="note-body-input"
          textContent={body()}
          onInput={e => {
            setBody(e.currentTarget.value);
          }}
        />
      </form>
      <div class="note-editor-preview">
        <div class="note-editor-menu" role="menubar">
          <button class="note-editor-done" type="submit" form="note-editor" role="menuitem">
            <img src="/checkmark.svg" width="14px" height="10px" alt="" role="presentation" />
            Done
          </button>
          {noteId != null && (
            <form action={deleteNote.with(noteId)} method="post">
              <button name="noteId" class="note-editor-delete" type="submit" role="menuitem">
                <img src="/cross.svg" width="10px" height="10px" alt="" role="presentation" />
                Delete
              </button>
            </form>
          )}
        </div>
        <div class="label label--preview" role="status">
          Preview
        </div>
        <h1 class="note-title">{title()}</h1>
        <NotePreview body={body()} />
      </div>
    </div>
  );
}
