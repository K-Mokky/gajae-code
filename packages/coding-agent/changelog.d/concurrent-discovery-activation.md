### Fixed

- Serialize concurrent discovered-tool activations per session and fence queued or in-flight commits after session transitions commit. Canceled transitions preserve the original session's pending activations. Publish tool names to execution contexts only after the active-tool set commits, preventing stale rebuilds from leaking into successor sessions.
