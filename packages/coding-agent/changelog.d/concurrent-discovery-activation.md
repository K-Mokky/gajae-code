### Fixed

- Serialize concurrent discovered-tool activations per session and fence queued or in-flight commits across session transitions, preventing stale prompt rebuilds from overwriting successor tools and selections.
