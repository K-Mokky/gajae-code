### Added

- `models.yml` accepts provider-level and per-model `streamIdleTimeoutMs` settings for OpenAI-compatible Completions and Responses models, with environment overrides retaining precedence. Provider defaults also apply to registry models without conflating per-model timeout differences with transport identity.
