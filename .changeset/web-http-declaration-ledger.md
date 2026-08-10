---
"@solidjs/web": patch
---

`httpHeader`/`httpStatus` retraction is declaration-exact instead of snapshot-restore: each response head keeps a ledger of live declarations per header (and for status), and disposing a scope removes only that scope's entry, replaying the survivors over the integration's base value in original write order. The write-time whole-field snapshot was only correct for LIFO disposal — when an earlier sibling SSR scope recovered while a later writer stayed live, restoring the earlier snapshot deleted the survivor's contribution (silently dropping e.g. a session `Set-Cookie`; same ordering hole for plain headers and `httpStatus`, #2984). Set-cookie ledgers stay entry-exact (`getSetCookie()` + re-append), and once a header's last declaration retracts its ledger is dropped so a later declaration re-reads a fresh base.
