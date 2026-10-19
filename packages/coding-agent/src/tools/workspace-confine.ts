import * as fs from "node:fs/promises";
import path from "node:path";
import { pathIsWithin } from "@gajae-code/utils";

/**
 * Lexical confinement for a session opened with `--confine`.
 *
 * The check is lexical, not a realpath jail: a symlink inside the root can still
 * point outside it, and a shell command can name an absolute path without going
 * through this helper. Callers that execute shell text must state that boundary.
 */
export function pathEscapesWorkspace(root: string, candidate: string): boolean {
	const resolvedRoot = path.resolve(root);
	const resolvedCandidate = path.resolve(candidate);
	return resolvedCandidate !== resolvedRoot && !pathIsWithin(resolvedRoot, resolvedCandidate);
}

/** realpath confinement for a directory the process is about to use as cwd. */
export async function directoryEscapesWorkspace(root: string, candidate: string): Promise<boolean> {
	const [realRoot, realCandidate] = await Promise.all([
		fs.realpath(root).catch(() => path.resolve(root)),
		fs.realpath(candidate).catch(() => path.resolve(candidate)),
	]);
	return realCandidate !== realRoot && !pathIsWithin(realRoot, realCandidate);
}
