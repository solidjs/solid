export function Raw({ html, text }) @{
  <article>
    <div innerHTML={html} />
    <div innerHTML="<b>static markup</b>" />
    <p textContent={text} />
    <p textContent="static text" />
    <span innerText={text} />
    @if (html) {
      <section innerHTML={html} class="preview" />
    } @else {
      <section textContent={text} />
    }
  </article>
}

export function LazyRaw(&{ html, text }) @{
  <div>
    <div innerHTML={html} />
    <p textContent={text} />
  </div>
}
