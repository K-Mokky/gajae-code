### Fixed
- Detect project-declared `TMPDIR` from the workflow guard caller's cwd while retaining startup dotenv declarations after `.env` is removed or the process changes directories.
