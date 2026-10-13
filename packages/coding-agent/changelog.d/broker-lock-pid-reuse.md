### Fixed

- Recover SDK broker startup when a stale lock's PID has been reused by a different process incarnation, serialize concurrent reclamation, and reap aged PID-reuse tombstones without weakening fail-closed behavior when incarnation evidence is unavailable.
