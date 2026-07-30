"use server";
// The React demo's NoteList.server.js + SidebarNote.js in one module: the
// sidebar list, server-rendered. Each note's header and excerpt are server
// markup handed into the SidebarNoteContent client slot, which owns the
// expand/collapse state, the active highlight, and the flash animation —
// exactly the demo's split, expressed as a slot instead of a client import.
//
// `$key: note.id` gives each occurrence entity identity: when a mutation
// morphs this list (a note added, removed, or renamed reorders positions),
// per-note client state and the title-change flash follow the note rather
// than the position.
import { format, isToday } from "date-fns";
import type { ComponentProps } from "solid-js";
import type { Slot } from "@solidjs/web/frames";
import { allNotes } from "~/lib/db";
import type SidebarNoteContent from "~/components/SidebarNoteContent";

type ItemSlot = Slot<ComponentProps<typeof SidebarNoteContent>>;

/** A plain-text summary, like the demo's excerpt of the note body. */
function excerpt(body: string) {
  const words = body.split(/\s+/);
  const summary = words.slice(0, 20).join(" ");
  return words.length > 20 ? summary + "…" : summary;
}

export async function noteListView(searchText: string) {
  const notes = (await allNotes()).filter(
    note => !searchText || note.title.toLowerCase().includes(searchText.toLowerCase())
  );

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
}
