#!/usr/bin/env node
/**
 * A reproducible identity for a packaged plugin.
 *
 * **The `.streamDeckPlugin`'s own sha256 is not reproducible, and cannot be made so.** `streamdeck
 * pack` writes the moment of packing into every zip entry's mtime, so two packs of a byte-identical
 * tree produce two different files. Measured: 21 of 21 entries with identical content hashes,
 * identical order and identical compression, and 21 of 21 with different timestamps. `touch`ing the
 * source tree first does not help — the stamp is the pack time, not the file's.
 *
 * So the container hash answers only "is this the same *file* I built", which is worth knowing about
 * an upload and worth nothing about a build. **The content id answers "is this the same *plugin*"**:
 * sha256 over every entry's path and content, sorted, with the timestamps that carry no meaning left
 * out. Same tree in, same id out, on any machine and at any hour.
 *
 * That is the check `docs/releasing.md` needs and could not have: its "is this change a release?"
 * procedure unzipped two builds into temp directories and ran `diff -rq`, which needs `unzip` — not
 * installed on this dev box, where a `diff` of two directories that failed to populate reports them
 * as identical. A comparison that cannot fail is not a comparison.
 *
 *   node tools/package-id.mjs <file.streamDeckPlugin> [--list]
 *
 * No dependencies, and deliberately none: this is the thing that says two builds agree, so it must
 * not itself be a package that could change what it means between releases.
 */

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { inflateRawSync } from "node:zlib";

const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_SIGNATURE = 0x02014b50;
const LOCAL_SIGNATURE = 0x04034b50;

const STORED = 0;
const DEFLATED = 8;

/**
 * Every file in the archive, as `{ path, sha256, bytes }`, in the order the archive lists them.
 *
 * Read through the central directory rather than by scanning for local headers, because the central
 * directory is the archive's own index of itself — scanning would find anything that happened to
 * look like a header inside compressed data.
 */
/**
 * @param {Buffer} zip
 * @returns {{ path: string, sha256: string, bytes: number }[]}
 */
export function entries(zip) {
	const eocd = findEndOfCentralDirectory(zip);
	const count = zip.readUInt16LE(eocd + 10);
	let at = zip.readUInt32LE(eocd + 16);

	if (count === 0xffff || at === 0xffffffff) {
		throw new Error("zip64 archive: this reader handles only the plain format, which is all pack emits");
	}

	const found = [];

	for (let index = 0; index < count; index++) {
		if (zip.readUInt32LE(at) !== CENTRAL_SIGNATURE) {
			throw new Error(`central directory entry ${index} has no signature — the archive is truncated or not a zip`);
		}

		const method = zip.readUInt16LE(at + 10);
		const compressedSize = zip.readUInt32LE(at + 20);
		const nameLength = zip.readUInt16LE(at + 28);
		const extraLength = zip.readUInt16LE(at + 30);
		const commentLength = zip.readUInt16LE(at + 32);
		const localAt = zip.readUInt32LE(at + 42);
		const path = zip.toString("utf8", at + 46, at + 46 + nameLength);

		// Directories are structure, not content, and pack does not always emit them consistently.
		if (!path.endsWith("/")) {
			found.push({ path, ...read(zip, localAt, method, compressedSize) });
		}

		at += 46 + nameLength + extraLength + commentLength;
	}

	return found;
}

/**
 * One entry's bytes, from its local header.
 *
 * The local header's own name and extra lengths are read rather than the central directory's: the
 * two are allowed to differ, and it is the local one that says where this entry's data starts.
 */
/**
 * @param {Buffer} zip
 * @param {number} at
 * @param {number} method
 * @param {number} compressedSize
 * @returns {{ sha256: string, bytes: number }}
 */
function read(zip, at, method, compressedSize) {
	if (zip.readUInt32LE(at) !== LOCAL_SIGNATURE) {
		throw new Error("local file header has no signature — the archive is corrupt");
	}

	const start = at + 30 + zip.readUInt16LE(at + 26) + zip.readUInt16LE(at + 28);
	const raw = zip.subarray(start, start + compressedSize);

	if (method !== STORED && method !== DEFLATED) {
		throw new Error(`unsupported compression method ${method}`);
	}

	const content = method === STORED ? raw : inflateRawSync(raw);
	return { sha256: createHash("sha256").update(content).digest("hex"), bytes: content.length };
}

/** The end-of-central-directory record, searched from the back since a trailing comment may follow it. */
/**
 * @param {Buffer} zip
 * @returns {number}
 */
function findEndOfCentralDirectory(zip) {
	for (let at = zip.length - 22; at >= 0; at--) {
		if (zip.readUInt32LE(at) === EOCD_SIGNATURE) {
			return at;
		}
	}
	throw new Error("no end-of-central-directory record — not a zip file");
}

/**
 * The archive's content id: one hash over what is in it, ignoring when it was packed.
 *
 * Sorted by path, so the id does not depend on the order `pack` happened to walk the tree in. The
 * `\0` between path and hash is what stops two different archives colliding by having a path that
 * ends where another's hash begins.
 */
/**
 * @param {Buffer} zip
 * @returns {string}
 */
export function contentId(zip) {
	const lines = entries(zip)
		.map(({ path, sha256 }) => `${path}\0${sha256}`)
		.sort();
	return createHash("sha256").update(lines.join("\n")).digest("hex");
}

if (import.meta.url === `file://${process.argv[1]}`) {
	const file = process.argv[2];
	if (file === undefined) {
		console.error("usage: node tools/package-id.mjs <file.streamDeckPlugin> [--list]");
		process.exit(1);
	}

	const zip = readFileSync(file);
	if (process.argv.includes("--list")) {
		for (const { path, sha256, bytes } of entries(zip)) {
			console.log(`${sha256}  ${String(bytes).padStart(8)}  ${path}`);
		}
	}
	console.log(contentId(zip));
}
