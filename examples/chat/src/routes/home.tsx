// The front page: a conversation that has not started. Sending the first
// message makes the thread and goes to it.
import Composer from "~/components/composer";

export default function Home() {
  return (
    <article class="thread empty">
      <header class="thread-head">
        <h1>New chat</h1>
        <p class="muted">
          Every reply is rendered on the server and arrives as HTML. Try closing the tab while one
          is being written.
        </p>
      </header>
      <Composer />
    </article>
  );
}
