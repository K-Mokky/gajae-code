import * as fs from "node:fs/promises";
import * as path from "node:path";

export type NativeBuildProfile = "local" | "ci" | "dist";

type ArtifactManifest = {
	version?: string;
	artifacts?: Record<string, string>;
};

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
