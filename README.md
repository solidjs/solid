<p>
  <img src="https://assets.solidjs.com/banner?project=Library&type=core" alt="SolidJS" />
</p>

[![Build Status](https://img.shields.io/github/actions/workflow/status/solidjs/solid/main-ci.yml?branch=main&logo=github&style=for-the-badge)](https://github.com/solidjs/solid/actions/workflows/main-ci.yml)
[![Coverage Status](https://img.shields.io/coveralls/github/solidjs/solid.svg?style=for-the-badge)](https://coveralls.io/github/solidjs/solid?branch=main)

[![NPM Version](https://img.shields.io/npm/v/solid-js.svg?style=for-the-badge)](https://www.npmjs.com/package/solid-js)
[![](https://img.shields.io/npm/dm/solid-js.svg?style=for-the-badge)](https://www.npmjs.com/package/solid-js)
[![Discord](https://img.shields.io/discord/722131463138705510?style=for-the-badge)](https://discord.com/invite/solidjs)
[![Subreddit subscribers](https://img.shields.io/reddit/subreddit-subscribers/solidjs?style=for-the-badge)](https://www.reddit.com/r/solidjs/)

**[Website](https://www.solidjs.com/) • [API Docs](https://docs.solidjs.com/) • [Features Tutorial](https://www.solidjs.com/tutorial/introduction_basics) • [Playground](https://playground.solidjs.com/?version=1.3.13#NobwRAdghgtgpmAXGGUCWEwBowBcCeADgsrgM4Ae2YZA9gK4BOAxiWGjIbY7gAQi9GcCABM4jXgF9eAM0a0YvADo1aAGzQiAtACsyAegDucAEYqA3EogcuPfr2ZCouOAGU0Ac2hqps+YpU6DW09CysrGXoIZlw0WgheAGEGCBdGAAoASn4rXgd4sj5gZhTcLF4yOFxkqNwAXV4AXgcnF3cvKDV0gAZMywT8iELeDEc4eFSm3iymgD4KqprU9JLamYBqXgBGPvCBoVwmBPTcvN4AHhN6XFx43gJiRpUrm-iVXnjEjWYAa0aQUZCCa4SSzU5nfirZaZSTgi76F63CBgga7CCwiBWISicTpGaNebnJZpXj6WblES0Zj0YEAOg8VQAompxsJcAAhfAASREJzAUEIhBUmTRYEkdSAA) • [Discord](https://discord.com/invite/solidjs)**

Solid is a declarative JavaScript library for creating user interfaces. Instead of using a Virtual DOM, it compiles its templates to real DOM nodes and updates them with fine-grained reactions. Declare your state and use it throughout your app, and when a piece of state changes, only the code that depends on it will rerun.

## At a Glance
```tsx
import { createSignal } from "solid-js";
import { render } from "solid-js/web";

function Counter() {
  const [count, setCount] = createSignal(0);
  const doubleCount = () => count() * 2;
  
  console.log("The body of the function runs once...");

  return (
    <>
      <button onClick={() => setCount(c => c + 1)}>
        {doubleCount()}
      </button>
    </>
  );
}

render(Counter, document.getElementById("app")!);
```

Try this code in our [playground](https://playground.solidjs.com/anonymous/0c88df54-91b0-4c88-bd20-e962bde49725)!

<details>
<summary>Explain this!</summary>

```tsx
import { createSignal } from "solid-js";
import { render } from "solid-js/web";

// A component is just a function that returns a DOM node
function Counter() {
  // Create a piece of reactive state, giving us an accessor, count(), and a setter, setCount()
  const [count, setCount] = createSignal(0);
  
  //To create derived state, just wrap an expression in a function
  const doubleCount = () => count() * 2;
  
  console.log("The body of the function runs once...");

  // JSX allows you to write HTML within your JavaScript function and include dynamic expressions using the { } syntax
  // The only part of this that will ever rerender is the doubleCount() text.
  return (
    <>
      <button onClick={() => setCount(c => c + 1)}>
        Increment: {doubleCount()}
      </button>
    </>
  );
}

// The render function mounts a component onto your page
render(Counter, document.getElementById("app")!);
```

Solid compiles your JSX down to efficient real DOM updates. It uses the same reactive primitives (`createSignal`) at runtime but making sure there's as little rerendering as possible. Here's what that looks like in this example:

```js
import { template as _$template } from "solid-js/web";
import { delegateEvents as _$delegateEvents } from "solid-js/web";
import { insert as _$insert } from "solid-js/web";
//The compiler pulls out any static HTML
const _tmpl$ = /*#__PURE__*/_$template(`<button>Increment: `);

import { createSignal, createEffect } from "solid-js";
import { render } from "solid-js/web";

function Counter() {
  const [count, setCount] = createSignal(0);
  
  const doubleCount = () => count() * 2;
  
  console.log("The body of the function runs once...");
  
  return (() => {
    //_el$ is a real DOM node!
    const _el$ = _tmpl$();
    _el$.$$click = () => setCount(c => c + 1);
     //This inserts the count as a child of the button in a way that allows count to update without rerendering the whole button
    _$insert(_el$, doubleCount);
    return _el$;
  })();
}
render(Counter, document.getElementById("app"));
_$delegateEvents(["click"]);
```

</details>

## Key Features

- Fine-grained updates to the real DOM
- Declarative data: model your state as a system with reactive primitives
- Render-once mental model: your components are regular JavaScript functions that run once to set up your view
- Automatic dependency tracking: accessing your reactive state subscribes to it
- [Small](https://dev.to/this-is-learning/javascript-framework-todomvc-size-comparison-504f) and [fast](https://krausest.github.io/js-framework-benchmark/current.html)
- Simple: learn a few powerful concepts that can be reused, combined, and built on top of
- Provides modern framework features like JSX, fragments, Context, Portals, Suspense, streaming SSR, progressive hydration, Error Boundaries and concurrent rendering.
- Naturally debuggable: A `<div>` is a real div, so you can use your browser's devtools to inspect the rendering
- [Web component friendly](https://github.com/solidjs/solid/tree/main/packages/solid-element#readme) and can author custom elements
- Isomorphic: render your components on the client and the server
- Universal: write [custom renderers](https://github.com/solidjs/solid/releases/tag/v1.2.0) to use Solid anywhere
- A growing community and ecosystem with active core team support

<details>
 
<summary>Quick Start</summary>

You can get started with a simple app by running the following in your terminal:

```sh
> npx degit solidjs/templates/js my-app
> cd my-app
> npm i # or yarn or pnpm
> npm run dev # or yarn or pnpm
```

Or for TypeScript:

```sh
> npx degit solidjs/templates/ts my-app
> cd my-app
> npm i # or yarn or pnpm
> npm run dev # or yarn or pnpm
```

This will create a minimal, client-rendered application powered by [Vite](https://vitejs.dev/).

Or you can install the dependencies in your own setup. To use Solid with JSX (_recommended_), run:

```sh
> npm i -D babel-preset-solid
> npm i solid-js
```

The easiest way to get set up is to add `babel-preset-solid` to your `.babelrc`, babel config for webpack, or rollup configuration:

```js
"presets": ["solid"]
```

For TypeScript to work, remember to set your `.tsconfig` to handle Solid's JSX:

```js
"compilerOptions": {
  "jsx": "preserve",
  "jsxImportSource": "solid-js",
}
```

</details>

## Why Solid?

### Performant

Meticulously engineered for performance and with half a decade of research behind it, Solid's performance is almost indistinguishable from optimized vanilla JavaScript (See Solid on the [JS Framework Benchmark](https://krausest.github.io/js-framework-benchmark/current.html)). Solid is [small](https://bundlephobia.com/package/solid-js@1.3.15) and completely tree-shakable, and [fast](https://levelup.gitconnected.com/how-we-wrote-the-fastest-javascript-ui-framework-again-db097ddd99b6) when rendering on the server, too. Whether you're writing a fully client-rendered SPA or a server-rendered app, your users see it faster than ever. ([Read more about Solid's performance](https://dev.to/ryansolid/thinking-granular-how-is-solidjs-so-performant-4g37) from the library's creator.)

### Powerful

Solid is fully-featured with everything you can expect from a modern framework. Performant state management is built-in with Context and Stores: you don't have to reach for a third party library to manage global state (if you don't want to). With Resources, you can use data loaded from the server like any other piece of state and build a responsive UI for it thanks to Suspense and concurrent rendering. And when you're ready to move to the server, Solid has full SSR and serverless support, with streaming and progressive hydration to get to interactive as quickly as possible. (Check out our full [interactive features walkthrough](https://www.solidjs.com/tutorial/introduction_basics).)

### Pragmatic

Do more with less: use simple, composable primitives without hidden rules and gotchas. In Solid, components are just functions - rendering is determined purely by how your state is used - so you're free to organize your code how you like and you don't have to learn a new rendering system. Solid encourages patterns like declarative code and read-write segregation that help keep your project maintainable, but isn't opinionated enough to get in your way.

### Productive

Solid is built on established tools like JSX and TypeScript and integrates with the Vite ecosystem. Solid's bare-metal, minimal abstractions give you direct access to the DOM, making it easy to use your favorite native JavaScript libraries like D3. And the Solid ecosystem is growing fast, with [custom primitives](https://github.com/solidjs-community/solid-primitives), [component libraries](https://kobalte.dev), and build-time utilities that let you [write Solid code in new ways](https://github.com/LXSMNSYC/solid-labels).

## More

Check out our official [documentation](https://docs.solidjs.com) or browse some [examples](https://github.com/solidjs/solid/blob/main/documentation/resources/examples.md)

## Browser Support

SolidJS Core is committed to supporting the last 2 years of modern browsers including Firefox, Safari, Chrome and Edge (for desktop and mobile devices). We do not support IE or similar sunset browsers. For server environments, we support Node LTS and the latest Deno and Cloudflare Worker runtimes.

<img src="https://saucelabs.github.io/images/opensauce/powered-by-saucelabs-badge-gray.svg?sanitize=true" alt="Testing Powered By SauceLabs" width="300"/>

## Community

Come chat with us on [Discord](https://discord.com/invite/solidjs)! Solid's creator and the rest of the core team are active there, and we're always looking for contributions.

### Contributors

<a href="https://github.com/solidjs/solid/graphs/contributors"><img src="https://contrib.rocks/image?repo=solidjs/solid" style="max-width:100%;"></a>

### Open Collective

Support us with a donation and help us continue our activities. [[Contribute](https://opencollective.com/solid)]

<a href="https://opencollective.com/solid/backer/0/website" target="_blank"><img src="https://opencollective.com/solid/backer/0/avatar.svg"></a>
<a href="https://opencollective.com/solid/backer/1/website" target="_blank"><img src="https://opencollective.com/solid/backer/1/avatar.svg"></a>
<a href="https://opencollective.com/solid/backer/2/website" target="_blank"><img src="https://opencollective.com/solid/backer/2/avatar.svg"></a>
<a href="https://opencollective.com/solid/backer/3/website" target="_blank"><img src="https://opencollective.com/solid/backer/3/avatar.svg"></a>
<a href="https://opencollective.com/solid/backer/4/website" target="_blank"><img src="https://opencollective.com/solid/backer/4/avatar.svg"></a>
<a href="https://opencollective.com/solid/backer/5/website" target="_blank"><img src="https://opencollective.com/solid/backer/5/avatar.svg"></a>
<a href="https://opencollective.com/solid/backer/6/website" target="_blank"><img src="https://opencollective.com/solid/backer/6/avatar.svg"></a>
<a href="https://opencollective.com/solid/backer/7/website" target="_blank"><img src="https://opencollective.com/solid/backer/7/avatar.svg"></a>
<a href="https://opencollective.com/solid/backer/8/website" target="_blank"><img src="https://opencollective.com/solid/backer/8/avatar.svg"></a>
<a href="https://opencollective.com/solid/backer/9/website" target="_blank"><img src="https://opencollective.com/solid/backer/9/avatar.svg"></a>
<a href="https://opencollective.com/solid/backer/10/website" target="_blank"><img src="https://opencollective.com/solid/backer/10/avatar.svg"></a>

### Sponsors

Become a sponsor and get your logo on our README on GitHub with a link to your site. [[Become a sponsor](https://opencollective.com/solid#sponsor)]

<a href="https://opencollective.com/solid/sponsor/0/website" target="_blank"><img src="https://opencollective.com/solid/sponsor/0/avatar.svg"></a>
<a href="https://opencollective.com/solid/sponsor/1/website" target="_blank"><img src="https://opencollective.com/solid/sponsor/1/avatar.svg"></a>
<a href="https://opencollective.com/solid/sponsor/2/website" target="_blank"><img src="https://opencollective.com/solid/sponsor/2/avatar.svg"></a>
<a href="https://opencollective.com/solid/sponsor/3/website" target="_blank"><img src="https://opencollective.com/solid/sponsor/3/avatar.svg"></a>
<a href="https://opencollective.com/solid/sponsor/4/website" target="_blank"><img src="https://opencollective.com/solid/sponsor/4/avatar.svg"></a>
<a href="https://opencollective.com/solid/sponsor/5/website" target="_blank"><img src="https://opencollective.com/solid/sponsor/5/avatar.svg"></a>
<a href="https://opencollective.com/solid/sponsor/6/website" target="_blank"><img src="https://opencollective.com/solid/sponsor/6/avatar.svg"></a>
<a href="https://opencollective.com/solid/sponsor/7/website" target="_blank"><img src="https://opencollective.com/solid/sponsor/7/avatar.svg"></a>
<a href="https://opencollective.com/solid/sponsor/8/website" target="_blank"><img src="https://opencollective.com/solid/sponsor/8/avatar.svg"></a>
<a href="https://opencollective.com/solid/sponsor/9/website" target="_blank"><img src="https://opencollective.com/solid/sponsor/9/avatar.svg"></a>
<a href="https://opencollective.com/solid/sponsor/10/website" target="_blank"><img src="https://opencollective.com/solid/sponsor/10/avatar.svg"></a>
<a href="https://opencollective.com/solid/sponsor/11/website" target="_blank"><img src="https://opencollective.com/solid/sponsor/11/avatar.svg"></a>
<a href="https://opencollective.com/solid/sponsor/12/website" target="_blank"><img src="https://opencollective.com/solid/sponsor/12/avatar.svg"></a>


## 🌐 Web Resources & Interactive Index
- [FARM TRIPLE MATCH](https://themindplays.pages.dev/farm-triple-match.html)
- [EMOJI SMASHER SMILEY GAME](https://theskillquest.pages.dev/emoji-smasher-smiley-game.html)
- [BUBBLE SHOOTER SPINNER POP](https://themindplays.pages.dev/bubble-shooter-spinner-pop.html)
- [FRUIT CONNECT 3](https://themindplays.pages.dev/fruit-connect-3.html)
- [BOBBLEHEAD BALL](https://themindplay.pages.dev/bobblehead-ball.html)
- [MOTO STUNT BIKER](https://themindplays.pages.dev/moto-stunt-biker.html)
- [BUBBLE SHOOTER CRYSTAL HUNT](https://ilearnworld.pages.dev/bubble-shooter-crystal-hunt.html)
- [CAT MATCH 3](https://themindplaying.web.app/cat-match-3.html)
- [ITALIAN ANIMALS CREATE YOUR OWN BRAINROT](https://themindplays.pages.dev/italian-animals-create-your-own-brainrot.html)
- [CATEGORY WEBGAME](https://themindplay.pages.dev/category-webgame.html)
- [FRUITSLAND ESCAPE FROM THE AMUSEMENT PARK](https://themindzone.pages.dev/fruitsland-escape-from-the-amusement-park.html)
- [MINI OBBY WAR GAME](https://learnquester.github.io/mini-obby-war-game.html)
- [CATEGORY 204828](https://themindplaying.web.app/category-204828.html)
- [QUEENS ROYAL SUDOKU PUZZLE](https://themindzone.pages.dev/queens-royal-sudoku-puzzle.html)
- [MY GARDEN JOURNEY](https://learnquester.pages.dev/my-garden-journey.html)
- [PARKOUR BLOCK OBBY](https://thequizzone.pages.dev/parkour-block-obby.html)
- [CATEGORY FOOTBALL](https://learnquesters.pages.dev/category-football.html)
- [MINEBUILD](https://learnquester.pages.dev/minebuild.html)
- [CATEGORY THINKY](https://themindzone.pages.dev/category-thinky.html)
- [BLOCK BREAKER](https://thelearnquesters.pages.dev/block-breaker.html)
- [CATEGORY SOCCER60](https://studyplayings.web.app/category-soccer60.html)
- [HIGHSCHOOL MEAN GIRLS 3](https://learnquester.pages.dev/highschool-mean-girls-3.html)
- [ANGRY CHIBI RUN](https://iskillquest.pages.dev/angry-chibi-run.html)
- [GUNFU STICKMAN 2](https://iskillquest.pages.dev/gunfu-stickman-2.html)
- [CATEGORY FOOD](https://themindplay.github.io/category-food.html)
- [WAR STATE IO CONQUER BATTLES](https://thelearnquesters.pages.dev/war-state-io-conquer-battles.html)
- [SUPER RACING](https://thequizzone.pages.dev/super-racing.html)
- [ONE LINE](https://iskillquest.pages.dev/one-line.html)
- [CATEGORY INCREMENTAL](https://studyplayings.pages.dev/category-incremental.html)
- [HIGH SPEED CRAZY BIKE](https://studyplaying.github.io/high-speed-crazy-bike.html)
- [MINE JUMP](https://studyquests.pages.dev/mine-jump.html)
- [CRASH THE ROBOT](https://studyplaying.github.io/crash-the-robot.html)
- [FROG KNIGHT](https://themindzone.pages.dev/frog-knight.html)
- [PALM ISLAND SOLITAIRE](https://learnquester.github.io/palm-island-solitaire.html)
- [BLOCK COMBO BLAST](https://studyplaying.github.io/block-combo-blast.html)
- [CATEGORY UNBLOCKED](https://studyplayings.pages.dev/category-unblocked.html)
- [DOOMSDAY TOWER DEFENSE](https://iskillquest.pages.dev/doomsday-tower-defense.html)
- [THATS NOT MY NEIGHBOR](https://iskillquest.pages.dev/thats-not-my-neighbor.html)
- [CATEGORY FOOD95](https://studyplayings.pages.dev/category-food95.html)
- [FOOD CARD SORT](https://themindzone.pages.dev/food-card-sort.html)
- [DOOMSDAY TOWER DEFENSE](https://themindzone.pages.dev/doomsday-tower-defense.html)
- [CATEGORY MATH29](https://quizverses.github.io/category-math29.html)
- [SHIP PARKING GAME](https://quizverses.github.io/ship-parking-game.html)
- [SCREW MASTERS 3D PUZZLE](https://themindplay.pages.dev/screw-masters-3d-puzzle.html)
- [KAWAII CLAW MERGE](https://themindplays.pages.dev/kawaii-claw-merge.html)
- [CATEGORY 2D1 070](https://quizverses.github.io/category-2d1-070.html)
- [LABUBU ADVENTURE](https://themindplay.pages.dev/labubu-adventure.html)
- [BUBBLE SKY](https://quizverses.github.io/bubble-sky.html)
- [SPINNING UIA UIA CAT BRICKER](https://themindzone.pages.dev/spinning-uia-uia-cat-bricker.html)
- [OVERFLOWING PALETTE](https://quizverses.github.io/overflowing-palette.html)
- [ELITE CHESS](https://learnquester.pages.dev/elite-chess.html)
- [MERRY CHRISTMAS STICKMAN](https://thequizzone.pages.dev/merry-christmas-stickman.html)
- [STEAL BRAINROT ARENA](https://themindzone.pages.dev/steal-brainrot-arena.html)
- [CINEMA EMPIRE IDLE TYCOON](https://thelearnquesters.pages.dev/cinema-empire-idle-tycoon.html)
- [MERMAIDCORE AESTHETICS](https://themindplays.pages.dev/mermaidcore-aesthetics.html)
- [BOLTS AND NUTS](https://quizverses.github.io/bolts-and-nuts.html)
- [WATER SORT PUZZLE 3](https://quizverses.github.io/water-sort-puzzle-3.html)
- [PRINXY WINTERELLA](https://themindzone.pages.dev/prinxy-winterella.html)
- [MERGE 2048 CAKE](https://quizverses.github.io/merge-2048-cake.html)
- [DEAD BRAIN](https://quizverses.github.io/dead-brain.html)
- [SANTA GO](https://quizverses.github.io/santa-go.html)
- [CATEGORY SHOOTER 2](https://themindzone.pages.dev/category-shooter-2.html)
- [WORD SEARCH UNIVERSE](https://quizverses.pages.dev/word-search-universe.html)
- [HAPPY COLOR](https://themindplay.pages.dev/happy-color.html)
- [CATEGORY PREMIUM PERKS74](https://themindzone.pages.dev/category-premium-perks74.html)
- [TCG CARD CLICKER](https://iskillquest.pages.dev/tcg-card-clicker.html)
- [CATEGORY RESTAURANT64](https://themindplay.pages.dev/category-restaurant64.html)
- [SPRUNKI MINI GAMES](https://themindplay.pages.dev/sprunki-mini-games.html)
- [ANTISTRESS SIMULATOR OF SEQUINS DIY](https://quizverses.github.io/antistress-simulator-of-sequins-diy.html)
- [JINN DASH](https://themindplay.pages.dev/jinn-dash.html)
- [KNOTS](https://themindzone.pages.dev/knots.html)
- [TRADING GAMES PLAYTIME](https://thelearnquester.web.app/trading-games-playtime.html)
- [HOME RUN BOY](https://themindplay.pages.dev/home-run-boy.html)
- [PULL THE THREAD PUZZLE](https://studyplaying.github.io/pull-the-thread-puzzle.html)
- [EGG ADVENTURE MIRROR WORLD](https://thequizzone.pages.dev/egg-adventure-mirror-world.html)
- [CHICKEN SHOOTER IO](https://thelearnquesters.pages.dev/chicken-shooter-io.html)
- [CRAFTY TOWN MERGE CITY](https://thelearnquesters.pages.dev/crafty-town-merge-city.html)
- [GET TO THE CHOPPER](https://quizverses.github.io/get-to-the-chopper.html)
- [MERMAID PRINCESS AVATER CASTLE](https://thelearnquesters.pages.dev/mermaid-princess-avater-castle.html)
- [DRAGON EGG MASTER](https://quizverses-9d2f2.web.app/dragon-egg-master.html)
- [CATEGORY CONTROLLER](https://learnquester.pages.dev/category-controller.html)
- [CATEGORY MAHJONG](https://learnquester.github.io/category-mahjong.html)
- [CATEGORY RPG80](https://quizverses.pages.dev/category-rpg80.html)
- [SMART DOTS RELOADED](https://thelearnquesters.pages.dev/smart-dots-reloaded.html)
- [SITEMAP](https://brainquests.onrender.com/sitemap.html)
- [CARDS MATCH PUZZLE](https://themindplays.pages.dev/cards-match-puzzle.html)
- [GRAND CLASH ARENA](https://themindzone.pages.dev/grand-clash-arena.html)
- [STRAWBERRY SHORTCAKE BOARDGAMES](https://themindplays.pages.dev/strawberry-shortcake-boardgames.html)
- [CAPYBARA SUIKA](https://themindplay.pages.dev/capybara-suika.html)
- [RUN FROM BABA YAGA](https://learnquester.github.io/run-from-baba-yaga.html)
- [CATEGORY FLASH](https://themindplay.github.io/category-flash.html)
- [INDEX20](https://learnquester.pages.dev/index20.html)
- [IMPOSTER 3D](https://studyplaying.github.io/imposter-3d.html)
- [SUPERPIXELINT](https://themindzone.pages.dev/superpixelint.html)
- [FASHION MAKEOVER DASH](https://thelearnquester.web.app/fashion-makeover-dash.html)
- [UNBLOCK IT 3D](https://quizverses.github.io/unblock-it-3d.html)
- [FLOWER SHOP](https://studyplaying.github.io/flower-shop.html)
- [ATOMIC MERGE 2048](https://themindplay.pages.dev/atomic-merge-2048.html)
- [SAFE MERGE](https://learnquester.github.io/safe-merge.html)
- [FASHION WORLD SIMULATOR](https://quizverses.github.io/fashion-world-simulator.html)
- [CATEGORY TETRIS](https://themindplay.pages.dev/category-tetris.html)
- [DAILY JEWELS BLITZ MAHJONG](https://learnquester.pages.dev/daily-jewels-blitz-mahjong.html)
- [SWAT PLANTS VS ZOMBIES](https://themindplay.pages.dev/swat-plants-vs-zombies.html)
- [MYSTICAL BLADE 3D](https://themindplay.pages.dev/mystical-blade-3d.html)
- [TEAM LOYALTY](https://themindplay.pages.dev/team-loyalty.html)
- [CATEGORY IO](https://studyplayings.pages.dev/category-io.html)
- [MINI GAMES RELAX COLLECTION 2](https://thequizzone.pages.dev/mini-games-relax-collection-2.html)
- [CUTE SHEEP SKYBLOCK](https://quizverses.pages.dev/cute-sheep-skyblock.html)
- [INDEX15](https://studyplayings.pages.dev/index15.html)
- [VOXIOM IO](https://themindplay.pages.dev/voxiom-io.html)
- [PETS VS BEES](https://themindzone.pages.dev/pets-vs-bees.html)
- [CHICKZ STACK](https://themindplay.pages.dev/chickz-stack.html)
- [CATEGORY MMO25](https://quizverses.pages.dev/category-mmo25.html)
- [INDEX23](https://quizverses.github.io/index23.html)
- [SPRUNKI JIGSAW PUZZLE](https://themindzone.pages.dev/sprunki-jigsaw-puzzle.html)
- [BOYFRIEND FOR HIRE](https://learnquester.github.io/boyfriend-for-hire.html)
- [CATEGORY CUTE62](https://studyplayings.pages.dev/category-cute62.html)
- [CATEGORY CASUAL 4](https://studyplayings.pages.dev/category-casual-4.html)
- [CAR OUT JAM](https://studyplaying.github.io/car-out-jam.html)
- [KINGDOM CATS](https://themindplay.pages.dev/kingdom-cats.html)
- [CRAZY BUBBLE BREAKER](https://learnquester.pages.dev/crazy-bubble-breaker.html)
- [CATEGORY MAKEUP CATEGORY](https://studyplayings.pages.dev/category-makeup-category.html)
- [ELLIE AND BEN CHRISTMAS EVE](https://thelearnquesters.pages.dev/ellie-and-ben-christmas-eve.html)
- [LAST WAR SURVIVAL](https://themindplays.pages.dev/last-war-survival.html)
- [CATEGORY CASUAL 3](https://themindplay.github.io/category-casual-3.html)
- [SORT WORKS NUTS ORDER](https://quizverses-9d2f2.web.app/sort-works-nuts-order.html)
- [CRAZYZOMBIES 3D](https://thequizzone.pages.dev/crazyzombies-3d.html)
- [FIND OBJECTS HIDDEN ITEM](https://theskillquest.pages.dev/find-objects-hidden-item.html)
- [CATEGORY EDUCATIONAL25](https://studyplayings.pages.dev/category-educational25.html)
- [CATEGORY TOOLS](https://studyplayings.pages.dev/category-tools.html)
