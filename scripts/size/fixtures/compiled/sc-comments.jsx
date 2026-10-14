// The lazy child behind the comments <Loading> in sc-shell.jsx — the compiled
// counterpart of the hand-written pages' lazy-page.js. Rolldown splits it
// into its own chunk, which the gate reports and never counts.
export default function Comments(props) {
  return (
    <section class="comments">
      <h2>Comments for #{props.id}</h2>
      <p>Nothing yet.</p>
    </section>
  );
}
