import { afterEach, describe, expect, it } from "bun:test";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import {
	getEnvApiKeyCredentialSource,
	getEnvApiKeyEnvName,
	getEnvApiKeyEnvNames,
	getGoogleVertexCredentialSource,
} from "@gajae-code/ai/stream";

const envNames = [
	"ANTHROPIC_OAUTH_TOKEN",
	"ANTHROPIC_API_KEY",
	"ANTHROPIC_FOUNDRY_API_KEY",
	"CLAUDE_CODE_USE_FOUNDRY",
	"OPENAI_API_KEY",
	"AWS_BEARER_TOKEN_BEDROCK",
	"AWS_ACCESS_KEY_ID",
	"AWS_SECRET_ACCESS_KEY",
	"KIRO_API_KEY",
	"AWS_BEARER_TOKEN_KIRO",
	"GOOGLE_CLOUD_API_KEY",
	"GOOGLE_APPLICATION_CREDENTIALS",
	"GOOGLE_CLOUD_PROJECT",
	"GOOGLE_CLOUD_LOCATION",
	"HOME",
] as const;
const originals = new Map(envNames.map(name => [name, Bun.env[name]]));
const tempDirs: string[] = [];

afterEach(async () => {
	for (const name of envNames) {
		const original = originals.get(name);
		if (original === undefined) delete Bun.env[name];
		else Bun.env[name] = original;
	}
	for (const dir of tempDirs.splice(0)) await fs.rm(dir, { recursive: true, force: true });
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

	it("omits Kiro environment variables rejected by the provider resolver", () => {
		Bun.env.KIRO_API_KEY = "\x01invalid-kiro-key";
		Bun.env.AWS_BEARER_TOKEN_KIRO = "valid-kiro-bearer-test";

		expect(getEnvApiKeyEnvNames("kiro")).toEqual(["AWS_BEARER_TOKEN_KIRO"]);
		expect(getEnvApiKeyCredentialSource("kiro")).toEqual({
			kind: "environment",
			name: "AWS_BEARER_TOKEN_KIRO",
		});
	});

	it("omits a Bedrock bearer token rejected by its provider resolver", () => {
		Bun.env.AWS_BEARER_TOKEN_BEDROCK = "\x01invalid-bedrock-token";

		expect(getEnvApiKeyEnvNames("amazon-bedrock")).toEqual([]);
		expect(getEnvApiKeyCredentialSource("amazon-bedrock")).toBeUndefined();
	});

	it("tracks explicit Vertex ADC file creation and removal without stale cached presence", async () => {
		const dir = await fs.mkdtemp(path.join(os.tmpdir(), "gjc-vertex-adc-source-"));
		tempDirs.push(dir);
		const credentialPath = path.join(dir, "adc.json");
		Bun.env.GOOGLE_APPLICATION_CREDENTIALS = credentialPath;
		Bun.env.GOOGLE_CLOUD_PROJECT = "test-project";
		Bun.env.GOOGLE_CLOUD_LOCATION = "us-central1";

		expect(getEnvApiKeyCredentialSource("google-vertex")).toBeUndefined();
		expect(await getGoogleVertexCredentialSource()).toBeUndefined();
		await Bun.write(
			credentialPath,
			JSON.stringify({
				type: "authorized_user",
				client_id: "test-client",
				client_secret: "test-client-secret",
				refresh_token: "test-refresh-token",
			}),
		);
		expect(getEnvApiKeyCredentialSource("google-vertex")).toEqual({
			kind: "google-adc",
			source: "explicit-file",
		});
		expect(await getGoogleVertexCredentialSource()).toEqual({ kind: "google-adc", source: "explicit-file" });
		await fs.rm(credentialPath);
		expect(getEnvApiKeyCredentialSource("google-vertex")).toBeUndefined();
		expect(await getGoogleVertexCredentialSource()).toBeUndefined();
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

	it("identifies metadata-server ADC without retrieving an access token", async () => {
		const dir = await fs.mkdtemp(path.join(os.tmpdir(), "gjc-vertex-metadata-source-"));
		tempDirs.push(dir);
		Bun.env.HOME = dir;
		delete Bun.env.GOOGLE_APPLICATION_CREDENTIALS;
		delete Bun.env.GOOGLE_CLOUD_API_KEY;
		Bun.env.GOOGLE_CLOUD_PROJECT = "test-project";
		Bun.env.GOOGLE_CLOUD_LOCATION = "us-central1";
		const requests: string[] = [];

		const source = await getGoogleVertexCredentialSource({
			fetch: async (input, init) => {
				const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
				requests.push(url);
				expect(new Headers(init?.headers).get("Metadata-Flavor")).toBe("Google");
				return new Response("test-project", { headers: { "Metadata-Flavor": "Google" } });
			},
		});

		expect(source).toEqual({ kind: "google-adc", source: "metadata-server" });
		expect(requests).toEqual(["http://metadata.google.internal/computeMetadata/v1/project/project-id"]);
	});
});
