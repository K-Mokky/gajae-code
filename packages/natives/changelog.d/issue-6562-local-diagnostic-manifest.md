### Fixed

- Keep local native builds from rewriting the checked-in diagnostic artifact manifest; CI and distribution builds continue updating the trusted record. Local binary builds verify the ignored digest and carry it into the compiled binary instead of weakening the release trust gate.
