---
"@radius-project/core": minor
"@radius-project/graph-react": patch
---

**Changed:** Support only `Radius.*` resource types. Retired `Applications.*` types are no longer recognized, so a graph or recipe that still uses them is reported as unsupported instead of being silently translated to its Radius equivalent.

- `normalizeLiveGraph(payload, context)` no longer accepts an options argument, and the `LiveGraphOptions` type and its `legacyGatewayDirection` correction for `Applications.Core/gateways` are removed. Connection direction now comes from the payload alone, with no resource type special-cased.
- Recipe resolution matches a planned resource against the recipe pack by its declared type only. An `Applications.*` type resolves to no recipe and no output resources rather than borrowing the recipe registered for the equivalent `Radius.*` type.
