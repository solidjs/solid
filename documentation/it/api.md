# Reattività

## `createSignal`

```ts
export function createSignal<T>(
  value: T,
  options?: { name?: string; equals?: false | ((prev: T, next: T) => boolean) }
): [get: () => T, set: (v: T) => T];
```

La primitiva reattiva più elementare utilizzata per tracciare un singolo valore che cambia nel tempo è createSignal. La funzione create restituisce una coppia di funzioni get e set per accedere e aggiornare il segnale.

```js
const [leggereValore, assegnaValore] = createSignal(valorePredefinito);

// assegna il valore con un setter di funzioni
leggereValore();

// assegna il valore con un setter di funzioni
assegnaValore(valoreSuccessivo);

// assegna il valore con un setter di funzioni
assegnaValore(assegnaValore => assegnaValore + successivo);
```

Remember to access signals under a tracking scope if you wish them to react to updates. Tracking scopes are functions that are passed to computations like `createEffect` or JSX expressions.

> Per memorizzare una funzione in un segnale utilizzerai il modulo funzione:
>
> ```js
> assegnaValore(() => ilFunzione);
> ```

## `createEffect`

```ts
export function createEffect<T>(fn: (v: T) => T, value?: T, options?: { name?: string }): void;
```

Questo creerà un nuovo calcolo che tiene traccia automaticamente delle dipendenze. Viene eseguito dopo ogni rendering in cui è cambiata una dipendenza. È ideale per l'utilizzo di `ref`s e la gestione di altri effetti collaterali.

```js
const [a, assegnaA] = createSignal(valorePredefinito);

// effetto che dipende dal segnale `a`
createEffect(() => altroAffetto(a()));
```

La funzione effetto viene chiamata con il valore restituito dall'ultima esecuzione della funzione effetto. Questo valore può essere inizializzato come secondo argomento opzionale. Questo può essere utile per differenziare senza creare una chiusura aggiuntiva.

```js
createEffect(prev => {
  const somma = a() + b();
  if (somma !== prev) console.log(somma);
  return somma;
}, 0);
```

## `createMemo`

```ts
export function createMemo<T>(
  fn: (v: T) => T,
  value?: T,
  options?: { name?: string; equals?: false | ((prev: T, next: T) => boolean) }
): () => T;
```

Crea un segnale derivato di sola lettura che ricalcola il suo valore ogni volta che le dipendenze del codice eseguito vengono aggiornate.

```js
const ottenereValore = createMemo(() => calcoloImpegnativo(a(), b()));

// leggere valore
ottenereValore();
```

La funzione memo viene chiamata con il valore restituito dall'ultima esecuzione della funzione memo. Questo valore può essere inizializzato come secondo argomento opzionale. Questo è utile per ridurre i calcoli.

```js
const somma = createMemo(somma => input() + somma, 0);
```

## `createResource`

```ts
type ResourceReturn<T> = [
  {
    (): T | undefined;
    loading: boolean;
    error: any;
  },
  {
    mutate: (v: T | undefined) => T | undefined;
    refetch: () => void;
  }
];

export function createResource<T, U = true>(
  fetcher: (k: U, getPrev: () => T | undefined) => T | Promise<T>,
  options?: { initialValue?: T; name?: string }
): ResourceReturn<T>;

export function createResource<T, U>(
  source: U | false | null | (() => U | false | null),
  fetcher: (k: U, getPrev: () => T | undefined) => T | Promise<T>,
  options?: { initialValue?: T; name?: string }
): ResourceReturn<T>;
```

Crea un segnale in grado di gestire le richieste asincrone. Il `fetcher` è una funzione asincrona che accetta il valore di ritorno della `sorgente` se fornito e restituisce una Promessa il cui valore risolto è impostato nella risorsa.

Il recuperatore non è reattivo. Usa il primo argomento opzionale se desideri che venga eseguito più di una volta. Se l'origine si risolve in false, null o undefined, non verrà recuperato.

```js
const [data, { mutate, refetch }] = createResource(getQuery, fetchData);

// leggere valore
data();

// controlla se stai caricando
data.loading;

// controlla se sbagli
data.error;

// impostare direttamente il valore senza creare promesse
mutate(valoreOttmista);

// recupera l'ultima richiesta solo perché
refetch();
```

"loading" ed "error" sono getter reattivi e possono essere tracciati.

# Cicli vitali

## `onMount`

```ts
export function onMount(fn: () => void): void;
```

Registra un metodo che viene eseguito dopo che tutti gli elementi di rendering iniziali sono stati montati. Questo è l'ideale per usare `ref`s e gestire altri effetti collaterali di una volta. È equivalente a un `createEffect` che non ha dipendenze.

## `onCleanup`

```ts
export function onCleanup(fn: () => void): void;
```

Registra un metodo di pulizia che viene eseguito in caso di eliminazione o ricalcolo dell'ambito reattivo corrente. Può essere utilizzato in qualsiasi componente o effetto.

## `onError`

```ts
export function onError(fn: (err: any) => void): void;
```

Registra un metodo del gestore degli errori che viene eseguito in caso di errori nell'ambito figlio. Vengono eseguiti solo i gestori di errori di ambito più vicini. Rilancia per attivare la linea.

# Utilità reattive

Questi helper offrono la possibilità di pianificare più facilmente gli aggiornamenti. Controllano anche come viene tracciata la reattività.

## `untrack`

```ts
export function untrack<T>(fn: () => T): T;
```

