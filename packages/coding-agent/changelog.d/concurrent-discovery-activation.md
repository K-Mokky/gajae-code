### Fixed

- Serialize concurrent discovered-tool activations per session and fence queued or in-flight commits across session transitions. Publish tool names to execution contexts only after the active-tool set commits, preventing stale rebuilds from leaking into successor sessions.
