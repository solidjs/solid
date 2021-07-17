# Confronto con altre biblioteche

Questa sezione non può sfuggire a qualche pregiudizio, ma penso che sia importante capire dove si trova la soluzione di Solid rispetto ad altre librerie. Non si tratta di prestazioni. Per uno sguardo definitivo alle prestazioni, non esitare a consultare il [JS Framework Benchmark](https://github.com/krausest/js-framework-benchmark).

## React

React ha avuto una grande influenza su Solid. Il suo flusso unidirezionale e la segregazione esplicita di lettura e scrittura con l'API Hooks hanno informato l'API di Solid. Solid ha opinioni forti su come affrontare la gestione dei dati nello sviluppo di applicazioni, ma non cerca di vincolarne l'esecuzione.

Tuttavia, per quanto Solid si allinei con la filosofia di design di React, funziona in modo fondamentalmente diverso. React utilizza un DOM virtuale e Solid no. L'astrazione di React si basa sulla partizione del componente dall'alto verso il basso in cui i metodi di rendering vengono chiamati ripetutamente e le differenze calcolate. Solid, invece, rende ogni Template una volta nella sua interezza, costruendo il suo grafico reattivo e solo allora esegue le istruzioni relative alle modifiche a grana fine.

#### Consigli per la migrazione:

Il modello di aggiornamento di Solid non è come React o anche React + MobX. Invece di pensare ai componenti della funzione come alla funzione "render", pensa a loro come a un "costruttore". Fare attenzione alla destrutturazione o all'accesso anticipato alla proprietà che perde la sua reattività. Le primitive di Solid non hanno restrizioni come le regole Hook. Sei libero di annidarli come meglio credi. Non hai bisogno di chiavi esplicite sulle righe dell'elenco per avere un comportamento "con chiave". Infine, non esiste un VDOM, quindi API VDOM imperative come `React.Children` e `React.cloneElement` non hanno senso. Incoraggio a trovare modi diversi per risolvere i problemi che li utilizzino in modo dichiarativo.

## Vue

Solid non è particolarmente influenzato da Vue dal punto di vista del design. Entrambi sono comparabili nel loro approccio alla reattività. Entrambi usano i proxy con il tracciamento automatico basato sulla lettura. È qui che finiscono le somiglianze. Il rilevamento delle dipendenze a grana fine di Vue alimenta un DOM virtuale e un sistema di componenti meno dettagliati. Solid mantiene la sua granularità fino agli aggiornamenti diretti del DOM.

Vue valorizza la semplicità dove Solid valorizza la trasparenza. Sebbene la nuova direzione di Vue con Vue 3 si allinei maggiormente all'approccio adottato da Solid. Queste librerie potrebbero allinearsi maggiormente nel tempo a seconda di come continuano ad evolversi.

#### Consigli per la migrazione:

La migrazione da Vue dovrebbe sembrare molto familiare e facile data la vicinanza di entrambe le soluzioni. I componenti di Solid sono simili all'etichettatura del modello alla fine della funzione `setup` di Vue. Fai attenzione a non sovrapporre le derivazioni di stato con i calcoli. Prova una funzione. La reattività è pervasiva. I proxy di Solid sono intenzionalmente di sola lettura. Non giudicarlo prima di provarlo.

## Svelte

Svelte ha aperto la strada alla struttura precompilata che scompare che Solid impiega anche in una certa misura. Entrambe le librerie sono veramente reattive e possono produrre bundle di codice di esecuzione davvero piccoli. Svelte è il vincitore qui per le piccole demo. Solid richiede un po' più di chiarezza nelle sue dichiarazioni e si affida meno all'analisi implicita del compilatore, ma questo fa parte di ciò che offre a Solid prestazioni superiori. Solid mantiene anche di più nel runtime che si adatta meglio alle app più grandi. L'implementazione della demo RealWorld di Solid è del 25% più piccola di quella di Svelte.

Entrambe le librerie mirano ad aiutare i loro sviluppatori a scrivere meno codice ma ad affrontarlo in modo completamente diverso. Svelte 3 si concentra sull'ottimizzazione della facilità di gestione dei cambiamenti localizzati concentrandosi sull'interazione di oggetti semplici e sul legame bidirezionale. In contrasto Solid si concentra sul flusso di dati abbracciando deliberatamente CQRS e un'interfaccia immutabile. Con composizione modello funzionale. In molti casi Solid consente agli sviluppatori di scrivere ancora meno codice di Svelte, sebbene la sintassi del modello di Svelte sia decisamente concisa.

#### Consigli per la migrazione:

L'esperienza degli sviluppatori è diversa da Solid e Svelte. Mentre alcune cose sono analoghe, è un'esperienza molto diversa. I componenti in Solid sono economici, quindi non esitare ad averne di più.

## Knockout.js

Solid deve la sua esistenza a Knockout. La modernizzazione del suo modello per il rilevamento granulare delle dipendenze è stata la motivazione per questo progetto. Knockout è stato rilasciato nel 2010 e supporta Microsoft Explorer su IE6 mentre gran parte di Solid non supporta affatto IE.

I collegamenti di Knockout sono solo stringhe in HTML che vengono esaminate in fase di esecuzione. Dipendono dal contesto di clonazione ($genitore ecc...). Considerando che Solid utilizza JSX o Tagged Template Literals per la creazione di modelli optando per un'API JavaScript.

La differenza più grande potrebbe essere che l'approccio di Solid alle modifiche in batch che garantisce la sincronicità mentre Knockout ha deferUpdates che utilizza una coda di microtask differita.

#### Advice for migrating:

Se ti senti a tuo agio con Knockout, i primitivi di Solid potrebbero sembrarti strani. La separazione lettura/scrittura è intenzionale e non solo per complicare la vita. Cerca di adottare un modello mentale stato/azione (Flusso). Sebbene le librerie abbiano un aspetto simile, promuovono best practice diverse.

## Lit & LighterHTML

Queste librerie sono incredibilmente simili e hanno avuto una certa influenza su Solid. Il codice compilato di Solid utilizza un metodo molto simile per eseguire il rendering iniziale del DOM in modo efficiente. La clonazione degli elementi del modello e l'utilizzo dei segnaposto dei commenti sono qualcosa che Solid e queste librerie condividono.

La differenza più grande è che, sebbene queste librerie non utilizzino il Virtual DOM, trattano il rendering allo stesso modo: dall'alto verso il basso. Al contrario, Solid utilizza il suo grafico reattivo a grana fine per aggiornare solo ciò che è cambiato e così facendo condivide questa tecnica solo per il suo rendering iniziale. Questo approccio sfrutta la velocità iniziale disponibile solo per il DOM nativo e offre anche l'approccio più efficiente agli aggiornamenti.

#### Advice for migrating:

Queste librerie sono piuttosto minimali e facili da costruire sopra. Tuttavia, tieni presente che `<MyComp/>` non è solo HTMLElement (array o funzione). Cerca di mantenere le tue cose nel modello JSX. "Hoisting" funziona per la maggior parte, ma è meglio pensare mentalmente a questo ancora come a una libreria di rendering e non a una fabbrica HTMLElement.

## S.js

S.js ha avuto la maggiore influenza sul design reattivo di Solid. Solid ha utilizzato S.js internamente per un paio d'anni fino a quando il catalogo delle funzionalità non li ha posizionati su percorsi diversi. S.js è una delle librerie reattive più efficienti fino ad oggi. Modella tutto in base a fasi temporali sincrone come un circuito digitale e garantisce coerenza senza dover eseguire molti dei meccanismi più complicati presenti in librerie come MobX.

La reattività di Solid alla fine è un ibrido tra S e MobX. Ciò gli conferisce prestazioni maggiori rispetto alla maggior parte delle librerie reattive (Knockout, MobX, Vue) pur mantenendo la facilità del modello mentale per lo sviluppatore. S.js in definitiva è ancora la libreria reattiva più performante, anche se la differenza è appena percettibile in tutti i benchmark sintetici più estenuanti.

## RxJS

RxJS è una libreria reattiva. Sebbene Solid abbia un'idea simile dei dati osservabili, utilizza un'applicazione molto diversa del modello dell'osservatore. I segnali sono come una semplice versione di un osservabile (solo il prossimo). Il modello di rilevamento della dipendenza automatica supera il centinaio di operatori RxJS. Solid avrebbe potuto adottare questo approccio, ma nella maggior parte dei casi è più semplice scrivere la propria logica di trasformazione in un calcolo. Laddove gli Observable sono avviabili a freddo, unicast e basati su push, molti problemi sul client si prestano all'avvio a caldo e al multicast che è il comportamento predefinito di Solid.

## Others

Angular e alcune altre librerie popolari mancano in particolare da questo confronto. La mancanza di esperienza con loro impedisce di fare confronti adeguati. In generale, Solid ha poco in comune con i framework più grandi ed è molto più difficile confrontarli frontalmente.
