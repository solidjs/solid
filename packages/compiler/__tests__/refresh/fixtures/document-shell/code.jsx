// #3151: document-shell modules decline (full reload) instead of
// registering hot-swappable components. The sibling component shows the
// decline is module-level: nothing in the file registers.
import { HydrationScript } from '@solidjs/web';

export function Header(props) {
  return <header>{props.title}</header>;
}

export default function Document(props) {
  return (
    <html lang="en">
      <head>
        <title>App</title>
        <HydrationScript />
      </head>
      <body class="app-body">
        <Header title="Hello" />
        {props.children}
      </body>
    </html>
  );
}
