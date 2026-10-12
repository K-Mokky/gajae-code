# report_issue

> Records a tool whose behavior contradicted its own description into a local SQLite database, for tool-quality tracking from real sessions.

## Source
- Entry: `packages/coding-agent/src/tools/report-issue.ts`
- Model-facing prompt: `packages/coding-agent/src/prompts/tools/report-issue.md`
- Database path: `getToolIssuesDbPath()` in `packages/utils/src/dirs.ts` (`~/.gjc/tool-issues.db`, or the XDG data dir)

## Availability
- Off by default. Enable with the `reportIssue.enabled` setting (`tools` tab).
- When enabled it is an essential tool, so the model sees it without tool discovery.

## Inputs

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `tool` | `string` | Yes | Name of the tool that misbehaved. |
| `report` | `string` | Yes | What was called, what was expected, what happened. |

## Outputs
- `content[0].text` is `Recorded. Continue the task.`, or `Report could not be stored locally; continue the task.` when the database write fails.
- `details` is `{ recorded: boolean, tool: string }`.

## Storage
Table `tool_issues`:

| Column | Description |
| --- | --- |
| `id` | Autoincrement key. |
| `created_at` | UTC ISO-8601 timestamp with milliseconds. |
| `tool` | Trimmed tool name, capped at 128 UTF-8 bytes. |
| `report` | Trimmed report, capped at 4000 characters (`…` marks truncation). |
| `model` | Active model string, or `NULL`. |
| `gjc_version` | GJC version that recorded the report. |
| `session_id` | Session id, or `NULL`. |

The file is created with mode `0600` inside a `0700` directory. The WAL and SHM sidecars are also protected with mode `0600`. Nothing is uploaded; reports leave the machine only if you share the file.

## Reading reports
Use the read tool or CLI SQLite support. The database path is determined by `getToolIssuesDbPath()`, which checks in order:

1. On Linux or macOS: if `$XDG_DATA_HOME/gjc` exists, use `$XDG_DATA_HOME/gjc/tool-issues.db`
2. Otherwise: use `~/.gjc/tool-issues.db`

Windows always uses `~/.gjc/tool-issues.db` (no XDG support).

If unsure which path your installation uses, run:

```sh
gjc read ~/.gjc/tool-issues.db:tool_issues?order=created_at:desc&limit=5
```

Example commands:

```sh
# Query by most recent reports
gjc read '~/.gjc/tool-issues.db:tool_issues?order=created_at:desc&limit=50'

# Count issues by tool
gjc read '~/.gjc/tool-issues.db?q=SELECT tool, count(*) AS n FROM tool_issues GROUP BY tool ORDER BY n DESC'

# If using XDG (when $XDG_DATA_HOME/gjc exists)
gjc read "$XDG_DATA_HOME/gjc/tool-issues.db:tool_issues?order=created_at:desc&limit=50"
```

Delete the file to clear all reports.

## Errors
- Blank `tool` or `report` after trimming is a tool error and nothing is written.
- Database open/write failures are logged and reported as `recorded: false`; they never fail the agent turn.

## Notes
- Ported from oh-my-pi's `xd://report_issue` auto-QA device, without its collector push and consent prompt.
