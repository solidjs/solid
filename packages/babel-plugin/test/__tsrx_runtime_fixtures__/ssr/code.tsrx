import { renderToString } from "@solidjs/web";

export function Page({ items, show }) @{
  <main>
    @if (show) {
      <ul>
        @for (const item of items; key item.id) {
          <li>{item.label}</li>
        } @empty {
          <li>empty</li>
        }
      </ul>
    } @else {
      <p>hidden</p>
    }
  </main>
}

export function renderPage(props) {
  return renderToString(() => Page(props));
}
