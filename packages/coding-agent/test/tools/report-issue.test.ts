import { Database } from "bun:sqlite";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { VERSION } from "@gajae-code/utils";
import { BUILTIN_TOOL_DESCRIPTORS, type ToolSession } from "../../src/tools";
import { closeToolIssueDbs, normalizeToolIssue, ReportIssueTool } from "../../src/tools/report-issue";
import { TOOL_CATALOG } from "../../src/tools/tool-catalog.generated";
import { ToolError } from "../../src/tools/tool-errors";

interface StoredIssue {
	tool: string;
	report: string;
	model: string | null;
	gjc_version: string;
	session_id: string | null;
	created_at: string;
}

function makeSession(settings: Record<string, unknown> = {}, extra: Partial<ToolSession> = {}): ToolSession {
	return {
		cwd: process.cwd(),
		hasUI: false,
		settings: { get: (key: string) => settings[key], has: (key: string) => Object.hasOwn(settings, key) },
		getSessionFile: () => null,
		getSessionSpawns: () => null,
		...extra,
	} as unknown as ToolSession;
}

function readIssues(dbPath: string): StoredIssue[] {
	const db = new Database(dbPath, { readonly: true });
	try {
		return db
			.prepare("SELECT tool, report, model, gjc_version, session_id, created_at FROM tool_issues ORDER BY id")
			.all() as StoredIssue[];
	} finally {
		db.close();
	}
}

