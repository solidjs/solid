import { createMemo, lazy } from "solid-js";
import type { User } from "./Profile";

const Profile = lazy(() => import("./Profile"), "./Profile/Profile");

// this component lazy loads data and code in parallel
export default () => {
  const user = createMemo<User>(() => {
    // simulate data loading
    console.log("LOAD USER");
    return new Promise<User>(resolve => {
      setTimeout(() => resolve({ firstName: "Jon", lastName: "Snow" }), 400);
    });
  });

  const info = createMemo<string[]>(() => {
    user();
    // simulate cascading data loading
    console.log("LOAD INFO");
    return new Promise<string[]>(resolve => {
      setTimeout(
        () =>
          resolve(["Something Interesting", "Something else you might care about", "Or maybe not"]),
        400
      );
    });
  });

  return <Profile user={user()} info={info()} />;
};