Ignora il rilevamento delle dipendenze nel blocco di codice in esecuzione e restituisce il valore.

## `batch`

```ts
export function batch<T>(fn: () => T): T;
```

Trattiene il processo di commit degli aggiornamenti. Qualunque cosa sia dichiarata all'interno del blocco viene conservata fino a quando la funzione non si risolve per evitare ricalcoli non necessari. La lettura dei valori sulle righe successive all'interno del blocco non verrà quindi aggiornata consecutivamente.

Nota: Solid Store, un modello di dati più avanzato disponibile in Solid, avvolge automaticamente i metodi set ed Effect con batch.

## `on`

```ts
export function on<T extends Array<() => any> | (() => any), U>(
  deps: T,
  fn: (input: T, prevInput: T, prevValue?: U) => U,
  options: { defer?: boolean } = {}
): (prevValue?: U) => U | undefined;
```

"on" è progettato per essere passato in un calcolo per rendere esplicite le sue dipendenze. Se viene passato un array di dipendenze, allora "input" e "prevInput" saranno array.

```js
createEffect(on(a, v => console.log(v, b())));

// è equivalente a:
createEffect(() => {
  const v = a();
  untrack(() => console.log(v, b()));
});
```

Puoi anche impedire l'esecuzione immediata del calcolo. È possibile specificare di assegnare la modifica impostando l'opzione di rinvio su true.

```js
// non viene eseguito immediatamente
createEffect(on(a, v => console.log(v), { defer: true }));

setA("new"); // ora funziona
```

## `createRoot`

```ts
export function createRoot<T>(fn: (dispose: () => void) => T): T;
```

Crea un nuovo contesto non tracciato. Inoltre non è auto-smaltato. Ciò è utile per i contesti reattivi nidificati che non si desidera rilasciare quando il genitore rivaluta. Questo può essere usato come un potente modello per la memorizzazione nella cache.

Tutto il codice Solid dovrebbe essere racchiuso in uno di questi livelli superiori in quanto assicurano che tutta la memoria/i calcoli siano liberati. Normalmente non devi preoccuparti di questo dato che `createRoot` è incorporato in tutte le funzioni di immissione di `render`.

## `mergeProps`

```ts
export function mergeProps(...sources: any): any;
```

Un metodo di "unione" reattivo. È utile per impostare gli oggetti di scena predefiniti per i componenti nel caso in cui il chiamante non li fornisca. È anche utile per clonare l'oggetto props con proprietà reattive.

Questo metodo funziona utilizzando un proxy e risolvendo le proprietà in ordine inverso. Ciò consente il tracciamento dinamico delle proprietà che non sono presenti quando l'oggetto prop viene unito per la prima volta.

```js
// proprietà predefinite
props = mergeProps({ nome: "Davide" }, props);

// proprietà del clone
newProps = mergeProps(proprietà);

// proprietà unite
props = mergeProps(props, altreProprieta);
```

## `splitProps`

```ts
export function splitProps<T>(props: T, ...keys: Array<(keyof T)[]>): [...parts: Partial<T>];
```

Questo è un sostituto della destrutturazione. Divide un oggetto reattivo per chiavi mantenendo la reattività.

```js
const [locale, altre] = splitProps(props, ["children"]);

<>
  <Child {...altre} />
  <div>{locale.children}<div>
</>
```

## `useTransition`

```ts
export function useTransition(): [() => boolean, (fn: () => void, cb?: () => void) => void];
```

Utilizzato per eseguire in batch gli aggiornamenti asincroni in una transazione rinviando il commit fino al completamento di tutti i processi asincroni. Questo processo è legato a Suspense e tiene traccia solo delle risorse lette sotto i limiti di Suspense.

```js
const [sospeso, inizio] = useTransition();

// controlla se stai effettuando la transizione
sospeso();

// avvolgere in transizione
inizio(() => setSignal(nuovoValore), () => /* la transizione è fatta */)
```

## `observable`

```ts
export function observable<T>(input: () => T): Observable<T>;
```

Un metodo che prende un segnale e produce un semplice osservabile. Puoi consumarlo dalla libreria Observable di tua scelta. Questo di solito accade con l'operatore `from`.

```js
import { from } from "rxjs";

const [s, set] = createSignal(0);

const obsv$ = from(observable(s));

obsv$.subscribe(v => console.log(v));
```

## `mapArray`

```ts
export function mapArray<T, U>(
  list: () => readonly T[],
  mapFn: (v: T, i: () => number) => U
): () => U[];
```

Un aiutante di mappa reattivo che memorizza nella cache ogni elemento per riferimento. Questo viene utilizzato per ridurre la mappatura non necessaria sugli aggiornamenti. Esegue la funzione di mappatura solo una volta per valore, quindi la sposta o la rimuove secondo necessità. L'argomento index è un segnale. La funzione mappa stessa non sta tracciando.

Questo è un helper sottostante per il componente del flusso di controllo integrato `<For>`.

```js
const mapped = mapArray(source, (modella) => {
  const [nome, assegnaNome] = createSignal(modella.nome);
  const [modella, assegnaDescrizione] = createSignal(modella.modella);

  return {
    id: model.id,
    get nome() {
      return nome();
    },
    get descrizione() {
      return descrizione();
    }
    assegnaNome,
    assegnaDescrizione
  }
});
```

## `indexArray`

```ts
export function indexArray<T, U>(
  list: () => readonly T[],
  mapFn: (v: () => T, i: number) => U
): () => U[];
```

