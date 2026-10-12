import "server-only";
// The note store. Only `"use server"` bodies import it, and the client build
// replaces those with references, so unstorage never reaches the browser; the
// `server-only` marker fails the build if this module is ever imported from
// client code. Server functions run in the same process (and module graph) as
// the SSR renderer on both the dev and prod surfaces, so module-level memory
// is shared by document renders, server-component calls, and mutations alike.
// Notes reset on server restart (and dev-time module reloads); swap the driver
// for the key-value store of your choice in a deployed environment.
import { createStorage } from "unstorage";
import memoryDriver from "unstorage/drivers/memory";
import type { Note } from "~/types";

const storage = createStorage({
  driver: memoryDriver()
});

// The seed content from the original React server-components demo.
const SEED: Omit<Note, "id" | "updatedAt">[] = [
  {
    title: "Meeting Notes",
    body: "This is an example note. It contains **Markdown**!"
  },
  {
    title: "Make a thing",
    body: "It's very easy to make some words **bold** and other words *italic* with Markdown. You can even [link to Solid's website!](https://www.solidjs.com)."
  },
  {
    title: "A note with a very long title because sometimes you need more words",
    body: "You can write all kinds of [amazing](https://en.wikipedia.org/wiki/The_Amazing) notes in this app! These notes live in memory on the server.\n\nThis note also has a very long title and a fairly long body content, so you can see what those look like in the UI."
  }
];

async function allNotes(): Promise<Note[]> {
  const notes = (await storage.getItem("notes:data")) as Note[] | null;
  if (notes) return notes;
  const now = new Date().toISOString();
  const seeded = SEED.map((note, id) => ({ id, ...note, updatedAt: now }));
  await Promise.all([
    storage.setItem("notes:data", seeded),
    storage.setItem("notes:counter", seeded.length)
  ]);
  return seeded;
}

export async function getNote(id: number): Promise<Note | undefined> {
  return (await allNotes()).find(note => note.id === id);
}

/**
 * The notes whose title contains `searchText`, case-insensitively, newest
 * first (the demo's `order by id desc`).
 */
export async function findNotes(searchText: string): Promise<Note[]> {
  const needle = searchText.toLowerCase();
  return (await allNotes())
    .filter(note => !needle || note.title.toLowerCase().includes(needle))
    .sort((a, b) => b.id - a.id);
}

/** Creates the note when `id` is undefined; answers the saved note's id. */
export async function saveNote(id: number | undefined, title: string, body: string) {
  const notes = await allNotes();
  const updatedAt = new Date().toISOString();

  if (id == undefined) {
    const index = ((await storage.getItem("notes:counter")) as number) || notes.length;
    await Promise.all([
      storage.setItem("notes:data", [...notes, { id: index, title, body, updatedAt }]),
      storage.setItem("notes:counter", index + 1)
    ]);
    return index;
  }

  await storage.setItem(
    "notes:data",
    notes.map(note => (note.id === id ? { id, title, body, updatedAt } : note))
  );
  return id;
}

export async function deleteNote(id: number) {
  const notes = await allNotes();
  await storage.setItem(
    "notes:data",
    notes.filter(note => note.id !== id)
  );
}
