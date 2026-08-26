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

export const PendingOnly = () => @try {
  <Profile id={2} />
} @pending {
  <p>Loading...</p>
};

export const CatchOnly = () => @try {
  <Profile id={3} />
} @catch (err) {
  <p>{err.name}: {String(err)}</p>
};
