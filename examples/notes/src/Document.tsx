import { HydrationScript, type JSX } from "@solidjs/web";

export default function Document(props: { children?: JSX.Element }) {
  return (
    <html lang="en">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <meta name="description" content="Solid Notes — a server components demo" />
        <title>Solid Notes</title>
        <link rel="icon" href="/favicon.ico" />
        <HydrationScript />
      </head>
      <body>{props.children}</body>
    </html>
  );
}
