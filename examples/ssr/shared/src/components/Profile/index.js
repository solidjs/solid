import { createAsync, lazy } from "solid-js";
// const Profile = lazy(() => import("./Profile"));
import Profile from "./Profile";

// this component lazy loads data and code in parallel
export default () => {
  const user = createAsync(() => {
      // simulate data loading
      console.log("LOAD USER");
      return new Promise(res => {
        setTimeout(() => res({ firstName: "Jon", lastName: "Snow" }), 1000);
      });
    }),
    info = createAsync(() => {
      user();
      // simulate cascading data loading
      console.log("LOAD INFO");
      return new Promise(res => {
        setTimeout(
          () =>
            res(["Something Interesting", "Something else you might care about", "Or maybe not"]),
          1000
        );
      });
    });

  return <Profile user={user()} info={info()} />;
};
