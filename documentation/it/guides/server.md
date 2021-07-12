# Server di rendering

Solid gestisce il rendering del server compilando i modelli JSX in un codice di aggiunta di stringhe ultra efficiente. Questo accade con il plugin o il preset Babel passando in `generate: "ssr"`. Con client e server è necessario passare `hydratable: true` per generare il codice compatibile con l'idratazione.

I runtime `solid-js` e `solid-js/web` vengono scambiati con versioni non reattive durante l'esecuzione in un ambiente nodo. Per altri ambienti sarà necessario raggruppare il codice del server con esportazioni condizionali impostate su "nodo". La maggior parte dei bundler ha un modo per farlo. Raccomandiamo anche di usare le condizioni di esportazione `solid` così come si consiglia alle librerie di spedire i loro sorgenti sotto l'export `solid`.

Costruire per SSR richiede sicuramente un po' più di configurazione. Genereremo 2 bundle separati. La voce client dovrebbe usare "idrato":

```jsx
import { hydrate } from "solid-js/web";

hydrate(() => <App />, document);
```

_Nota: è possibile renderizzare e idratare dalla radice del documento. Questo ci permette di descrivere la nostra visione completa in JSX._

La voce del server può utilizzare una delle quattro opzioni di rendering offerte da Solid. Ciascuno produce l'output e un tag di script da inserire nell'intestazione del documento.

```jsx
import {
  renderToString,
  renderToStringAsync,
  renderToNodeStream,
  renderToWebStream
} from "solid-js/web";

// Rendering di stringhe sincrone
const html = renderToString(() => <App />);

// Rendering di stringhe asincrone
const html = await renderToStringAsync(() => <App />);

// Node Stream API
pipeToNodeWritable(App, res);

// Web Stream API (come esempio Cloudflare Workers)
const { readable, writable } = new TransformStream();
pipeToWritable(() => <App />, writable);
```

Per semplicità `solid-js/web` esporta un flag `isServer`. Ciò è utile in quanto la maggior parte dei bundler sarà in grado di eseguire il treeshake di qualsiasi cosa sotto questo flag o le importazioni utilizzate solo dal codice sotto questo flag dal tuo bundle client.

```jsx
import { isServer } from "solid-js/web";

if (isServer) {
  // solo per server
} else {
  // solo nel browser
}
```

## Script di idratazione

Per idratarsi progressivamente direttamente prima del caricamento del runtime di Solid, è necessario inserire uno script speciale nella pagina. Può essere generato e inserito tramite `generateHydrationScript`o incluso come parte di JSX utilizzando il tag `<HydrationScript />`.

```js
import { generateHydrationScript } from "solid-js/web";

const app = renderToString(() => <App />);

const html = `
  <html lang="en">
    <head>
      <title>🔥 Solid 🔥</title>
      <meta charset="UTF-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1.0" />
      <link rel="stylesheet" href="/styles.css" />
      ${generateHydrationScript()}
    </head>
    <body>${app}</body>
  </html>
`;
```

```jsx
import { HydrationScript } from "solid-js/web";

const App = () => {
  return (
    <html lang="en">
      <head>
        <title>🔥 Solid 🔥</title>
        <meta charset="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <link rel="stylesheet" href="/styles.css" />
        <HydrationScript />
      </head>
      <body>{/*... resto dell'app */}</body>
    </html>
  );
};
```

Fai attenzione quando ti idrati. Anche l'inserimento di risorse che non sono disponibili nell'esecuzione del client può rovinare le cose. Solid fornisce un componente `<NoHydration>` i cui figli funzioneranno normalmente sul server. Questo non è per idratare nel browser.

```jsx
<NessunaIdratazione>
  {manifesta.map(m => (
    <link rel="modulepreload" href={m.href} />
  ))}
</NessunaIdratazione>
```

## Asincrono e streaming SSR

I meccanismi sono costruiti sulla conoscenza di Solid di come funziona la tua applicazione. Usando Suspense e l'API delle risorse sul server, invece di recuperare in anticipo e quindi eseguire il rendering. Solid recupera mentre esegue il rendering sul server in modo simile al client. Il codice e i modelli di esecuzione sono scritti esattamente allo stesso modo.

Il rendering asincrono attende la risoluzione di tutti i limiti di Suspense. Quindi invia i risultati o li scrive su un file nel caso di Static Site Generation.

Lo streaming inizia a scaricare il contenuto sincrono nel browser, rendendo immediatamente i tuoi Suspense Fallback sul server. Quindi, quando i dati asincroni terminano sul server, inviano lo stesso flusso al client per risolvere Suspense. Questo è quando il browser termina il lavoro e sostituisce il fallback con contenuto reale.

Il vantaggio:

- Il server non deve attendere che i dati asincroni rispondano. Le risorse possono iniziare a caricarsi prima nel browser e l'utente può iniziare a vedere i contenuti prima.
- Rispetto al recupero del client come JAMStack, il caricamento dei dati inizia immediatamente sul server e non deve attendere il caricamento di JavaScript del client.
- Tutti i dati vengono serializzati e trasportati automaticamente dal server al client.

## Avvertenze SSR

La soluzione SSR isomorfa di Solid è molto potente. Puoi scrivere il tuo codice principalmente come base di codice singola che funziona in modo simile in entrambi gli ambienti. Tuttavia ci sono aspettative che questo metta su idratazione. Principalmente che la vista renderizzata nel client è la stessa che sarebbe resa sul server. Non ha bisogno di essere esatto in termini di testo. Strutturalmente il markup dovrebbe essere lo stesso.

Usiamo i marcatori resi nel server per abbinare elementi e posizioni delle risorse sul server. Per questo motivo Client e Server dovrebbero avere gli stessi componenti. Questo non è in genere un problema dato che Solid esegue il rendering allo stesso modo su client e server. Attualmente non esiste un metodo per rendere qualcosa sul server che non si idrata sul client. Non è possibile idratare parzialmente un'intera pagina e non generare indicatori di idratazione per essa. L'idratazione parziale è qualcosa che vogliamo esplorare in futuro.

Infine, tutte le risorse devono essere definite nell'albero `render`. Vengono automaticamente serializzati e prelevati nel browser. Funziona perché i metodi `render` o `pipeTo` tengono traccia dell'avanzamento del rendering. Non possiamo fare nulla se vengono creati in un contesto isolato. Allo stesso modo non c'è reattività sul server. Non aggiornare i segnali durante il rendering iniziale e aspettarti che si riflettano più in alto nell'albero. Ci sono limiti di Suspense ma l'SSR di Solid viene elaborato dall'alto verso il basso.

## Iniziare con SSR

Le configurazioni SSR sono complicate. Abbiamo alcuni esempi nel pacchetto [solid-ssr](https://github.com/solidjs/solid/blob/main/packages/solid-ssr).

È in lavorazione un nuovo antipasto [SolidStart](https://github.com/solidjs/solid-start) che mira a rendere questa esperienza molto più fluida.

## Iniziare con la generazione di siti statici

[solid-ssr](https://github.com/solidjs/solid/blob/main/packages/solid-ssr) viene fornito anche con una semplice utility per la generazione di siti statici o prerenderizzati. Leggi il README per maggiori informazioni.
