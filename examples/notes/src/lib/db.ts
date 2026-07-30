// The note store, server-only: this module is only imported by "use server"
// modules, so unstorage never reaches the client build. Server functions run
// in the same process (and module graph) as the SSR renderer on both the dev
// and prod surfaces, so module-level memory is shared by document renders,
// server-component calls, and mutations alike. Notes reset on server restart
// (and dev-time module reloads); swap the driver for the key-value store of
// your choice in a deployed environment.
import { createStorage } from "unstorage";
import memoryDriver from "unstorage/drivers/memory";
import type { Note } from "./types";

export const storage = createStorage({
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

export async function allNotes(): Promise<Note[]> {
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
