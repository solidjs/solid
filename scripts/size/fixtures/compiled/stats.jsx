// The lazy child behind <Loading> in app.jsx. Rolldown splits it into its
// own chunk, which the gate reports and never counts.
export default function Stats(props) {
  return (
    <dl class="stats">
      <dt>Total</dt>
      <dd>{props.todos.length}</dd>
      <dt>Done</dt>
      <dd>{props.todos.filter(t => t.done).length}</dd>
    </dl>
  );
}
