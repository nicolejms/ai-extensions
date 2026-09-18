---
name: radius-app-graph
description: Build and display the interactive Radius application graph for the current Claude Code workspace. Use when the user asks to show, inspect, build, or refresh a Radius app graph.
---

# Radius Application Graph

Use the Radius MCP tool `show_application_graph` to build and display the current workspace's application graph.

## Rules

- Do not run `rad` directly. The Radius MCP server owns the managed CLI and graph assembly.
- Use the current Claude Code working directory as the workspace.
- Let the tool select `.radius/app.bicep` first and `app.bicep` second. Pass `appBicepPath` only when the user identifies a different workspace-relative definition.
- Treat a tool error as a failure. Report the exact message instead of claiming that a graph was rendered.
- The returned MCP App is the graph UI. Do not replace it with a separately generated Mermaid diagram or copied graph implementation.

## Invocation

Call `show_application_graph` with no arguments for the normal case:

```json
{}
```

For a nonstandard application definition:

```json
{
  "appBicepPath": "services/api/app.bicep"
}
```

The interactive graph uses the shared `@radius-project/graph-react` renderer. Selecting a resource updates model context, source links send a follow-up request to open the local file, and external links open through the MCP host.
