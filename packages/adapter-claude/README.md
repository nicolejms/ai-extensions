# Radius for Claude Code

`@radius-project/adapter-claude` is a Claude Code plugin and MCP App adapter for Radius. It builds application graphs with `@radius-project/adapter-shared` and renders them with the shared `@radius-project/graph-react` library.

## Current Surface

- Claude Code plugin manifest under `.claude-plugin/plugin.json`
- Bundled stdio MCP server configured by `.mcp.json`
- `show_application_graph` MCP tool
- Interactive MCP App graph with refresh, resource details, source navigation, external links, and model-context updates
- `radius-app-graph` Agent Skill

The adapter does not import the GitHub Copilot SDK or reuse Canvas runtime state. Claude Code owns the MCP lifecycle, while Radius core and shared adapter packages own graph behavior and CLI execution.

## Build

From the repository root:

```console
pnpm install --frozen-lockfile
pnpm run build:claude
```

The build produces `packages/adapter-claude/dist/server.mjs` and `packages/adapter-claude/dist/mcp-app.html`.

## Run in Claude Code

Build first, then load the package directory as a local plugin:

```console
claude --plugin-dir packages/adapter-claude
```

Ask Claude to show the Radius application graph, or invoke `/radius:radius-app-graph`.

The current workspace must contain `.radius/app.bicep` or `app.bicep`. A different workspace-relative path can be supplied through the tool's `appBicepPath` argument.

## Test

```console
pnpm --filter @radius-project/adapter-claude test
pnpm --filter @radius-project/adapter-claude test:component
pnpm --filter @radius-project/adapter-claude test:artifact
```
