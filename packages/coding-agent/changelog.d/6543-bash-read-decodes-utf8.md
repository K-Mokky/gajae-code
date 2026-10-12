### Fixed

- The Bash tool's `read` builtin now decodes UTF-8 input instead of turning each byte into a Latin-1 character, so `while IFS= read -r line` loops pass non-ASCII text through intact, and `read -n`/`-N` count characters rather than bytes (#6543).
- `mapfile` into a readonly array now fails before reading, leaving piped input for the next reader as bash does.
