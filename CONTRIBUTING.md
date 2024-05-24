# Contributing to SolidJS

Thank you for investing your time in contributing to our project! ✨.

Read our [Code of Conduct](https://github.com/solidjs/solid/blob/main/CODE_OF_CONDUCT.md) to keep our community approachable and respectable. Solid accepts a number of contributions from the broader community. More hands indeed make lighter work. We're however selective of the types of contributions we receive.

This usually involves vetting code quality, current focus, alignment with team philosophies etc. It's typically a good idea to submit a proposal for a change before spending time implementing it. This is to ensure that your efforts align with the current needs or more practically that work isn't completed by multiple contributors.

Note: If you would like your project listed here please submit a PR or contact a core/ecosystem member on Discord.

## Team Structure & Organization

There are a lot of opportunities to get involved. We organize Solid community efforts via Discord and typically onboard dedicated contributors into focused teams:

- Docs (headed by [@LadyBluenotes](https://github.com/ladybluenotes))
- Infrastructure (headed by [@davedbase](https://github.com/davedbase))
- Advocacy (headed by [@hindsight](https://github.com/eslachance))
- Growth (headed by [@davedbase](https://github.com/davedbase))
- Translators (headed by [@davedbase](https://github.com/davedbase))

Most team members are part of the Ecosystem Team or Core Team. Entry into these groups is selected by Core Members only. We do not accept applications or requests for entry. Selections are made ad-hoc according to internal needs. Selections are typically announced at Community Meetings which occur quarterly.

## Meetings and Schedules

SolidJS team members organize via Discord chat and audio channels. Channels exist to manage these conversations and threads within channels are used to focus on specific topics. A number of meetings occur weekly between each group however there is no set cadence or recurring schedule. Typically attendance for team members is requested to maintain membership, however we respect and recognize OSS contributions are typically ad hoc and as can be given by our members and generous donors.

## Official Opportunities

As a growing community, Solid has an on-going need for developers, writers, designers and general thought leaders. The following is a list of openings and tasks that Core attempts to maintain often.

### Docs Team

  To get involved, check out our [Contributing Guide](https://github.com/solidjs/solid-docs-next/blob/main/CONTRIBUTING.md) in the new docs repository!
  
- General/Core Docs
  - Write new drafts for the new docs repo
  - Work on the infrastructure for the new docs site
  - Create videos, diagrams, and other multimedia content
- Solid Start 1.0 API
  - Draft an initial, comprehensive set of docs for Solid Start
  - This currently takes place in [this subfolder](https://github.com/solidjs/solid-docs-next/tree/main/content/start) on `solid-docs-next`

### Infrastructure Team

- Solid Site
  - Help maintain the current Solid website by implementing bugs, testing and reporting issues
  - Port the current website from being an SPA to Solid Start
  - Website redevelopment project for 2.0
- Solid Service API
  - Help implement our API service that powers solid REPL
  - Test, validate and implement security and bug fixes
  - Add new missing features
- Develop new Solid Docs platform and website
  - Help coordinate creating MDX components
  - Developer infrastructure for delivering future community documentation platform
- Solidex (our ecosystem directory)
  - How maintain a list of ecosystem projects and resources (articles, podcasts etc.)
  - Vet incoming PR from submissions and merge + deploy updated the directory
  - Improve workflow and systems for managing Solidex
  - Implement an API (via Solid Service API) to search and filter resources
- Solid Dev Tools
  - We're actively looking for individuals to prototype and experiment on a set of developer tools.

### Solid Start Team

Solid Start is our new meta framework that focuses on enhancing Solid's DX story and general usability. Similar to SvelteKit, Next and other meta frameworks, this project is considered a primary core supported effort. Solid Start is approaching its beta release and we're looking for developers to test, validate and build on top of it. Join the #solid-start channel on Discord or the [solid-start](https://github.com/solidjs/solid-start) to learn more.

## Ecosystem Opportunities

SolidJS core members maintain a separate project called [SolidJS Community](https://github.com/solidjs-community). This is a large and lush ecosystem community project that encompasses a number of critical core tooling such as Solid Primitives, Solid Aria (similar to React Aria) etc.

The following are projects looking for leaders or support:

- [**Solid Aria**](https://github.com/solidjs-community/solid-aria) (lead by [@fabien-ml](https://github.com/fabien-ml)): A port of React Aria.
- [**Solid Examples**](https://github.com/solidjs-community/solid-examples) (lead by [@foolswisdom](https://github.com/mosheduminer)): A list of examples, patterns and app implementations.
- [**Solid Codemod**](https://github.com/solidjs-community/solid-codemod) (lead by [@trivikr](https://github.com/trivikr)): Convert React or other libraries to Solid automatically.
- [**Solid Snippets**](https://github.com/solidjs-community/solid-snippets) (lead by [@thetarnav](https://github.com/thetarnav)): VSCode snippet library.
- [**Solid DSL**](https://github.com/solidjs-community/solid-dsl) (lead by [@davedbase](https://github.com/davedbase)): A project to explore enhancing JSX or other DSL options.
- [**Solid Primitives**](https://github.com/solidjs-community/solid-primitives) (lead by [@davedbase](https://github.com/davedbase)): A large primitives (hooks) library.

Contributing to ecosystem projects is just as important as contributing to Solid core projects. As Solid grows a lush, well supported and high-quality set of packages and learning materials will benefit it's users and future viability.

## Where do I start?

If you haven't found any interesting information on this page then we encourage you to start hacking at a Solid related utility or package that does. Building useful tools for fellow OSS ecosystem and Solid users enhances the whole platform.

We can't wait to see what you build!

## Building Solid

This repository uses [pnpm](https://pnpm.io/) and
[Turborepo](https://turborepo.org/).
If you want to build Solid from scratch, use the following steps:

1. `corepack enable` (use the correct version of PNPM, https://nodejs.org/api/corepack.html#enabling-the-feature)
2. `pnpm install` (install all dependencies)
3. `pnpm build`

You can then run all tests via `pnpm test`.
