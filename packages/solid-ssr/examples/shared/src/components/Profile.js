import { createResource } from "solid-js";

const Profile = () => {
  const [user, loadUser] = createResource(undefined, { name: "profile" });
  loadUser(
    () =>
      new Promise(res => {
        setTimeout(() => res({ firstName: "Jon", lastName: "Snow" }), 500);
      })
  );
  return (
    <>
      <h1>{user()?.firstName}'s Profile</h1>
      <p>This section could be about you.</p>
    </>
  );
};

export default Profile;
