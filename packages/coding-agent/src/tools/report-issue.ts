/**
 * `report_issue` — local auto-QA for tool behavior.
 *
 * The model records a tool whose output contradicts that tool's own
 * description. Reports are appended to a local SQLite database
 * (`~/.gjc/tool-issues.db`); nothing leaves the machine. Inspect them with the
 * read tool's SQLite support, e.g.
 * `gjc read '~/.gjc/tool-issues.db?q=SELECT tool, count(*) FROM tool_issues GROUP BY tool'`.
 *
 * Inspired by oh-my-pi's `xd://report_issue` auto-QA device; collector push
 * and consent prompts are intentionally not part of this local-only port.
 */
import { Database } from "bun:sqlite";
import * as fs from "node:fs";
import * as path from "node:path";
import type { AgentTool, AgentToolResult } from "@gajae-code/agent-core";
import { getToolIssuesDbPath, logger, prompt, VERSION } from "@gajae-code/utils";
import * as z from "zod/v4";
import reportIssueDescription from "../prompts/tools/report-issue.md" with { type: "text" };
import type { ToolSession } from "./index";
import { ToolError } from "./tool-errors";

/** Upper bound on the stored tool name, in UTF-8 bytes. */
const MAX_TOOL_BYTES = 128;
/** Upper bound on the stored report body, in characters. */
const MAX_REPORT_CHARS = 4_000;

const reportIssueSchema = z.object({
	tool: z.string().describe("name of the tool that misbehaved"),
	report: z.string().describe("what was called, what was expected, what happened"),
});

export type ReportIssueToolInput = z.infer<typeof reportIssueSchema>;

export interface ReportIssueToolDetails {
	recorded: boolean;
	tool: string;
}

export interface ToolIssueEntry {
	tool: string;
	report: string;
	model: string | null;
	sessionId: string | null;
}

const dbHandles = new Map<string, Database>();

function openToolIssueDb(dbPath: string): Database {
	const existing = dbHandles.get(dbPath);
	if (existing) return existing;
	const dir = path.dirname(dbPath);
	fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
	// Enforce private permissions on existing parent directory
	if (process.platform !== "win32") {
		fs.chmodSync(dir, 0o700);
	}
	const db = new Database(dbPath);
	try {
		db.run(`
			PRAGMA busy_timeout=5000;
			PRAGMA journal_mode=WAL;
			CREATE TABLE IF NOT EXISTS tool_issues (
				id          INTEGER PRIMARY KEY AUTOINCREMENT,
				created_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
				tool        TEXT    NOT NULL,
				report      TEXT    NOT NULL,
				model       TEXT,
				gjc_version TEXT    NOT NULL,
				session_id  TEXT
			);
			CREATE INDEX IF NOT EXISTS idx_tool_issues_tool_created ON tool_issues(tool, created_at);
		`);
		// Protect the main database file and sidecars with private permissions
		if (process.platform !== "win32") {
			fs.chmodSync(dbPath, 0o600);
			// SQLite creates WAL and SHM sidecars; protect them too
			const walPath = `${dbPath}-wal`;
			const shmPath = `${dbPath}-shm`;
			if (fs.existsSync(walPath)) fs.chmodSync(walPath, 0o600);
			if (fs.existsSync(shmPath)) fs.chmodSync(shmPath, 0o600);
		} else {
			// On Windows, use the basic chmod for the main file
			fs.chmodSync(dbPath, 0o600);
		}
	} catch (error) {
		db.close();
		throw error;
	}
	dbHandles.set(dbPath, db);
	return db;
}

/** Close cached handles so tests can remove their temporary databases. */
export function closeToolIssueDbs(): void {
	for (const db of dbHandles.values()) db.close();
	dbHandles.clear();
}

function truncateUtf8(text: string, maxBytes: number): string {
	const bytes = Buffer.from(text, "utf8");
	if (bytes.length <= maxBytes) return text;
	// Decoding a cut multi-byte sequence yields U+FFFD; drop it.
	return bytes
		.subarray(0, maxBytes)
		.toString("utf8")
		.replace(/\uFFFD+$/u, "");
}

/**
 * Truncate text by complete Unicode code points, avoiding incomplete surrogate pairs.
 * JavaScript strings use UTF-16 encoding, where astral characters use two code units
 * (high surrogate + low surrogate). Slicing at an arbitrary position can split a pair.
 */
function truncateByCodePoint(text: string, maxChars: number): string {
	if (text.length <= maxChars) return text;
	let result = text.slice(0, maxChars);
	// Check if we cut in the middle of a surrogate pair:
	// If the last character is a high surrogate (U+D800-U+DBFF),
	// it needs its low surrogate pair which we've discarded.
	const lastCode = result.charCodeAt(result.length - 1);
	if (lastCode >= 0xd800 && lastCode <= 0xdbff) {
		// Remove the orphaned high surrogate
		result = result.slice(0, -1);
	}
	return result;
}

/** Normalize and clamp a report to the stored field limits. */
export function normalizeToolIssue(tool: string, report: string): { tool: string; report: string } {
	const normalizedTool = truncateUtf8(tool.trim(), MAX_TOOL_BYTES);
	const trimmedReport = report.trim();
	const normalizedReport =
		trimmedReport.length > MAX_REPORT_CHARS
			? `${truncateByCodePoint(trimmedReport, MAX_REPORT_CHARS - 1)}…`
			: trimmedReport;
	return { tool: normalizedTool, report: normalizedReport };
}

/** Append one report to the tool-issue database at `dbPath`. */
export function recordToolIssue(dbPath: string, entry: ToolIssueEntry): void {
	openToolIssueDb(dbPath)
		.prepare("INSERT INTO tool_issues (tool, report, model, gjc_version, session_id) VALUES (?, ?, ?, ?, ?)")
		.run(entry.tool, entry.report, entry.model, VERSION, entry.sessionId);
}

export class ReportIssueTool implements AgentTool<typeof reportIssueSchema, ReportIssueToolDetails> {
	readonly name = "report_issue";
	readonly label = "Report Issue";
	readonly loadMode = "essential" as const;
	readonly description = prompt.render(reportIssueDescription);
	readonly parameters = reportIssueSchema;
	readonly strict = true;
	readonly intent = "omit" as const;
	readonly #session: ToolSession;
	readonly #dbPath: string;

	constructor(session: ToolSession, dbPath: string = getToolIssuesDbPath()) {
		this.#session = session;
		this.#dbPath = dbPath;
	}

	async execute(_toolCallId: string, params: ReportIssueToolInput): Promise<AgentToolResult<ReportIssueToolDetails>> {
		const { tool, report } = normalizeToolIssue(params.tool, params.report);
		if (!tool) throw new ToolError("tool must name the tool that misbehaved.");
		if (!report) throw new ToolError("report must describe the unexpected behavior.");
		try {
			recordToolIssue(this.#dbPath, {
				tool,
				report,
				model: this.#session.getActiveModelString?.() ?? null,
				sessionId: this.#session.getSessionId?.() ?? null,
			});
		} catch (error) {
			logger.warn("report_issue: failed to record tool issue", { error: String(error), dbPath: this.#dbPath });
			return {
				content: [{ type: "text", text: "Report could not be stored locally; continue the task." }],
				details: { recorded: false, tool },
			};
		}
		return {
			content: [{ type: "text", text: "Recorded. Continue the task." }],
			details: { recorded: true, tool },
		};
	}
}
