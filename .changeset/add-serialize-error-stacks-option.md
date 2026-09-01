---
"@solidjs/web": patch
---

Add `serializeErrorStacks` to the serialization codec options (and `createSerializer`): error-stack disclosure defaulted to `NODE_ENV === "development"`, which describes the process rather than the artifact — a production build run with `NODE_ENV=development` shipped stacks to the wire, including application-code stacks for errors marked with `markSafeError`. Deployments can now pin `codec: { serializeErrorStacks: false }` regardless of the ambient variable (#3152)
