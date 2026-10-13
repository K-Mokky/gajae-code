### Fixed

- Recover SDK broker startup when a stale lock's PID has been reused by a different process incarnation, serialize concurrent reclamation, and reap aged PID-reuse tombstones without weakening fail-closed behavior when incarnation evidence is unavailable. Lock reclamation now requires host qualification: only same-host PID/incarnation mismatches trigger reclaim; foreign-host or host-unqualified (legacy) owners are treated conservatively and never reclaimed based on incarnation mismatch alone (#6719).
