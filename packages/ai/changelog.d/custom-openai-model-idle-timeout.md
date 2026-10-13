### Fixed

- OpenAI Responses and Completions streams now use a model's configured idle timeout when no environment or request override is set, so long reasoning gaps on compatible proxies can be tuned per model. Kimi Code's Anthropic-compatible route also honors its model timeout, with environment and request overrides retaining precedence.
