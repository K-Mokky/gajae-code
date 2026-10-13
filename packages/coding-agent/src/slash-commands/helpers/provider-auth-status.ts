import {
	type AuthCredentialSnapshotEntry,
	type EnvApiKeyCredentialSource,
	getEnvApiKeyCredentialSource,
	getEnvApiKeyEnvNames,
	listProvidersWithEnvKey,
	resolveOAuthStorageProvider,
} from "@gajae-code/ai/core";
import { sanitizeDisplayLine } from "@gajae-code/utils";
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
		| "getProviderConfigApiKeyEnvName"
		| "getProviderRuntimeApiKeyEnvName"
		| "hasRuntimeProviderApiKey"
	>;
};

interface CredentialSource {
	kind: "api_key" | "oauth";
	layer: "runtime-override" | "runtime-provider" | "config" | "stored" | "environment" | "fallback" | "pending";
	label: string;
}

function displayAccountLabel(value: string): string {
	const safe = sanitizeDisplayLine(value)
		.replaceAll(/[\u2028\u2029]/gu, " ")
		.trim();
	return safe.length > 120 ? `${safe.slice(0, 117)}...` : safe || "unknown";
}

function oauthLabel(entry: AuthCredentialSnapshotEntry): string {
	if (entry.credential.type !== "oauth") return `OAuth (stored credential id:${entry.id})`;
	const account = entry.credential.accountId ?? entry.credential.email;
	return account ? `OAuth (account ${displayAccountLabel(account)})` : `OAuth (stored credential id:${entry.id})`;
}

function environmentCredentialLabel(name: string): string {
	if (name.endsWith("_API_KEY")) return `API key (env ${name})`;
	if (name.includes("OAUTH") || name.includes("ACCESS_TOKEN")) return `OAuth token (env ${name})`;
	return `environment credential (env ${name})`;
}

