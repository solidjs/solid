import { HydrationScript } from "@solidjs/web";
export function Header(props) {
  return <header>{props.title}</header>;
}
export default function Document(props) {
  return <html lang="en">
      <head>
        <title>App</title>
        <HydrationScript />
      </head>
      <body class="app-body">
        <Header title="Hello" />
        {props.children}
      </body>
    </html>;
}
if (import.meta.hot) {
  import.meta.hot.accept(() => import.meta.hot.invalidate());
}
