### Added

- Add Gemini 4 Argon (`gemini-4-argon`) to bundled `google-antigravity` provider models so the model surfaces reliably even when dynamic discovery fails. The model supports text and image input, reasoning with `google-level` thinking (low/medium/high), and a 1M token context window.

### Fixed

- Surface Gemini 4 Argon from Antigravity model discovery by ensuring internal models marked in `agentModelSorts` are correctly exposed. Added regression tests verifying that `isInternal` models are properly gated on presence in the `agentModelSorts` response payload.
