# Rendering

Solid supporta 3 tipi di template: JSX, Tagged Template Literals e la variante HyperScript di Solid. JSX è la forma predominante. Perché? JSX è un ottimo DSL creato per la compilazione. Ha una sintassi chiara, supporta TypeScript, funziona con Babel e supporta altri strumenti come l'evidenziazione della sintassi del codice e più carino. Era solo pragmatico usare uno strumento che fondamentalmente ti dà tutto gratuitamente. Come soluzione compilata fornisce un ottimo DX. Abbiamo scelto di non lottare con le sintassi DSL personalizzate e di usarne una ampiamente supportata.

## Compilazione JSX

Il rendering prevede la precompilazione di modelli JSX in codice js nativo ottimizzato. I costrutti del codice JSX sono:

- Elementi template DOM (clonati su ogni istanza)
- Una serie di dichiarazioni di riferimento che utilizzano solo firstChild e nextSibling
- Calcoli a grana fine per aggiornare gli elementi creati.

Questo approccio è più performante e produce meno codice rispetto alla creazione di ogni elemento individualmente con document.createElement.

## Attributi e oggetti di scena

Tentativi solidi di seguire il più possibile le convenzioni HTML, inclusa l'insensibilità alle maiuscole degli attributi.

La maggior parte di tutti gli attributi sull'elemento nativo JSX sono impostati come attributi DOM. I valori statici sono incorporati direttamente nel modello clonato. Ci sono un certo numero di eccezioni come `class`, `style`, `value`, `innerHTML` che forniscono funzionalità extra.

Gli elementi personalizzati (ad eccezione dei built-in nativi) sono predefiniti come proprietà quando sono dinamici. Questo serve per gestire tipi di dati più complessi. Esegue questa conversione in base ai nomi degli attributi dei casi di serpente standard dell'involucro del cammello da `some-attr` a `someAttr`.

È anche possibile controllare questo comportamento direttamente con le direttive dello spazio dei nomi. Puoi forzare un attributo con `attr:` o `prop:`

```jsx
<my-element prop:UniqACC={state.value} attr:titolo={state.titolo} />
```

> **Nota:** gli attributi statici vengono creati come parte del modello html che viene clonato. Le espressioni fisse e dinamiche vengono applicate successivamente nell'ordine di associazione JSX. Questo va bene per la maggior parte degli elementi DOM ma ce ne sono alcuni, come gli elementi di input con `type='range'`, dove l'ordine conta. Ricordalo quando leghi gli elementi.

## Entrata

Il modo più semplice per montare Solid è importare il rendering da 'solid-js/web'. `render` riceve una funzione come primo argomento e l'elemento di montaggio per il secondo. Restituirà un metodo di smaltimento. Questo `render` crea automaticamente la radice reattiva e gestisce il rendering nel contenitore di montaggio. Per prestazioni ottimali, utilizzare un elemento senza figli.

```jsx
import { render } from "solid-js/web";

render(() => <App />, document.getElementById("main"));
```

> **Importante** Il primo argomento deve essere una funzione. In caso contrario, non possiamo tracciare e programmare correttamente il sistema reattivo. Se lo fai in modo errato, i tuoi effetti non verranno eseguiti.

## Componenti

I componenti in Solid sono solo funzioni in maiuscolo Pascal. Il loro primo argomento è un oggetto props e restituiscono nodi DOM reali.

```jsx
const Primo = () => (
  <section>
    <Secondo saluto="Salve">
      <div>Davide</div>
    </Secondo>
  </section>
);

const Secondo = props => (
  <>
    <div>{props.saluto}</div>
    {props.children}
  </>
);
```

Tutti i nodi JSX sono nodi DOM effettivi. Non c'è magia qui. I componenti di primo livello li aggiungono al DOM stesso.

## Oggetti di scena

Solid consente di definire le proprietà sui componenti per passare i dati ai componenti figlio. Questo è simile a React, Vue, Angular e altri framework. Qui un componente genitore sta passando la stringa "Hello" al componente `Label` tramite una proprietà `greeting`.

