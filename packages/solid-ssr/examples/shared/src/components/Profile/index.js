import { createResource, lazy } from "solid-js";
const Profile = lazy(() => import("./Profile"));

// this component lazy loads data and code in parallel
export default () => {
  const [user, loadUser] = createResource(undefined, { name: "profile" }),
    [info, loadInfo] = createResource([], { name: "profile_info" });
  loadUser(
    () =>
      // simulate data loading
      new Promise(res => {
        setTimeout(() => res({ firstName: "Jon", lastName: "Snow" }), 400);
      })
  );
  loadInfo(
    () =>
      // simulate data loading
      new Promise(res => {
        setTimeout(
          () =>
            res(["Something Interesting", "Something else you might care about", "Or maybe not"]),
          800
        );
      })
  );
  return <Profile user={user()} info={info()} />;
};
