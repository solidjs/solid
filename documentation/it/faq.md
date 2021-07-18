# FAQ

### 1. JSX senza VDOM? Questo è vaporware? Ho sentito altri autori riconosciuti dire che non era possibile.

È possibile quando non hai il modello di aggiornamento di React. JSX è un modello DSL come un altro. Solo uno che è più flessibile in certi modi. L'inserimento di JavaScript arbitrario può essere difficile a volte, ma non è diverso dal supportare gli operatori di diffusione. Quindi no, questo non è impossibile, ma un approccio che si è dimostrato uno dei più performanti.

Il vero vantaggio è quanto è estensibile. Hai il compilatore che lavora per te dandoti aggiornamenti DOM nativi ottimali ma hai tutta la libertà di una libreria come React per scrivere componenti usando tecniche come Render Props e Higher Order Components insieme ai tuoi "ganci" reattivi. Non ti piace come funziona il flusso di controllo di Solid? Scrivi il tuo.

### 2. How is Solid so performant?

È difficile individuare qualcosa di specifico. È davvero la combinazione di molte decisioni più specificamente:

1. Reattività granulare in modo che vengano tracciate solo le cose che dovrebbero essere reattive.
2. Compilare tenendo presente la creazione iniziale. Solid utilizza l'euristica per ridurre la granularità. Ciò riduce il numero di calcoli effettuati, ma mantiene gli aggiornamenti chiave granulari e performanti.
3. Le espressioni reattive sono solo funzioni. Ciò consente la "scomparsa dei componenti" con valutazione pigra delle prop che rimuove wrapper non necessari e sovraccarico di sincronizzazione.

Queste sono attualmente tecniche uniche in una combinazione che danno a Solid un vantaggio rispetto alla concorrenza.

### 3. Esiste una funzionalità di compatibilità di React?

No, e probabilmente non ci sarà mai. Sebbene le API siano simili e i componenti spesso possano essere spostati con piccole modifiche, il modello di aggiornamento è fondamentalmente diverso. React Components esegue il rendering più e più volte quindi il codice al di fuori di Hooks funziona in modo molto diverso. Le chiusure e le regole dei ganci non solo non sono necessarie, ma possono essere utilizzate in modi che qui non funzionano.

La compatibilità con Vue potrebbe tuttavia essere più realistica. Sebbene non ci siano piani da implementare attualmente.

### 4. Perché la destrutturazione non funziona? Mi sono reso conto che posso risolverlo avvolgendo l'intero componente in una funzione.

La reattività si verifica all'accesso alla proprietà con oggetti Prop e Store. Il loro riferimento al di fuori di un calcolo vincolante o reattivo non verrà registrato. La destrutturazione è perfettamente a posto all'interno di quelli.

Annidare l'intero componente in una funzione non è quello che vuoi fare in modo irresponsabile. Solid non ha un VDOM. Quindi qualsiasi modifica tracciata eseguirà nuovamente l'intera funzione ricreando tutto. Non farlo.

### 5. Puoi aggiungere il supporto per i componenti della classe? Trovo che i cicli di vita siano più facili da ragionare.

Non è intenzione di supportare i componenti della classe. I cicli di vita di Solid sono legati alla programmazione del sistema reattivo e sono artificiali. Potresti farne una classe, ma in pratica tutto il codice del gestore non di eventi viene fondamentalmente eseguito nel costruttore, inclusa la funzione di rendering.

Raggruppa i dati e i relativi comportamenti anziché i cicli di vita. Questa è una best practice reattiva che funziona da decenni.

### 6. Non mi piace molto JSX! C'è qualche possibilità per un modello DSL? Oh, vedo che hai taggato Template Literals/HyperScript. Forse userò quelli...

Non farlo. Ti fermerò proprio lì. Usiamo JSX nel modo in cui Svelte usa i suoi modelli: per creare istruzioni DOM ottimizzate. Le soluzioni Tagged Template Literal e HyperScript possono essere davvero impressionanti di per sé, ma a meno che tu non abbia una vera ragione come un requisito di non compilazione, sono inferiori in ogni modo. Si traduce in bundle più grandi, prestazioni più lente e la necessità di valori di wrapping per soluzioni alternative manuali.

