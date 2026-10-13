import { afterEach, describe, expect, it } from "bun:test";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { AuthStorage } from "@gajae-code/ai/core";
import { visibleWidth } from "@gajae-code/tui";
import { getAgentDir, setAgentDir } from "@gajae-code/utils";
import { YAML } from "bun";
import { ModelRegistry } from "../src/config/model-registry";
import { BUILTIN_SLASH_COMMANDS_INTERNAL, executeBuiltinSlashCommand } from "../src/slash-commands/builtin-registry";
import type { SlashCommandRuntime, TuiSlashCommandRuntime } from "../src/slash-commands/types";

let tempAgentDir: string | undefined;
const authStorages: AuthStorage[] = [];
const modelRegistries: ModelRegistry[] = [];
const originalAgentDir = getAgentDir();
const TEST_PROVIDER_KEY_ENV = "GJC_PROVIDER_SLASH_TEST_KEY";

afterEach(async () => {
	setAgentDir(originalAgentDir);
	for (const registry of modelRegistries.splice(0)) await registry.dispose();
	for (const storage of authStorages.splice(0)) storage.close();
	if (tempAgentDir) {
		await fs.rm(tempAgentDir, { recursive: true, force: true });
		tempAgentDir = undefined;
	}
});

describe("provider slash command", () => {
	it("is advertised as a thin provider onboarding entrypoint", () => {
		const command = BUILTIN_SLASH_COMMANDS_INTERNAL.find(entry => entry.name === "provider");
		expect(command?.description).toContain("providers");
		expect(command?.allowArgs).toBe(true);
	});

	it("points generic provider login users to /login provider selection", async () => {
		const outputs: string[] = [];
		const command = BUILTIN_SLASH_COMMANDS_INTERNAL.find(entry => entry.name === "provider");

		await command?.handle?.({ name: "provider", args: "login", text: "/provider login" }, {
			output: (text: string) => outputs.push(text),
		} as unknown as SlashCommandRuntime);

		const output = outputs.join("\n");
		expect(output).toContain("/login [provider-id]");
		expect(output).toMatch(/OAuth|account/);
	});

	it("points provider-specific login users to the matching /login command", async () => {
		const outputs: string[] = [];
		const command = BUILTIN_SLASH_COMMANDS_INTERNAL.find(entry => entry.name === "provider");

		await command?.handle?.({ name: "provider", args: "login kagi", text: "/provider login kagi" }, {
			output: (text: string) => outputs.push(text),
		} as unknown as SlashCommandRuntime);

		const output = outputs.join("\n");
		expect(output).toContain("/login kagi");
		expect(output).toMatch(/OAuth|account/);
	});

	it("reports OAuth as active and an API-key environment variable as shadowed without exposing secrets", async () => {
		tempAgentDir = await fs.mkdtemp(path.join(os.tmpdir(), "gjc-provider-slash-"));
		setAgentDir(tempAgentDir);
		const originalApiKey = Bun.env.ANTHROPIC_API_KEY;
		Bun.env.ANTHROPIC_API_KEY = "anthropic-secret-test-value";
		try {
			const authStorage = await AuthStorage.create(path.join(tempAgentDir, "auth.db"));
			authStorages.push(authStorage);
			await authStorage.set("anthropic", {
				type: "oauth",
				access: "oauth-secret-test-value",
				refresh: "oauth-refresh-secret-test-value",
				expires: Date.now() + 60 * 60_000,
				accountId: "account-123",
			});
			const registry = new ModelRegistry(authStorage, path.join(tempAgentDir, "models.yml"));
			modelRegistries.push(registry);
			const outputs: string[] = [];
			const command = BUILTIN_SLASH_COMMANDS_INTERNAL.find(entry => entry.name === "provider");

			await command?.handle?.({ name: "provider", args: "status", text: "/provider status" }, {
				session: { modelRegistry: registry, credentialSessionId: "status-session" },
				output: (text: string) => outputs.push(text),
			} as unknown as SlashCommandRuntime);

			const output = outputs.join("\n");
			expect(output).toContain("anthropic: OAuth (account account-123)");
			expect(output).toContain("shadowed: API key (env ANTHROPIC_API_KEY)");
			expect(output).not.toContain("anthropic-secret-test-value");
			expect(output).not.toContain("oauth-secret-test-value");
		} finally {
			if (originalApiKey === undefined) delete Bun.env.ANTHROPIC_API_KEY;
			else Bun.env.ANTHROPIC_API_KEY = originalApiKey;
		}
	});

	it("reports OAuth-only and environment-key-only providers", async () => {
		tempAgentDir = await fs.mkdtemp(path.join(os.tmpdir(), "gjc-provider-slash-"));
		setAgentDir(tempAgentDir);
		const originalAnthropicKey = Bun.env.ANTHROPIC_API_KEY;
		const originalOpenAiKey = Bun.env.OPENAI_API_KEY;
		const originalAwsBearerToken = Bun.env.AWS_BEARER_TOKEN_BEDROCK;
		const originalAwsAccessKey = Bun.env.AWS_ACCESS_KEY_ID;
		const originalAwsSecretKey = Bun.env.AWS_SECRET_ACCESS_KEY;
		delete Bun.env.ANTHROPIC_API_KEY;
		Bun.env.OPENAI_API_KEY = "openai-secret-test-value";
		delete Bun.env.AWS_BEARER_TOKEN_BEDROCK;
		Bun.env.AWS_ACCESS_KEY_ID = "aws-access-key-test";
		Bun.env.AWS_SECRET_ACCESS_KEY = "aws-secret-key-test";
		try {
			const authStorage = await AuthStorage.create(path.join(tempAgentDir, "auth.db"));
			authStorages.push(authStorage);
			await authStorage.set("anthropic", {
				type: "oauth",
				access: "oauth-secret-test-value",
				refresh: "oauth-refresh-secret-test-value",
				expires: Date.now() + 60 * 60_000,
				accountId: "account-oauth-only",
			});
			const registry = new ModelRegistry(authStorage, path.join(tempAgentDir, "models.yml"));
			modelRegistries.push(registry);
			const outputs: string[] = [];
			const command = BUILTIN_SLASH_COMMANDS_INTERNAL.find(entry => entry.name === "provider");

			await command?.handle?.({ name: "provider", args: "status", text: "/provider status" }, {
				session: { modelRegistry: registry, credentialSessionId: "status-session" },
				output: (text: string) => outputs.push(text),
			} as unknown as SlashCommandRuntime);

			const output = outputs.join("\n");
			expect(output).toContain("anthropic: OAuth (account account-oauth-only)");
			expect(output).toContain("openai: API key (env OPENAI_API_KEY)");
			expect(output).toContain("amazon-bedrock: AWS environment credentials");
			expect(output).not.toMatch(/anthropic:\s+[^\n]*\n\s+shadowed:/);
			expect(output).not.toContain("openai-secret-test-value");
			expect(output).not.toContain("aws-access-key-test");
			expect(output).not.toContain("aws-secret-key-test");
			expect(output).not.toContain("oauth-secret-test-value");
		} finally {
			if (originalAnthropicKey === undefined) delete Bun.env.ANTHROPIC_API_KEY;
			else Bun.env.ANTHROPIC_API_KEY = originalAnthropicKey;
			if (originalOpenAiKey === undefined) delete Bun.env.OPENAI_API_KEY;
			else Bun.env.OPENAI_API_KEY = originalOpenAiKey;
			if (originalAwsBearerToken === undefined) delete Bun.env.AWS_BEARER_TOKEN_BEDROCK;
			else Bun.env.AWS_BEARER_TOKEN_BEDROCK = originalAwsBearerToken;
			if (originalAwsAccessKey === undefined) delete Bun.env.AWS_ACCESS_KEY_ID;
			else Bun.env.AWS_ACCESS_KEY_ID = originalAwsAccessKey;
			if (originalAwsSecretKey === undefined) delete Bun.env.AWS_SECRET_ACCESS_KEY;
			else Bun.env.AWS_SECRET_ACCESS_KEY = originalAwsSecretKey;
		}
	});

	it("shows credential status from the TUI provider command", async () => {
		const registry = {
			authStorage: {
				exportSnapshot: () => ({ credentials: [] }),
				hasAuth: () => false,
				hasSessionCredentialUnavailable: () => false,
				getSelectedApiKeyCredentialRowId: () => undefined,
			},
			getAll: () => [],
			getAvailable: () => [],
			getConfiguredProviderIds: () => [],
			getAuthStorageOwner: () => ({}),
		};
		const statuses: string[] = [];
		let editorText = "status";
		const command = BUILTIN_SLASH_COMMANDS_INTERNAL.find(entry => entry.name === "provider");

		await command?.handleTui?.({ name: "provider", args: "status", text: "/provider status" }, {
			ctx: {
				session: { modelRegistry: registry },
				showStatus: (text: string) => statuses.push(text),
				editor: { setText: (text: string) => (editorText = text) },
			},
			handleBackgroundCommand: () => undefined,
		} as unknown as TuiSlashCommandRuntime);

		expect(statuses).toEqual(["No configured provider credentials."]);
		expect(editorText).toBe("");
	});

	it("defers multi-account OAuth labels until dispatch selects the session row", async () => {
		tempAgentDir = await fs.mkdtemp(path.join(os.tmpdir(), "gjc-provider-slash-"));
		setAgentDir(tempAgentDir);
		const originalKagiKey = Bun.env.KAGI_API_KEY;
		delete Bun.env.KAGI_API_KEY;
		try {
			const authStorage = await AuthStorage.create(path.join(tempAgentDir, "auth.db"));
			authStorages.push(authStorage);
			await authStorage.set("kagi", [
				{
					type: "oauth",
					access: "kagi-account-one-secret",
					refresh: "kagi-account-one-refresh-secret",
					expires: Date.now() + 60 * 60_000,
					accountId: "kagi-account-one",
				},
				{
					type: "oauth",
					access: "kagi-account-two-secret",
					refresh: "kagi-account-two-refresh-secret",
					expires: Date.now() + 60 * 60_000,
					accountId: "kagi-account-two",
				},
			]);
			const registry = new ModelRegistry(authStorage, path.join(tempAgentDir, "models.yml"));
			modelRegistries.push(registry);
			const sessionId = "kagi-status-dispatch-session";
			const command = BUILTIN_SLASH_COMMANDS_INTERNAL.find(entry => entry.name === "provider");
			const status = async (): Promise<string> => {
				const outputs: string[] = [];
				await command?.handle?.({ name: "provider", args: "status", text: "/provider status" }, {
					session: { modelRegistry: registry, credentialSessionId: sessionId },
					output: (text: string) => outputs.push(text),
				} as unknown as SlashCommandRuntime);
				return outputs.join("\n");
			};

			const beforeDispatch = await status();
			expect(beforeDispatch).toContain("kagi: OAuth (account selection pending)");
			expect(beforeDispatch).not.toContain("shadowed: OAuth");
			expect(beforeDispatch).not.toContain("kagi-account-one-secret");
			expect(beforeDispatch).not.toContain("kagi-account-two-secret");
			authStorage.setRuntimeCredentialSelector("kagi", { kind: "account", value: "kagi-account-two" });
			const pinnedStatus = await status();
			expect(pinnedStatus).toContain("kagi: OAuth (account kagi-account-two)");

			await registry.getApiKeyForProvider("kagi", sessionId);
			const rowId = authStorage.getSessionCredentialRowId("kagi", sessionId);
			const selected = authStorage
				.exportSnapshot()
				.credentials.find(entry => entry.id === rowId && entry.credential.type === "oauth");
			if (selected?.credential.type !== "oauth" || !selected.credential.accountId) {
				throw new Error("expected the selected Kagi OAuth row");
			}
			const afterDispatch = await status();
			expect(afterDispatch).toContain(`kagi: OAuth (account ${selected.credential.accountId})`);
			expect(afterDispatch).not.toContain("kagi-account-one-secret");
			expect(afterDispatch).not.toContain("kagi-account-two-secret");
			authStorage.removeRuntimeCredentialSelector("kagi");
			await authStorage.markUsageLimitReached("kagi", sessionId, { retryAfterMs: 60_000, rowId });
			const blockedStatus = await status();
			expect(blockedStatus).toContain("kagi: OAuth (account selection pending)");
			expect(blockedStatus).not.toContain(`kagi: OAuth (account ${selected.credential.accountId})`);

			await authStorage.set("openai-codex", {
				type: "oauth",
				access: "codex-account-secret",
				refresh: "codex-account-refresh-secret",
				expires: Date.now() + 60 * 60_000,
				accountId: "codex-account-label",
			});
			registry.registerProvider(
				"openai-codex-device",
				{
					baseUrl: "https://chatgpt.com/backend-api",
					api: "openai-codex-responses",
					oauth: { name: "Codex Alias Test", login: async () => "unused" },
					models: [
						{
							id: "codex-alias-model",
							name: "Codex Alias Model",
							reasoning: false,
							input: ["text"],
							cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
							contextWindow: 100_000,
							maxTokens: 8_000,
						},
					],
				},
				"provider-status-alias-test",
			);
			const aliasStatus = await status();
			const codexRows = aliasStatus
				.split("\n")
				.filter(line => line.startsWith("openai-codex:") || line.startsWith("openai-codex-device:"));
			expect(codexRows).toEqual(["openai-codex: OAuth (account codex-account-label)"]);
			expect(aliasStatus).not.toContain("codex-account-secret");
		} finally {
			if (originalKagiKey === undefined) delete Bun.env.KAGI_API_KEY;
			else Bun.env.KAGI_API_KEY = originalKagiKey;
		}
	});

	it("reports the fallback after a stored command key is known unusable", async () => {
		tempAgentDir = await fs.mkdtemp(path.join(os.tmpdir(), "gjc-provider-slash-"));
		setAgentDir(tempAgentDir);
		const originalOpenAiKey = Bun.env.OPENAI_API_KEY;
		Bun.env.OPENAI_API_KEY = "openai-fallback-secret-test-value";
		try {
			const authStorage = await AuthStorage.create(path.join(tempAgentDir, "auth.db"), {
				configValueResolver: async () => undefined,
			});
			authStorages.push(authStorage);
			await authStorage.set("openai", { type: "api_key", key: "!empty-command-key-secret" });
			const registry = new ModelRegistry(authStorage, path.join(tempAgentDir, "models.yml"));
			modelRegistries.push(registry);
			const command = BUILTIN_SLASH_COMMANDS_INTERNAL.find(entry => entry.name === "provider");
			const sessionId = "unusable-command-key-session";
			const status = async (): Promise<string> => {
				const outputs: string[] = [];
				await command?.handle?.({ name: "provider", args: "status", text: "/provider status" }, {
					session: { modelRegistry: registry, credentialSessionId: sessionId },
					output: (text: string) => outputs.push(text),
				} as unknown as SlashCommandRuntime);
				return outputs.join("\n");
			};

			const beforeResolution = await status();
			expect(beforeResolution).toContain("openai: API key (stored credential; usability pending)");
			expect(beforeResolution).not.toContain("empty-command-key-secret");
			await authStorage.getApiKey("openai", sessionId);
			const afterResolution = await status();
			expect(afterResolution).toContain("openai: API key (env OPENAI_API_KEY)");
			expect(afterResolution).not.toContain("openai-fallback-secret-test-value");
			expect(afterResolution).not.toContain("empty-command-key-secret");

			const commandRow = authStorage
				.exportSnapshot()
				.credentials.find(entry => entry.provider === "openai" && entry.credential.type === "api_key");
			if (commandRow?.credential.type !== "api_key") {
				throw new Error("expected the stored command API-key row");
			}
			authStorage.setSessionCredentialSelector(sessionId, "openai", {
				kind: "id",
				value: String(commandRow.id),
			});
			expect(await authStorage.getApiKey("openai", sessionId)).toBeUndefined();
			const pinnedStatus = await status();
			expect(pinnedStatus).toContain("openai: API key (selected credential unavailable)");
			expect(pinnedStatus).not.toContain("openai: API key (env OPENAI_API_KEY)");
		} finally {
			if (originalOpenAiKey === undefined) delete Bun.env.OPENAI_API_KEY;
			else Bun.env.OPENAI_API_KEY = originalOpenAiKey;
		}
	});

	it("reports unavailable session credentials instead of fallback or omission", async () => {
		tempAgentDir = await fs.mkdtemp(path.join(os.tmpdir(), "gjc-provider-slash-"));
		setAgentDir(tempAgentDir);
		const originalOpenAiKey = Bun.env.OPENAI_API_KEY;
		Bun.env.OPENAI_API_KEY = "openai-unavailable-pin-fallback-secret";
		try {
			const authStorage = await AuthStorage.create(path.join(tempAgentDir, "auth.db"));
			authStorages.push(authStorage);
			await Bun.write(
				path.join(tempAgentDir, "models.yml"),
				YAML.stringify({
					providers: {
						"status-unavailable-empty": {
							baseUrl: "https://unavailable.example.test/v1",
							api: "openai-completions",
							auth: "none",
							models: [
								{
									id: "unavailable-model",
									name: "Unavailable Model",
									reasoning: false,
									input: ["text"],
									cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
									contextWindow: 100_000,
									maxTokens: 8_000,
								},
							],
						},
					},
				}),
			);
			const registry = new ModelRegistry(authStorage, path.join(tempAgentDir, "models.yml"));
			modelRegistries.push(registry);
			await registry.refresh("offline");
			const sessionId = "unavailable-credential-status-session";
			authStorage.markSessionCredentialUnavailable(sessionId, "openai", {
				kind: "id",
				value: "missing-openai-row",
			});
			authStorage.markSessionCredentialUnavailable(sessionId, "status-unavailable-empty", {
				kind: "id",
				value: "missing-custom-row",
			});
			const outputs: string[] = [];
			const command = BUILTIN_SLASH_COMMANDS_INTERNAL.find(entry => entry.name === "provider");
			await command?.handle?.({ name: "provider", args: "status", text: "/provider status" }, {
				session: { modelRegistry: registry, credentialSessionId: sessionId },
				output: (text: string) => outputs.push(text),
			} as unknown as SlashCommandRuntime);

			const output = outputs.join("\n");
			expect(output).toContain("openai: selected credential unavailable");
			expect(output).not.toContain("openai: API key (env OPENAI_API_KEY)");
			expect(output).toContain("status-unavailable-empty: selected credential unavailable");
			expect(output).not.toContain("openai-unavailable-pin-fallback-secret");
		} finally {
			if (originalOpenAiKey === undefined) delete Bun.env.OPENAI_API_KEY;
			else Bun.env.OPENAI_API_KEY = originalOpenAiKey;
		}
	});

	it("sanitizes and width-clips OAuth account labels by terminal columns", async () => {
		tempAgentDir = await fs.mkdtemp(path.join(os.tmpdir(), "gjc-provider-slash-"));
		setAgentDir(tempAgentDir);
		const authStorage = await AuthStorage.create(path.join(tempAgentDir, "auth.db"));
		authStorages.push(authStorage);
		await authStorage.set("status-sanitized-account", {
			type: "oauth",
			access: "sanitized-account-secret",
			refresh: "sanitized-account-refresh-secret",
			expires: Date.now() + 60 * 60_000,
			accountId: `${"a".repeat(116)}😀\t界界`,
		});
		const registry = new ModelRegistry(authStorage, path.join(tempAgentDir, "models.yml"));
		modelRegistries.push(registry);
		const outputs: string[] = [];
		const command = BUILTIN_SLASH_COMMANDS_INTERNAL.find(entry => entry.name === "provider");
		await command?.handle?.({ name: "provider", args: "status", text: "/provider status" }, {
			session: { modelRegistry: registry, credentialSessionId: "sanitized-account-session" },
			output: (text: string) => outputs.push(text),
		} as unknown as SlashCommandRuntime);

		const statusLine = outputs
			.join("\n")
			.split("\n")
			.find(line => line.startsWith("status-sanitized-account:"));
		if (!statusLine) throw new Error("expected the OAuth account status line");
		const accountLabel = statusLine.slice("status-sanitized-account: OAuth (account ".length, -1);
		expect(accountLabel).toContain("😀");
		expect(accountLabel).not.toContain("\t");
		expect(visibleWidth(accountLabel)).toBeLessThanOrEqual(120);
		expect(outputs.join("\n")).not.toContain("sanitized-account-secret");
	});

	it("reports the configured --api-key-env name instead of its value", async () => {
		tempAgentDir = await fs.mkdtemp(path.join(os.tmpdir(), "gjc-provider-slash-"));
		setAgentDir(tempAgentDir);
		const originalApiKey = Bun.env[TEST_PROVIDER_KEY_ENV];
		Bun.env[TEST_PROVIDER_KEY_ENV] = "custom-provider-secret-test-value";
		try {
			const authStorage = await AuthStorage.create(path.join(tempAgentDir, "auth.db"));
			authStorages.push(authStorage);
			const registry = new ModelRegistry(authStorage, path.join(tempAgentDir, "models.yml"));
			modelRegistries.push(registry);
			const add = BUILTIN_SLASH_COMMANDS_INTERNAL.find(entry => entry.name === "provider");
			await add?.handle?.(
				{
					name: "provider",
					args: `add --compat openai --provider status-custom --base-url https://proxy.example.test --api-key-env ${TEST_PROVIDER_KEY_ENV} --model test-model`,
					text: "/provider add",
				},
				{
					session: { modelRegistry: registry },
					sessionManager: {},
					settings: {},
					cwd: process.cwd(),
					output: () => undefined,
					refreshCommands: () => undefined,
					reloadPlugins: async () => undefined,
					notifyConfigChanged: () => undefined,
				} as unknown as SlashCommandRuntime,
			);
			await registry.refresh("offline");

			const status = async (credentialSessionId?: string): Promise<string> => {
				const outputs: string[] = [];
				await add?.handle?.({ name: "provider", args: "status", text: "/provider status" }, {
					session: { modelRegistry: registry, credentialSessionId },
					output: (text: string) => outputs.push(text),
				} as unknown as SlashCommandRuntime);
				return outputs.join("\n");
			};

			const envStatus = await status();
			expect(envStatus).toContain(`status-custom: API key (env ${TEST_PROVIDER_KEY_ENV})`);
			expect(envStatus).not.toContain("custom-provider-secret-test-value");

			const modelsConfig = YAML.parse(await Bun.file(path.join(tempAgentDir, "models.yml")).text()) as {
				providers: Record<string, unknown>;
			};
			modelsConfig.providers["status-legacy"] = {
				api: "openai-completions",
				baseUrl: "https://legacy-proxy.example.test/v1",
				apiKey: TEST_PROVIDER_KEY_ENV,
				models: [
					{
						id: "legacy-model",
						name: "Legacy Model",
						reasoning: false,
						input: ["text"],
						cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
						contextWindow: 100_000,
						maxTokens: 8_000,
					},
				],
			};
			modelsConfig.providers["openai-codex-device"] = {
				api: "openai-completions",
				baseUrl: "https://codex-alias-proxy.example.test/v1",
				apiKeyEnv: TEST_PROVIDER_KEY_ENV,
				models: [
					{
						id: "codex-alias-proxy-model",
						name: "Codex Alias Proxy Model",
						reasoning: false,
						input: ["text"],
						cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
						contextWindow: 100_000,
						maxTokens: 8_000,
					},
				],
			};
			await Bun.write(path.join(tempAgentDir, "models.yml"), YAML.stringify(modelsConfig));
			await registry.refresh("offline");
			const legacyStatus = await status();
			expect(legacyStatus).toContain(`status-legacy: API key (env ${TEST_PROVIDER_KEY_ENV})`);
			expect(legacyStatus).toContain(`openai-codex: API key (env ${TEST_PROVIDER_KEY_ENV})`);
			expect(legacyStatus).not.toContain("openai-codex-device:");
			expect(legacyStatus).not.toContain("custom-provider-secret-test-value");

			delete Bun.env[TEST_PROVIDER_KEY_ENV];
			const removedEnvStatus = await status();
			expect(removedEnvStatus).not.toContain("status-custom:");
			Bun.env[TEST_PROVIDER_KEY_ENV] = "custom-provider-secret-test-value";
			const restoredEnvStatus = await status();
			expect(restoredEnvStatus).toContain(`status-custom: API key (env ${TEST_PROVIDER_KEY_ENV})`);

			await authStorage.set("status-custom", [
				{ type: "api_key", key: "stored-custom-secret-one" },
				{ type: "api_key", key: "stored-custom-secret-two" },
			]);
			const credentialSessionId = "status-custom-dispatch-session";
			const expectedRowId = authStorage.getProspectiveApiKeyCredentialRowId("status-custom", credentialSessionId, {
				owner: registry.getAuthStorageOwner(),
			});
			if (expectedRowId === undefined) throw new Error("expected a prospective stored API key row");
			const storedStatus = await status(credentialSessionId);
			expect(storedStatus).toContain(`status-custom: API key (stored credential id:${expectedRowId})`);
			expect(storedStatus).toContain(`API key (env ${TEST_PROVIDER_KEY_ENV})`);
			expect(storedStatus).not.toContain("custom-provider-secret-test-value");
			expect(storedStatus).not.toContain("stored-custom-secret-one");
			expect(storedStatus).not.toContain("stored-custom-secret-two");
			await registry.getApiKeyForProvider("status-custom", credentialSessionId);
			expect(authStorage.getSessionCredentialRowId("status-custom", credentialSessionId)).toBe(expectedRowId);

			registry.registerProvider("status-runtime", {
				baseUrl: "https://runtime-proxy.example.test/v1",
				api: "openai-completions",
				apiKey: TEST_PROVIDER_KEY_ENV,
				models: [
					{
						id: "runtime-model",
						name: "Runtime Model",
						reasoning: false,
						input: ["text"],
						cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
						contextWindow: 100_000,
						maxTokens: 8_000,
					},
				],
			});
			const runtimeStatus = await status();
			expect(runtimeStatus).toContain(`status-runtime: API key (env ${TEST_PROVIDER_KEY_ENV})`);
			expect(runtimeStatus).not.toContain("custom-provider-secret-test-value");
			authStorage.setRuntimeApiKey("status-runtime", "cli-override-secret-test-value");
			const cliOverrideStatus = await status();
			const runtimeLineIndex = cliOverrideStatus.split("\n").findIndex(line => line.startsWith("status-runtime:"));
			const runtimeLines = cliOverrideStatus.split("\n");
			expect(runtimeLines[runtimeLineIndex]).toBe("status-runtime: API key (runtime override)");
			expect(runtimeLines[runtimeLineIndex + 1]).toContain(`shadowed: API key (env ${TEST_PROVIDER_KEY_ENV})`);
			expect(cliOverrideStatus).not.toContain("cli-override-secret-test-value");
			authStorage.removeRuntimeApiKey("status-runtime");

			await authStorage.set("status-runtime", {
				type: "oauth",
				access: "runtime-oauth-secret",
				refresh: "runtime-oauth-refresh-secret",
				expires: Date.now() + 60 * 60_000,
				accountId: "runtime-oauth-account",
			});
			delete Bun.env[TEST_PROVIDER_KEY_ENV];
			const runtimeEnvRemovedStatus = await status();
			expect(runtimeEnvRemovedStatus).toContain("status-runtime: OAuth (account runtime-oauth-account)");
			expect(runtimeEnvRemovedStatus).not.toContain(`API key (env ${TEST_PROVIDER_KEY_ENV})`);
			Bun.env[TEST_PROVIDER_KEY_ENV] = "custom-provider-secret-test-value";
			const runtimeEnvRestoredStatus = await status();
			expect(runtimeEnvRestoredStatus).toContain(`status-runtime: API key (env ${TEST_PROVIDER_KEY_ENV})`);

			await authStorage.set("status-command", { type: "api_key", key: "!empty-command-key-secret" });
			const commandKeyStatus = await status();
			expect(commandKeyStatus).toContain("status-command: API key (stored credential; usability pending)");
			expect(commandKeyStatus).not.toContain("empty-command-key-secret");
		} finally {
			if (originalApiKey === undefined) delete Bun.env[TEST_PROVIDER_KEY_ENV];
			else Bun.env[TEST_PROVIDER_KEY_ENV] = originalApiKey;
		}
	});

	it("reports the /provicer typo without falling through to model bootstrap", async () => {
		const errors: string[] = [];
		const result = await executeBuiltinSlashCommand("/provicer add --compat anthropic", {
			ctx: {
				showError: (text: string) => errors.push(text),
				editor: { setText: () => undefined },
			},
			handleBackgroundCommand: () => undefined,
		} as unknown as Parameters<typeof executeBuiltinSlashCommand>[1]);

		expect(result).toBe(true);
		expect(errors.join("\n")).toContain("Unknown slash command: /provicer");
		expect(errors.join("\n")).toContain("Did you mean /provider?");
	});

	it("adds API-compatible providers through the shared onboarding core", async () => {
		tempAgentDir = await fs.mkdtemp(path.join(os.tmpdir(), "gjc-provider-slash-"));
		setAgentDir(tempAgentDir);
		const outputs: string[] = [];
		let refreshedMode: string | undefined;
		let configChanged = false;
		const command = BUILTIN_SLASH_COMMANDS_INTERNAL.find(entry => entry.name === "provider");
		expect(command?.handle).toBeTruthy();

		await command?.handle?.(
			{
				name: "provider",
				args: `add --compat anthropic --provider local-claude --base-url https://proxy.example.test --api-key-env ${TEST_PROVIDER_KEY_ENV} --model claude-proxy`,
				text: "/provider add",
			},
			{
				session: {
					modelRegistry: {
						refresh: async (mode: string) => {
							refreshedMode = mode;
						},
					},
				},
				sessionManager: {},
				settings: {},
				cwd: process.cwd(),
				output: (text: string) => outputs.push(text),
				refreshCommands: () => undefined,
				reloadPlugins: async () => undefined,
				notifyConfigChanged: () => {
					configChanged = true;
				},
			} as unknown as SlashCommandRuntime,
		);

		const parsed = YAML.parse(await Bun.file(path.join(tempAgentDir, "models.yml")).text()) as {
			providers: Record<string, { api: string; apiKey?: string; apiKeyEnv?: string; models: Array<{ id: string }> }>;
		};
		expect(parsed.providers["local-claude"]?.api).toBe("anthropic-messages");
		expect(parsed.providers["local-claude"]?.apiKey).toBeUndefined();
		expect(parsed.providers["local-claude"]?.apiKeyEnv).toBe(TEST_PROVIDER_KEY_ENV);
		expect(parsed.providers["local-claude"]?.models.map(model => model.id)).toEqual(["claude-proxy"]);
		const output = outputs.join("\n");
		expect(output).toContain("API key: *** (environment variable)");
		expect(output).not.toContain(TEST_PROVIDER_KEY_ENV);
		expect(output).not.toContain("GJC_…_KEY");
		expect(refreshedMode).toBe("offline");
		expect(configChanged).toBe(true);
	});

	it("adds MiniMax and GLM provider presets through slash onboarding", async () => {
		tempAgentDir = await fs.mkdtemp(path.join(os.tmpdir(), "gjc-provider-slash-"));
		setAgentDir(tempAgentDir);
		const outputs: string[] = [];
		const command = BUILTIN_SLASH_COMMANDS_INTERNAL.find(entry => entry.name === "provider");
		expect(command?.handle).toBeTruthy();
		const runtime = {
			session: { modelRegistry: { refresh: async () => undefined } },
			sessionManager: {},
			settings: {},
			cwd: process.cwd(),
			output: (text: string) => outputs.push(text),
			refreshCommands: () => undefined,
			reloadPlugins: async () => undefined,
			notifyConfigChanged: () => undefined,
		} as unknown as SlashCommandRuntime;

		await command?.handle?.({ name: "provider", args: "add --preset minimax", text: "/provider add" }, runtime);
		await command?.handle?.({ name: "provider", args: "add zai", text: "/provider add" }, runtime);

		const parsed = YAML.parse(await Bun.file(path.join(tempAgentDir, "models.yml")).text()) as {
			providers: Record<
				string,
				{
					api: string;
					baseUrl: string;
					apiKeyEnv?: string;
					compat?: { thinkingFormat?: string };
					models: Array<{ id: string }>;
				}
			>;
		};
		expect(parsed.providers["minimax-code"]?.api).toBe("openai-completions");
		expect(parsed.providers["minimax-code"]?.baseUrl).toBe("https://api.minimax.io/v1");
		expect(parsed.providers["minimax-code"]?.apiKeyEnv).toBe("MINIMAX_CODE_API_KEY");
		expect(parsed.providers["minimax-code"]?.models.map(model => model.id)).toEqual(["MiniMax-M3"]);
		expect(parsed.providers["glm-proxy"]?.api).toBe("openai-completions");
		expect(parsed.providers["glm-proxy"]?.baseUrl).toBe("https://api.z.ai/api/paas/v4");
		expect(parsed.providers["glm-proxy"]?.apiKeyEnv).toBe("ZAI_API_KEY");
		expect(parsed.providers["glm-proxy"]?.compat?.thinkingFormat).toBe("zai");
		expect(parsed.providers["glm-proxy"]?.models.map(model => model.id)).toEqual(["glm-4.6"]);
		expect(outputs.join("\n")).toContain("MiniMax Coding Plan");
		expect(outputs.join("\n")).toContain("GLM / zAI");
	});

	it("rejects raw API keys in public provider onboarding", async () => {
		tempAgentDir = await fs.mkdtemp(path.join(os.tmpdir(), "gjc-provider-slash-"));
		setAgentDir(tempAgentDir);
		const outputs: string[] = [];
		const command = BUILTIN_SLASH_COMMANDS_INTERNAL.find(entry => entry.name === "provider");

		await command?.handle?.(
			{
				name: "provider",
				args: "add --compat openai --provider raw-key --base-url https://proxy.example.test --api-key sk-secret --model gpt",
				text: "/provider add",
			},
			{
				session: { modelRegistry: { refresh: async () => undefined } },
				sessionManager: {},
				settings: {},
				cwd: process.cwd(),
				output: (text: string) => outputs.push(text),
				refreshCommands: () => undefined,
				reloadPlugins: async () => undefined,
				notifyConfigChanged: () => undefined,
			} as unknown as SlashCommandRuntime,
		);

		expect(outputs.join("\n")).toContain("rejects raw --api-key values");
		expect(await Bun.file(path.join(tempAgentDir, "models.yml")).exists()).toBe(false);
	});

	it("rejects preset overrides through slash provider onboarding", async () => {
		tempAgentDir = await fs.mkdtemp(path.join(os.tmpdir(), "gjc-provider-slash-"));
		setAgentDir(tempAgentDir);
		const outputs: string[] = [];
		const command = BUILTIN_SLASH_COMMANDS_INTERNAL.find(entry => entry.name === "provider");
		const runtime = {
			session: { modelRegistry: { refresh: async () => undefined } },
			sessionManager: {},
			settings: {},
			cwd: process.cwd(),
			output: (text: string) => outputs.push(text),
			refreshCommands: () => undefined,
			reloadPlugins: async () => undefined,
			notifyConfigChanged: () => undefined,
		} as unknown as SlashCommandRuntime;

		await command?.handle?.(
			{
				name: "provider",
				args: "add --preset minimax --base-url https://example.invalid/v1",
				text: "/provider add",
			},
			runtime,
		);
		await command?.handle?.(
			{
				name: "provider",
				args: "add --preset minimax --model custom-model",
				text: "/provider add",
			},
			runtime,
		);
		await command?.handle?.(
			{
				name: "provider",
				args: "add --preset minimax --api-key-env CUSTOM_KEY",
				text: "/provider add",
			},
			runtime,
		);

		const output = outputs.join("\n");
		expect(output).toContain("fixed base URL");
		expect(output).toContain("fixed model ids");
		expect(output).toContain("MINIMAX_CODE_API_KEY");
		expect(await Bun.file(path.join(tempAgentDir, "models.yml")).exists()).toBe(false);
	});

	it("honors trailing --force for replacement", async () => {
		tempAgentDir = await fs.mkdtemp(path.join(os.tmpdir(), "gjc-provider-slash-"));
		setAgentDir(tempAgentDir);
		const command = BUILTIN_SLASH_COMMANDS_INTERNAL.find(entry => entry.name === "provider");
		const runtime = {
			session: { modelRegistry: { refresh: async () => undefined } },
			sessionManager: {},
			settings: {},
			cwd: process.cwd(),
			output: () => undefined,
			refreshCommands: () => undefined,
			reloadPlugins: async () => undefined,
			notifyConfigChanged: () => undefined,
		} as unknown as SlashCommandRuntime;

		await command?.handle?.(
			{
				name: "provider",
				args: `add --compat openai --provider replace-me --base-url https://proxy.example.test --api-key-env ${TEST_PROVIDER_KEY_ENV} --model old`,
				text: "/provider add",
			},
			runtime,
		);
		await command?.handle?.(
			{
				name: "provider",
				args: `add --compat openai --provider replace-me --base-url https://proxy.example.test --api-key-env ${TEST_PROVIDER_KEY_ENV} --model new --force`,
				text: "/provider add",
			},
			runtime,
		);

		const parsed = YAML.parse(await Bun.file(path.join(tempAgentDir, "models.yml")).text()) as {
			providers: Record<string, { models: Array<{ id: string }> }>;
		};
		expect(parsed.providers["replace-me"]?.models.map(model => model.id)).toEqual(["new"]);
	});
});
