# Notices

The plugin is [MIT licensed](LICENSE). Two things that licence does not cover:

The Mate Wish Key name, logo and brand colours are trademarks of Mate Wish Key
and are NOT covered by the MIT licence above. The mark itself is supplied
artwork, kept at `assets/mwk-mark.svg`; `tools/make-icons.mjs` reads it and
`src/render.ts` carries the same two paths as a literal, because it is bundled
and cannot read from disk at runtime.

If you fork this plugin, replace that file, the generated artwork in
`com.matewishkey.dial-countdown.sdPlugin/imgs/`, the `mwk` theme and the mark
in `src/render.ts` with your own, and change the plugin UUID in `manifest.json`
so your build does not collide with this one.

`ui/sdpi-components.js` is Elgato's Stream Deck property inspector component
library, vendored here for offline use, and is distributed under its own
licence: https://github.com/geekyeggo/sdpi-components

Everything else is MIT, including the bundled sounds in `sounds/`, which were
generated for this project.
