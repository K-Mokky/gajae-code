import { describe, expect, it } from "bun:test";
import { bigintIdentityMatchesNumeric } from "../src/discovery/helpers";

describe("bigintIdentityMatchesNumeric", () => {
	it("matches a 64-bit file ID that a plain stat rounded to a double", () => {
		// NTFS file IDs routinely exceed 2^53; a plain fs.stat reports the rounded double.
		const exact = { dev: 3_430_812_034n, ino: 2n ** 60n + 12_345n };
		const plainStat = { dev: Number(exact.dev), ino: Number(exact.ino) };

		expect(BigInt(plainStat.ino)).not.toBe(exact.ino);
		expect(bigintIdentityMatchesNumeric(exact, plainStat)).toBe(true);
	});

	it("rejects a different directory", () => {
		const exact = { dev: 7n, ino: 42n };
		expect(bigintIdentityMatchesNumeric(exact, { dev: 7, ino: 43 })).toBe(false);
		expect(bigintIdentityMatchesNumeric(exact, { dev: 8, ino: 42 })).toBe(false);
	});

	it("rejects a large file ID beyond double rounding distance", () => {
		const exact = { dev: 1n, ino: 2n ** 60n };
		expect(bigintIdentityMatchesNumeric(exact, { dev: 1, ino: Number(2n ** 60n + 4096n) })).toBe(false);
	});
});
