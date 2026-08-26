const celebration = "🎉";

export function 国際化({ user, visible }) @{
  const marker = "🚀";
  const &{ 名前 } = user;

  <article title={celebration}>
    <p>{marker}: {名前}</p>
    @if (visible) {
      <strong>你好 🌍</strong>
    } @else {
      <em>再见</em>
    }
  </article>
}
