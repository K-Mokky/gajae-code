import { describe, expect, it } from "bun:test";
import { sessionMatchesConfinement } from "../src/session/session-confinement";

describe("--confine session selection", () => {
	it("keeps a confined transcript out of an ordinary resume match", () => {
		expect(sessionMatchesConfinement({ filesystemScope: "cwd" }, true)).toBe(true);
		expect(sessionMatchesConfinement({ filesystemScope: "cwd" }, false)).toBe(false);
		expect(sessionMatchesConfinement({}, false)).toBe(true);
		expect(sessionMatchesConfinement({}, true)).toBe(false);
	});
});
