import { describe, expect, it } from "bun:test";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { sessionMatchesConfinement } from "../src/session/session-confinement";
import { SessionManager } from "../src/session/session-manager";

describe("--confine session selection", () => {
	it("keeps a confined transcript out of an ordinary resume match", () => {
		expect(sessionMatchesConfinement({ filesystemScope: "cwd" }, true)).toBe(true);
		expect(sessionMatchesConfinement({ filesystemScope: "cwd" }, false)).toBe(false);
		expect(sessionMatchesConfinement({}, false)).toBe(true);
		expect(sessionMatchesConfinement({}, true)).toBe(false);
	});
	it("does not leave an ordinary transcript when a confined resume path is missing", async () => {
		const dir = await fs.mkdtemp(path.join(os.tmpdir(), "confine-missing-"));
		const missing = path.join(dir, "missing.jsonl");
		try {
			await expect(
				SessionManager.open(
					missing,
					SessionManager.explicitDestination(dir),
					undefined,
					"copy-retain",
					"enabled",
					true,
				),
			).rejects.toThrow(/missing path/);
			await expect(fs.stat(missing)).rejects.toMatchObject({ code: "ENOENT" });
		} finally {
			await fs.rm(dir, { recursive: true, force: true });
		}
	});
	it("keeps confinement when a confined transcript is resumed by id", async () => {
		const dir = await fs.mkdtemp(path.join(os.tmpdir(), "confine-resume-id-"));
		const created = SessionManager.create(dir, SessionManager.explicitDestination(dir), undefined, true);
		await created.ensureOnDisk();
		const sessionPath = created.getSessionFile();
		const sessionId = created.getSessionId();
		await created.close();
		if (!sessionPath || !sessionId) throw new Error("confined session was not persisted");
		try {
			const resumed = await SessionManager.open(
				sessionPath,
				SessionManager.explicitDestination(dir),
				undefined,
				"copy-retain",
				"shadow",
				true,
			);
			expect(resumed.isFilesystemConfined()).toBe(true);
			expect(resumed.getSessionId()).toBe(sessionId);
			await resumed.close();
		} finally {
			await fs.rm(dir, { recursive: true, force: true });
		}
	});
});
