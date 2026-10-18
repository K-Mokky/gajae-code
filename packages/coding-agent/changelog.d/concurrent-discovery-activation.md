### Fixed

- Serialize concurrent discovered-tool activations per session and fence queued or in-flight commits at committed session and MCP catalog boundaries. Revalidate delayed activations against current MCP catalog and registry entry identities after prompt rebuilds; canceled transitions and read-only MCP status snapshots preserve pending activations. Seed and publish execution-context tool names from active tools, including exact-MCP rollback restoration, so stale rebuilds or failed controls cannot leave mismatched context.