È simile a `mapArray` tranne che mappa per indice. L'elemento è un segnale e l'indice è ora la costante.

Helper sottostante per il flusso di controllo `<Index>`.

```js
const mapped = indexArray(source, (modella) => {
  return {
    get id() {
      return modella().id
    }
    get firstInitial() {
      return modella().nome[0];
    },
    get fullName() {
      return `${modella().nome} ${modella().cognome}`;
    },
  }
});
```

# Stores

Queste API sono disponibili su `solid-js/store`.

## `createStore`

```ts
export function createStore<T extends StoreNode>(
  state: T | Store<T>,
  options?: { name?: string }
): [get: Store<T>, set: SetStoreFunction<T>];
```

Questa utility crea un albero di Segnali come proxy. Consente di tenere traccia dei singoli valori in strutture dati nidificate. La funzione create restituisce un oggetto proxy di sola lettura e una funzione setter.

```js
const [state, setState] = createStore(initialValue);

// legerre valore
state.unValore;

// set value
setState({ merge: "questoValore" });

setState("percorso", "verso", "valore", nuovoValore);
```

Poiché gli oggetti Store sono proxy, tengono traccia solo dell'accesso alla proprietà. All'accesso, Store produce in modo ricorsivo oggetti nidificati su dati nidificati. Questo tuttavia avvolge solo array e oggetti semplici. Le classi non sono chiuse. Elementi come "Data", "HTMLElement", "Regexp", "Mappa", "Set" non sono granularmente reattivi.

Si noti che l'oggetto di stato di livello superiore non può essere tracciato senza accedere a una proprietà su di esso. Non è adatto per le cose su cui si esegue l'iterazione poiché l'aggiunta di nuove chiavi o indici non può attivare gli aggiornamenti. Quindi dovresti mettere qualsiasi elenco su una chiave di stato piuttosto che provare a usare l'oggetto di stato stesso.

```js
// metti la lista come chiave sull'oggetto di stato
const [state, setState] = createStore({ elenco: [] });

// accedere alla proprietà `elenco` sull'oggetto stato
<For each={state.elenco}>{articolo => /*...*/}</For>
```

### Getters

Gli oggetti Store supportano l'uso di getter per memorizzare i valori calcolati.

```js
const [state, setState] = createStore({
  user: {
    nome: "Davide",
    cognome: "Italiano",
    get nome() {
      return `${this.nome} ${this.cognome}`;
    }
  }
});
```

Questi sono semplici getter. È comunque necessario utilizzare un Memo se si desidera memorizzare nella cache un valore:

```js
let nomeECognome;
const [stato, assegnareStato] = createStore({
  user: {
    nome: "Davide",
    cognome: "Italiano",
    get nomeECognome() {
      return nomeECognome();
    }
  }
});
nomeECognome = createMemo(() => `${state.nome} ${state.cognome}`);
```

### Aggiornamento dei negozi Store

Le modifiche possono assumere la forma di funzioni che forniscono lo stato precedente e restituiscono un nuovo stato o un valore. Gli oggetti sono sempre uniti in modo superficiale. Imposta i valori su "non definito" per eliminarli dallo Store.

```js
const [stato, assegnareStato] = createStore({ nome: "John", cognome: "Azzuro" });

assegnareStato({ nome: "Davide", middleName: "Paolo" });
// ({ nome: 'Davide', middleName: 'Paolo', cognome: 'Italiano' })

assegnareStato(stato => ({ nomePreferito: state.nome, cognome: "Azzuro" }));
// ({ nome: 'Davide', nomePreferito: 'Davide', middleName: 'Paolo', cognome: 'Azzuro' })
```

Store supporta percorsi inclusi array di chiavi, intervalli di oggetti e funzioni di filtro.

In questo esempio, assegnareStato supporta anche l'impostazione nidificata in cui è possibile indicare il percorso della modifica. Quando nidificato, lo stato che stai aggiornando potrebbe essere altri valori non Object. Gli oggetti vengono ancora uniti ma gli altri valori (inclusi gli array) vengono sostituiti.

```js
const [stato, assegnareStato] = createStore({
  counter: 2,
  elenco: [
    { id: 23, titolo: 'Uccelli' }
    { id: 27, titolo: 'Pesce' }
  ]
});

assegnareStato('counter', c => c + 1);
assegnareStato('elenco', l => [...l, { id: 43, titolo: 'Marsupiali' }]);
assegnareStato('elenco', 2, 'legerre', true);
// {
//   counter: 3,
//   elenco: [
//     { id: 23, titolo: 'Uccelli' }
//     { id: 27, titolo: 'Pesce' }
//     { id: 43, titolo: 'Marsupiali', read: true }
//   ]
// }
```

Il percorso può essere costituito da chiavi stringa, array di chiavi, oggetti iterativi ({da, a, per}) o funzioni di filtro. Dà un incredibile potere espressivo per descrivere i cambiamenti di stato.

