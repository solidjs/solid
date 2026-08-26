import { Profile } from "./profile.js";

export function Matrix() @{
  <main>
    @try {
      <Profile />
    } @pending {
      <p>pending</p>
    } @catch (error) {
      <p>{error.message}</p>
    }

    @try {
      <span>ready</span>
    } @catch (failure) {
      <em>{failure.name}</em>
    }
  </main>
}
