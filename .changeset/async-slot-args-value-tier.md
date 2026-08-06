---
"@solidjs/web": patch
---

DR-2 value tier, client half: async values passed whole as slot args (promises, async iterables) suspend at the consumption read. The slot-props proxy routes an async-valued prop through a lazily created async memo under the occurrence's owner, so the read follows the normal async path — it suspends into the covering loading boundary and settles when the server's data chunk lands. Applies on both the live-props and static-args paths. (The shell gate this leans on — a fresh mount's covering `<Loading>` holding until the frame's first apply — shipped separately; here it's what gives a t=0 fill's pending async arg read its covering boundary.)