```js
const [stato, assegnareStato] = createStore({
  compiti: [
    { compito: 'Finito di lavorare', fatto: false }
    { compito: 'Andare a fare la spesa', fatto: false }
    { compito: 'Preparare la cena', fatto: false }
  ]
});

assegnareStato('todos', [0, 2], 'completato', true);

// {
//   compiti: [
//     { compito: 'Finito di lavorare', fatta: true }
//     { compito: 'Andare a fare la spesa', fatta: false }
//     { compito: 'Preparare la cena', fatta: true }
//   ]
// }

assegnareStato('todos', { from: 0, to: 1 }, 'fatta', c => !c);

// {
//   compiti: [
//     { compito: 'Finito di lavorare', fatta: false }
//     { compito: 'Andare a fare la spesa', fatta: false }
//     { compito: 'Preparare la cena', fatta: true }
//   ]
// }

assegnareStato('compiti', compiti => compiti.fatta, 'compito', t => t + '!')

// {
//   compiti: [
//     { compito: 'Finito di lavorare', fatta: false }
//     { compito: 'Andare a fare la spesa', fatta: true }
//     { compito: 'Preparare la cena', fatta: true }
//   ]
// }

assegnareStato('compiti', {}, compiti => ({ marked: true, fatta: !todo.fatta }))
// {
//   compiti: [
//     { compito: 'Finish work', fatta: true, marked: true }
//     { compito: 'Go grocery shopping!', fatta: false, marked: true }
//     { compito: 'Make dinner!', fatta: false, marked: true }
//   ]
// }
```

## `produce`

```ts
export function produce<T>(
  fn: (state: T) => void
): (state: T extends NotWrappable ? T : Store<T>) => T extends NotWrappable ? T : Store<T>;
```

API ispirata a "Immer" per oggetti Solid's Store che consente la mutazione localizzata.

```js
setState(
  produce(s => {
    s.utente.nome = "Franco";
    s.lista.push("Matita");
  })
);
```

## `reconcile`

```ts
export function reconcile<T>(
  value: T | Store<T>,
  options?: {
    key?: string | null;
    merge?: boolean;
  } = { key: "id" }
): (state: T extends NotWrappable ? T : Store<T>) => T extends NotWrappable ? T : Store<T>;
```

Questa utility rileva la modifica dei dati differenziali quando non è possibile applicare aggiornamenti granulari. Utile per quando si tratta di dati immutabili da negozi o risposte API di grandi dimensioni.

La chiave viene utilizzata quando disponibile per abbinare gli elementi. Per impostazione predefinita, `merge` false esegue controlli referenziali ove possibile per determinare l'uguaglianza e sostituisce laddove gli elementi non sono referenziali uguali. `merge` true spinge tutte le differenze alle foglie e trasforma efficacemente i dati precedenti nel nuovo valore.

```js
// subscribing to an observable
const anulla = store.subscribe(({ todos }) => (
  setState('compiti', reconcile(todos)));
);
onCleanup(() => anulla());
```

## `createMutable`

```ts
export function createMutable<T extends StoreNode>(
  state: T | Store<T>,
  options?: { name?: string }
): Store<T> {
```

Crea un nuovo oggetto proxy Store mutabile. Registra solo gli aggiornamenti dei trigger in caso di modifica dei valori. Il tracciamento viene gestito intercettando l'accesso alla proprietà e traccia automaticamente l'annidamento profondo tramite proxy.

Utile per l'integrazione di sistemi esterni o come livello di compatibilità con MobX/Vue.

> **Nota:** uno stato mutabile può essere passato e mutato ovunque. Può rendere più difficile da seguire e più facile interrompere il flusso unidirezionale. In genere si consiglia di utilizzare invece createStore. Il modificatore di produzione può dare molti degli stessi benefici senza nessuno degli svantaggi.

```js
const stato = createMutable(initialValue);

// legerre valore
stato.valore;

// assegna valore
stato.valore = 5;

stato.lista.push(altroValore);
```

I mutabili supportano i setter insieme ai getter.

```js
const persona = createMutable({
  nome: "John",
  cognome: "Smith",
  get nome() {
    return `${this.nome} ${this.cognome}`;
  },
  set cognome(value) {
    [this.nome, this.cognome] = valore.split(" ");
  }
});
```

# API dei componenti

## `createContext`

```ts
interface Context<T> {
  id: symbol;
  Provider: (props: { value: T; children: any }) => any;
  defaultValue: T;
}
export function createContext<T>(defaultValue?: T): Context<T | undefined>;
```

Il contesto fornisce una forma di iniezione di dipendenza in Solid. Viene utilizzato per evitare di dover passare dati come oggetti di scena attraverso componenti intermedi.

Questa funzione crea un nuovo oggetto di contesto che può essere utilizzato con `useContext` e fornisce il flusso di controllo `Provider`. Il contesto predefinito viene utilizzato quando nella gerarchia non viene trovato alcun "provider".

```js
export const ContestoContatore = createContext([{ conta: 0 }, {}]);

export function Fornitrice(props) {
  const [stato, assegnaStato] = createStore({ conta: props.conta || 0 });
  const store = [
    stato,
    {
      incremento() {
        assegnaStato("conta", c => c + 1);
      },
      decremento() {
        assegnaStato("conta", c => c - 1);
      }
    }
  ];

  return <Fornitrice.Provider value={store}>{props.children}</Fornitrice.Provider>;
}
```

Il valore fornito al provider viene passato a "useContext" così com'è. Ciò significa che il wrapping come espressione reattiva non funzionerà. Dovresti passare direttamente a Segnali e Negozi invece di accedervi in JSX.

## `useContext`

```ts
export function useContext<T>(context: Context<T>): T;
```

Utilizzato per acquisire il contesto e consente il passaggio profondo degli oggetti di scena senza doverli passare attraverso ciascuna funzione del componente.

```js
const [stato, { incremento, decremento }] = useContext(ContestoContatore);
```

## `children`

```ts
export function children(fn: () => any): () => any;
```

