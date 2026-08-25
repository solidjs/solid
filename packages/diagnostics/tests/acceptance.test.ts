/**
 * Acceptance contract for tests/fixtures/todo-app.ts.
 *
 * This file defines what "done" means for the todo app: correct render
 * output for a scripted session, zero diagnostics, zero wasted re-runs,
 * and per-scope re-run budgets. Fix the component, not this file — the
 * budgets pin the existing scope names (todos/filter/theme/visibleCount/
 * renderHeader/themeWatcher), so keep them.
 */
import { flush } from "@solidjs/signals";
import { assertBudget, captureArtifact, expectNoDiagnostics } from "../src/index.js";
import { mountTodoApp } from "./fixtures/todo-app.js";

describe("todo app acceptance", () => {
  it("renders correctly within budget for a scripted session", async () => {
    const { result: renderLog, artifact } = await captureArtifact(
      () => {
        const app = mountTodoApp();
        flush();
        app.addTodo("write tests");
        flush();
        app.addTodo("ship it", true);
        flush();
        app.setFilter("active");
        flush();
        app.toggleTheme();
        flush();
        app.dispose();
        return app.renderLog;
      },
      { scenario: "todo-session" }
    );

    // Behavior: every state change the user made is visible in the output.
    expect(renderLog).toContain("theme:light");
    expect(renderLog).toContain("header:all:0");
    expect(renderLog).toContain("header:all:1");
    expect(renderLog).toContain("header:all:2");
    expect(renderLog).toContain("header:active:1");
    expect(renderLog).toContain("theme:dark");
    // ...and nothing rendered twice.
    expect(renderLog).toHaveLength(6);

    // Reactive quality: no rule violations, no wasted recomputes, and each
    // scope re-runs only when something it renders actually changed.
    expectNoDiagnostics(artifact);
    assertBudget(artifact, {
      maxReruns: 10,
      maxWastedRuns: 0,
      scopes: {
        visibleCount: 4,
        renderHeader: 4,
        themeWatcher: 2
      }
    });
  });
});
