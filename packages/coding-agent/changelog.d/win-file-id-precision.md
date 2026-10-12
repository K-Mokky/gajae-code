### Fixed

- Native user-agent instructions are no longer intermittently skipped on Windows when the agent directory's NTFS file ID exceeds 2^53: contained-file reads now compare the root identity in the same precision a plain `stat` captured it.