```jsx
const Primo = () => (
  <section>
    <Secondo saluto="salve">
      <div>David</div>
    </Secondo>
  </section>
);
```

Il valore impostato su "saluto" è statico, ma possiamo anche impostare valori dinamici. Per esempio:

```jsx
const Primo = () => {
  const [saluto, impostareSaluto] = createSignal("Buongiorno");
  return (
    <section>
      <Secondo greeting={saluto()}>
        <div>Davide</div>
      </Secondo>
    </section>
  );
};
```

I componenti possono accedere alle proprietà passate loro tramite un argomento `props`.

```jsx
const Label = props => (
  <>
    <div>{props.greeting}</div>
    {props.children}
  </>
);
```

A differenza di altri framework, non è possibile utilizzare la destrutturazione degli oggetti sui `props` di un componente. Dietro le quinte l'oggetto `props` si basa su Object getter per recuperare pigramente i valori. L'uso della destrutturazione degli oggetti interrompe la reattività degli "sostegni". Questa è una limitazione naturale e accettabile.

Questo esempio mostra il modo "corretto" di accedere agli oggetti di scena in Solid:

```jsx
// Qui, `props.name` si aggiornerà come ti aspetteresti
const MioComponentene = props => <div>{props.nome}</div>;
```

Questo esempio mostra il modo sbagliato di accedere agli oggetti di scena in Solid:

```jsx
// Questo è il male
// Qui, `props.name` non si aggiornerà (cioè non è reattivo) poiché è destrutturato in `name`
const MioComponentene = ({ nome }) => <div>{nome}</div>;
```

Mentre l'oggetto props sembra un oggetto normale quando lo usi, in realtà è adeguatamente reattivo, in qualche modo simile a un segnale. Questo ha alcune implicazioni. Gli utenti dattiloscritti riconosceranno che è digitato come un normale oggetto.

A differenza della maggior parte dei framework JSX, i componenti delle funzioni di Solid vengono eseguiti solo una volta (anziché ogni ciclo di rendering). L'esempio seguente non funzionerà come previsto.

```jsx
import { createSignal } from "solid-js";

const ComponenteBase = props => {
  const valore = props.value || "predefinita";
  return <div>{valore}</div>;
};

export default function Modulo() {
  const [valore, impostareValore] = createSignal("");
  return (
    <div>
      <ComponenteBase value={valore()} />
      <input type="text" oninput={e => impostareValore(e.currentTarget.value)} />
    </div>
  );
}
```

In realtà vogliamo che il `ComponenteBase` mostri il valore corrente digitato nell'`input`. Come promemoria, la funzione `ComponenteBase` viene eseguita solo una volta quando il componente viene creato per la prima volta. A questo punto (durante la creazione), `props.valore` sarà uguale a `''`. Ciò significa che il "valore const" in "BasicComponent" si risolverà in "default" e non si aggiornerà mai. L'accesso agli oggetti di scena mentre l'oggetto `props` è reattivo è al di fuori dell'ambito osservabile di Solid. Quindi verrà automaticamente rivalutato quando cambiano gli oggetti di scena.

Per risolvere il problema dobbiamo accedere a "props" da qualche parte in cui Solid possa osservarlo. Generalmente questo significa all'interno di JSX o all'interno di un `createMemo`, `createEffect` o thunk(`() => ...`). Ecco una soluzione che funziona come previsto:

```jsx
const ComponenteBase = props => {
  return <div>{props.valore || "predefinita"}</div>;
};
```

Questo, equivalentemente, può essere issato in una funzione:

```jsx
const ComponenteBase = props => {
  const valore = () => props.valore || "predefinita";

  return <div>{valore()}</div>;
};
```

Un'altra opzione per calcoli costosi è usare `createMemo`. Per esempio:

```jsx
const ComponenteBase = props => {
  const valore = createMemo(() => props.valore || "predefinita");

  return <div>{valore()}</div>;
};
```

