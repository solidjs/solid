// The app root. One screen and nowhere to navigate, so there is no router:
// the board under this tab's identity.
import { IdentityProvider } from "~/identity";
import BoardScreen from "~/board";
import "./app.css";

export default function App() {
  return (
    <IdentityProvider>
      <BoardScreen />
    </IdentityProvider>
  );
}
