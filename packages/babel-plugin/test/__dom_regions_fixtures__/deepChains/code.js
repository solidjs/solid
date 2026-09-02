// The dbmon row: static-key chains below the subject's own keys are
// eligible and set the DEEP flag (writes bubble to the region root — no
// witness subscriptions).
function Row(db) {
  return (
    <tr>
      <td class="dbname" textContent={db.name} />
      <td class={db.countClass} textContent={db.count} />
      <td class={db.queries[0].className} textContent={db.queries[0].elapsed} />
      <td class={db.queries[1].className} textContent={db.queries[1].elapsed} />
    </tr>
  );
}