Utilizzato per semplificare l'interazione con `props.children`. Questo helper risolve qualsiasi reattività nidificata e restituisce un memo. È l'approccio consigliato per utilizzare `props.children` per qualsiasi cosa diversa dal passaggio diretto a JSX.

```js
const list = children(() => props.children);

// fare qualcosa con loro
createEffect(() => lista());
```

## `lazy`

```ts
export function lazy<T extends Component<any>>(
  fn: () => Promise<{ default: T }>
): T & { preload: () => Promise<T> };
```

Utilizzato per caricare lentamente i componenti per consentire la suddivisione del codice. I componenti non vengono caricati fino al rendering. I componenti caricati pigri possono essere usati come la loro controparte importata staticamente, ricevendo oggetti di scena ecc... I componenti pigri attivano `<Suspense>`

```js
// avvolgere l'importazione
const ComponenteA = lazy(() => import("./ComponentA"));

// utilizzare in JSX
<ComponenteA title={props.title} />;
```

# Primitive secondarie

Probabilmente non ti serviranno per la tua prima app, ma questi utili strumenti per avere.

## `createDeferred`

```ts
export function createDeferred<T>(
  source: () => T,
  options?: { timeoutMs?: number; name?: string; equals?: false | ((prev: T, next: T) => boolean) }
): () => T;
```

Crea un readonly che notifica le modifiche downstream solo quando il browser è inattivo. `timeoutMs` è il tempo massimo di attesa prima di forzare l'aggiornamento.

## `createComputed`

```ts
export function createComputed<T>(fn: (v: T) => T, value?: T, options?: { name?: string }): void;
```

Crea una proprietà di sola lettura che notifica le modifiche downstream solo quando il browser è inattivo. `timeoutMs` è il tempo massimo di attesa prima di forzare l'aggiornamento.

## `createRenderEffect`

```ts
export function createRenderEffect<T>(
  fn: (v: T) => T,
  value?: T,
  options?: { name?: string }
): void;
```

Crea un nuovo calcolo che tiene traccia automaticamente delle dipendenze. Viene eseguito anche durante la fase di rendering poiché gli elementi DOM vengono creati e aggiornati ma non necessariamente collegati. Tutti gli aggiornamenti DOM interni vengono eseguiti in questo momento.

## `createSelector`

```ts
export function createSelector<T, U>(
  source: () => T,
  fn?: (a: U, b: T) => boolean,
  options?: { name?: string }
): (k: U) => boolean;
```

Questo crea un segnale condizionale che notifica agli abbonati solo quando entrano o escono dalla loro chiave che corrisponde al valore. Utile per lo stato di selezione delegata. Poiché esegue l'operazione O(2) invece di O(n).

```js
const selezionata = createSelector(selectedId);

<For each={lista()}>
  {item => <li classList={{ attivo: selezionata(item.id) }}>{articolo.nome}</li>}
</For>;
```

# Rendering

Queste importazioni sono esposte da `solid-js/web`.

## `render`

```ts
export function render(code: () => JSX.Element, element: MountableElement): () => void;
```

Questo è il punto di ingresso dell'app del browser. Fornisce una definizione o una funzione del componente di primo livello e un elemento su cui montare. È consigliabile che questo elemento rimanga vuoto poiché la funzione di eliminazione restituita cancellerà tutti i figli.

```js
const smaltire = render(App, document.getElementById("app"));
```

## `hydrate`

```ts
export function hydrate(fn: () => JSX.Element, node: MountableElement): () => void;
```

Questo metodo è simile a "render" tranne che tenta di reidratare ciò che è già stato reso al DOM.

```js
const dispose = hydrate(App, document.getElementById("app"));
```

## `renderToString`

```ts
export function renderToString<T>(
  fn: () => T,
  options?: {
    eventNames?: string[];
    nonce?: string;
  }
): string;
```

Esegue il rendering in una stringa in modo sincrono. La funzione genera anche un tag script per l'idratazione progressiva. Le opzioni includono nomi di eventi da ascoltare prima che la pagina venga caricata e riprodurre su Hydratio. Come bonus viene fornito un nonce da mettere sul tag script.

```js
const html = renderToString(App);
```

## `renderToStringAsync`

```ts
export function renderToStringAsync<T>(
  fn: () => T,
  options?: {
    eventNames?: string[];
    timeoutMs?: number;
    nonce?: string;
  }
): Promise<string>;
```

Uguale a `renderToString` tranne che attenderà che tutti i limiti di `<Suspense>` vengano risolti prima di restituire i risultati. I dati delle risorse vengono serializzati automaticamente nel tag script e vengono idratati al caricamento del client.

```js
const html = await renderToStringAsync(App);
```

## `pipeToNodeWritable`

```ts
export type PipeToWritableResults = {
  startWriting: () => void;
  write: (v: string) => void;
  abort: () => void;
};
export function pipeToNodeWritable<T>(
  fn: () => T,
  writable: { write: (v: string) => void },
  options?: {
    eventNames?: string[];
    nonce?: string;
    noScript?: boolean;
    onReady?: (r: PipeToWritableResults) => void;
    onComplete?: (r: PipeToWritableResults) => void | Promise<void>;
  }
): void;
```

Questo metodo esegue il rendering in un flusso Node. Esegue il rendering del contenuto in modo sincrono, inclusi eventuali segnaposto di fallback di Suspense. Quindi continua a trasmettere i dati da qualsiasi risorsa asincrona man mano che viene completata.

```js
pipeToNodeWritable(App, res);
```

