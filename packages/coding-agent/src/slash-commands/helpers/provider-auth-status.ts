import {
	type AuthCredentialSnapshotEntry,
	type EnvApiKeyCredentialSource,
	getEnvApiKeyCredentialSources,
	listProvidersWithEnvKey,
	resolveOAuthStorageProvider,
} from "@gajae-code/ai/core";
import { replaceTabs, truncateToWidth, wrapTextWithAnsi } from "@gajae-code/tui";
import { $credentialEnv, sanitizeDisplayLine } from "@gajae-code/utils";
import type { ModelRegistry } from "../../config/model-registry";
import type { AgentSession } from "../../session/agent-session";

type ProviderAuthStatusSession = Pick<AgentSession, "credentialSessionId"> & {
	modelRegistry: Pick<
		ModelRegistry,
		| "authStorage"
		| "getAll"
		| "getAvailable"
		| "getConfiguredProviderIds"
		| "getAuthStorageOwner"
		| "getProviderConfigApiKeySources"
		| "getProviderRuntimeApiKeyEnvName"
		| "hasRuntimeProviderApiKey"
	>;
};

interface CredentialSource {
	kind: "api_key" | "oauth";
	layer: "runtime-override" | "runtime-provider" | "config" | "stored" | "environment" | "fallback" | "pending";
	label: string;
}

const MAX_STATUS_VALUE_WIDTH = 120;

function displayStatusValue(value: string): string {
	const safe = replaceTabs(sanitizeDisplayLine(value))
		.replaceAll(/[\u2028\u2029]/gu, " ")
		.trim();
	return truncateToWidth(safe, MAX_STATUS_VALUE_WIDTH).trim() || "unknown";
}

function displayAccountLabel(value: string): string {
	return displayStatusValue(value);
}

function displayEnvironmentName(value: string): string {
	return displayStatusValue(value);
}

function oauthLabel(entry: AuthCredentialSnapshotEntry): string {
	if (entry.credential.type !== "oauth") return `OAuth (stored credential id:${entry.id})`;
	const account = entry.credential.accountId ?? entry.credential.email;
	return account ? `OAuth (account ${displayAccountLabel(account)})` : `OAuth (stored credential id:${entry.id})`;
}

function environmentCredentialLabel(name: string): string {
	const safeName = displayEnvironmentName(name);
	if (name.endsWith("_API_KEY")) return `API key (env ${safeName})`;
	if (name.includes("OAUTH") || name.includes("ACCESS_TOKEN")) return `OAuth token (env ${safeName})`;
	return `environment credential (env ${safeName})`;
}

function environmentSourceLabel(source: EnvApiKeyCredentialSource): string {
	switch (source.kind) {
		case "environment":
			return environmentCredentialLabel(source.name);
		case "google-adc":
			return source.source === "explicit-file"
				? "Google ADC (env GOOGLE_APPLICATION_CREDENTIALS)"
				: source.source === "default-file"
					? "Google ADC (default credentials file)"
					: "Google ADC (metadata server)";
		case "aws":
			return source.source === "bearer-token"
				? "AWS bearer token (env AWS_BEARER_TOKEN_BEDROCK)"
				: source.source === "environment-credentials"
					? "AWS environment credentials"
					: "AWS profile credentials";
		case "unknown":
			return "environment credentials";
	}
}

function addSource(sources: CredentialSource[], source: CredentialSource): void {
	if (
		!sources.some(
			existing =>
				existing.kind === source.kind && existing.layer === source.layer && existing.label === source.label,
		)
	) {
		sources.push(source);
	}
}

function hasRuntimeProviderCredential(registry: ProviderAuthStatusSession["modelRegistry"], provider: string): boolean {
	const envName = registry.getProviderRuntimeApiKeyEnvName(provider);
	return registry.hasRuntimeProviderApiKey(provider) && (envName === undefined || Boolean($credentialEnv(envName)));
}

