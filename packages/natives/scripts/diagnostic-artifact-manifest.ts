import * as fs from "node:fs/promises";
import * as path from "node:path";

export type NativeBuildProfile = "local" | "ci" | "dist";

type ArtifactManifest = {
	schema?: string;
	version?: string;
	artifacts?: Record<string, string>;
};

/**
 * Verify an addon against the manifest appropriate to its build profile and return
 * the verified digest for inclusion in a compiled binary's diagnostic trust record.
 * Local addons are admitted only for explicit embedding builds and only when their
 * bytes match the gitignored local manifest.
 */
export async function verifyDiagnosticArtifactDigest(options: {
	addonPath: string;
	nativeDir: string;
	version: string;
	allowLocalBuilds: boolean;
}): Promise<string> {
	const { addonPath, nativeDir, version, allowLocalBuilds } = options;
	const addon = path.basename(addonPath);
	const metadataPath = `${addonPath}.build.json`;
	const metadata = (await Bun.file(metadataPath).exists())
		? ((await Bun.file(metadataPath).json()) as { profile?: string })
		: undefined;
	const localBuild = metadata?.profile === "local";
	if (localBuild && !allowLocalBuilds) {
		throw new Error(`${addon} is a local build and is not eligible for trusted verification`);
	}

	const manifestPath = path.join(
		nativeDir,
		localBuild ? "diagnostic-artifact.local.json" : "diagnostic-artifact.json",
	);
	if (!(await Bun.file(manifestPath).exists())) {
		throw new Error(`${addon} has no ${localBuild ? "local" : "trusted"} diagnostic artifact manifest`);
	}
	const manifest = (await Bun.file(manifestPath).json()) as ArtifactManifest;
	if (manifest.schema !== "gjc.diagnostic-artifact" || manifest.version !== version) {
		throw new Error(
			`${addon} has an invalid or stale ${localBuild ? "local" : "trusted"} diagnostic artifact manifest`,
		);
	}
	const expected = manifest.artifacts?.[addon];
	if (typeof expected !== "string" || !/^[0-9a-f]{64}$/.test(expected)) {
		throw new Error(`${addon} has no usable ${localBuild ? "local" : "trusted"} diagnostic artifact digest`);
	}
	const actual = new Bun.CryptoHasher("sha256").update(await Bun.file(addonPath).bytes()).digest("hex");
	if (actual !== expected) {
		throw new Error(
			`${addon} bytes do not match the ${localBuild ? "local" : "trusted"} digest (${actual} != ${expected})`,
		);
	}
	return expected;
}

/**
 * Record the digest for the native build. Local builds use a gitignored manifest;
 * CI and distribution builds update the package-owned trusted manifest and emit the
 * provenance sidecars consumed by the release packaging pipeline.
 */
export async function recordDiagnosticArtifactDigest(options: {
	addonPath: string;
	nativeDir: string;
	packageJsonPath: string;
	profile: NativeBuildProfile;
}): Promise<void> {
	const { addonPath, nativeDir, packageJsonPath, profile } = options;
	const localBuild = profile === "local";
	const manifestPath = path.join(
		nativeDir,
		localBuild ? "diagnostic-artifact.local.json" : "diagnostic-artifact.json",
	);
	const digest = new Bun.CryptoHasher("sha256").update(await Bun.file(addonPath).bytes()).digest("hex");
	const existing = (await Bun.file(manifestPath).exists())
		? ((await Bun.file(manifestPath).json()) as ArtifactManifest)
		: {};
	const { version } = (await Bun.file(packageJsonPath).json()) as { version: string };
	const artifacts = existing.version === version ? { ...(existing.artifacts ?? {}) } : {};
	// Preserve pre-existing local variants during manifest migration: if bootstrapping a new local
	// manifest (artifacts is empty), scan for other local-profile variants on disk and include them.
	// This ensures that when the version changes and only one variant rebuilds first, the manifest
	// still tracks all present local addons, preventing verification failures when embed-native
	// later checks for addons that exist on disk but aren't in the manifest.
	if (localBuild && Object.keys(artifacts).length === 0) {
		const entries = await fs.readdir(nativeDir);
		for (const entry of entries) {
			if (!entry.endsWith(".node")) continue;
			const variantPath = path.join(nativeDir, entry);
			const sidecarPath = `${variantPath}.build.json`;
			const sidecar = (await Bun.file(sidecarPath).exists())
				? ((await Bun.file(sidecarPath).json()) as { profile?: string })
				: undefined;
			if (sidecar?.profile === "local" && entry !== path.basename(addonPath)) {
				const variantDigest = new Bun.CryptoHasher("sha256")
					.update(await Bun.file(variantPath).bytes())
					.digest("hex");
				artifacts[entry] = variantDigest;
			}
		}
	}
	artifacts[path.basename(addonPath)] = digest;
	await Bun.write(
		manifestPath,
		`${JSON.stringify({ schema: "gjc.diagnostic-artifact", version, artifacts }, null, 2)}\n`,
	);

	if (localBuild) {
		// A prior CI build may have left provenance beside this same addon filename.
		await fs.rm(`${addonPath}.provenance.json`, { force: true });
	} else {
		// Release addons travel to other checkouts as bare `.node` uploads, so the digest
		// travels beside each artifact and `scripts/verify-diagnostic-artifact-provenance.ts`
		// rebuilds the trusted record there from these sidecars.
		await Bun.write(
			`${addonPath}.provenance.json`,
			`${JSON.stringify(
				{
					schema: "gjc.diagnostic-artifact-provenance",
					version,
					artifact: path.basename(addonPath),
					sha256: digest,
				},
				null,
				2,
			)}\n`,
		);
	}

	console.log(
		`Recorded ${localBuild ? "local " : "trusted "}diagnostic artifact digest for ${path.basename(addonPath)}`,
	);
}
