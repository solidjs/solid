// The app is the chat. `start: {}` in vite.config.ts wraps this in a
// document, renders it on the server and hydrates it in the browser.
import Chat from "~/chat";
import "./app.css";

export default function App() {
  return <Chat />;
}
