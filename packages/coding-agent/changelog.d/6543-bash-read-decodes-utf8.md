### Fixed

- The Bash tool's `read` builtin now decodes valid UTF-8 as text and preserves Windows ANSI-code-page text from native pipelines instead of replacing it, so `while IFS= read -r line` loops pass non-ASCII text through intact, and `read -n`/`-N` count UTF-8 characters rather than bytes (#6543).
- `mapfile` into a readonly array now fails before reading, leaving piped input for the next reader as bash does.
