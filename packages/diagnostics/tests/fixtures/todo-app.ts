/**
 * A small signals-level "component": todo state, derived values, and render
 * effects that append to a render log (standing in for the DOM).
 *
 * Exercised by tests/acceptance.test.ts, which captures a scripted session
 * with @solidjs/diagnostics and enforces behavior + a reactive budget.
 */
import { createEffect, createMemo, createRoot, createSignal, untrack } from "@solidjs/signals";

export interface Todo {
  id: number;
  title: string;
  done: boolean;
}

export type Filter = "all" | "active";
export type Theme = "light" | "dark";

export interface TodoAppHandle {
  addTodo(title: string, done?: boolean): void;
  setFilter(filter: Filter): void;
  toggleTheme(): void;
  readonly renderLog: string[];
  dispose(): void;
}

let nextId = 1;

export function mountTodoApp(): TodoAppHandle {
  const renderLog: string[] = [];

  const [todos, setTodos] = createSignal<Todo[]>([], { name: "todos" });
  const [filter, setFilter] = createSignal<Filter>("all", { name: "filter" });
  const [theme, setTheme] = createSignal<Theme>("light", { name: "theme" });

  const dispose = createRoot(dispose => {
    // Theme watcher: paints the current theme into the render log.
    createEffect(
      theme,
      currentTheme => {
        renderLog.push(`theme:${currentTheme}`);
      },
      { name: "themeWatcher" }
    );

    // Component body — untracked, like every Solid component.
    untrack(() => {
      const visibleCount = createMemo(
        () => {
          const list = todos();
          return (filter() === "active" ? list.filter(todo => !todo.done) : list).length;
        },
        { name: "visibleCount" }
      );

      createEffect(
        () => `${filter()}:${visibleCount()}`,
        header => {
          renderLog.push(`header:${header}`);
        },
        { name: "renderHeader" }
      );
    }, "component <TodoApp>");
    return dispose;
  });

  return {
    addTodo(title, done = false) {
      setTodos(list => [...list, { id: nextId++, title, done }]);
    },
    setFilter,
    toggleTheme() {
      setTheme(current => (current === "light" ? "dark" : "light"));
    },
    renderLog,
    dispose
  };
}
