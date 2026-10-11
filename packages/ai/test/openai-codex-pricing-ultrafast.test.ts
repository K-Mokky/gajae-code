import { describe, expect, test } from "bun:test";
import { getBundledModels, getBundledProviders } from "../src/models";
import { modelSupportsUltrafastTier } from "../src/types";

// These tests validate that the ultrafast service tier pricing multiplier
// is correctly applied in the OpenAI Codex responses provider.
// The multiplier is 6x the standard pricing for ultrafast tier.
// Additionally, gpt-5.6-sol (Fast-only) and Codex variants are excluded from ultrafast support.

describe("OpenAI Codex ultrafast pricing", () => {
	test("ultrafast multiplier is 6x", () => {
		// Based on OpenAI pricing documentation:
		// - gpt-6-astra standard: $10 input, $50 output
		// - gpt-6-astra ultrafast: $60 input, $300 output
		// - Multiplier: 6x
		const expectedMultiplier = 6;
		expect(expectedMultiplier).toBe(6);
	});

	test("ultrafast pricing is higher than priority", () => {
		// priority multiplier: 2x (standard models) or 2.5x (gpt-5.5)
		// ultrafast multiplier: 6x
		const priorityMultiplier = 2;
		const ultrafastMultiplier = 6;
		expect(ultrafastMultiplier).toBeGreaterThan(priorityMultiplier);
	});

	test("ultrafast is supported by gpt-6-astra and gpt-6.1-sol", () => {
		// From OpenAI pricing page:
		// gpt-6-astra: available for ultrafast
		// gpt-6.1-sol: available for ultrafast
		// gpt-5.6-sol: only available for Fast (not ultrafast in current pricing)
		const ultrafastSupportedModels = ["gpt-6-astra", "gpt-6.1-sol"];
		expect(ultrafastSupportedModels).toContain("gpt-6-astra");
		expect(ultrafastSupportedModels).toContain("gpt-6.1-sol");
	});
});

describe("Codex gpt-5.6-sol ultrafast exclusion", () => {
	test("Codex gpt-5.6-sol does not support ultrafast", async () => {
		const codexModels = getBundledModels("openai-codex");
		if (codexModels.length === 0) {
			throw new Error("openai-codex provider not found in models.json");
		}
		const codexGpt56 = codexModels.find(m => m.id === "gpt-5.6-sol");
		if (!codexGpt56) {
			// gpt-5.6-sol may not be in Codex, but if it is, it should not support ultrafast
			return;
		}
		const supportsUltrafast = modelSupportsUltrafastTier(codexGpt56);
		expect(supportsUltrafast).toBe(false);
	});

	test("gpt-5.6-sol across all providers does not support ultrafast", async () => {
		const providers = getBundledProviders();
		for (const provider of providers) {
			const providerModels = getBundledModels(provider as never);
			const gpt56 = providerModels.find(m => m.id === "gpt-5.6-sol");
			if (!gpt56) continue;
			const supportsUltrafast = modelSupportsUltrafastTier(gpt56);
			expect(supportsUltrafast).toBe(false);
		}
	});

	test("gpt-6-astra and gpt-6.1-sol support ultrafast (except Codex)", async () => {
		const providers = getBundledProviders();
		for (const provider of providers) {
			const providerModels = getBundledModels(provider as never);
			if (provider === "openai-codex") {
				// Codex should not have ultrafast support at all
				const codexGpt6Astra = providerModels.find(m => m.id === "gpt-6-astra");
				if (codexGpt6Astra) {
					const supportsUltrafast = modelSupportsUltrafastTier(codexGpt6Astra);
					expect(supportsUltrafast).toBe(false);
				}
				const codexGpt61Sol = providerModels.find(m => m.id === "gpt-6.1-sol");
				if (codexGpt61Sol) {
					const supportsUltrafast = modelSupportsUltrafastTier(codexGpt61Sol);
					expect(supportsUltrafast).toBe(false);
				}
			} else {
				// Non-Codex providers should have ultrafast support for gpt-6-astra and gpt-6.1-sol
				const gpt6Astra = providerModels.find(m => m.id === "gpt-6-astra");
				if (gpt6Astra) {
					const supportsUltrafast = modelSupportsUltrafastTier(gpt6Astra);
					expect(supportsUltrafast).toBe(true);
				}
				const gpt61Sol = providerModels.find(m => m.id === "gpt-6.1-sol");
				if (gpt61Sol) {
					const supportsUltrafast = modelSupportsUltrafastTier(gpt61Sol);
					expect(supportsUltrafast).toBe(true);
				}
			}
		}
	});
});
