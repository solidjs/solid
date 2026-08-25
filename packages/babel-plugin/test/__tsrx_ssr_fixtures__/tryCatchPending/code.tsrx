import { Profile } from "./profile.js";

export const App = () => @try {
  <Profile id={1} />
} @pending {
  <p>Loading...</p>
} @catch (e, reset) {
  <div>
    <p>Error: {e.message}</p>
    <button onClick={() => reset()}>Try again</button>
  </div>
};
