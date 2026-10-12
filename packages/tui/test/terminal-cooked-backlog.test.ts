/**
 * Keys typed while gjc is still starting up are read by the cooked TTY line
 * discipline, whose ICRNL turns Enter into LF. Once ProcessTerminal switches to
 * raw mode that backlog arrives as the first stdin read, and a lone LF is the
 * editor's Shift+Enter newline mapping, so type-ahead never submitted.
 */
import { afterEach, describe, expect, it, vi } from "bun:test";
import { ProcessTerminal } from "@gajae-code/tui/terminal";

const stdinIsTtyDescriptor = Object.getOwnPropertyDescriptor(process.stdin, "isTTY");
const stdinIsRawDescriptor = Object.getOwnPropertyDescriptor(process.stdin, "isRaw");
const stdoutIsTtyDescriptor = Object.getOwnPropertyDescriptor(process.stdout, "isTTY");
const stdinSetRawModeDescriptor = Object.getOwnPropertyDescriptor(process.stdin, "setRawMode");

function restoreProperty(target: object, key: string, descriptor: PropertyDescriptor | undefined): void {
	if (descriptor) {
		Object.defineProperty(target, key, descriptor);
		return;
	}
	delete (target as Record<string, unknown>)[key];
}

function mockTty(isRaw: boolean): void {
	Object.defineProperty(process.stdin, "isTTY", { value: true, configurable: true });
	Object.defineProperty(process.stdin, "isRaw", { value: isRaw, configurable: true });
	Object.defineProperty(process.stdout, "isTTY", { value: true, configurable: true });
	Object.defineProperty(process.stdin, "setRawMode", { value: vi.fn(), configurable: true });
	vi.spyOn(process, "kill").mockReturnValue(true);
	vi.spyOn(process.stdin, "resume").mockImplementation(() => process.stdin);
	vi.spyOn(process.stdin, "pause").mockImplementation(() => process.stdin);
	vi.spyOn(process.stdout, "write").mockImplementation(() => true);
}

const sleep = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms));

async function feed(...chunks: Buffer[]): Promise<void> {
	for (const chunk of chunks) {
		process.stdin.emit("data", chunk);
		await sleep(30);
	}
}

describe.skipIf(process.platform === "win32")("ProcessTerminal cooked type-ahead", () => {
	let terminal: ProcessTerminal | undefined;
	let received: string[] = [];

	function start(isRaw: boolean): void {
		mockTty(isRaw);
		received = [];
		terminal = new ProcessTerminal();
		terminal.start(
			data => received.push(data),
			() => {},
		);
	}

	afterEach(() => {
		terminal?.stop();
		terminal = undefined;
		vi.restoreAllMocks();
		restoreProperty(process.stdin, "isTTY", stdinIsTtyDescriptor);
		restoreProperty(process.stdin, "isRaw", stdinIsRawDescriptor);
		restoreProperty(process.stdout, "isTTY", stdoutIsTtyDescriptor);
		restoreProperty(process.stdin, "setRawMode", stdinSetRawModeDescriptor);
	});

	it("submits a line typed before raw mode", async () => {
		start(false);
		await feed(Buffer.from("hi 안녕\n"));
		expect(received).toEqual(["h", "i", " ", "안", "녕", "\r"]);
	});

	it("keeps earlier backlog newlines and submits once", async () => {
		start(false);
		await feed(Buffer.from("a\nb\n"));
		expect(received).toEqual(["a", "\n", "b", "\r"]);
	});

	it("leaves later LF keystrokes as newlines", async () => {
		start(false);
		await feed(Buffer.from("x"), Buffer.from("\n"));
		expect(received).toEqual(["x", "\n"]);
	});

	it("does not rewrite input when the terminal was already raw", async () => {
		start(true);
		await feed(Buffer.from("\n"));
		expect(received).toEqual(["\n"]);
	});

	it("does not convert bare LF from raw mode to CR (empty cooked startup)", async () => {
		// Critical case: no input during cooked startup, first raw keystroke is
		// Shift+Enter (which sends LF in raw mode). This must remain a newline,
		// not be converted to CR and submitted.
		start(false);
		await feed(Buffer.from("\n"));
		expect(received).toEqual(["\n"]);
	});
});
