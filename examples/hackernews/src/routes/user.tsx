import { type RouteParams, type RoutePreloadFuncArgs, type RouteProps } from "@solidjs/router";
import { dynamic } from "@solidjs/web";
import { getUser } from "~/lib/api";

type Path = "/users/:id";

export const preload = ({ params }: RoutePreloadFuncArgs<RouteParams<Path>>) => {
  void getUser(params.id);
};

export default function User(props: RouteProps<Path>) {
  const View = dynamic(() => getUser(props.params.id));
  return <View />;
}
