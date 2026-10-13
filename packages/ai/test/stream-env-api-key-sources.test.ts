import { afterEach, describe, expect, it } from "bun:test";
import { getEnvApiKeyEnvName, getEnvApiKeyEnvNames } from "@gajae-code/ai/stream";

const envNames = [
	"ANTHROPIC_OAUTH_TOKEN",
	"ANTHROPIC_API_KEY",
	"ANTHROPIC_FOUNDRY_API_KEY",
	"CLAUDE_CODE_USE_FOUNDRY",
	"OPENAI_API_KEY",
] as const;
const originals = new Map(envNames.map(name => [name, Bun.env[name]]));

afterEach(() => {
	for (const name of envNames) {
		const original = originals.get(name);
		if (original === undefined) delete Bun.env[name];
		else Bun.env[name] = original;
	}
});

describe("environment API-key source names", () => {
	it("reports configured environment variable names without returning their values", () => {
		delete Bun.env.ANTHROPIC_FOUNDRY_API_KEY;
		delete Bun.env.CLAUDE_CODE_USE_FOUNDRY;
		Bun.env.ANTHROPIC_OAUTH_TOKEN = "anthropic-oauth-secret";
		Bun.env.ANTHROPIC_API_KEY = "anthropic-api-key-secret";

		expect(getEnvApiKeyEnvNames("anthropic")).toEqual(["ANTHROPIC_OAUTH_TOKEN", "ANTHROPIC_API_KEY"]);
		expect(getEnvApiKeyEnvName("anthropic")).toBe("ANTHROPIC_OAUTH_TOKEN");
		expect(getEnvApiKeyEnvName("anthropic")).not.toContain("secret");
	});

	it("resolves the source name for providers with a fixed environment fallback", () => {
		Bun.env.OPENAI_API_KEY = "openai-test-secret";

		expect(getEnvApiKeyEnvNames("openai")).toEqual(["OPENAI_API_KEY"]);
		expect(getEnvApiKeyEnvName("openai")).toBe("OPENAI_API_KEY");
	});
});