L'opzione `onReady` è utile per scrivere nel flusso attorno al rendering dell'app principale. Ricorda se usi "onReady" per chiamare manualmente "startWriting".

## `pipeToWritable`

```ts
export type PipeToWritableResults = {
  write: (v: string) => void;
  abort: () => void;
  script: string;
};
export function pipeToWritable<T>(
  fn: () => T,
  writable: WritableStream,
  options?: {
    eventNames?: string[];
    nonce?: string;
    noScript?: boolean;
    onReady?: (writable: { write: (v: string) => void }, r: PipeToWritableResults) => void;
    onComplete?: (writable: { write: (v: string) => void }, r: PipeToWritableResults) => void;
  }
): void;
```

Questo metodo esegue il rendering in un flusso web. Esegue il rendering del contenuto in modo sincrono, inclusi eventuali segnaposto di fallback di Suspense. Quindi continua a trasmettere i dati da qualsiasi risorsa asincrona man mano che viene completata.

```js
const { readable, writable } = new TransformStream();
pipeToWritable(App, writable);
```

L'opzione `onReady` è utile per scrivere nel flusso attorno al rendering dell'app principale. Ricorda se usi "onReady" per chiamare manualmente "startWriting".

## `isServer`

```ts
export const isServer: boolean;
```

Ciò indica che il codice viene eseguito come server o bundle del browser. Poiché i runtime sottostanti esportano, questo valore fornisce un valore booleano costante e consente ai bundler di eliminare il codice e le importazioni utilizzate dai rispettivi bundle.

```js
if (isServer) {
  // Non arriverò mai al bundle del browser
} else {
  // Non verrà eseguito sul server;
}
```

# Controllo del flusso

Solid utilizza componenti per il controllo del flusso. Affinché la reattività sia performante, dobbiamo controllare come vengono creati gli elementi. Ad esempio con le liste una semplice `mappa` è inefficiente. Mappa sempre tutto. Ciò significa funzioni di supporto.

Il wrapping di questi in componenti è un modo conveniente per modelli concisi e consente agli utenti di comporre e costruire i propri flussi di controllo.

Questi flussi di controllo integrati verranno importati automaticamente. Tutti tranne "Portal" e "Dynamic" vengono esportati da "solid-js". Quei due che sono specifici del DOM vengono esportati da `solid-js/web`.

> Nota: tutte le funzioni figlio di callback/render del flusso di controllo non sono tracciabili. Ciò consente la creazione dello stato di nidificazione e isola meglio le reazioni.

## `<For>`

```ts
export function For<T, U extends JSX.Element>(props: {
  each: readonly T[];
  fallback?: JSX.Element;
  children: (item: T, index: () => number) => U;
}): () => U[];
```

Semplice flusso di controllo del ciclo con chiave referenziale.

```jsx
<For each={state.list} fallback={<div>Loading...</div>}>
  {item => <div>{item}</div>}
</For>
```

Il secondo argomento opzionale è un segnale di indice:

```jsx
<For each={stato.lista} fallback={<div>Caricamento in corso...</div>}>
  {(articolo, numero) => (
    <div>
      #{numero()} {articolo}
    </div>
  )}
</For>
```

## `<Show>`

```ts
function Show<T>(props: {
  when: T | undefined | null | false;
  fallback?: JSX.Element;
  children: JSX.Element | ((item: T) => JSX.Element);
}): () => JSX.Element;
```

Il flusso di controllo Show viene utilizzato per il rendering condizionale di parte della vista. È simile all'operatore ternario (`a ? b : c`) ma è ideale per creare modelli JSX.

```jsx
<Show when={stato.contaggio > 0} fallback={<div>Caricamento in corso...</div>}>
  <div>I miei contenuti</div>
</Show>
```

Show può anche essere usato come un modo per inserire blocchi in un modello di dati specifico. Ad esempio, la funzione viene rieseguita ogni volta che il modello utente viene sostituito.

```jsx
<Show when={stato.persona} fallback={<div>Caricamento in corso...</div>}>
  {persona => <div>{persona.nome}</div>}
</Show>
```

## `<Switch>`/`<Match>`

```ts
export function Switch(props: { fallback?: JSX.Element; children: JSX.Element }): () => JSX.Element;

type MatchProps<T> = {
  when: T | undefined | null | false;
  children: JSX.Element | ((item: T) => JSX.Element);
};
export function Match<T>(props: MatchProps<T>);
```

Il componente Switch è utile quando sono presenti più di 2 condizioni di mutua esclusione. Può essere usato per fare cose come un semplice routing.

```jsx
<Switch fallback={<div>Non trovato</div>}>
  <Match when={stato.route === "home"}>
    <Home />
  </Match>
  <Match when={stato.route === "settings"}>
    <Settings />
  </Match>
</Switch>
```

Match supporta anche i figli di funzione per fungere da flusso con chiave.

## `<Index>`

```ts
export function Index<T, U extends JSX.Element>(props: {
  each: readonly T[];
  fallback?: JSX.Element;
  children: (item: () => T, index: number) => U;
}): () => U[];
```

Questo componente viene utilizzato per l'iterazione di elenchi senza chiave (righe con chiave per l'indice). Questo è utile quando non c'è una chiave concettuale. Ad esempio se i dati sono primitivi ed è l'indice che è fisso piuttosto che il valore.

L'oggetto è un segnale:

```jsx
<Index each={stato.lista} fallback={<div>Caricamento in corso...</div>}>
  {articolo => <div>{articolo()}</div>}
</Index>
```

