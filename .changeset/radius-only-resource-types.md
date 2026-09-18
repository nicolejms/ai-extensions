---
"@radius-project/core": minor
"@radius-project/graph-react": patch
"radius": minor
---

**Changed:** Support only `Radius.*` resource types. Retired `Applications.*` types are no longer recognized anywhere, so a graph, recipe, or application model that still uses them is reported as unsupported instead of being silently translated to its Radius equivalent.

- `normalizeLiveGraph(payload, context)` no longer accepts an options argument, and the `LiveGraphOptions` type and its `legacyGatewayDirection` correction for `Applications.Core/gateways` are removed. Connection direction now comes from the payload alone, with no resource type special-cased.
- Recipe resolution matches a planned resource against the recipe pack by its declared type only. An `Applications.*` type resolves to no recipe and no output resources rather than borrowing the recipe registered for the equivalent `Radius.*` type.
- A root `app.bicep` whose only Radius signal is an `Applications.Core/applications` resource no longer activates the canvas; the `radius` extension declaration or a `Radius.Core/applications` resource still does.
- The `get_graph_resources` action excludes the application resource itself from its missing-source-reference results by matching the `applications` type segment, instead of every resource type whose name happens to contain `applications`.
