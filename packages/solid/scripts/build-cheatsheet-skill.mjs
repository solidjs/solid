/**
 * Publish CHEATSHEET.md as an Agent Skill at `skills/solid-2.0-cheatsheet/SKILL.md`
 * so skill registries (TanStack Intent, `npx skills add`) and agents reading
 * `node_modules/solid-js/skills/` find it beside the hand-written skills.
 *
 * CHEATSHEET.md stays the single source of truth: this step prepends the
 * frontmatter the skill format requires and copies the rest verbatim. It runs
 * as part of `build`, and the output is gitignored.
 */
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const source = path.join(root, "CHEATSHEET.md");
const target = path.join(root, "skills", "solid-2.0-cheatsheet", "SKILL.md");

const frontmatter = `---
name: solid-2.0-cheatsheet
description: The complete Solid 2.0 API cheatsheet (solid-js 2.x, @solidjs/web). Use to look up the exact signature or form of a Solid 2.0 primitive, component, store setter, prop, attribute or SSR entry, and for the full list of 1.x APIs that no longer exist and their replacements.
---

<!-- Generated from CHEATSHEET.md by scripts/build-cheatsheet-skill.mjs. Edit CHEATSHEET.md, not this file. -->

`;

fs.mkdirSync(path.dirname(target), { recursive: true });
fs.writeFileSync(target, frontmatter + fs.readFileSync(source, "utf8"));
console.log(`wrote ${path.relative(root, target)} from CHEATSHEET.md`);
