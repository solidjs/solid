import type { Scenario } from "./scenario.js";

/** Reduced generated witnesses; classifications never suppress executable rules. */
export const corpus: Array<{
  name: string;
  classification: string;
  seed?: number;
  index?: number;
  foundOn: string;
  scenario: Scenario;
}> = [
  {
    name: "disposed-reader",
    classification: "historical-disposal-waiting; released by #3392",
    seed: 3289,
    index: 17,
    foundOn: "005a623864ffd7cc3c76628369588ddcc4df26a5",
    scenario: {
      version: 1,
      show: false,
      nodes: [
        {
          id: 0,
          deps: [-1],
          factor: 1,
          offset: 0,
          delivery: "manual"
        },
        {
          id: 1,
          deps: [0],
          factor: 1,
          offset: 0,
          delivery: "sync"
        }
      ],
      readers: [
        {
          refs: [1],
          gated: false,
          id: 0,
          boundary: "none"
        }
      ],
      turns: [
        {
          steps: [
            {
              op: "write",
              value: 2
            }
          ]
        },
        {
          steps: [
            {
              op: "dispose",
              reader: 0
            }
          ]
        }
      ],
      strict: true
    }
  },
  {
    name: "stale-reader",
    classification: "candidate-failure",
    seed: 3289,
    index: 73,
    foundOn: "005a623864ffd7cc3c76628369588ddcc4df26a5",
    scenario: {
      version: 1,
      show: false,
      nodes: [
        {
          id: 0,
          deps: [-1],
          factor: 1,
          offset: 0,
          delivery: "sync"
        },
        {
          id: 1,
          deps: [0],
          factor: 1,
          offset: 0,
          delivery: "manual"
        },
        {
          id: 2,
          deps: [0],
          factor: 1,
          offset: 0,
          delivery: "promise"
        }
      ],
      readers: [
        {
          refs: [-1, 1],
          gated: false,
          id: 1,
          boundary: "none"
        },
        {
          refs: [-1, 2],
          gated: true,
          id: 2,
          boundary: "none"
        }
      ],
      turns: [
        {
          steps: [
            {
              op: "queue",
              id: 0,
              via: "task",
              step: {
                op: "show",
                value: true
              }
            }
          ]
        },
        {
          steps: [
            {
              op: "write",
              value: 2
            }
          ]
        }
      ],
      strict: true
    }
  },
  {
    name: "stuck-hidden",
    classification: "candidate-failure",
    seed: 3289,
    index: 168,
    foundOn: "005a623864ffd7cc3c76628369588ddcc4df26a5",
    scenario: {
      version: 1,
      show: true,
      nodes: [
        {
          id: 0,
          deps: [-1],
          factor: 1,
          offset: 0,
          delivery: "manual"
        }
      ],
      readers: [
        {
          refs: [-1],
          gated: true,
          id: 0,
          boundary: "none"
        },
        {
          refs: [0],
          gated: true,
          id: 2,
          boundary: "none"
        }
      ],
      turns: [
        {
          steps: [
            {
              op: "queue",
              id: 1,
              via: "promise",
              step: {
                op: "show",
                value: false
              }
            },
            {
              op: "write",
              value: 3
            }
          ]
        },
        {
          steps: [
            {
              op: "show",
              value: true
            }
          ]
        },
        {
          steps: [
            {
              op: "write",
              value: 0
            }
          ]
        }
      ],
      strict: true
    }
  },
  {
    name: "late-pending-read",
    classification: "fixed-on-pr-3347",
    seed: 3289,
    index: 7045,
    foundOn: "005a623864ffd7cc3c76628369588ddcc4df26a5",
    scenario: {
      version: 1,
      show: false,
      nodes: [
        {
          id: 0,
          deps: [-1],
          factor: 1,
          offset: 0,
          delivery: "await"
        },
        {
          id: 1,
          deps: [0],
          factor: 1,
          offset: 0,
          delivery: "manual"
        }
      ],
      readers: [
        {
          refs: [0],
          gated: false,
          id: 0,
          boundary: "retain"
        },
        {
          refs: [-1, 0, 1],
          gated: true,
          id: 2,
          boundary: "none"
        }
      ],
      turns: [
        {
          steps: [
            {
              op: "write",
              value: 2
            }
          ]
        },
        {
          steps: [
            {
              op: "resolve",
              node: 0,
              which: "newest",
              key: "0:[2]#1"
            }
          ]
        },
        {
          steps: [
            {
              op: "write",
              value: 0
            }
          ]
        },
        {
          steps: [
            {
              op: "queue",
              id: 4,
              via: "task",
              step: {
                op: "show",
                value: true
              }
            }
          ]
        }
      ],
      strict: true
    }
  },
  {
    name: "disposed-pending-control",
    classification: "candidate-failure",
    seed: 3289,
    index: 524,
    foundOn: "005a623864ffd7cc3c76628369588ddcc4df26a5",
    scenario: {
      version: 1,
      show: false,
      nodes: [
        {
          id: 0,
          deps: [-1],
          factor: 1,
          offset: 0,
          delivery: "sync"
        },
        {
          id: 1,
          deps: [-1],
          factor: 1,
          offset: 0,
          delivery: "sync"
        },
        {
          id: 2,
          deps: [0, 1],
          factor: 1,
          offset: 0,
          delivery: "manual"
        }
      ],
      readers: [
        {
          refs: [2, 0],
          gated: true,
          id: 0,
          boundary: "none"
        }
      ],
      turns: [
        {
          steps: [
            {
              op: "write",
              value: 1
            }
          ]
        },
        {
          steps: [
            {
              op: "show",
              value: true
            }
          ]
        },
        {
          steps: [
            {
              op: "dispose",
              reader: 0
            }
          ]
        }
      ],
      strict: true
    }
  },
  {
    name: "optimistic-correction-settled",
    classification: "experimental-completion-candidate",
    foundOn: "344ed054a932c7508efe57908eb175ed67d54940",
    scenario: {
      version: 2,
      sources: [-1, -2],
      show: true,
      optimistic: { proposals: [1], authoritative: 0 },
      nodes: [{ id: 0, deps: [-2], factor: 2, offset: 0, delivery: "manual" }],
      readers: [{ id: 0, refs: [-2, 0], gated: false, boundary: "none" }],
      turns: [
        { steps: [{ op: "start-action" }] },
        { steps: [{ op: "resolve", node: 0, which: "newest" }] }
      ]
    }
  },
  {
    name: "latest-late-mount",
    classification: "final-publication-candidate",
    foundOn: "344ed054a932c7508efe57908eb175ed67d54940",
    scenario: {
      version: 2,
      sources: [-1, -2],
      anchors: [-1],
      show: true,
      optimistic: { kind: "latest", proposals: [1], authoritative: 1, hold: true },
      nodes: [],
      readers: [{ id: 0, refs: [-2], gated: false, boundary: "none", mounted: false }],
      turns: [
        { steps: [{ op: "start-action" }] },
        { steps: [{ op: "mount", reader: 0, value: true }] }
      ]
    }
  },
  {
    name: "held-sync-verdict",
    classification: "readiness-candidate",
    foundOn: "344ed054a932c7508efe57908eb175ed67d54940",
    scenario: {
      version: 2,
      sources: [-1],
      show: true,
      nodes: [
        { id: 0, deps: [-1], factor: 1, offset: 0, delivery: "sync" },
        { id: 1, deps: [-1], factor: 1, offset: 0, delivery: "manual" }
      ],
      readers: [
        { id: 0, refs: [0], gated: false, boundary: "none", pending: true },
        { id: 1, refs: [1], gated: false, boundary: "none" }
      ],
      turns: [{ steps: [{ op: "write", value: 1 }] }]
    }
  },
  {
    name: "hidden-reader-release",
    classification: "ideal-progress-candidate; distinct from explicit disposal",
    foundOn: "bc54629bf58f55f47e0f4ae369919d643e85594a",
    scenario: {
      version: 1,
      show: true,
      nodes: [{ id: 0, deps: [-1], factor: 1, offset: 0, delivery: "manual" }],
      readers: [{ id: 0, refs: [0], gated: true, boundary: "none" }],
      turns: [{ steps: [{ op: "write", value: 1 }] }, { steps: [{ op: "show", value: false }] }]
    }
  },
  {
    name: "mixed-effect-entanglement",
    classification:
      "ideal-independent-publication-candidate; shared effect reads async answers and their sources",
    foundOn: "bc54629bf58f55f47e0f4ae369919d643e85594a",
    scenario: {
      version: 2,
      sources: [-1, -2],
      show: true,
      nodes: [
        { id: 0, deps: [-1], factor: 1, offset: 0, delivery: "manual" },
        { id: 1, deps: [-2], factor: 1, offset: 0, delivery: "manual" }
      ],
      readers: [{ id: 0, refs: [0, 1, -1, -2], gated: false, boundary: "none" }],
      turns: [
        { steps: [{ op: "write", source: -1, value: 1 }] },
        { steps: [{ op: "write", source: -2, value: 1 }] },
        { steps: [{ op: "resolve", node: 0, which: "newest" }] }
      ]
    }
  }
];
