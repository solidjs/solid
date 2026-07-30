import type { RouteProps } from "@solidjs/router";
import { dynamic } from "@solidjs/web";
import EditButton from "~/components/EditButton";
import { getNote } from "~/lib/api";

export default function Note(props: RouteProps<"/notes/:id">) {
  const View = dynamic(() => getNote(+props.params.id));
  return <View editButton={p => <EditButton {...p} />} />;
}
