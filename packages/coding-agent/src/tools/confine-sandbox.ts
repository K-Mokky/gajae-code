import * as path from "node:path";

const PROFILE_PATH = /^[A-Za-z0-9._/-]+$/;

/**
 * macOS Seatbelt profile for a confined session.
 *
 * The shell process and everything it spawns may read the system (so compilers
 * and interpreters keep working) but may not read or write anything beside or
 * above the session root. Writes are limited to that root and the system temp
 * directories. This is a process boundary, not a promise about other host
 * processes the user starts themselves.
 */
export function confineSandboxProfile(root: string): string {
	const confinedRoot = seatbeltPath(root);
	const parent = seatbeltPath(path.dirname(confinedRoot));
	return [
		"(version 1)",
		"(allow default)",
		"(deny file-read* (subpath \"/\"))",
		"(deny file-read* (require-all (subpath \"/\") (vnode-type SYMLINK)))",
		`(allow file-read* (subpath ${quote(confinedRoot)}))`,
		'(allow file-read* (literal "/"))',
		'(allow file-read* (subpath "/bin"))',
		'(allow file-read* (subpath "/usr"))',
		'(allow file-read* (subpath "/opt"))',
		'(allow file-read* (subpath "/System"))',
		'(allow file-read* (subpath "/Library"))',
		'(allow file-read* (subpath "/private"))',
		'(allow file-read* (subpath "/var"))',
		'(allow file-read* (subpath "/Applications"))',
		'(allow file-read* (subpath "/dev"))',
		'(allow file-read* (subpath "/tmp"))',
		"(deny file-write*)",
		`(allow file-write* (subpath ${quote(confinedRoot)}))`,
		'(allow file-write* (subpath "/private/tmp"))',
		'(allow file-write* (subpath "/tmp"))',
		'(allow file-write* (subpath "/private/var/folders"))',
	].join("\n");
}

export function sandboxExecAvailable(): boolean {
	return process.platform === "darwin";
}

/**
 * Run `command` inside the confined-session sandbox.
 * The wrapper is a single quoted argument, so metacharacters in the command
 * stay inside the sandboxed process instead of being parsed by the outer shell.
 */
export function sandboxedShellCommand(command: string, root: string): string {
	if (!sandboxExecAvailable()) {
		throw new Error(
			`Confined sessions require a process sandbox, which this build only provides on macOS (got ${process.platform}).`,
		);
	}
	return `sandbox-exec -p ${shellQuote(confineSandboxProfile(root))} /bin/sh -c ${shellQuote(command)}`;
}

function seatbeltPath(value: string): string {
	const resolved = path.resolve(value);
	if (!PROFILE_PATH.test(resolved)) {
		throw new Error(`Confined session root cannot be expressed in a sandbox profile: ${resolved}`);
	}
	return resolved;
}

function quote(value: string): string {
	return JSON.stringify(value);
}

function shellQuote(value: string): string {
	return `'${value.replaceAll("'", "'\\''")}'`;
}
