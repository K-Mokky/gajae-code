import { afterEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fetchAntigravityDiscoveryModels } from "../src/utils/discovery/antigravity";

const cacheDirs: string[] = [];

afterEach(() => {
	for (const cacheDir of cacheDirs.splice(0)) {
		rmSync(cacheDir, { recursive: true, force: true });
	}
});

describe("Code Assist Standard/Enterprise tier (business accounts with user-provided project)", () => {
	/**
	 * Business-tier users (Standard/Enterprise) bring their own GCP project via onboarding.
	 * This test ensures the new UA and cache invalidation don't regress their discovery/generation.
	 * Mocked test — needs field verification from actual Code Assist business users.
	 */

	it("discovers models for business-tier Code Assist user with project ID", async () => {
		// Mock business-tier response: includes standard tier models
		const businessFetcher = (async () =>
			new Response(
				JSON.stringify({
					models: {
						"gemini-2.5-flash": {
							displayName: "Gemini 2.5 Flash",
							supportsImages: true,
							maxTokens: 1_000_000,
							maxOutputTokens: 65_535,
						},
					},
					agentModelSorts: [
						{
							groups: [
								{
									modelIds: ["gemini-2.5-flash"],
								},
							],
						},
					],
				}),
				{ headers: { "content-type": "application/json" } },
			)) as unknown as typeof fetch;

		const models = await fetchAntigravityDiscoveryModels({
			token: "code-assist-oauth-token",
			endpoint: "https://cloudcode-pa.googleapis.com",
			userAgent: "antigravity/cli/1.3.4 (os_type=darwin; arch=arm64; aidev_client; auth_method=oauth)",
			fetcher: businessFetcher,
		});

		expect(models).not.toBeNull();
		expect(models?.map(m => m.id)).toContain("gemini-2.5-flash");
	});

	it("handles business-tier credentials without projectId (backwards compat)", async () => {
		const cacheDir = mkdtempSync(join(tmpdir(), "pi-ai-code-assist-"));
		cacheDirs.push(cacheDir);

		// Mock response for business user (project-less fallback path)
		const fetcher = (async () =>
			new Response(
				JSON.stringify({
					models: {
						"gemini-2.5-flash": {
							displayName: "Gemini 2.5 Flash",
							supportsImages: true,
							maxTokens: 1_000_000,
							maxOutputTokens: 65_535,
						},
					},
				}),
				{ headers: { "content-type": "application/json" } },
			)) as unknown as typeof fetch;

		const models = await fetchAntigravityDiscoveryModels({
			token: "legacy-code-assist-token",
			endpoint: "https://cloudcode-pa.googleapis.com",
			userAgent: "antigravity/cli/1.3.4 (os_type=darwin; arch=arm64; aidev_client; auth_method=oauth)",
			fetcher,
		});

		expect(models).not.toBeNull();
		expect(models?.length).toBeGreaterThan(0);
	});

	it("excludes disabled models from business-tier discovery", async () => {
		// Mock loadCodeAssist response with disabled models (Standard user sees Enterprise-only as disabled)
		const businessFetcher = (async () =>
			new Response(
				JSON.stringify({
					models: {
						"gemini-2.5-flash": {
							displayName: "Gemini 2.5 Flash (Standard tier)",
							supportsImages: true,
							maxTokens: 1_000_000,
							maxOutputTokens: 65_535,
						},
						"gemini-4-argon-disabled": {
							displayName: "Gemini 4 Argon (Enterprise only)",
							disabled: true,
							supportsImages: true,
						},
					},
					agentModelSorts: [
						{
							groups: [
								{
									modelIds: ["gemini-2.5-flash"],
								},
							],
						},
					],
				}),
				{ headers: { "content-type": "application/json" } },
			)) as unknown as typeof fetch;

		const models = await fetchAntigravityDiscoveryModels({
			token: "standard-tier-token",
			endpoint: "https://cloudcode-pa.googleapis.com",
			userAgent: "antigravity/cli/1.3.4 (os_type=darwin; arch=arm64; aidev_client; auth_method=oauth)",
			fetcher: businessFetcher,
		});

		// Standard tier user should get gemini-2.5 models
		expect(models?.map(m => m.id)).toContain("gemini-2.5-flash");
		// But not disabled models (business tier restriction)
		expect(models?.map(m => m.id)).not.toContain("gemini-4-argon-disabled");
	});

	it("cache invalidates correctly for business-tier with UA change", async () => {
		// First: old UA (hypothetically)
		const oldUA = "antigravity-ide";
		const oldFetcher = (async () =>
			new Response(
				JSON.stringify({
					models: {
						"gemini-2.5-flash": {
							displayName: "Gemini 2.5 Flash",
							supportsImages: true,
							maxTokens: 1_000_000,
							maxOutputTokens: 65_535,
						},
					},
					agentModelSorts: [
						{
							groups: [
								{
									modelIds: ["gemini-2.5-flash"],
								},
							],
						},
					],
				}),
				{ headers: { "content-type": "application/json" } },
			)) as unknown as typeof fetch;

		const oldModels = await fetchAntigravityDiscoveryModels({
			token: "business-token",
			endpoint: "https://cloudcode-pa.googleapis.com",
			userAgent: oldUA,
			fetcher: oldFetcher,
			targetProvider: "google-gemini-cli",
		});

		expect(oldModels).not.toBeNull();

		// Second: new UA
		const newUA = "antigravity/cli/1.3.4 (os_type=darwin; arch=arm64; aidev_client; auth_method=oauth)";
		let fetchCallCount = 0;
		const newFetcher = (async () => {
			fetchCallCount++;
			return new Response(
				JSON.stringify({
					models: {
						"gemini-2.5-flash": {
							displayName: "Gemini 2.5 Flash",
							supportsImages: true,
							maxTokens: 1_000_000,
							maxOutputTokens: 65_535,
						},
					},
					agentModelSorts: [
						{
							groups: [
								{
									modelIds: ["gemini-2.5-flash"],
								},
							],
						},
					],
				}),
				{ headers: { "content-type": "application/json" } },
			);
		}) as unknown as typeof fetch;

		const newModels = await fetchAntigravityDiscoveryModels({
			token: "business-token",
			endpoint: "https://cloudcode-pa.googleapis.com",
			userAgent: newUA,
			fetcher: newFetcher,
			targetProvider: "google-gemini-cli",
		});

		// Fetcher should have been called
		expect(fetchCallCount).toBe(1);
		// Both should return models
		expect(newModels).not.toBeNull();
		expect(newModels?.length).toBeGreaterThan(0);
	});

	it("Code Assist discovery with target provider mapping", async () => {
		/**
		 * google-gemini-cli provider remaps discovery results from google-antigravity.
		 * This ensures business users using the gemini-cli path get correct provider IDs.
		 */
		const cacheDir = mkdtempSync(join(tmpdir(), "pi-ai-code-assist-"));
		cacheDirs.push(cacheDir);

		const fetcher = (async () =>
			new Response(
				JSON.stringify({
					models: {
						"gemini-2.5-pro": {
							displayName: "Gemini 2.5 Pro",
							supportsImages: true,
							supportsThinking: true,
							maxTokens: 1_000_000,
							maxOutputTokens: 65_535,
						},
					},
					agentModelSorts: [
						{
							groups: [
								{
									modelIds: ["gemini-2.5-pro"],
								},
							],
						},
					],
				}),
				{ headers: { "content-type": "application/json" } },
			)) as unknown as typeof fetch;

		const models = await fetchAntigravityDiscoveryModels({
			token: "business-token",
			endpoint: "https://cloudcode-pa.googleapis.com",
			userAgent: "antigravity/cli/1.3.4 (os_type=darwin; arch=arm64; aidev_client; auth_method=oauth)",
			targetProvider: "google-gemini-cli",
			fetcher,
		});

		// When targetProvider is google-gemini-cli, models should have that provider ID
		expect(models?.every(m => m.provider === "google-gemini-cli")).toBe(true);
	});
});
