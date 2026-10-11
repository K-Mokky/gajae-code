### Fixed

- The Bash tool's `read` builtin now decodes UTF-8 input instead of turning each byte into a Latin-1 character, so `while IFS= read -r line` loops pass non-ASCII text through intact, and `read -n`/`-N` count characters rather than bytes (#6543).
- `mapfile` into a readonly array now fails before reading, leaving piped input for the next reader as bash does.

### Performance

- `read` and `mapfile` read a regular file in blocks and give the unread bytes back to the file offset, and `mapfile` without `-n` or `-C` reads a pipe in blocks, instead of one system call per byte.
