# Iniziare

## Prova Solid

Il modo migliore per imparare Solid è provarlo online. Il nostro REPL su https://playground.solidjs.com è il modo perfetto per sperimentare i concetti fondamentali. Così come https://codesandbox.io/ dove puoi modificare uno qualsiasi dei nostri esempi.

In alternativa, puoi utilizzare i nostri semplici modelli [Vite](https://vitejs.dev/) eseguendo questi comandi nel tuo terminale:

```sh
> npx degit solidjs/templates/js my-app
> cd mia-app
> npm i # o yarn o pnpm
> npm run dev # o yarn o pnpm
```

O per TypeScript:

```sh
> npx degit solidjs/templates/ts my-app
> cd mia-app
> npm i # o yarn o pnpm
> npm run dev # o fyarn o pnpm
```

## Impara Solid

Il Solid è composto da piccoli pezzi componibili che fungono da elementi costitutivi nelle applicazioni. Questi pezzi sono per lo più funzioni che costituiscono molte API superficiali di alto livello. Fortunatamente, non avrai bisogno di conoscerne la maggior parte per iniziare con la libreria.

I due principali tipi di blocchi a tua disposizione sono i componenti e le primitive reattive.

I componenti sono funzioni che accettano un oggetto di props e restituiscono elementi JSX inclusi elementi DOM nativi e altri componenti. Possono essere espressi come elementi JSX in PascalCase:

```jsx
function MyComponent(props) {
  return <div>Ciao {props.name}</div>;
}

<MyComponent name="Solid" />;
```

I componenti sono leggeri. Non sono stateful di per sé e non hanno istanze. Servono invece come funzioni di fabbrica per gli elementi DOM e le primitive reattive.

La reattività a grana fine è costruita su 3 semplici primitive: Segnali, Memo ed Effetti. Insieme, formano un motore di sincronizzazione con tracciamento automatico che garantisce che la tua vista rimanga aggiornata. I calcoli reattivi assumono la forma di semplici espressioni con wrapping di funzioni che vengono eseguite in modo sincrono.

```js
const [first, setFirst] = createSignal("JSON");
const [last, setLast] = createSignal("Bourne");

createEffect(() => console.log(`${first()} ${last()}`));
```

Puoi saperne di più su [Reattività di Solid](https://www.solidjs.com/docs/latest#reactivity) e [Rendering di Solid](https://www.solidjs.com/docs/latest#rendering).

## Pensa in modo Solid

Il design di Solid contiene diverse opinioni su quali principi e valori ci aiutano a costruire al meglio siti Web e applicazioni. È più facile imparare e utilizzare Solid quando si è consapevoli della filosofia alla base.

### 1. Dati dichiarativi

Declarative data combines the description of data’s behavior to its declaration. This allows for easy composition by packaging all aspects of data’s behavior in a single place.

### 2. Componenti a scomparsa

È piuttosto difficile strutturare i componenti senza prendere in considerazione gli aggiornamenti. Gli aggiornamenti Solid sono completamente indipendenti dai componenti. Le funzioni componenti vengono chiamate una volta e poi cessano di esistere. Esistono componenti per organizzare il tuo codice e non molto altro.

### 3. Lettura/scrittura

Precise control and predictability make for better systems. We don't need true immutability to enforce unidirectional flow, only the ability to make the conscious decision which consumers may write and which may not.

### 4. Semplice è meglio che facile

Ecco una lezione che viene dalla reattività a grana fine. Vale la pena avere convenzioni esplicite e coerenti anche se richiedono uno sforzo maggiore. Lo scopo è fornire strumenti minimi che servano come base su cui costruire.

## Web Components

Solid nasce con il desiderio di avere Web Components come cittadini di prima classe. Nel tempo il suo design si è evoluto e gli obiettivi sono cambiati. Tuttavia, Solid è ancora un ottimo modo per creare Web Components. [Solid Element](https://github.com/solidjs/solid/tree/main/packages/solid-element) consente di scrivere e avvolgere i componenti funzione di Solid per produrre componenti Web piccoli e performanti. All'interno delle app Solid Solid Element è ancora in grado di sfruttare l'API di contesto di Solid e Solid Portals supportano lo stile isolato Shadow DOM.

## Rendering del server

Solid ha una soluzione di rendering lato server dinamico che fornisce un'esperienza di sviluppo veramente isomorfa. Attraverso l'uso della nostra primitiva Resource, le richieste di dati asincroni vengono facilmente effettuate e automaticamente serializzate e sincronizzate tra client e browser.

Poiché Solid supporta il rendering asincrono e in streaming sul server, puoi scrivere il tuo codice in un modo e farlo eseguire sul server. Ciò significa che funzionalità come [render-as-you-fetch](https://reactjs.org/docs/concurrent-mode-suspense.html#approach-3-render-as-you-fetch-using-suspense) e code splitting funzionano solo in Solid.

Per maggiori informazioni, leggi la [Guida al server](https://www.solidjs.com/docs/latest#server-side-rendering).

## Nessuna compilazione?

Non ti piace JSX? Non ti dispiace fare il lavoro manuale per avvolgere le espressioni, prestazioni peggiori e avere pacchetti di dimensioni maggiori? In alternativa, puoi creare un'app Solid usando Tagged Template Literals o HyperScript in ambienti non compilati.

Puoi eseguirli direttamente dal browser utilizzando [Skypack](https://www.skypack.dev/):

```html
<html>
  <body>
    <script type="module">
      import { createSignal, onCleanup } from "https://cdn.skypack.dev/solid-js";
      import { render } from "https://cdn.skypack.dev/solid-js/web";
      import html from "https://cdn.skypack.dev/solid-js/html";

      const App = () => {
        const [counteggio, impostatoConteggio] = createSignal(0),
          timer = setInterval(() => setConteggio(counteggio() + 1), 1000);
        onCleanup(() => clearInterval(timer));
        return html`<div>${counteggio}</div>`;
      };
      render(App, document.body);
    </script>
  </body>
</html>
```

Ricorda che hai ancora bisogno della corrispondente libreria di espressioni DOM affinché funzionino con TypeScript. È possibile utilizzare i valori letterali dei modelli con tag con le espressioni Lit DOM o HyperScript con le espressioni Hyper DOM.
