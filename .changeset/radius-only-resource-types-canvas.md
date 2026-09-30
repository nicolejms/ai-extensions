---
"radius": major
---

**Removed:** Support for retired `Applications.*` resource types. Canvas now recognizes only `Radius.*` types, so an application model that still uses `Applications.*` types is reported as unsupported instead of being silently translated to its Radius equivalent.

Before upgrading, convert every `Applications.*` resource in your `app.bicep` to its `Radius.*` equivalent (for example, `Applications.Core/containers` to `Radius.Compute/containers`) and declare the application as `Radius.Core/applications`.

- A root `app.bicep` whose only Radius signal is an `Applications.Core/applications` resource no longer activates the canvas; the `radius` extension declaration or a `Radius.Core/applications` resource still does.
- The `get_graph_resources` action excludes the application resource itself from its missing-source-reference results by matching the `applications` type segment, instead of every resource type whose name happens to contain `applications`.