Il secondo argomento facoltativo è un numero di indice:

```jsx
<Index each={state.list} fallback={<div>Caricamento in corso...</div>}>
  {(articolo, numero) => (
    <div>
      #{numero} {item()}
    </div>
  )}
</Index>
```

## `<ErrorBoundary>`

```ts
function ErrorBoundary(props: {
  fallback: JSX.Element | ((err: any, reset: () => void) => JSX.Element);
  children: JSX.Element;
}): () => JSX.Element;
```

Contiene errori non rilevati e rende il contenuto di fallback.

```jsx
<ErrorBoundary fallback={<div>Qualcosa è andato terribilmente storto</div>}>
  <MioComponente />
</ErrorBoundary>
```

Supporta anche il modulo di callback che passa per errore e una funzione di ripristino.

```jsx
<ErrorBoundary fallback={(err, reset) => <div onClick={reset}>Error: {err}</div>}>
  <MioComponente />
</ErrorBoundary>
```

## `<Suspense>`

```ts
export function Suspense(props: { fallback?: JSX.Element; children: JSX.Element }): JSX.Element;
```

Un componente che tiene traccia di tutte le risorse lette sotto di esso e mostra uno stato segnaposto di fallback fino a quando non vengono risolte. Ciò che rende "Suspense" diverso da "Show" è che non è bloccante in quanto entrambi i rami esistono contemporaneamente anche se non sono attualmente nel DOM.

```jsx
<Suspense fallback={<div>Caricamento in corso...</div>}>
  <AsyncComponent />
</Suspense>
```

## `<SuspenseList>` (Experimental)

```ts
function SuspenseList(props: {
  children: JSX.Element;
  revealOrder: "forwards" | "backwards" | "together";
  tail?: "collapsed" | "hidden";
}): JSX.Element;
```

`SuspenseList` coordina più componenti paralleli `Suspense` e `SuspenseList`. Controlla l'ordine in cui il contenuto viene rivelato per ridurre il thrashing del layout e ha un'opzione per comprimere o nascondere gli stati di fallback.

```jsx
<SuspenseList revealOrder="forwards" tail="collapsed">
  <ProfileDetails persona={resource.persona} />
  <Suspense fallback={<h2>Caricamento post...</h2>}>
    <ProfileTimeline posts={resource.posts} />
  </Suspense>
  <Suspense fallback={<h2>Caricamento di fatti divertenti...</h2>}>
    <ProfileTrivia trivia={resource.trivia} />
  </Suspense>
</SuspenseList>
```

SuspenseList è ancora sperimentale e non ha il pieno supporto SSR.

## `<Dynamic>`

```ts
function Dynamic<T>(
  props: T & {
    children?: any;
    component?: Component<T> | string | keyof JSX.IntrinsicElements;
  }
): () => JSX.Element;
```

Questo componente ti consente di inserire un Componente o un tag arbitrario e gli passa gli oggetti di scena.

```jsx
<Dynamic component={state.component} someProp={state.something} />
```

## `<Portal>`

```ts
export function Portal(props: {
  mount?: Node;
  useShadow?: boolean;
  isSVG?: boolean;
  children: JSX.Element;
}): Text;
```

Questo inserisce l'elemento nel nodo di montaggio. Utile per inserire Modali al di fuori del layout di pagina. Gli eventi si propagano ancora attraverso la Gerarchia dei componenti.

Il portale è montato in un `<div>` a meno che la destinazione non sia l'intestazione del documento. "useShadow" posiziona l'elemento in una Shadow Root per l'isolamento dello stile e "isSVG" è richiesto se si inserisce in un elemento SVG in modo che "<div>" non sia inserito.

```jsx
<Portal mount={document.getElementById("modal")}>
  <div>My Content</div>
</Portal>
```

# Special JSX Attributes

Solidi tentativi di attenersi il più possibile alle convenzioni DOM. La maggior parte degli oggetti di scena viene trattata come attributi su elementi nativi e proprietà su Web Components. Tuttavia, alcuni di loro hanno un comportamento speciale.

Per gli attributi dello spazio dei nomi personalizzati con TypeScript è necessario estendere lo spazio dei nomi JSX di Solid:

```ts
declare module "solid-js" {
  namespace JSX {
    interface Directives {
      // use:____
    }
    interface ExplicitProperties {
      // prop:____
    }
    interface ExplicitAttributes {
      // attr:____
    }
    interface CustomEvents {
      // on:____
    }
    interface CustomCaptureEvents {
      // oncapture:____
    }
  }
}
```

## `ref`

`Refs` sono un modo per accedere agli elementi DOM sottostanti nel nostro JSX. È vero che si potrebbe assegnare un elemento a una variabile. È più ottimale lasciare i componenti nel flusso di JSX. I riferimenti vengono assegnati al momento del rendering ma prima che gli elementi siano collegati al DOM. Sono disponibili in 2 gusti.

```js
// compito semplice
let mioDiv;

// usa onMount o createEffect per leggere dopo esserti connesso a DOM
onMount(() => console.log(mioDiv));
<div ref={mioDiv} />

// o funzione di callback (chiamata prima della connessione al DOM)
<div ref={el => console.log(el)} />
```

`Refs` può essere utilizzato anche sui componenti. Devono ancora essere attaccati dall'altra parte.

```jsx
function MyComp(props) {
  return <div ref={props.ref} />;
}

function App() {
  let mioDiv;
  onMount(() => console.log(mioDiv.clientWidth));
  return <MyComp ref={mioDiv} />;
}
```