function storedApiKeySource(
	authStorage: ProviderAuthStatusSession["modelRegistry"]["authStorage"],
	provider: string,
	entries: AuthCredentialSnapshotEntry[],
	rowId: number | undefined,
): Omit<CredentialSource, "kind"> | undefined {
	const apiKeys = entries.filter(entry => entry.credential.type === "api_key");
	const selected = rowId === undefined ? undefined : apiKeys.find(entry => entry.id === rowId);
	if (selected?.credential.type === "api_key") {
		const usability = authStorage.getStoredApiKeyUsability(provider, selected.id);
		if (selected.credential.key.startsWith("!") && usability !== true) {
			return {
				layer: "pending",
				label:
					usability === false
						? "API key (stored credential; retry pending)"
						: "API key (stored credential; usability pending)",
			};
		}
		return { layer: "stored", label: `API key (stored credential id:${selected.id})` };
	}
	const unknownCommandKey = apiKeys.some(
		entry =>
			entry.credential.type === "api_key" &&
			entry.credential.key.startsWith("!") &&
			authStorage.getStoredApiKeyUsability(provider, entry.id) === undefined,
	);
	if (unknownCommandKey) {
		return { layer: "pending", label: "API key (stored credential; usability pending)" };
	}
	const retryableCommandKey = apiKeys.some(
		entry =>
			entry.credential.type === "api_key" &&
			entry.credential.key.startsWith("!") &&
			authStorage.getStoredApiKeyUsability(provider, entry.id) === false,
	);
	if (retryableCommandKey) {
		return { layer: "pending", label: "API key (stored credential; retry pending)" };
	}
	const usableApiKeys = apiKeys.filter(entry => authStorage.getStoredApiKeyUsability(provider, entry.id) !== false);
	if (usableApiKeys.length === 1) {
		return { layer: "stored", label: `API key (stored credential id:${usableApiKeys[0]!.id})` };
	}
	if (usableApiKeys.length > 1) return { layer: "pending", label: "API key (stored credential; selection pending)" };
	return undefined;
}

function collectSources(
	provider: string,
	entries: AuthCredentialSnapshotEntry[],
	registry: ProviderAuthStatusSession["modelRegistry"],
	environmentSources: EnvApiKeyCredentialSource[],
): CredentialSource[] {
	const sources: CredentialSource[] = [];
	const authStorage = registry.authStorage;
	for (const entry of entries) {
		if (entry.credential.type === "oauth") {
			addSource(sources, { kind: "oauth", layer: "stored", label: oauthLabel(entry) });
		} else {
			if (authStorage.getStoredApiKeyUsability(provider, entry.id) === false) continue;
			addSource(sources, {
				kind: "api_key",
				layer: "stored",
				label: `API key (stored credential id:${entry.id})`,
			});
		}
	}

	if (authStorage.hasRuntimeApiKey(provider)) {
		addSource(sources, {
			kind: "api_key",
			layer: "runtime-override",
			label: "API key (runtime override)",
		});
	}
	const runtimeEnvName = registry.getProviderRuntimeApiKeyEnvName(provider);
	if (
		registry.hasRuntimeProviderApiKey(provider) &&
		(runtimeEnvName === undefined || $credentialEnv(runtimeEnvName) !== undefined)
	) {
		addSource(sources, {
			kind: "api_key",
			layer: "runtime-provider",
			label: runtimeEnvName
				? `API key (env ${displayEnvironmentName(runtimeEnvName)})`
				: "API key (runtime provider)",
		});
	}
	for (const configSource of registry.getProviderConfigApiKeySources(provider)) {
		addSource(sources, {
			kind: "api_key",
			layer: "config",
			label:
				configSource.kind === "environment"
					? `API key (env ${displayEnvironmentName(configSource.name)})`
					: "API key (models.yml)",
		});
	}
	for (const source of environmentSources) {
		addSource(sources, { kind: "api_key", layer: "environment", label: environmentSourceLabel(source) });
	}
	return sources;
}

