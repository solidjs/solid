import type { RouteProps } from "@solidjs/router";
import { dynamic } from "@solidjs/web";
import NoteEditor from "~/components/NoteEditor";
import { getNoteEdit } from "~/lib/api";

export default function EditNote(props: RouteProps<"/notes/:id/edit">) {
  const View = dynamic(() => getNoteEdit(+props.params.id));
  return <View editor={p => <NoteEditor {...p} />} />;
}
