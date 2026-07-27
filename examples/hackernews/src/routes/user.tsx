import { type RouteSectionProps } from "@solidjs/router";
import { dynamic } from "@solidjs/web";
import { userView } from "~/lib/views";

export default function User(props: RouteSectionProps) {
  const View = dynamic(() => userView(props.params.id));
  return <View />;
}
