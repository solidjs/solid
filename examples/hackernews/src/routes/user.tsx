import { type RouteProps } from "@solidjs/router";
import { dynamic } from "@solidjs/web";
import { userView } from "~/lib/views";

export default function User(props: RouteProps<"/users/:id">) {
  const View = dynamic(() => userView(props.params.id));
  return <View />;
}
