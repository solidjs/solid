export function Raw({ html, text }) @{
  <article>
    <div innerHTML={html} />
    <div innerHTML="<b>static markup</b>" />
    <p textContent={text} />
    <p textContent="static text" />
    @if (html) {
      <section innerHTML={html} class="preview" />
    } @else {
      <section textContent={text} />
    }
  </article>
}
