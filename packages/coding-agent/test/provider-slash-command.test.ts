import { afterEach, describe, expect, it } from "bun:test";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { AuthStorage } from "@gajae-code/ai/core";
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
		delete Bun.env.ANTHROPIC_API_KEY;
		Bun.env.OPENAI_API_KEY = "openai-secret-test-value";
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
			expect(output).not.toMatch(/anthropic:\s+[^\n]*\n\s+shadowed:/);
			expect(output).not.toContain("openai-secret-test-value");
			expect(output).not.toContain("oauth-secret-test-value");
		} finally {
			if (originalAnthropicKey === undefined) delete Bun.env.ANTHROPIC_API_KEY;
			else Bun.env.ANTHROPIC_API_KEY = originalAnthropicKey;
			if (originalOpenAiKey === undefined) delete Bun.env.OPENAI_API_KEY;
			else Bun.env.OPENAI_API_KEY = originalOpenAiKey;
		}
	});

	it("shows credential status from the TUI provider command", async () => {
		const registry = {
			authStorage: { exportSnapshot: () => ({ credentials: [] }), hasAuth: () => false },
			getAll: () => [],
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

			const outputs: string[] = [];
			await add?.handle?.({ name: "provider", args: "status", text: "/provider status" }, {
				session: { modelRegistry: registry },
				output: (text: string) => outputs.push(text),
			} as unknown as SlashCommandRuntime);

			expect(outputs.join("\n")).toContain(`status-custom: API key (env ${TEST_PROVIDER_KEY_ENV})`);
			expect(outputs.join("\n")).not.toContain("custom-provider-secret-test-value");
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
