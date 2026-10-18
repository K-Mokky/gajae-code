### Fixed

- Isolate the text-only SDK stop/restart test from real broker startup, restore its clock before teardown, and synchronize arbiter publication checks with observed retry state instead of fixed sleeps.
