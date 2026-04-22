import { For, Loading } from "solid-js";

export interface User {
  firstName: string;
  lastName: string;
}

function Profile(props: { info: string[]; user: User }) {
  return (
    <>
      <h1>{props.user.firstName}'s Profile</h1>
      <p>This section could be about you.</p>
      <Loading fallback={<span class="loader">Loading Info...</span>}>
        <ul>
          <For each={props.info}>{fact => <li>{fact()}</li>}</For>
        </ul>
      </Loading>
    </>
  );
}

export default Profile;
