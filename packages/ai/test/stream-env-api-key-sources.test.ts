import { afterEach, describe, expect, it } from "bun:test";
import * as path from "node:path";
import { getEnvApiKeyCredentialSource, getEnvApiKeyEnvName, getEnvApiKeyEnvNames } from "@gajae-code/ai/stream";

const envNames = [
	"ANTHROPIC_OAUTH_TOKEN",
	"ANTHROPIC_API_KEY",
	"ANTHROPIC_FOUNDRY_API_KEY",
	"CLAUDE_CODE_USE_FOUNDRY",
	"OPENAI_API_KEY",
	"AWS_BEARER_TOKEN_BEDROCK",
	"AWS_ACCESS_KEY_ID",
	"AWS_SECRET_ACCESS_KEY",
	"GOOGLE_CLOUD_API_KEY",
	"GOOGLE_APPLICATION_CREDENTIALS",
	"GOOGLE_CLOUD_PROJECT",
	"GOOGLE_CLOUD_LOCATION",
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
		expect(getEnvApiKeyCredentialSource("anthropic")).toEqual({
			kind: "environment",
			name: "ANTHROPIC_OAUTH_TOKEN",
		});
	});

	it("resolves the source name for providers with a fixed environment fallback", () => {
		Bun.env.OPENAI_API_KEY = "openai-test-secret";

		expect(getEnvApiKeyEnvNames("openai")).toEqual(["OPENAI_API_KEY"]);
		expect(getEnvApiKeyEnvName("openai")).toBe("OPENAI_API_KEY");
	});

	it("distinguishes AWS environment credentials from an API key", () => {
		delete Bun.env.AWS_BEARER_TOKEN_BEDROCK;
		Bun.env.AWS_ACCESS_KEY_ID = "aws-access-key-test";
		Bun.env.AWS_SECRET_ACCESS_KEY = "aws-secret-key-test";

		expect(getEnvApiKeyCredentialSource("amazon-bedrock")).toEqual({
			kind: "aws",
			source: "environment-credentials",
		});
	});

	it("identifies Vertex ADC without exposing the credential file path", () => {
		delete Bun.env.GOOGLE_CLOUD_API_KEY;
		Bun.env.GOOGLE_APPLICATION_CREDENTIALS = path.join(process.cwd(), "package.json");
		Bun.env.GOOGLE_CLOUD_PROJECT = "test-project";
		Bun.env.GOOGLE_CLOUD_LOCATION = "us-central1";

		expect(getEnvApiKeyCredentialSource("google-vertex")).toEqual({
			kind: "google-adc",
			source: "explicit-file",
		});
	});
});
