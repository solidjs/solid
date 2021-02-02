import { createResource, lazy } from "solid-js";
const Profile = lazy(() => import("./Profile"));

// this component lazy loads data and code in parallel
export default () => {
  const [user] = createResource("user", () => {
      // simulate data loading
      console.log("LOAD USER");
      return new Promise(res => {
        setTimeout(() => res({ firstName: "Jon", lastName: "Snow" }), 400);
      });
    }),
    [info] = createResource(
      () => user() && "userinfo",
      () => {
        // simulate cascading data loading
        console.log("LOAD INFO");
        return new Promise(res => {
          setTimeout(
            () =>
              res(["Something Interesting", "Something else you might care about", "Or maybe not"]),
            400
          );
        });
      },
      []
    );

  return <Profile user={user()} info={info()} />;
};
