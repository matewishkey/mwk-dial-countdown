/**
 * The reproducible identity of a packaged plugin.
 *
 * `tools/package-id.mjs` exists because the `.streamDeckPlugin`'s own sha256 is not reproducible:
 * `streamdeck pack` writes the moment of packing into every zip entry, so two packs of a
 * byte-identical tree differ. Measured on the real thing — 21 of 21 entries with matching content,
 * 21 of 21 with differing timestamps.
 *
 * The archives here are built by hand rather than by packing the plugin, for two reasons. A test
 * that shells out to `streamdeck pack` is slow and needs a build; and building the bytes is the only
 * way to control what is being asserted — the same content in a different order, the same paths with
 * different content, a directory entry, a stored entry beside a deflated one. None of those can be
 * arranged by packing a directory.
 */

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { describe, it } from "node:test";
import { deflateRawSync } from "node:zlib";

import { contentId, entries } from "../tools/package-id.mjs";

type When = [number, number];
type Entry = { path: string; content: string; deflate?: boolean; when?: When };

/**
 * A minimal zip, written by hand.
 *
 * `when` is the DOS date/time pair, and it is a parameter because it is the whole point: two
 * archives that differ only in `when` must produce the same content id.
 */
function zip(items: Entry[]): Buffer {
	const locals: Buffer[] = [];
	const centrals: Buffer[] = [];
	let offset = 0;

	for (const item of items) {
		const { path, content, deflate = false } = item;
		const when: When = item.when ?? [0x4a21, 0x8b40];
		const raw = Buffer.from(content, "utf8");
		const stored = deflate ? deflateRawSync(raw) : raw;
		const name = Buffer.from(path, "utf8");

		// The crc is left at zero: the reader hashes the bytes it inflates rather than trusting a
		// checksum written by whoever made the archive, so it never reads this field.
		const local = Buffer.alloc(30 + name.length);
		local.writeUInt32LE(0x04034b50, 0);
		local.writeUInt16LE(deflate ? 8 : 0, 8);
		local.writeUInt16LE(when[1], 10);
		local.writeUInt16LE(when[0], 12);
		local.writeUInt32LE(stored.length, 18);
		local.writeUInt32LE(raw.length, 22);
		local.writeUInt16LE(name.length, 26);
		name.copy(local, 30);

		const central = Buffer.alloc(46 + name.length);
		central.writeUInt32LE(0x02014b50, 0);
		central.writeUInt16LE(deflate ? 8 : 0, 10);
		central.writeUInt16LE(when[1], 12);
		central.writeUInt16LE(when[0], 14);
		central.writeUInt32LE(stored.length, 20);
		central.writeUInt32LE(raw.length, 24);
		central.writeUInt16LE(name.length, 28);
		central.writeUInt32LE(offset, 42);
		name.copy(central, 46);

		locals.push(local, stored);
		centrals.push(central);
		offset += local.length + stored.length;
	}

	const directory = Buffer.concat(centrals);
	const end = Buffer.alloc(22);
	end.writeUInt32LE(0x06054b50, 0);
	end.writeUInt16LE(items.length, 8);
	end.writeUInt16LE(items.length, 10);
	end.writeUInt32LE(directory.length, 12);
	end.writeUInt32LE(offset, 16);

	return Buffer.concat([...locals, directory, end]);
}

const PLUGIN: Entry[] = [
	{ path: "x.sdPlugin/manifest.json", content: '{"Name":"x"}' },
	{ path: "x.sdPlugin/bin/plugin.js", content: "console.log(1);", deflate: true }
];

describe("reading a packaged plugin", () => {
	it("lists every file, with its content hash and size", () => {
		const found = entries(zip(PLUGIN));

		assert.deepEqual(
			found.map((entry) => entry.path),
			["x.sdPlugin/manifest.json", "x.sdPlugin/bin/plugin.js"]
		);
		assert.equal(found[0].bytes, 12);
		assert.equal(found[0].sha256, createHash("sha256").update('{"Name":"x"}').digest("hex"));
	});

	it("inflates a deflated entry rather than hashing the compressed bytes", () => {
		// The one that would go unnoticed: hashing compressed bytes still produces a stable id, so the
		// tool would look like it worked while comparing the wrong thing across compression settings.
		const [, script] = entries(zip(PLUGIN));

		assert.equal(script.sha256, createHash("sha256").update("console.log(1);").digest("hex"));
		assert.equal(script.bytes, 15);
	});

	it("leaves directory entries out, since they are structure and not content", () => {
		assert.equal(entries(zip([{ path: "x.sdPlugin/", content: "" }, ...PLUGIN])).length, 2);
	});

	it("refuses anything that is not a zip, rather than returning an empty listing", () => {
		// An empty listing would hash to a perfectly stable id, and two unrelated broken files would
		// then "match". Failing loudly is the only safe answer.
		assert.throws(() => entries(Buffer.from("not a zip at all")), /not a zip file/);
	});
});

describe("the content id", () => {
	it("ignores timestamps, which is the entire reason it exists", () => {
		const early = zip(PLUGIN.map((entry) => ({ ...entry, when: [0x0021, 0x0000] as When })));
		const late = zip(PLUGIN.map((entry) => ({ ...entry, when: [0x5a21, 0xbb40] as When })));

		assert.notEqual(early.toString("hex"), late.toString("hex"), "precondition: the archives really do differ");
		assert.equal(contentId(early), contentId(late));
	});

	it("ignores the order the archive happens to list files in", () => {
		assert.equal(contentId(zip(PLUGIN)), contentId(zip([...PLUGIN].reverse())));
	});

	it("changes when any file's content changes", () => {
		// The positive control for every test above. An id that never moved would pass all of them.
		assert.notEqual(contentId(zip(PLUGIN)), contentId(zip([PLUGIN[0], { ...PLUGIN[1], content: "console.log(2);" }])));
	});

	it("changes when a file is renamed, even though the bytes are the same", () => {
		const renamed = [{ ...PLUGIN[0], path: "x.sdPlugin/manifest.json.bak" }, PLUGIN[1]];

		assert.notEqual(contentId(zip(PLUGIN)), contentId(zip(renamed)));
	});

	it("cannot be fooled by a path that runs into the next entry's hash", () => {
		// The separator between path and hash earns its place here. Joining them with nothing would
		// let two different archives produce the same string to hash.
		const plain = contentId(
			zip([
				{ path: "a", content: "1" },
				{ path: "b", content: "2" }
			])
		);
		const shifted = contentId(
			zip([
				{ path: "a b", content: "1" },
				{ path: "", content: "2" }
			])
		);

		assert.notEqual(plain, shifted);
	});
});