function activeSource(
	provider: string,
	entries: AuthCredentialSnapshotEntry[],
	session: ProviderAuthStatusSession,
	owner: object,
	activeType: "api_key" | "oauth",
	environmentSources: EnvApiKeyCredentialSource[],
): CredentialSource {
	const { authStorage } = session.modelRegistry;
	const sessionId = session.credentialSessionId;
	if (activeType === "oauth") {
		const pinnedRowId = authStorage.getSelectedOAuthCredentialRowId(provider, sessionId, { owner });
		const preferredRowId = authStorage.getPreferredOAuthCredentialRowId(provider);
		const sessionRowId = authStorage.getSessionCredentialRowId(provider, sessionId);
		const availableSessionRowId =
			sessionRowId !== undefined && authStorage.isCredentialAvailable(provider, sessionRowId)
				? sessionRowId
				: undefined;
		const rowId = pinnedRowId ?? availableSessionRowId ?? preferredRowId;
		const selected = rowId === undefined ? undefined : entries.find(entry => entry.id === rowId);
		if (
			selected?.credential.type === "oauth" &&
			(pinnedRowId === rowId || authStorage.isCredentialAvailable(provider, selected.id))
		) {
			return { kind: "oauth", layer: "stored", label: oauthLabel(selected) };
		}
		const oauthEntries = entries.filter(
			entry => entry.credential.type === "oauth" && authStorage.isCredentialAvailable(provider, entry.id),
		);
		if (oauthEntries.length === 1) return { kind: "oauth", layer: "stored", label: oauthLabel(oauthEntries[0]!) };
		return {
			kind: "oauth",
			layer: "pending",
			label: oauthEntries.length > 1 ? "OAuth (account selection pending)" : "OAuth (account unavailable)",
		};
	}

	if (authStorage.hasRuntimeApiKey(provider)) {
		return { kind: "api_key", layer: "runtime-override", label: "API key (runtime override)" };
	}
	const runtimeEnvName = session.modelRegistry.getProviderRuntimeApiKeyEnvName(provider);
	if (
		session.modelRegistry.hasRuntimeProviderApiKey(provider) &&
		(runtimeEnvName === undefined || $credentialEnv(runtimeEnvName) !== undefined)
	) {
		return {
			kind: "api_key",
			layer: "runtime-provider",
			label: runtimeEnvName
				? `API key (env ${displayEnvironmentName(runtimeEnvName)})`
				: "API key (runtime provider)",
		};
	}
	const configSources = session.modelRegistry.getProviderConfigApiKeySources(provider);
	if (authStorage.hasConfigApiKey(provider, owner) && configSources.length > 0) {
		const configSource = configSources[0]!;
		if (!authStorage.hasLiteralConfigApiKey(provider, owner)) {
			const rowId = authStorage.getProspectiveApiKeyCredentialRowId(provider, sessionId, { owner });
			const storedSource = storedApiKeySource(authStorage, provider, entries, rowId);
			if (storedSource) return { kind: "api_key", ...storedSource };
		}
		return {
			kind: "api_key",
			layer: "config",
			label:
				configSource.kind === "environment"
					? `API key (env ${displayEnvironmentName(configSource.name)})`
					: "API key (models.yml)",
		};
	}
	const selectedRowId = authStorage.getSelectedApiKeyCredentialRowId(provider, sessionId, { owner });
	if (selectedRowId !== undefined && authStorage.getStoredApiKeyUsability(provider, selectedRowId) === false) {
		return { kind: "api_key", layer: "pending", label: "API key (selected credential unavailable)" };
	}
	const rowId = authStorage.getProspectiveApiKeyCredentialRowId(provider, sessionId, { owner });
	const storedSource = storedApiKeySource(authStorage, provider, entries, rowId);
	if (storedSource) return { kind: "api_key", ...storedSource };

	const envSource = environmentSources[0];
	if (envSource) return { kind: "api_key", layer: "environment", label: environmentSourceLabel(envSource) };
	return { kind: "api_key", layer: "fallback", label: "API key (configured)" };
}

