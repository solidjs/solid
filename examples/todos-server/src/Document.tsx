import { HydrationScript, type JSX } from "@solidjs/web";

export default function Document(props: { children?: JSX.Element }) {
  return (
    <html lang="en">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <meta name="description" content="TodoMVC as a Solid Server Component" />
        <title>Solid 2.0 Todos (server components)</title>
        <HydrationScript />
      </head>
      <body>{props.children}</body>
    </html>
  );
}