È bello avere opzioni, ma JSX di Solid è davvero la soluzione migliore qui. Fidati di noi! Anche un modello DSL sarebbe fantastico. Potrebbe essere un po' più restrittivo, ma JSX ci dà così tanto valore. TypeScript, Parser esistenti, Evidenziazione della sintassi, TypeScript, Più carino, Completamento del codice e, ultimo e non meno importante, TypeScript.

Altre librerie hanno aggiunto il supporto per queste funzionalità, ma questo è stato uno sforzo enorme ed è ancora imperfetto e un costante mal di testa per la manutenzione. Questo è davvero puntare sul pragmatismo.

### 7. Quando uso un Signal vs Store? Perché questi sono diversi?

Gli archivi contengono valori nidificati che lo rendono ideale per strutture di dati profonde e per cose come i modelli. Per la maggior parte delle altre cose, i segnali sono leggeri e portano a termine il lavoro.

Sfortunatamente, poiché non è possibile eseguire il proxy delle primitive, queste idee non possono essere combinate. Le funzioni sono l'interfaccia più semplice e qualsiasi espressione reattiva (incluso l'accesso allo stato) può essere racchiusa in una durante il trasporto, quindi questo fornisce un'API universale. Puoi nominare i tuoi segnali e dichiarare come preferisci e rimane minimo. L'ultima cosa che vorresti fare è forzare la digitazione `.get()` `.set()` o anche peggio `.value`. Almeno il primo può essere alias per brevità, mentre il secondo è solo il modo meno conciso per chiamare una funzione.1

### 8. Perché non posso semplicemente assegnare un valore a Solid's Store come posso fare in Vue. Svelto o MobX? Dov'è il "2-way binding"?

### 8. Perché non posso semplicemente assegnare un valore a Solid's Store come posso fare in Vue. Svelto o MobX? Dov'è il "binding a 2 vie"?

La reattività è uno strumento potente ma anche pericoloso. MobX lo sa e ha introdotto la modalità Strict e le azioni per limitare dove/quando si verificano gli aggiornamenti. Non hai bisogno di essere effettivamente immutabile fintanto che fornisci i mezzi per avere lo stesso contratto.

Avere la possibilità di aggiornare lo stato è probabilmente ancora più importante che decidere di passare lo stato. Quindi essere in grado di separarlo è importante. Anche se la lettura è immutabile. Inoltre, non dobbiamo pagare il costo dell'immutabilità se possiamo ancora aggiornare granulare. Fortunatamente ci sono tonnellate di arte precedente qui tra ImmutableJS e Immer. Ironicamente Solid agisce principalmente come un Immer inverso con i suoi interni mutevoli e l'interfaccia immutabile.

### 9. Posso usare la reattività di Solid da sola?

Ovviamente. Anche se non ho esportato un pacchetto autonomo, è facile installare Solid senza il compilatore e utilizzare solo le primitive reattive. Uno dei vantaggi della reattività granulare è che è indipendente dalla libreria. Del resto, quasi tutte le librerie reattive funzionano in questo modo. Questo è ciò che ha ispirato [Solid](https://github.com/solidjs/solid) ed è alla base della [libreria DOM Expressions](https://github.com/ryansolid/dom-expressions) in primo luogo per creare un renderer puramente dal sistema reattivo.

Per elencarne alcuni da provare: [Solid](https://github.com/solidjs/solid), [MobX](https://github.com/mobxjs/mobx), [Knockout](https://github .com/knockout/knockout), [Svelto](https://github.com/sveltejs/svelte), [S.js](https://github.com/adamhaile/S), [CellX](https: //github.com/Riim/cellx), [Derivable](https://github.com/ds300/derivablejs), [Sinuous](https://github.com/luwes/sinuous) e anche recentemente [Vue ](https://github.com/vuejs/vue). Per creare una libreria reattiva è necessario molto di più che taggarla su un renderer come [lit-html](https://github.com/Polymer/lit-html) per esempio, ma è un buon modo per avere un'idea.

### 10. Solid ha una libreria Next.js o Material Components che posso usare?

Non a mia conoscenza. Se sei interessato a costruirne uno, siamo prontamente disponibili sul nostro [Discord](https://discord.com/invite/solidjs) per aiutarti a costruirli. Abbiamo le basi e dobbiamo solo costruirci sopra.
