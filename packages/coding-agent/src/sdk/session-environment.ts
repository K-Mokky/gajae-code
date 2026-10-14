export interface SessionLaunchEnvironment {
	readonly env?: Readonly<Record<string, string>>;
	readonly unsetEnv?: readonly string[];
}

export interface SessionEnvironmentNames {
	readonly set: string[];
	readonly unset: string[];
}

const ENV_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/u;
const RESERVED_ENV_PREFIX = /^(?:GJC_|PI_)/iu;
const MAX_ENV_ENTRIES = 100;
const MAX_ENV_VALUE_LENGTH = 32_768;
const MAX_ENV_BYTES = 256 * 1024;

function isPlainRecord(value: unknown): value is Record<string, unknown> {
	if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
	const prototype = Object.getPrototypeOf(value);
	return prototype === Object.prototype || prototype === null;
}

function isValidEnvironmentName(name: string): boolean {
	return name.length <= 255 && ENV_NAME_PATTERN.test(name) && !RESERVED_ENV_PREFIX.test(name);
}

/** Validates caller-controlled session subprocess environment fields at the broker boundary. */
export function isValidSessionLaunchEnvironment(env: unknown, unsetEnv: unknown): boolean {
	if (env !== undefined && !isPlainRecord(env)) return false;
	if (unsetEnv !== undefined && !Array.isArray(unsetEnv)) return false;

	const setNames = new Set<string>();
	let totalBytes = 0;
	if (env !== undefined) {
		const entries = Object.entries(env);
		if (entries.length > MAX_ENV_ENTRIES) return false;
		for (const [name, value] of entries) {
			const normalizedName = name.toUpperCase();
			if (
				!isValidEnvironmentName(name) ||
				setNames.has(normalizedName) ||
				typeof value !== "string" ||
				value.length > MAX_ENV_VALUE_LENGTH ||
				value.includes("\0")
			)
				return false;
			setNames.add(normalizedName);
			totalBytes += Buffer.byteLength(name, "utf8") + Buffer.byteLength(value, "utf8");
			if (totalBytes > MAX_ENV_BYTES) return false;
		}
	}
	if (unsetEnv !== undefined) {
		if (unsetEnv.length > MAX_ENV_ENTRIES) return false;
		const unsetNames = new Set<string>();
		for (const name of unsetEnv) {
			if (typeof name !== "string" || !isValidEnvironmentName(name)) return false;
			const normalizedName = name.toUpperCase();
			if (unsetNames.has(normalizedName) || setNames.has(normalizedName)) return false;
			unsetNames.add(normalizedName);
			totalBytes += Buffer.byteLength(name, "utf8");
			if (totalBytes > MAX_ENV_BYTES) return false;
		}
	}
	return true;
}

export function sessionLaunchEnvironment(env: unknown, unsetEnv: unknown): SessionLaunchEnvironment | undefined {
	if (!isValidSessionLaunchEnvironment(env, unsetEnv)) throw new Error("Session launch environment is invalid.");
	if (env === undefined && unsetEnv === undefined) return undefined;
	return {
		...(env === undefined ? {} : { env: Object.fromEntries(Object.entries(env as Record<string, string>)) }),
		...(unsetEnv === undefined ? {} : { unsetEnv: [...(unsetEnv as string[])] }),
	};
}

/** Applies the validated launch overlay to an isolated session host's child environment. */
export function applySessionLaunchEnvironment(
	environment: Record<string, string | undefined>,
	launchEnvironment: SessionLaunchEnvironment | undefined,
): void {
	if (!launchEnvironment) return;
	for (const name of launchEnvironment.unsetEnv ?? []) delete environment[name];
	for (const [name, value] of Object.entries(launchEnvironment.env ?? {}))
		Object.defineProperty(environment, name, { configurable: true, enumerable: true, value, writable: true });
}

export function sessionEnvironmentNames(environment: SessionLaunchEnvironment): SessionEnvironmentNames {
	return {
		set: Object.keys(environment.env ?? {}).sort(),
		unset: [...(environment.unsetEnv ?? [])].sort(),
	};
}
