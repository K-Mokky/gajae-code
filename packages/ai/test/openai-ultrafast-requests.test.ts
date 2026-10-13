import { afterEach, describe, expect, it, vi } from "bun:test";
import { getBundledModel } from "../src/models";
import { streamOpenAICodexResponses } from "../src/providers/openai-codex-responses";
import { streamOpenAICompletions } from "../src/providers/openai-completions";
import { streamOpenAIResponses } from "../src/providers/openai-responses";
import type { Model } from "../src/types";
import { createSseResponse, testContext } from "./openai-tool-choice-test-helpers";

const originalFetch = global.fetch;

const usage = {
	input_tokens: 5,
	output_tokens: 1,
	total_tokens: 6,
	input_tokens_details: { cached_tokens: 0 },
};

function completedResponseEvents(serviceTier?: string): unknown[] {
	return [
		{
			type: "response.output_item.added",
			item: { type: "message", id: "msg_1", role: "assistant", status: "in_progress", content: [] },
		},
		{ type: "response.content_part.added", part: { type: "output_text", text: "" } },
		{ type: "response.output_text.delta", delta: "ok" },
		{
			type: "response.output_item.done",
			item: {
				type: "message",
				id: "msg_1",
				role: "assistant",
				status: "completed",
				content: [{ type: "output_text", text: "ok" }],
			},
		},
		{
			type: "response.completed",
			response: {
				id: "resp_1",
				status: "completed",
				usage,
				...(serviceTier === undefined ? {} : { service_tier: serviceTier }),
			},
		},
	];
}

function completionsResponseEvents(serviceTier?: string): unknown[] {
	const reportedTier = serviceTier === undefined ? {} : { service_tier: serviceTier };
	return [
		{
			id: "chatcmpl_1",
			object: "chat.completion.chunk",
			created: 0,
			model: "gpt-6-astra",
			...reportedTier,
			choices: [{ index: 0, delta: { content: "ok" }, finish_reason: "stop" }],
		},
		{
			id: "chatcmpl_1",
			object: "chat.completion.chunk",
			created: 0,
			model: "gpt-6-astra",
			...reportedTier,
			choices: [],
			usage: { prompt_tokens: 5, completion_tokens: 1, total_tokens: 6 },
		},
		"[DONE]",
	];
}

function captureRequests(events: unknown[]): Record<string, unknown>[] {
	const bodies: Record<string, unknown>[] = [];
	const fetchMock = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
		bodies.push(typeof init?.body === "string" ? (JSON.parse(init.body) as Record<string, unknown>) : {});
		return createSseResponse(events);
	});
	global.fetch = Object.assign(fetchMock, { preconnect: originalFetch.preconnect }) as typeof fetch;
	return bodies;
}

function codexTestToken(): string {
	const payload = Buffer.from(
		JSON.stringify({ "https://api.openai.com/auth": { chatgpt_account_id: "acc_test" } }),
		"utf8",
	).toBase64();
	return `aaa.${payload}.bbb`;
}

afterEach(() => {
	global.fetch = originalFetch;
	vi.restoreAllMocks();
});

describe("ultrafast request serialization for bundled models", () => {
	it("sends ultrafast for an opted-in GitHub Copilot Completions model", async () => {
		const model = getBundledModel("github-copilot", "gpt-6-astra") as Model<"openai-completions">;
		expect(model.compat).toMatchObject({ supportsServiceTier: true, supportsUltrafastTier: true });
		const bodies = captureRequests([
			{
				id: "chatcmpl_1",
				object: "chat.completion.chunk",
				created: 0,
				model: model.id,
				choices: [{ index: 0, delta: { content: "ok" }, finish_reason: "stop" }],
			},
			"[DONE]",
		]);

		const result = await streamOpenAICompletions(model, testContext, {
			apiKey: "ghu_test_copilot_token",
			serviceTier: "ultrafast",
		}).result();

		expect(result.stopReason).toBe("stop");
		expect(bodies[0]?.service_tier).toBe("ultrafast");
	});

	it("sends ultrafast for an opted-in OpenCode Zen Responses model", async () => {
		const model = getBundledModel("opencode-zen", "gpt-6.1-sol") as Model<"openai-responses">;
		expect(model.compat).toMatchObject({ supportsServiceTier: true, supportsUltrafastTier: true });
		const bodies = captureRequests(completedResponseEvents());

		const result = await streamOpenAIResponses(model, testContext, {
			apiKey: "test-key",
			serviceTier: "ultrafast",
		}).result();

		expect(result.stopReason).toBe("stop");
		expect(bodies[0]?.service_tier).toBe("ultrafast");
	});

	it("prices Responses usage using its effective tier and falls back when the response omits it", async () => {
		const model = getBundledModel("opencode-zen", "gpt-6.1-sol") as Model<"openai-responses">;
		const scenarios = [
			{ requestedTier: "ultrafast", responseTier: "default", expectedCost: 0.00002 },
			{ requestedTier: "priority", responseTier: "ultrafast", expectedCost: 0.00012 },
			{ requestedTier: "ultrafast", responseTier: undefined, expectedCost: 0.00012 },
		] as const;

		for (const scenario of scenarios) {
			const bodies = captureRequests(completedResponseEvents(scenario.responseTier));
			const result = await streamOpenAIResponses(model, testContext, {
				apiKey: "test-key",
				serviceTier: scenario.requestedTier,
			}).result();

			expect(result.stopReason).toBe("stop");
			expect(bodies[0]?.service_tier).toBe(scenario.requestedTier);
			expect(result.usage.cost.total).toBeCloseTo(scenario.expectedCost, 12);
		}
	});

	it("prices Completions usage using its effective tier and falls back when the response omits it", async () => {
		const model = getBundledModel("github-copilot", "gpt-6-astra") as Model<"openai-completions">;
		const scenarios = [
			{ requestedTier: "ultrafast", responseTier: "default", expectedCost: 0.0001 },
			{ requestedTier: "priority", responseTier: "ultrafast", expectedCost: 0.0006 },
			{ requestedTier: "ultrafast", responseTier: undefined, expectedCost: 0.0006 },
		] as const;

		for (const scenario of scenarios) {
			const bodies = captureRequests(completionsResponseEvents(scenario.responseTier));
			const result = await streamOpenAICompletions(model, testContext, {
				apiKey: "ghu_test_copilot_token",
				serviceTier: scenario.requestedTier,
			}).result();

			expect(result.stopReason).toBe("stop");
			expect(bodies[0]?.service_tier).toBe(scenario.requestedTier);
			expect(result.usage.cost.total).toBeCloseTo(scenario.expectedCost, 12);
		}
	});

	it("sends ultrafast for a Codex catalog model explicitly opted into the tier", async () => {
		const catalogModel = getBundledModel("openai-codex", "gpt-6-astra") as Model<"openai-codex-responses">;
		expect(catalogModel.compat?.supportsUltrafastTier).toBe(true);
		const model = { ...catalogModel, preferWebsockets: false };
		const bodies = captureRequests(completedResponseEvents());

		const result = await streamOpenAICodexResponses(model, testContext, {
			apiKey: codexTestToken(),
			serviceTier: "ultrafast",
		}).result();

		expect(result.stopReason).toBe("stop");
		expect(bodies[0]?.service_tier).toBe("ultrafast");
	});
});