/** Format credential provenance for `/provider status` without returning credential values. */
export async function buildProviderAuthStatusText(session: ProviderAuthStatusSession): Promise<string> {
	const { modelRegistry } = session;
	// Status must reflect rotating env-backed keys even before another model selection runs.
	modelRegistry.getAvailable();
	const googleVertexSources = await getEnvApiKeyCredentialSources("google-vertex");
	const googleVertexSource = googleVertexSources[0];
	const authStorage = modelRegistry.authStorage;
	const owner = modelRegistry.getAuthStorageOwner();
	const snapshot = authStorage.exportSnapshot();
	const storedProviders = new Set(snapshot.credentials.map(entry => resolveOAuthStorageProvider(entry.provider)));
	const providerIds = new Set([
		...modelRegistry.getAll().map(model => resolveOAuthStorageProvider(model.provider)),
		...modelRegistry.getConfiguredProviderIds().map(provider => resolveOAuthStorageProvider(provider)),
		...snapshot.credentials.map(entry => resolveOAuthStorageProvider(entry.provider)),
		...listProvidersWithEnvKey().map(provider => resolveOAuthStorageProvider(provider)),
	]);
	const providers = [...providerIds]
		.filter(
			provider =>
				authStorage.hasSessionCredentialUnavailable(provider, session.credentialSessionId) ||
				storedProviders.has(provider) ||
				(provider === "google-vertex"
					? googleVertexSource !== undefined ||
						modelRegistry.getProviderConfigApiKeySources(provider).length > 0 ||
						hasRuntimeProviderCredential(modelRegistry, provider) ||
						authStorage.hasRuntimeApiKey(provider)
					: authStorage.hasAuth(provider, session.credentialSessionId, { owner })),
		)
		.sort((left, right) => left.localeCompare(right));
	if (providers.length === 0) return "No configured provider credentials.";

	const lines = ["Provider credentials (active source per provider):"];
	for (const provider of providers) {
		const entries = snapshot.credentials.filter(entry => resolveOAuthStorageProvider(entry.provider) === provider);
		const environmentSources =
			provider === "google-vertex" ? googleVertexSources : await getEnvApiKeyCredentialSources(provider);
		const activeType = authStorage.getEffectiveCredentialType(provider, session.credentialSessionId, { owner });
		const sources = collectSources(provider, entries, modelRegistry, environmentSources);
		const sessionCredentialUnavailable = authStorage.hasSessionCredentialUnavailable(
			provider,
			session.credentialSessionId,
		);
		let active: { kind: "api_key" | "oauth"; layer: string; label: string } | undefined;
		if (activeType === "oauth" || activeType === "api_key") {
			active = activeSource(provider, entries, session, owner, activeType, environmentSources);
		} else if (environmentSources[0]) {
			active = {
				kind: "api_key" as const,
				layer: "environment",
				label: environmentSourceLabel(environmentSources[0]),
			};
		} else {
			active = undefined;
		}
		const configOverridePrecedesUnavailablePin =
			authStorage.hasConfigApiKey(provider, owner) &&
			modelRegistry.getProviderConfigApiKeySources(provider).length > 0;
		const overridePrecedesUnavailablePin =
			active?.layer === "runtime-override" ||
			active?.layer === "runtime-provider" ||
			configOverridePrecedesUnavailablePin;
		if (sessionCredentialUnavailable && !overridePrecedesUnavailablePin) {
			active = { kind: "api_key", layer: "pending", label: "selected credential unavailable" };
		}
		lines.push(
			...wrapTextWithAnsi(
				`${displayStatusValue(provider)}: ${active?.label ?? "credential source unavailable"}`,
				MAX_STATUS_VALUE_WIDTH,
			),
		);
		const shadowed =
			active && active.layer !== "pending"
				? sources
						.filter(
							source =>
								source.label !== active.label &&
								!(active.layer === "stored" && source.layer === "stored" && source.kind === active.kind),
						)
						.map(source => source.label)
				: [];
		if (shadowed.length > 0) {
			lines.push(...wrapTextWithAnsi(`  shadowed: ${[...new Set(shadowed)].join(", ")}`, MAX_STATUS_VALUE_WIDTH));
		}
	}
	return lines.join("\n");
}
