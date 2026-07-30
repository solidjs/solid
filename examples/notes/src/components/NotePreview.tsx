// The shared markdown renderer — the direct analogue of the React demo's
// NotePreview.js. The server component (server/Note.tsx) renders it on the
// server, where its output is plain HTML in the frame stream; the editor
// (NoteEditor.tsx) renders it in the browser for the live preview. `marked`
// ships to the client only because the editor imports it — a note that is
// never edited never pays for it.
import { marked } from "marked";

export default function NotePreview(props: { body: string }) {
  return (
    <div class="note-preview">
      <div
        class="text-with-markdown"
        innerHTML={props.body ? (marked(props.body) as string) : ""}
      />
    </div>
  );
}