## `classList`

Funzione di supporto che sfrutta `element.classList.toggle`. Prende un oggetto le cui chiavi sono nomi di classe e le assegna quando il valore risolto è vero.

```jsx
<div classList={{ active: state.active, editing: state.currentId === row.id }} />
```

## `style`

L'helper di stile di Solid funziona con una stringa o con un oggetto. A differenza della versione di React, Solid usa `element.style.setProperty`. Ciò significa che può supportare CSS vars. Significa anche che usiamo le versioni inferiori delle proprietà con trattini. Ciò porta effettivamente a prestazioni e coerenza migliori con l'output SSR.

```jsx
// string
<div style={`color: green; background-color: ${stato.colore}; height: ${stato.altezza}px`} />

// object
<div style={{
  color: "green",
  "background-color": stato.colore,
  height: stato.altezza + "px" }}
/>

// css variabile
<div style={{ "--my-custom-color": stato.temaColore }} />
```

## `innerHTML`/`textContent`

Questi metodi funzionano come i loro equivalenti di proprietà. Imposta una stringa e verranno impostati. **Fai attenzione!!** Impostando `innerHTML` con tutti i dati che potrebbero essere esposti a un utente finale in quanto potrebbe essere un vettore per attacchi dannosi. `textContent`, anche se generalmente non è necessario, è in realtà un'ottimizzazione delle prestazioni quando si sa che i bambini saranno solo testo poiché ignora la routine di diffing generica.

```jsx
<div textContent={state.text} />
```

## `on___`

I gestori di eventi in Solid in genere assumono la forma di "onclick" o "onClick" a seconda dello stile. Il nome dell'evento è sempre minuscolo. Solid utilizza la delega di eventi semi-sintetici per eventi dell'interfaccia utente comuni composti e bolle. Ciò migliora le prestazioni per questi eventi comuni.

```jsx
<div onClick={e => console.log(e.currentTarget)} />
```

Solid supporta anche il passaggio di un array al gestore eventi per associare un valore al primo argomento del gestore eventi. Questo non usa `bind` o crea una chiusura aggiuntiva, quindi è un modo altamente ottimizzato per delegare gli eventi.

```jsx
function handler(itemId, e) {
  /*...*/
}

<ul>
  <For each={state.list}>{item => <li onClick={[handler, item.id]} />}</For>
</ul>;
```

Gli eventi non possono essere rimbalzati e le associazioni non sono reattive. In genere è più costoso collegare/scollegare gli ascoltatori. Poiché gli eventi vengono chiamati naturalmente, non è necessaria la reattività, è sufficiente scorciatoia per il gestore se lo si desidera.

```jsx
// se definito chiamalo, altrimenti no.
<div onClick={() => props.handleClick?.()} />
```

## `on:___`/`oncapture:___`

Per tutti gli altri eventi anche con nomi insoliti. Forse anche gli eventi che non desideri vengano delegati agli eventi dello spazio dei nomi. Questo aggiunge semplicemente un listener di eventi alla lettera.

```jsx
<div on:Weird-Event={e => alert(e.detail)} />
```

## `use:___`

Queste sono direttive personalizzate. In un certo senso questa è solo sintassi zucchero su `ref` ma ci consente di collegare facilmente più direttive a un singolo elemento. Una direttiva è semplicemente una funzione con la seguente firma:

```ts
function directive(element: Element, accessor: () => any): void;
```

Queste funzioni vengono eseguite in fase di rendering e puoi fare quello che vuoi in esse. Crea segnali ed effetti, registra funzioni di pulizia, qualunque cosa desideri.

```js
const [name, setName] = createSignal("");

function model(el, value) {
  const [field, setField] = value();
  createRenderEffect(() => (el.value = field()));
  el.addEventListener("input", e => setField(e.target.value));
}

<input type="text" use:model={[name, setName]} />;
```

Per registrarlo con TypeScript, assicurati di estendere lo spazio dei nomi JSX.

```ts
declare module "solid-js" {
  namespace JSX {
    interface Directives {
      model: [() => any, (v: any) => any];
    }
  }
}
```

## `prop:___`

Questo obbliga a trattare il prop come una proprietà invece che come un attributo.

```jsx
<div prop:scrollTop={props.scrollPos + "px"} />
```

## `attr:___`

Forza l'oggetto a essere trattato come un attributo anziché come una proprietà. Utile per i componenti Web in cui si desidera impostare gli attributi.

```jsx
<mio-componente attr:status={props.status} />
```

## `/* @once */`

Il compilatore di Solid utilizza una semplice euristica per il wrapping reattivo e la valutazione pigra delle espressioni JSX. L'elemento in questione contiene una chiamata di funzione, un accesso a una proprietà o forse JSX? Se sì, lo avvolgiamo in un getter quando viene passato ai componenti o in un effetto se passato agli elementi nativi.

Sapendo questo, possiamo ridurre il sovraccarico di cose che sappiamo non cambieranno mai semplicemente accedendovi al di fuori del JSX. Una variabile semplice non verrà mai racchiusa. Possiamo anche dire al compilatore di non avvolgerli iniziando l'espressione con un decoratore di commenti `/_ @once _/.

```jsx
<MioComponent static={/*@once*/ stato.nonAggionerò} />
```

Funziona anche sui bambini.

```jsx
<MioComponent>{/*@once*/ stato.nonAggionerò}</MioComponent>
```
