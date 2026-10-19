import * as fs from "node:fs/promises";
import path from "node:path";
import { pathIsWithin } from "@gajae-code/utils";

/**
 * Confinement for a session opened with `--confine`.
 *
 * Existing paths are checked after symlink resolution. A path that does not
 * exist yet is checked at its nearest existing ancestor, so creating
 * `root/link/new` is rejected when `link` points outside the root.
 */
export function pathEscapesWorkspace(root: string, candidate: string): boolean {
	const resolvedRoot = path.resolve(root);
	const resolvedCandidate = path.resolve(candidate);
	return resolvedCandidate !== resolvedRoot && !pathIsWithin(resolvedRoot, resolvedCandidate);
}

async function nearestExistingPath(candidate: string): Promise<string> {
	let current = path.resolve(candidate);
	for (;;) {
		try {
			await fs.lstat(current);
			return current;
		} catch (error) {
			const missing = (error as NodeJS.ErrnoException).code === "ENOENT";
			const parent = path.dirname(current);
			if (!missing || parent === current) throw error;
			current = parent;
		}
	}
}

/** True when `candidate` resolves, through symlinks, outside `root`. */
export async function realpathEscapesWorkspace(root: string, candidate: string): Promise<boolean> {
	const [realRoot, existing] = await Promise.all([
		fs.realpath(root).catch(() => path.resolve(root)),
		nearestExistingPath(candidate),
	]);
	const realCandidate = await fs.realpath(existing).catch(() => existing);
	const suffix = path.relative(existing, path.resolve(candidate));
	const resolved = suffix ? path.resolve(realCandidate, suffix) : realCandidate;
	return resolved !== realRoot && !pathIsWithin(realRoot, resolved);
}

/** realpath confinement for a directory the process is about to use as cwd. */
export async function directoryEscapesWorkspace(root: string, candidate: string): Promise<boolean> {
	return realpathEscapesWorkspace(root, candidate);
}
