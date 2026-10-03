import type { Scenario } from "./scenario.js";

export function chain(delivery: "sync" | "promise" | "manual" | "await" = "manual"): Scenario {
  return {
    version: 1,
    show: true,
    nodes: [
      { id: 0, deps: [-1], factor: 2, offset: 1, delivery },
      { id: 1, deps: [0], factor: 1, offset: 3, delivery: "sync" }
    ],
    readers: [{ id: 0, refs: [-1, 1], gated: false, boundary: "none" }],
    turns: [{ steps: [{ op: "write", value: 1 }] }]
  };
}

export function obsolete(): Scenario {
  const s = chain();
  s.turns = [
    { steps: [{ op: "write", value: 1 }] },
    { steps: [{ op: "write", value: 2 }] },
    { steps: [{ op: "resolve", node: 0, which: "newest" }] }
  ];
  return s;
}

export function reveal(boundary: "none" | "retain" | "reset" = "none"): Scenario {
  const s = chain();
  s.show = false;
  s.readers = [{ id: 0, refs: [1], gated: true, boundary }];
  s.turns.push({ steps: [{ op: "show", value: true }] });
  return s;
}

export function readyControl(): Scenario {
  const s = chain();
  s.version = 2;
  s.sources = [-1];
  s.readers = [{ id: 0, refs: [1], gated: false, boundary: "none", pending: true }];
  s.turns = [
    {
      steps: [
        { op: "click", reader: 0 },
        { op: "write", value: 1 }
      ]
    },
    {
      steps: [
        { op: "click", reader: 0 },
        { op: "resolve", node: 0, which: "newest" }
      ]
    },
    {
      steps: [
        { op: "click", reader: 0 },
        { op: "read", ref: 1, mode: "pending" }
      ]
    }
  ];
  return s;
}

export function heldPending(): Scenario {
  const s = readyControl();
  s.readers.push({ id: 1, refs: [1], gated: false, boundary: "none" });
  s.turns = [{ steps: [{ op: "write", value: 1 }] }];
  return s;
}

export function disposedReader(): Scenario {
  const s = chain();
  s.turns.push({ steps: [{ op: "dispose", reader: 0 }] });
  return s;
}

/** A held details write loses its only blocker when a page reset publishes fallback. */
export function releasedFallback(): Scenario {
  return {
    version: 2,
    sources: [-1, -2],
    show: true,
    nodes: [
      { id: 0, deps: [-1], factor: 1, offset: 0, delivery: "manual" },
      { id: 1, deps: [0, -2], factor: 1, offset: 0, delivery: "manual" }
    ],
    readers: [{ id: 0, refs: [1], gated: false, boundary: "reset" }],
    turns: [
      { steps: [{ op: "write", source: -2, value: 1 }] },
      { steps: [{ op: "write", source: -1, value: 1 }] }
    ]
  };
}

export function separateUpdates(): Scenario {
  return {
    version: 2,
    sources: [-1, -2],
    show: true,
    nodes: [
      { id: 0, deps: [-1], factor: 1, offset: 0, delivery: "manual" },
      { id: 1, deps: [-2], factor: 1, offset: 0, delivery: "manual" }
    ],
    readers: [
      { id: 0, refs: [0], gated: false, boundary: "none" },
      { id: 1, refs: [1], gated: false, boundary: "none" },
      { id: 2, refs: [-1, -2], gated: false, boundary: "none" }
    ],
    turns: [
      { steps: [{ op: "write", source: -1, value: 1 }] },
      { steps: [{ op: "write", source: -2, value: 1 }] },
      { steps: [{ op: "resolve", node: 0, which: "newest" }] }
    ]
  };
}

export function heldAction(): Scenario {
  const s = separateUpdates();
  s.actions = [{ id: 0, segments: [[{ source: -1, value: 1 }], []] }];
  s.turns = [
    { steps: [{ op: "start-action", action: 0 }] },
    { steps: [{ op: "resolve", node: 0, which: "newest" }] },
    { steps: [{ op: "resume-action", action: 0 }] }
  ];
  return s;
}