O usando un aiutante

```jsx
const ComponenteBase = props => {
  props = mergeProps({ valore: "predefinita" }, props);

  return <div>{props.valore}</div>;
};
```

Come promemoria, i seguenti esempi _non_ funzioneranno:

```jsx
// cattiva
const ComponenteBase = props => {
  const { valore: propValore } = props;
  const valore = createMemo(() => propValore || "predefinita");
  return <div>{valore()}</div>;
};

// cattiva
const ComponenteBase = props => {
  const propValore = prop.value;
  const valore = createMemo(() => valueProp || "predefinita");
  return <div>{valore()}</div>;
};
```

I componenti di Solid sono la parte fondamentale delle sue prestazioni. L'approccio di Solid a far scomparire i componenti è reso possibile dalla valutazione pigra degli oggetti. A differenza della valutazione immediata delle espressioni prop e del passaggio di valori, l'esecuzione viene posticipata fino a quando non si accede al prop nel figlio. In questo modo rimandiamo l'esecuzione fino all'ultimo momento, in genere proprio nei binding DOM, massimizzando le prestazioni. Ciò appiattisce la gerarchia ed elimina la necessità di mantenere un albero di componenti.

```jsx
<Component prop1="statica" prop2={state.dynamic} />;

// compila approssimativamente a:

// estraiamo il corpo del componente per isolarlo e prevenire costosi aggiornamenti
untrack(() =>
  Componente({
    prop1: "statica",
    // espressione dinamica quindi avvolgiamo in un getter
    get prop2() {
      return state.dinamica;
    }
  })
);
```

Per aiutare a mantenere la reattività, Solid ha un paio di aiutanti:

```jsx
// oggetti di scena predefiniti
props = mergeProps({ name: "Italiano" }, props);

// clone
const newProps = mergeProps(props);

// unire
props = mergeProps(props, otherProps);

// sdividere gli oggetti di scena in più oggetti di scena
const [locale, altre] = splitProps(props, ["className"])
<div {...altre} className={cx(locale.className, theme.component)} />
```

## Children

Solid gestisce JSX Children simile a React. Un singolo figlio è un singolo valore su `props.children` e più figli vengono gestiti tramite un array di valori. Normalmente, li passi alla vista JSX. Se vuoi interagire con loro il metodo suggerito è l'helper `figli` che risolve qualsiasi flusso di controllo a valle e restituisce un memo.

```jsx
// singolo
const Etichetta = (props) => <div class="etichetta">Salve, { props.children }</div>

<Etichetta><span>Michele</span></Etichetta>

// multipla
const List = (props) => <div>{props.children}</div>;

<Elenco>
  <div>First</div>
  {state.expression}
  <Etichetta>Judith</Etichetta>
</Elenco>

// oggetto bambini
const Elenco = (props) => <ul>
  <For each={props.children}>{articolo => <li>{itarticoloem}</li>}</For>
</ul>;

// mmodificare e mappare i bambini usando l'helper
const Elenco = (props) => {
  // l'assistente dei bambini memorizza il valore e risolve tutte le reattività intermedie
  const memo = bambini(() => props.children);
  createEffect(() => {
    const bambini = memo();
    bambini.forEach((c) => c.classList.add("elenco-bambino"))
  })
  return <ul>
    <For each={memo()}>{item => <li>{item}</li>}</For>
  </ul>;
```

**Importante:** Solid tratta i tag inferiori come espressioni costose e li racchiude allo stesso modo delle espressioni reattive dinamiche. Valutano pigramente l'accesso "prop". Fai attenzione ad accedervi più volte o a destrutturare prima del punto in cui li useresti nella vista. Solid non ha il lusso di creare nodi DOM virtuali in anticipo e poi di differenziarli. La risoluzione di questi "sostegni" deve essere pigra e deliberata. Usa l'helper `bambini` se desideri farlo mentre li memorizza.
