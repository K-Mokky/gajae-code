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
	>;
};

interface CredentialSource {
	kind: "api_key" | "oauth";
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
	if (!sources.some(existing => existing.kind === source.kind && existing.label === source.label)) {
		sources.push(source);
	}
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
		if (entry.credential.type === "oauth") addSource(sources, { kind: "oauth", label: oauthLabel(entry) });
		else addSource(sources, { kind: "api_key", label: `API key (stored credential id:${entry.id})` });
	}

	const authStorage = registry.authStorage;
	if (authStorage.hasRuntimeApiKey(provider)) {
		const envName = registry.getProviderRuntimeApiKeyEnvName(provider);
		addSource(sources, {
			kind: "api_key",
			label: envName ? `API key (env ${envName})` : "API key (runtime override)",
		});
	}
	if (authStorage.hasConfigApiKey(provider, owner)) {
		const envName = registry.getProviderConfigApiKeyEnvName(provider);
		addSource(sources, {
			kind: "api_key",
			label: envName ? `API key (env ${envName})` : "API key (models.yml)",
		});
	}
	const selectedEnvSource = getEnvApiKeyCredentialSource(envProvider);
	for (const name of getEnvApiKeyEnvNames(envProvider)) {
		const label =
			selectedEnvSource?.kind === "aws" && selectedEnvSource.source === "bearer-token"
				? environmentSourceLabel(selectedEnvSource)
				: environmentCredentialLabel(name);
		addSource(sources, { kind: "api_key", label });
	}
	if (selectedEnvSource && selectedEnvSource.kind !== "environment") {
		addSource(sources, { kind: "api_key", label: environmentSourceLabel(selectedEnvSource) });
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
		const credential = authStorage.getOAuthCredential(provider, sessionId, { owner });
		const rowId = authStorage.getSessionCredentialRowId(provider, sessionId);
		const row = entries.find(
			entry =>
				entry.credential.type === "oauth" && (entry.id === rowId || entry.credential.access === credential?.access),
		);
		return row
			? { kind: "oauth", label: oauthLabel(row) }
			: {
					kind: "oauth",
					label: credential?.accountId
						? `OAuth (account ${displayAccountLabel(credential.accountId)})`
						: credential?.email
							? `OAuth (account ${displayAccountLabel(credential.email)})`
							: "OAuth (stored account)",
				};
	}

	if (authStorage.hasRuntimeApiKey(provider)) {
		const envName = session.modelRegistry.getProviderRuntimeApiKeyEnvName(provider);
		return {
			kind: "api_key",
			label: envName ? `API key (env ${envName})` : "API key (runtime override)",
		};
	}
	if (authStorage.hasConfigApiKey(provider, owner)) {
		const envName = session.modelRegistry.getProviderConfigApiKeyEnvName(provider);
		if (!authStorage.hasLiteralConfigApiKey(provider, owner)) {
			const rowId = authStorage.getSessionCredentialRowId(provider, sessionId);
			const storedKey =
				entries.find(entry => entry.credential.type === "api_key" && entry.id === rowId) ??
				entries.find(entry => entry.credential.type === "api_key");
			if (storedKey) return { kind: "api_key", label: `API key (stored credential id:${storedKey.id})` };
		}
		return {
			kind: "api_key",
			label: envName ? `API key (env ${envName})` : "API key (models.yml)",
		};
	}
	const rowId = authStorage.getSessionCredentialRowId(provider, sessionId);
	const storedKey = entries.find(
		entry => entry.credential.type === "api_key" && (entry.id === rowId || rowId === undefined),
	);
	if (storedKey) return { kind: "api_key", label: `API key (stored credential id:${storedKey.id})` };

	const envProvider = resolveOAuthStorageProvider(provider);
	const envSource = getEnvApiKeyCredentialSource(envProvider);
	if (envSource) return { kind: "api_key", label: environmentSourceLabel(envSource) };
	return { kind: "api_key", label: "API key (configured)" };
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
			? sources.filter(source => source.label !== active.label).map(source => source.label)
			: [];
		if (shadowed.length > 0) lines.push(`  shadowed: ${[...new Set(shadowed)].join(", ")}`);
	}
	return lines.join("\n");
}
