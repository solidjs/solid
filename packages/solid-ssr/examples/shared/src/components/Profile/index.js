import { createResource, lazy } from "solid-js";
const Profile = lazy(() => import("./Profile"));

// this component lazy loads data and code in parallel
export default () => {
  const [user, loadUser] = createResource(undefined, { name: "profile" });
  loadUser(
    () =>
      // simulate data loading
      new Promise(res => {
        setTimeout(() => res({ firstName: "Jon", lastName: "Snow" }), 350);
      })
  );
  return <Profile user={user()} />
}