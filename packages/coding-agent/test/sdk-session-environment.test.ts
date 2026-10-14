import { expect, test } from "bun:test";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { SessionIndex } from "../src/sdk/broker/session-index";
import {
	applySessionLaunchEnvironment,
	isValidSessionLaunchEnvironment,
	type SessionLaunchEnvironment,
	sessionEnvironmentNames,
} from "../src/sdk/session-environment";

test("session launch environment overlays a child environment without mutating its broker parent", () => {
	const parent = { PATH: "/usr/bin:/bin", GH_TOKEN: "broker-secret" };
	const child: Record<string, string> = { ...parent };
	const environment: SessionLaunchEnvironment = {
		env: { PATH: "/guarded/bin:/usr/bin:/bin" },
		unsetEnv: ["GH_TOKEN"],
	};

	expect(isValidSessionLaunchEnvironment(environment.env, environment.unsetEnv)).toBe(true);
	applySessionLaunchEnvironment(child, environment);

	expect(parent).toEqual({ PATH: "/usr/bin:/bin", GH_TOKEN: "broker-secret" });
	expect(child).toEqual({ PATH: "/guarded/bin:/usr/bin:/bin" });
	expect(sessionEnvironmentNames(environment)).toEqual({ set: ["PATH"], unset: ["GH_TOKEN"] });
	expect(JSON.stringify(sessionEnvironmentNames(environment))).not.toContain("broker-secret");

	const specialNameEnv = Object.fromEntries([["__proto__", "literal-value"]]) as Record<string, string>;
	const specialNameChild: Record<string, string> = {};
	expect(isValidSessionLaunchEnvironment(specialNameEnv, undefined)).toBe(true);
	applySessionLaunchEnvironment(specialNameChild, { env: specialNameEnv });
	expect(Object.hasOwn(specialNameChild, "__proto__")).toBe(true);
	expect(Object.getOwnPropertyDescriptor(specialNameChild, "__proto__")?.value).toBe("literal-value");
});

test("session launch environment rejects invalid, conflicting, and host-control variables", () => {
	expect(isValidSessionLaunchEnvironment({ PATH: "/safe", GH_TOKEN: "secret" }, ["GH_TOKEN"])).toBe(false);
	expect(isValidSessionLaunchEnvironment({ PATH: 7 }, undefined)).toBe(false);
	expect(isValidSessionLaunchEnvironment({ "bad=name": "value" }, undefined)).toBe(false);
	expect(isValidSessionLaunchEnvironment({ GJC_STATE_ROOT: "/outside" }, undefined)).toBe(false);
	expect(isValidSessionLaunchEnvironment(undefined, ["PI_SESSION_FILE"])).toBe(false);
	expect(isValidSessionLaunchEnvironment({ FOO: "bad\0value" }, undefined)).toBe(false);
});

test("session launch environment survives session-index rotation and is absent from public rows", async () => {
	const agentDir = await fs.mkdtemp(path.join(process.env.TMPDIR ?? "/tmp", "gjc-session-environment-index-"));
	const cwd = path.join(agentDir, "workspace");
	const stateRoot = path.join(cwd, ".gjc", "state");
	const locator = { cwd, worktreeRoot: null, stateRoot };
	try {
		const index = await new SessionIndex(agentDir).open();
		await index.append({
			type: "host_registered",
			sessionId: "environment-resume",
			locator,
			endpointGeneration: 1,
			pid: process.pid,
			sessionEnvironment: { env: { SESSION_SECRET: "stored-secret", PATH: "/guarded/bin" }, unsetEnv: ["GH_TOKEN"] },
		});
		await index.append({
			type: "host_unregistered",
			sessionId: "environment-resume",
			locator,
			endpointGeneration: 1,
			pid: process.pid,
		});

		expect(JSON.stringify(index.listSessions())).not.toContain("stored-secret");
		await index.snapshot();

		const reopened = await new SessionIndex(agentDir).open();
		expect(reopened.findSessionLaunchEnvironment("environment-resume", stateRoot)).toEqual({
			env: { SESSION_SECRET: "stored-secret", PATH: "/guarded/bin" },
			unsetEnv: ["GH_TOKEN"],
		});
	} finally {
		await fs.rm(agentDir, { recursive: true, force: true });
	}
});
