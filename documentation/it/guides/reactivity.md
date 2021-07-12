# Reattività

La gestione dei dati in Solid utilizza primitive reattive che sono responsabili di tutti gli aggiornamenti. Utilizza un approccio molto simile a MobX o Vue, tranne per il fatto che non scambia mai la sua granularità con un VDOM. Le dipendenze vengono tracciate automaticamente quando accedi ai tuoi valori reattivi in Effetti e codice JSX.

Le primitive di Solid sono chiamate `create` che spesso restituiscono tuple. Generalmente il primo elemento è una primitiva leggibile e il secondo è un setter. È comune riferirsi solo alla parte leggibile con il nome primitivo.

Ecco un contatore di incremento automatico di base che si aggiorna in base all'impostazione del segnale `count`.

```jsx
import { createSignal, onCleanup } from "solid-js";
import { render } from "solid-js/web";

const App = () => {
  const [counteggio, setCounteggio] = createSignal(0),
    timer = setInterval(() => setCounteggio(counteggio() + 1), 1000);
  onCleanup(() => clearInterval(timer));

  return <div>{counteggio()}</div>;
};

render(() => <App />, document.getElementById("app"));
```

## Presentazione dei primitivi

Solid è costituito da 3 primitive primarie, Segnale, Memo ed Effetto. Al centro c'è il pattern Observer in cui i segnali (e i promemoria) vengono tracciati avvolgendo i promemoria e gli effetti.

I segnali sono la primitiva più semplice. Contengono valore e ottengono e impostano funzioni in modo da poter intercettare quando vengono letti e scritti.

```js
const [counteggio, setCounteggio] = createSignal(0);
```

Gli effetti sono funzioni che forniscono letture del nostro segnale. Viene eseguito nuovamente ogni volta che il valore di un segnale dipendente cambia. Questo è utile per creare effetti collaterali, come il rendering.

```js
createEffect(() => console.log("L'ultimo conteggio è ", counteggio()));
```

Infine, i Memo sono valori derivati memorizzati nella cache. Condividono le proprietà di entrambi i segnali e gli effetti. Tracciano i propri segnali dipendenti, rieseguendoli solo quando questi cambiano e sono essi stessi segnali tracciabili.

```js
const nome = createMemo(() => `${nomeBattsimo()} ${cognome()}`);
```

## Come funziona

I segnali sono emettitori di eventi che contengono un elenco di abbonamenti. Notificano ai loro abbonati ogni volta che il loro valore cambia.

Dove le cose si fanno più interessanti è come avvengono questi abbonamenti. Solid utilizza il monitoraggio automatico delle dipendenze. Gli aggiornamenti avvengono automaticamente quando i dati cambiano.

Il trucco è uno stack globale in fase di esecuzione. Prima che un Effetto o Memo esegua (o riesegui) la sua funzione fornita dallo sviluppatore, si spinge su quello stack. Quindi qualsiasi segnale che viene letto controlla se c'è un listener corrente nello stack e in tal caso aggiunge il listener alle sue sottoscrizioni.

Puoi pensarla così:

```js
function createSignal(value) {
  const iscritti = new Set();

  const leggere = () => {
    const listener = getCurrentListener();
    if (listener) iscritti.add(listener);
    return valore;
  };

  const scrivi = nextValue => {
    valore = valoreSuccessivo;
    for (const isc of iscritti) isc.run();
  };

  return [read, scrivi];
}
```

Ora ogni volta che aggiorniamo il segnale sappiamo quali effetti eseguire nuovamente. Semplice ma efficace. L'effettiva implementazione è molto più complicata, ma questo è il succo di ciò che sta accadendo.

Per una comprensione più dettagliata di come funziona Reattività, questi sono articoli utili (in inglese):

[A Hands-on Introduction to Fine-Grained Reactivity](https://dev.to/ryansolid/a-hands-on-introduction-to-fine-grained-reactivity-3ndf)

[Building a Reactive Library from Scratch](https://dev.to/ryansolid/building-a-reactive-library-from-scratch-1i0p)

[SolidJS: Reactivity to Rendering](https://indepth.dev/posts/1289/solidjs-reactivity-to-rendering)

## Considerazioni

Questo approccio alla reattività è molto potente e dinamico. Può gestire le dipendenze che cambiano al volo eseguendo diversi rami di codice condizionale. Funziona anche attraverso molti livelli di indiretto. Viene tracciata anche qualsiasi funzione eseguita all'interno di un ambito di tracciamento.

Ci sono alcuni comportamenti chiave e compromessi di cui dobbiamo essere consapevoli.

1. Tutta la reattività viene tracciata direttamente dalle chiamate di funzione. Possono anche essere nascosti sotto getter/proxy e attivati ​​dall'accesso alla proprietà. Ciò significa che è importante dove si accede alle proprietà sugli oggetti reattivi.

2. I componenti ei callback dai flussi di controllo non tengono traccia degli ambiti. Eseguono solo una volta. Ciò significa che la destrutturazione o l'esecuzione della logica di primo livello nei componenti non verrà rieseguita. È necessario accedere a questi segnali, negozi e oggetti di scena dall'interno di altre primitive reattive o JSX per quella parte del codice da rivalutare.

3. Questo approccio tiene traccia solo in modo sincrono. Se hai un setTimeout o usi una funzione asincrona nel tuo effetto, verrà eseguito asincrono. Quindi non verrà più tracciato.
