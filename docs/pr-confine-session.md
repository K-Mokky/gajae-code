# PR: confine a session to its directory

Target branch: `dev`

## Title

```text
feat(session): confine a session to its directory with --confine
```

## Body

```markdown
## Summary

- Add `--confine`, an opt-in launch mode that keeps one session inside its cwd and descendants.
- Keep confined transcripts out of ordinary `--continue`, `--resume`, and the resume picker. Resuming one requires the same flag.
- On macOS, run the session shell under `sandbox-exec`, so command text cannot read or write outside that directory. Direct paths, `../`, and a symlink inside the root that points outside it are denied by the kernel.

## Why

A session opened in one project can currently read a parent directory, a sibling checkout, and `~` through tool paths and shell commands. This flag is for the case where the operator wants that session's tools and shell process limited to the directory it was opened in.

Ordinary sessions are unchanged. The flag is not a default, and it does not claim to be a virtual machine.

## Behavior

- `gjc --confine` creates a session whose header records `filesystemScope: "cwd"`.
- `read`, `write`, `edit`, `search`, and `find` reject a resolved path outside the session root.
- The shell working directory is rejected outside that root, including a symlink that resolves outside it.
- `move_session` cannot move the session above that root.
- `gjc --continue` and `gjc --resume` skip confined transcripts. `gjc --confine --continue` and `gjc --confine --resume <id>` skip ordinary ones.
- On macOS the shell process itself runs inside a Seatbelt profile rooted at the session directory. System tool paths remain readable so compilers and interpreters still run. Writes outside the root are denied, except system temp directories.
- Linux and Windows have no equivalent process sandbox in this build. A confined shell fails closed there instead of running unsandboxed.

## What this does not do

- It does not close the network. A command can still send file contents it can read.
- It does not sandbox processes the user starts outside this session.
- It is not an OS-level virtual machine. The boundary is the session's tool calls and the shell process those calls spawn.

## Test plan

- [x] `bun test packages/coding-agent/test/workspace-confine.test.ts packages/coding-agent/test/confine-session.test.ts`
- [x] Sandboxed process denies a parent path, `../`, and a symlink from the session root to a file under the home directory, while a file inside the root still reads.
- [ ] Open `gjc --confine` in a scratch directory and confirm `cat ../secret` is denied on macOS.
- [ ] Confirm `gjc --continue` does not resume that session, and `gjc --confine --continue` does.
- [ ] Confirm an ordinary `gjc` session is unchanged.
```

## How to open it

Run this from the repository root. It does not switch your current branch until the first command.

```sh
git checkout -b feat/confine-session
git add docs/session.md docs/pr-confine-session.md \
  packages/coding-agent/changelog.d/confine-session.md \
  packages/coding-agent/src/cli/args.ts \
  packages/coding-agent/src/cli/root-flags.ts \
  packages/coding-agent/src/commands/launch.ts \
  packages/coding-agent/src/exec/bash-executor.ts \
  packages/coding-agent/src/main.ts \
  packages/coding-agent/src/sdk/session.ts \
  packages/coding-agent/src/session/agent-session.ts \
  packages/coding-agent/src/session/session-confinement.ts \
  packages/coding-agent/src/session/session-manager.ts \
  packages/coding-agent/src/tools/bash.ts \
  packages/coding-agent/src/tools/confine-sandbox.ts \
  packages/coding-agent/src/tools/index.ts \
  packages/coding-agent/src/tools/path-utils.ts \
  packages/coding-agent/src/tools/workspace-confine.ts \
  packages/coding-agent/test/confine-session.test.ts \
  packages/coding-agent/test/workspace-confine.test.ts
git commit -m "$(cat <<'EOF'
feat(session): confine a session to its directory with --confine

A session opened in one project could read parent and sibling paths through
tool arguments and shell command text. The flag keeps that session inside its
cwd and out of ordinary resume.

EOF
)"
git push -u origin HEAD
gh pr create --base dev --title "feat(session): confine a session to its directory with --confine" --body-file docs/pr-confine-session.md
```

If `gh` is not authenticated, stop after the push and open the PR from the URL GitHub prints. The base must be `dev`, not `main`.