describe("report_issue tool", () => {
	let root: string;
	let dbPath: string;

	beforeEach(async () => {
		root = await fs.mkdtemp(path.join(os.tmpdir(), "gjc-report-issue-"));
		dbPath = path.join(root, "nested", "tool-issues.db");
	});

	afterEach(async () => {
		closeToolIssueDbs();
		await fs.rm(root, { recursive: true, force: true });
	});

	test("appends a report with model, session, and version to the local database", async () => {
		closeToolIssueDbs();
		const tool = new ReportIssueTool(
			makeSession({}, { getActiveModelString: () => "openai/gpt-5.5", getSessionId: () => "session-1" }),
			dbPath,
		);

		const first = await tool.execute("call-1", {
			tool: " search ",
			report: " paths filter ignored; matched files outside src ",
		});
		await tool.execute("call-2", { tool: "read", report: "range selector returned the whole file" });

		expect(first.details).toEqual({ recorded: true, tool: "search" });
		expect(first.content).toEqual([{ type: "text", text: "Recorded. Continue the task." }]);
		const rows = readIssues(dbPath);
		expect(rows.map(row => [row.tool, row.report])).toEqual([
			["search", "paths filter ignored; matched files outside src"],
			["read", "range selector returned the whole file"],
		]);
		expect(rows[0]).toMatchObject({ model: "openai/gpt-5.5", gjc_version: VERSION, session_id: "session-1" });
		expect(rows[0].created_at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
		if (process.platform !== "win32") expect((await fs.stat(dbPath)).mode & 0o777).toBe(0o600);
	});

	test("stores null model and session when the session exposes neither", async () => {
		closeToolIssueDbs();
		await new ReportIssueTool(makeSession(), dbPath).execute("call", { tool: "bash", report: "exit code lost" });

		expect(readIssues(dbPath)[0]).toMatchObject({ model: null, session_id: null });
	});

	test("rejects blank tool names and reports without writing", async () => {
		closeToolIssueDbs();
		const tool = new ReportIssueTool(makeSession(), dbPath);

		await expect(tool.execute("call", { tool: "  ", report: "x" })).rejects.toBeInstanceOf(ToolError);
		await expect(tool.execute("call", { tool: "read", report: "\n\t" })).rejects.toBeInstanceOf(ToolError);
		expect(await Bun.file(dbPath).exists()).toBe(false);
	});

	test("reports a storage failure to the model instead of throwing", async () => {
		closeToolIssueDbs();
		const blocker = path.join(root, "blocker");
		await Bun.write(blocker, "not a directory");

		const result = await new ReportIssueTool(makeSession(), path.join(blocker, "tool-issues.db")).execute("call", {
			tool: "write",
			report: "content dropped",
		});

		expect(result.details).toEqual({ recorded: false, tool: "write" });
		expect(result.content).toEqual([
			{ type: "text", text: "Report could not be stored locally; continue the task." },
		]);
	});

	test("closes database handle and protects sidecars with private permissions", async () => {
		if (process.platform === "win32") return; // Skip on Windows

		// Close any cached handles before test
		closeToolIssueDbs();

		const newDbPath = path.join(root, "sidecars", "tool-issues.db");
		const tool = new ReportIssueTool(makeSession(), newDbPath);

		// Perform an operation that creates the database and sidecars
		const result = await tool.execute("call-1", { tool: "test", report: "test report" });
		expect(result.details).toEqual({ recorded: true, tool: "test" });

		// Verify the database file has 0o600 permissions
		const dbStat = await fs.stat(newDbPath);
		expect(dbStat.mode & 0o777).toBe(0o600);

		// Verify WAL sidecar exists and has 0o600 permissions
		const walPath = `${newDbPath}-wal`;
		const walStat = await fs.stat(walPath);
		expect(walStat.mode & 0o777).toBe(0o600);

		// Verify SHM sidecar exists and has 0o600 permissions
		const shmPath = `${newDbPath}-shm`;
		const shmStat = await fs.stat(shmPath);
		expect(shmStat.mode & 0o777).toBe(0o600);

		// Verify that closeToolIssueDbs can be called without crashing
		// This ensures handles were properly managed
		expect(() => closeToolIssueDbs()).not.toThrow();
	});
});

describe("normalizeToolIssue", () => {
	test("clamps the tool name to 128 UTF-8 bytes without splitting a code point", () => {
		const { tool } = normalizeToolIssue(`${"a".repeat(127)}가나`, "r");

		expect(tool).toBe("a".repeat(127));
		expect(Buffer.byteLength(tool, "utf8")).toBeLessThanOrEqual(128);
	});

	test("caps the report at 4000 characters with an ellipsis", () => {
		const { report } = normalizeToolIssue("read", "x".repeat(5000));

		expect(report).toHaveLength(4000);
		expect(report.endsWith("…")).toBe(true);
		expect(normalizeToolIssue("read", "y".repeat(4000)).report).toBe("y".repeat(4000));
	});

	test("avoids splitting surrogate pairs when truncating at 4000 characters", () => {
		// Create a report that places an astral character (emoji) across the boundary.
		// The emoji 😀 (U+1F600) uses two UTF-16 code units (a surrogate pair: U+D83D U+DE00).
		// Position it so that with naïve truncation it would split the pair.
		// Total: 3998 'a's + emoji (2 code units) = 4000 code units at the boundary
		const report = "a".repeat(3998) + "😀";
		expect(report.length).toBe(4000);

		const { report: normalized } = normalizeToolIssue("read", report);

		// The truncated report should not have an orphaned high surrogate
		// Valid code point check: can be encoded/decoded without corruption
		const encoded = Buffer.from(normalized, "utf8");
		const decoded = encoded.toString("utf8");
		expect(decoded).toBe(normalized);

		// The last character should not be a high surrogate code unit on its own
		const lastCode = normalized.charCodeAt(normalized.length - 1);
		// High surrogates are in range 0xD800-0xDBFF; they should not be present alone
		if (normalized.length > 0 && !normalized.endsWith("…")) {
			expect(lastCode < 0xd800 || lastCode > 0xdbff).toBe(true);
		}
	});

	test("truncates at 4000 code points, not UTF-16 code units", () => {
		// A report with 4500 emojis: each emoji is 1 code point but 2 UTF-16 code units.
		// Total: 4500 * 2 = 9000 UTF-16 code units
		// Should truncate to 3999 emojis + ellipsis (still 4000 code points total)
		const manyEmojis = "👍".repeat(4500);
		const { report: normalized } = normalizeToolIssue("read", manyEmojis);

		// Count code points in the result
		let codePointCount = 0;
		for (const _ of normalized) {
			codePointCount++;
		}

		// Should be 3999 emojis + 1 ellipsis = 4000 code points
		expect(codePointCount).toBe(4000);
		expect(normalized.endsWith("…")).toBe(true);
		// Ensure no splitting of emoji surrogate pairs
		const encoded = Buffer.from(normalized, "utf8");
		const decoded = encoded.toString("utf8");
		expect(decoded).toBe(normalized);
	});

	test("respects 0700 directory and 0600 database permissions on creation", async () => {
		if (process.platform === "win32") return; // Skip on Windows

		closeToolIssueDbs();
		const testDir = await fs.mkdtemp(path.join(os.tmpdir(), "gjc-perms-test-"));
		try {
			const newDbPath = path.join(testDir, "deep", "nested", "tool-issues.db");
			const tool = new ReportIssueTool(makeSession(), newDbPath);

			// Execute a report to trigger database creation
			await tool.execute("call-1", { tool: "test", report: "test report" });

			// Verify directory permissions are 0700
			const dirPath = path.dirname(newDbPath);
			const dirStat = await fs.stat(dirPath);
			expect(dirStat.mode & 0o777).toBe(0o700);

			// Verify database file permissions are 0600
			const dbStat = await fs.stat(newDbPath);
			expect(dbStat.mode & 0o777).toBe(0o600);
		} finally {
			closeToolIssueDbs();
			await fs.rm(testDir, { recursive: true, force: true });
		}
	});
});

describe("report_issue availability", () => {
	test("is offered only when reportIssue.enabled is set", () => {
		const descriptor = BUILTIN_TOOL_DESCRIPTORS.report_issue;

		expect(descriptor.isAvailable(makeSession({ "reportIssue.enabled": true }))).toBe(true);
		expect(descriptor.isAvailable(makeSession({ "reportIssue.enabled": false }))).toBe(false);
		expect(descriptor.isAvailable(makeSession())).toBe(false);
	});

	test("is generated as an essential tool", () => {
		expect(TOOL_CATALOG.report_issue?.loadMode).toBe("essential");
		expect(BUILTIN_TOOL_DESCRIPTORS.report_issue.metadata.loadMode).toBe("essential");
	});
});
