import { HydrationScript } from "@solidjs/web";

const App = () => {
  return (
    <html lang="en">
      <head>
        <title>🔥 Solid SSR 🔥</title>
        <meta charset="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <link rel="stylesheet" href="/styles.css" />
        <HydrationScript />
      </head>
      <body>
        <div id="app">
          <h1>🔥 Solid SSR 🔥</h1>
          <p>Server side rendered with SolidJS</p>
          <p>Open the console to see the client side rendering</p>
        </div>
      </body>
      <script type="module" src="/js/index.js" async></script>
    </html>
  );
};

export default App;
