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
		| "getConfiguredProviderIds"
		| "getAuthStorageOwner"
		| "getProviderConfigApiKeyEnvName"
		| "getProviderRuntimeApiKeyEnvName"
		| "hasRuntimeProviderApiKey"
	>;
};

interface CredentialSource {
	kind: "api_key" | "oauth";
	layer: "runtime" | "config" | "stored" | "environment" | "fallback";
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

function storedApiKeyLabel(entries: AuthCredentialSnapshotEntry[], rowId: number | undefined): string | undefined {
	const apiKeys = entries.filter(entry => entry.credential.type === "api_key");
	const selected = rowId === undefined ? undefined : apiKeys.find(entry => entry.id === rowId);
	if (selected) return `API key (stored credential id:${selected.id})`;
	if (apiKeys.length === 1) return `API key (stored credential id:${apiKeys[0]!.id})`;
	if (apiKeys.length > 1) return "API key (stored credential; selection pending)";
	return undefined;
}

function collectSources(
	provider: string,
	entries: AuthCredentialSnapshotEntry[],
	registry: ProviderAuthStatusSession["modelRegistry"],
	owner: object,
): CredentialSource[] {
	const sources: CredentialSource[] = [];
	const envProvider = resolveOAuthStorageProvider(provider);
	for (const entry of entries) {
		if (entry.credential.type === "oauth") {
			addSource(sources, { kind: "oauth", layer: "stored", label: oauthLabel(entry) });
		} else {
			addSource(sources, {
				kind: "api_key",
				layer: "stored",
				label: `API key (stored credential id:${entry.id})`,
			});
		}
	}

	const authStorage = registry.authStorage;
	if (authStorage.hasRuntimeApiKey(provider)) {
		const envName = registry.getProviderRuntimeApiKeyEnvName(provider);
		addSource(sources, {
			kind: "api_key",
			layer: "runtime",
			label: envName ? `API key (env ${envName})` : "API key (runtime override)",
		});
	} else if (registry.hasRuntimeProviderApiKey(provider)) {
		const envName = registry.getProviderRuntimeApiKeyEnvName(provider);
		addSource(sources, {
			kind: "api_key",
			layer: "runtime",
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
		const rowId = authStorage.getSessionCredentialRowId(provider, sessionId);
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
		const envName = session.modelRegistry.getProviderRuntimeApiKeyEnvName(provider);
		return {
			kind: "api_key",
			layer: "runtime",
			label: envName ? `API key (env ${envName})` : "API key (runtime override)",
		};
	}
	if (session.modelRegistry.hasRuntimeProviderApiKey(provider)) {
		const envName = session.modelRegistry.getProviderRuntimeApiKeyEnvName(provider);
		return {
			kind: "api_key",
			layer: "runtime",
			label: envName ? `API key (env ${envName})` : "API key (runtime provider)",
		};
	}
	if (authStorage.hasConfigApiKey(provider, owner)) {
		const envName = session.modelRegistry.getProviderConfigApiKeyEnvName(provider);
		if (!authStorage.hasLiteralConfigApiKey(provider, owner)) {
			const rowId = authStorage.getProspectiveApiKeyCredentialRowId(provider, sessionId, { owner });
			const storedLabel = storedApiKeyLabel(entries, rowId);
			if (storedLabel) return { kind: "api_key", layer: "stored", label: storedLabel };
		}
		return {
			kind: "api_key",
			layer: "config",
			label: envName ? `API key (env ${envName})` : "API key (models.yml)",
		};
	}
	const rowId = authStorage.getProspectiveApiKeyCredentialRowId(provider, sessionId, { owner });
	const storedLabel = storedApiKeyLabel(entries, rowId);
	if (storedLabel) return { kind: "api_key", layer: "stored", label: storedLabel };

	const envProvider = resolveOAuthStorageProvider(provider);
	const envSource = getEnvApiKeyCredentialSource(envProvider);
	if (envSource) return { kind: "api_key", layer: "environment", label: environmentSourceLabel(envSource) };
	return { kind: "api_key", layer: "fallback", label: "API key (configured)" };
}

/** Format credential provenance for `/provider status` without returning credential values. */
export function buildProviderAuthStatusText(session: ProviderAuthStatusSession): string {
	const { modelRegistry } = session;
	const authStorage = modelRegistry.authStorage;
	const owner = modelRegistry.getAuthStorageOwner();
	const snapshot = authStorage.exportSnapshot();
	const providerIds = new Set([
		...modelRegistry.getAll().map(model => model.provider),
		...modelRegistry.getConfiguredProviderIds(),
		...snapshot.credentials.map(entry => entry.provider),
		...listProvidersWithEnvKey(),
	]);
	const providers = [...providerIds]
		.filter(provider => authStorage.hasAuth(provider, session.credentialSessionId, { owner }))
		.sort((left, right) => left.localeCompare(right));
	if (providers.length === 0) return "No configured provider credentials.";

	const lines = ["Provider credentials (active source per provider):"];
	for (const provider of providers) {
		const entries = snapshot.credentials.filter(entry => entry.provider === provider);
		const activeType = authStorage.getEffectiveCredentialType(provider, session.credentialSessionId, { owner });
		const sources = collectSources(provider, entries, modelRegistry, owner);
		const active =
			activeType === "oauth" || activeType === "api_key"
				? activeSource(provider, entries, session, owner, activeType)
				: undefined;
		lines.push(`${sanitizeDisplayLine(provider)}: ${active?.label ?? "credential source unavailable"}`);
		const shadowed = active
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
