"use server";
// The mutations. Each one answers with `redirect()` — and that redirect is
// what powers single-flight: the server-function runtime hands the target URL
// to the router's flight collector (see ../server-config.ts), which reruns the
// destination's preloads, so the response carries the redirect, the fresh
// sidebar list, and the fresh note — markup and data — in one round trip. No
// revalidate keys are named, so everything the destination shows refreshes:
// the same "refetch the app" semantics the original React demo had, paid only
// for the regions that actually show.
import { redirect } from "@solidjs/web";
import { allNotes, storage } from "~/lib/db";

export async function saveNote(id: number | undefined, formData: FormData) {
  const title = String(formData.get("title") ?? "");
  const body = String(formData.get("body") ?? "");
  const notes = await allNotes();

  if (id == undefined) {
    const index = ((await storage.getItem("notes:counter")) as number) || notes.length;
    await Promise.all([
      storage.setItem("notes:data", [
        ...notes,
        { id: index, title, body, updatedAt: new Date().toISOString() }
      ]),
      storage.setItem("notes:counter", index + 1)
    ]);
    return redirect(`/notes/${index}`);
  }

  await storage.setItem(
    "notes:data",
    notes.map(note =>
      note.id === id ? { id, title, body, updatedAt: new Date().toISOString() } : note
    )
  );
  return redirect(`/notes/${id}`);
}

export async function deleteNote(id: number) {
  const notes = await allNotes();
  await storage.setItem(
    "notes:data",
    notes.filter(note => note.id !== id)
  );
  return redirect("/");
}
