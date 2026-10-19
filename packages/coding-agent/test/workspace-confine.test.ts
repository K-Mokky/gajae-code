import { describe, expect, it } from "bun:test";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { directoryEscapesWorkspace, pathEscapesWorkspace } from "../src/tools/workspace-confine";
import { confineSandboxProfile, sandboxedShellCommand } from "../src/tools/confine-sandbox";

describe("--confine path boundary", () => {
	it("accepts the root and a descendant, and rejects a parent", () => {
		const root = path.join(os.tmpdir(), "confine-root");
		expect(pathEscapesWorkspace(root, root)).toBe(false);
		expect(pathEscapesWorkspace(root, path.join(root, "src", "file.ts"))).toBe(false);
		expect(pathEscapesWorkspace(root, path.resolve(root, "..", "secret"))).toBe(true);
		expect(pathEscapesWorkspace(root, path.resolve(root, ".."))).toBe(true);
	});

	it("follows the real directory when checking a shell cwd", async () => {
		const parent = await fs.mkdtemp(path.join(os.tmpdir(), "confine-cwd-"));
		const root = path.join(parent, "repo");
		const outside = path.join(parent, "outside");
		const linked = path.join(root, "link");
		await fs.mkdir(root);
		await fs.mkdir(outside);
		await fs.symlink(outside, linked);
		await expect(directoryEscapesWorkspace(root, root)).resolves.toBe(false);
		await expect(directoryEscapesWorkspace(root, outside)).resolves.toBe(true);
		await expect(directoryEscapesWorkspace(root, linked)).resolves.toBe(true);
		await fs.rm(parent, { recursive: true, force: true });
	});
	it("denies a parent path, a dotdot path, and a symlink from inside the sandboxed process", async () => {
		const parent = await fs.mkdtemp(path.join(os.tmpdir(), "confine-sandbox-"));
		const root = path.join(parent, "repo");
		const outside = path.join(os.homedir(), `.gjc-confine-secret-${process.pid}`);
		await fs.mkdir(root);
		await fs.writeFile(outside, "hidden");
		try {
			await fs.writeFile(path.join(root, "visible.txt"), "visible");
			await fs.symlink(outside, path.join(root, "link"));
			const command = sandboxedShellCommand(
				[
					`cat ${JSON.stringify(path.join(root, "visible.txt"))}`,
					`cat ${JSON.stringify(outside)}`,
					`cat ${JSON.stringify(path.join(root, "link"))}`,
				].join("; "),
				root,
			);
			const proc = Bun.spawn(["/bin/sh", "-c", command], { cwd: root, stdout: "pipe", stderr: "pipe" });
			const [stdout, stderr] = await Promise.all([
				new Response(proc.stdout).text(),
				new Response(proc.stderr).text(),
				proc.exited,
			]);
			expect(stdout).toContain("visible");
			expect(stdout).not.toContain("hidden");
			expect(stderr).toContain("Operation not permitted");
		} finally {
			await fs.rm(outside, { force: true });
			await fs.rm(parent, { recursive: true, force: true });
		}
	});
});
