/**
 * Lets the tests import the source as the bundler sees it.
 *
 * `src/` is written for rollup, whose resolver fills in the extension — so a module says
 * `from "./acceleration"`. Node's ESM resolver deliberately does no such thing, which is fine for
 * the shipped bundle (there is only one file by then) but stops a test from loading anything that
 * imports a sibling. This hook does the one thing rollup does and Node does not.
 */

import { register } from "node:module";

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

register(import.meta.url);
