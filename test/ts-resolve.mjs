/**
 * Lets the tests import the source as the bundler sees it.
 *
 * Two jobs, and the second one is why the actions are testable at all.
 *
 * **Resolution.** `src/` is written for rollup, whose resolver fills in the extension — so a module
 * says `from "./step"`. Node's ESM resolver deliberately does no such thing, which is fine for the
 * shipped bundle (there is only one file by then) but stops a test from loading anything that
 * imports a sibling.
 *
 * **Compilation.** Node's own type stripping erases types and leaves everything else standing,
 * including decorators — so `import`ing `dial-countdown.ts` was a `SyntaxError`, and for months
 * the rule here was that a test could not reach either action subclass at all. Everything about
 * what the user *sees* lived inside them, which is how a ringing state shipped in 4.1.0 that the
 * screen never showed: no test could have caught it, and nobody said so out loud.
 *
 * That was never a limit of the Stream Deck SDK — it imports in 73 ms and needs no connection. It
 * was the transform. So this compiles with TypeScript's own `transpileModule`, reading the same
 * `tsconfig.json` rollup reads, and the constraint is gone: the tests and the shipped bundle now
 * come out of the same compiler. `transpileModule` does not typecheck, which is correct here —
 * `npm run typecheck` is a separate step over a wider set of files.
 */

import { readFileSync } from "node:fs";
import { register } from "node:module";
import { fileURLToPath } from "node:url";

import ts from "typescript";

const { config } = ts.readConfigFile("tsconfig.json", ts.sys.readFile);
const { options } = ts.parseJsonConfigFileContent(config, ts.sys, ".");

/** Compiled output, keyed by file URL. One test process imports the same module more than once. */
const cache = new Map();

/** @type {import("node:module").ResolveHook} */
export async function resolve(specifier, context, next) {
	if (specifier.startsWith(".") && !/\.[cm]?[jt]s$/.test(specifier)) {
		try {
			return await next(`${specifier}.ts`, context);
		} catch {
			// Not a TypeScript sibling after all — let the real resolver report whatever it is.
		}
	}

	return next(specifier, context);
}

/** @type {import("node:module").LoadHook} */
export async function load(url, context, next) {
	if (!url.endsWith(".ts")) {
		return next(url, context);
	}

	let source = cache.get(url);
	if (source === undefined) {
		const fileName = fileURLToPath(url);
		({ outputText: source } = ts.transpileModule(readFileSync(fileName, "utf8"), {
			compilerOptions: { ...options, module: ts.ModuleKind.ESNext, sourceMap: false, declaration: false },
			fileName
		}));
		cache.set(url, source);
	}

	return { format: "module", shortCircuit: true, source };
}

register(import.meta.url);
