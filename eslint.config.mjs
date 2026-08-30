import js from "@eslint/js";
import prettier from "eslint-config-prettier";
import globals from "globals";
import tseslint from "typescript-eslint";

/**
 * Lint rules, kept deliberately small.
 *
 * Formatting is not here at all — `eslint-config-prettier` comes last and switches off every rule
 * that has an opinion about layout, so `.prettierrc.json` is the only thing with a view on it and
 * the two cannot disagree. What is left is the class of thing a formatter cannot see: a promise
 * nobody awaited, a variable nobody read, a comparison that can only go one way.
 *
 * The type-aware rules are the point of having a linter in a project this size, and they need a
 * TypeScript program — `tsconfig.test.json`, which is the one that covers the tests as well as the
 * source. `.mjs` tooling is checked with the plain rules, because it is in no tsconfig and pulling
 * it into one to satisfy the linter would be the tail wagging the dog.
 */
export default tseslint.config(
	{
		ignores: [
			"com.matewishkey.dial-countdown-v2.sdPlugin/bin/**",
			// Vendored third party, shipped as its author wrote it.
			"com.matewishkey.dial-countdown-v2.sdPlugin/ui/sdpi-components.js"
		]
	},

	js.configs.recommended,

	{
		files: ["src/**/*.ts", "test/**/*.ts"],
		extends: [tseslint.configs.recommendedTypeChecked],
		languageOptions: {
			parserOptions: {
				project: ["./tsconfig.test.json"],
				tsconfigRootDir: import.meta.dirname
			}
		},
		rules: {
			// `void something()` is used throughout to say "deliberately not awaited", and is clearer
			// than a comment because it cannot drift away from the call it describes.
			//
			// `describe`/`it` return promises the test runner owns, and awaiting them is not how the
			// API is meant to be used — without this exemption the rule reports every test in the
			// suite and buys nothing. Named explicitly rather than switched off for `test/**`, so a
			// genuinely dropped promise inside a test is still caught.
			"@typescript-eslint/no-floating-promises": [
				"error",
				{
					ignoreVoid: true,
					allowForKnownSafeCalls: [
						{
							from: "package",
							package: "node:test",
							name: ["describe", "it", "before", "after", "beforeEach", "afterEach"]
						}
					]
				}
			],
			"@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_" }]
		}
	},

	{
		files: ["**/*.mjs"],
		languageOptions: {
			ecmaVersion: "latest",
			sourceType: "module",
			globals: globals.node
		}
	},

	prettier
);