function environmentSourceLabel(source: EnvApiKeyCredentialSource): string {
	switch (source.kind) {
		case "environment":
			return environmentCredentialLabel(source.name);
		case "google-adc":
			return source.source === "explicit-file"
				? "Google ADC (env GOOGLE_APPLICATION_CREDENTIALS)"
				: "Google ADC (default credentials file)";
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

function storedApiKeySource(
	authStorage: ProviderAuthStatusSession["modelRegistry"]["authStorage"],
	provider: string,
	entries: AuthCredentialSnapshotEntry[],
	rowId: number | undefined,
): Omit<CredentialSource, "kind"> | undefined {
	const apiKeys = entries.filter(entry => entry.credential.type === "api_key");
	const selected = rowId === undefined ? undefined : apiKeys.find(entry => entry.id === rowId);
	if (selected) return { layer: "stored", label: `API key (stored credential id:${selected.id})` };
	const unknownCommandKey = apiKeys.some(
		entry =>
			entry.credential.type === "api_key" &&
			entry.credential.key.startsWith("!") &&
			authStorage.getStoredApiKeyUsability(provider, entry.id) === undefined,
	);
	if (unknownCommandKey) {
		return { layer: "pending", label: "API key (stored credential; usability pending)" };
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
	owner: object,
): CredentialSource[] {
	const sources: CredentialSource[] = [];
	const authStorage = registry.authStorage;
	const envProvider = resolveOAuthStorageProvider(provider);
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
	if (registry.hasRuntimeProviderApiKey(provider)) {
		const envName = registry.getProviderRuntimeApiKeyEnvName(provider);
		addSource(sources, {
			kind: "api_key",
			layer: "runtime-provider",
			label: envName ? `API key (env ${envName})` : "API key (runtime provider)",
		});
	} else if (authStorage.hasConfigApiKey(provider, owner)) {
		const envName = registry.getProviderConfigApiKeyEnvName(provider);
		addSource(sources, {
			kind: "api_key",
			layer: "config",
			label: envName ? `API key (env ${envName})` : "API key (models.yml)",
		});
	}
	const selectedEnvSource = getEnvApiKeyCredentialSource(envProvider);
	for (const name of getEnvApiKeyEnvNames(envProvider)) {
		const label =
			selectedEnvSource?.kind === "aws" && selectedEnvSource.source === "bearer-token"
				? environmentSourceLabel(selectedEnvSource)
				: environmentCredentialLabel(name);
		addSource(sources, { kind: "api_key", layer: "environment", label });
	}
	if (selectedEnvSource && selectedEnvSource.kind !== "environment") {
		addSource(sources, { kind: "api_key", layer: "environment", label: environmentSourceLabel(selectedEnvSource) });
	}
	return sources;
}

function activeSource(
	provider: string,
	entries: AuthCredentialSnapshotEntry[],
	session: ProviderAuthStatusSession,
	owner: object,
	activeType: "api_key" | "oauth",
): CredentialSource {
	const { authStorage } = session.modelRegistry;
	const sessionId = session.credentialSessionId;
	if (activeType === "oauth") {
		const rowId =
			authStorage.getSelectedOAuthCredentialRowId(provider, sessionId, { owner }) ??
			authStorage.getSessionCredentialRowId(provider, sessionId);
		const selected = rowId === undefined ? undefined : entries.find(entry => entry.id === rowId);
		if (selected?.credential.type === "oauth") return { kind: "oauth", layer: "stored", label: oauthLabel(selected) };
		const oauthEntries = entries.filter(entry => entry.credential.type === "oauth");
		if (oauthEntries.length === 1) return { kind: "oauth", layer: "stored", label: oauthLabel(oauthEntries[0]!) };
		return {
			kind: "oauth",
			layer: "stored",
			label: oauthEntries.length > 1 ? "OAuth (account selection pending)" : "OAuth (stored account)",
		};
	}

	if (authStorage.hasRuntimeApiKey(provider)) {
		return { kind: "api_key", layer: "runtime-override", label: "API key (runtime override)" };
	}
	if (session.modelRegistry.hasRuntimeProviderApiKey(provider)) {
		const envName = session.modelRegistry.getProviderRuntimeApiKeyEnvName(provider);
		return {
			kind: "api_key",
			layer: "runtime-provider",
			label: envName ? `API key (env ${envName})` : "API key (runtime provider)",
		};
	}
	if (authStorage.hasConfigApiKey(provider, owner)) {
		const envName = session.modelRegistry.getProviderConfigApiKeyEnvName(provider);
		if (!authStorage.hasLiteralConfigApiKey(provider, owner)) {
			const rowId = authStorage.getProspectiveApiKeyCredentialRowId(provider, sessionId, { owner });
			const storedSource = storedApiKeySource(authStorage, provider, entries, rowId);
			if (storedSource) return { kind: "api_key", ...storedSource };
		}
		return {
			kind: "api_key",
			layer: "config",
			label: envName ? `API key (env ${envName})` : "API key (models.yml)",
		};
	}
	const rowId = authStorage.getProspectiveApiKeyCredentialRowId(provider, sessionId, { owner });
	const storedSource = storedApiKeySource(authStorage, provider, entries, rowId);
	if (storedSource) return { kind: "api_key", ...storedSource };

	const envProvider = resolveOAuthStorageProvider(provider);
	const envSource = getEnvApiKeyCredentialSource(envProvider);
	if (envSource) return { kind: "api_key", layer: "environment", label: environmentSourceLabel(envSource) };
	return { kind: "api_key", layer: "fallback", label: "API key (configured)" };
}

/** Format credential provenance for `/provider status` without returning credential values. */
export function buildProviderAuthStatusText(session: ProviderAuthStatusSession): string {
	const { modelRegistry } = session;
	// Status must reflect rotating env-backed keys even before another model selection runs.
	modelRegistry.getAvailable();
	const authStorage = modelRegistry.authStorage;
	const owner = modelRegistry.getAuthStorageOwner();
	const snapshot = authStorage.exportSnapshot();
	const providerIds = new Set([
		...modelRegistry.getAll().map(model => resolveOAuthStorageProvider(model.provider)),
		...modelRegistry.getConfiguredProviderIds().map(provider => resolveOAuthStorageProvider(provider)),
		...snapshot.credentials.map(entry => resolveOAuthStorageProvider(entry.provider)),
		...listProvidersWithEnvKey().map(provider => resolveOAuthStorageProvider(provider)),
	]);
	const providers = [...providerIds]
		.filter(provider => authStorage.hasAuth(provider, session.credentialSessionId, { owner }))
		.sort((left, right) => left.localeCompare(right));
	if (providers.length === 0) return "No configured provider credentials.";

	const lines = ["Provider credentials (active source per provider):"];
	for (const provider of providers) {
		const entries = snapshot.credentials.filter(entry => resolveOAuthStorageProvider(entry.provider) === provider);
		const activeType = authStorage.getEffectiveCredentialType(provider, session.credentialSessionId, { owner });
		const sources = collectSources(provider, entries, modelRegistry, owner);
		const active =
			activeType === "oauth" || activeType === "api_key"
				? activeSource(provider, entries, session, owner, activeType)
				: undefined;
		lines.push(`${sanitizeDisplayLine(provider)}: ${active?.label ?? "credential source unavailable"}`);
		const shadowed =
			active && active.layer !== "pending"
				? sources
						.filter(
							source =>
								source.label !== active.label && (source.kind !== active.kind || source.layer !== active.layer),
						)
						.map(source => source.label)
				: [];
		if (shadowed.length > 0) lines.push(`  shadowed: ${[...new Set(shadowed)].join(", ")}`);
	}
	return lines.join("\n");
}
