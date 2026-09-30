---
"radius": minor
---

**Changed:** Support only `Radius.*` resource types. Retired `Applications.*` types are no longer recognized, so an application model that still uses them is reported as unsupported instead of being silently translated to its Radius equivalent.

- A root `app.bicep` whose only Radius signal is an `Applications.Core/applications` resource no longer activates the canvas; the `radius` extension declaration or a `Radius.Core/applications` resource still does.
- The `get_graph_resources` action excludes the application resource itself from its missing-source-reference results by matching the `applications` type segment, instead of every resource type whose name happens to contain `applications`.
