### Fixed

- Serialize concurrent discovered-tool activations per session and fence queued or in-flight commits after session transitions commit. Canceled transitions and read-only MCP status snapshots preserve pending activations; mutating controls still fence catalog changes. Publish tool names to execution contexts only after the active-tool set commits, preventing stale rebuilds from leaking into successor sessions.
