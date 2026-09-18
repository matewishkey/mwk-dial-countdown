# Changelog

What changed. The user-facing sections are written for whoever installs the plugin; `### Internal`
covers repo-only work — a refactor, a tool, a formatting pass — which travels with the next release
rather than vanishing, and is left out of the Marketplace notes. Format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versioning is explained in
[docs/releasing.md](docs/releasing.md).

Entries under **Unreleased** have landed on `main` but are not in any `.streamDeckPlugin` yet — for
this project that generally means they do not change the packaged plugin at all.

Two things about the shape of this file. **It starts at 0.10.0**: `v0.6.0` through `v0.9.0` are
tagged and released on GitHub but were never written up, and they are left that way rather than
reconstructed from git years later. And **an entry is a record of what shipped**, so it keeps naming
things as they were called at the time — a file mentioned in the 3.2.0 entry may since have been
renamed, and rewriting it would make the history describe a repo that never existed.

## [Unreleased]

## [3.11.0] — 2026-09-18

The fault that prompted most of the last two days was never in this plugin. A Stream Deck + was
drawing **500 mA through a Studio Display's hub** — the documented ceiling for that port, and not
enough for a touchscreen, eight LCD keys and four dials. Moved to a port on the Mac, everything
works: the dials, the keys, and the built-in actions that had also stopped.

So the instrumentation built to find it comes back out. The bug fixes stay, because none of them were
ever about the hardware.

### Removed

- **The per-minute health report, and everything that fed it.** Two timers ran for the life of the
  process — an event-loop sampler twice a second and a report every sixty seconds — writing a line of
  performance telemetry into the log of every install, for ever. A countdown timer does not need to
  file a report about itself once a minute.
- **The round-trip probe**, which sent a message to Stream Deck every minute purely to time the reply.
- **Per-gesture logging.** A line was written for every press, release, turn and tap.
- **The `pressed || down` override on a rotation.** It was borrowed from another plugin on the theory
  that the flag might lag the button, never measured, and a reviewer pointed out it trades a
  self-correcting reading for a latch that stays wrong until the next complete press. No evidence for
  it ever appeared — and the actual cause was three feet of USB away. The rotation's own flag decides
  the step again.

### Changed

- **Copy diagnostics stays, and is leaner.** It costs nothing until it is pressed, and it is what
  makes the next hardware problem ten minutes rather than a day. It now carries **warnings and
  errors** rather than every gesture and a per-minute performance line, and gathers what it needs at
  the moment you press it rather than from a reporter running in the background.

### Kept

For the record, since this release removes a great deal: **the ten fixes from the last two days all
stay.** The paused clock that threw away its count, the no-detent rotation that ate a press, the
duration ratchet, the floor that added time when you turned it down, the repeat tally that ran a
timer six times for a setting of four, the key's press-then-hold firing twice, the stray release
after a page flip, the orphaned long-press timer, the inspector undoing a gesture, and a release gate
that can now actually fail. Every one was reproduced before it was written, and every one is still
caught by deliberately breaking it and watching a test go red.


## [3.10.0] — 2026-09-17

### Added

- **Copy diagnostics now names the Stream Deck application version and the connected device.** Both
  arrive when the plugin starts, in a handshake no user could go and look up — and they are exactly
  what the two most commonly reported causes of an unresponsive Stream Deck turn on.

  ```
  Stream Deck 7.1.0.0 on mac 14.0.0
  devices: Stream Deck + (type 7)
  ```

  When the plugin has not been told, the line is left out entirely rather than printed with question
  marks in it: a line reading `Stream Deck ? on ? ?` looks like an answer.

### Internal

- Researched what is actually reported when a Stream Deck stops responding, prompted by keys from
  *other* plugins failing too. The two recurring answers are **insufficient USB power** — the device
  browns out, restarts without initialising and is left in a bad state, which is why it is usually
  cured by a powered hub or a direct port rather than by any software change — and **an out-of-date
  application**. Neither is a plugin fault, and neither could be advised on without the two facts now
  in the report.

- What the research did *not* support is recorded too: a page offering to fix Stream Deck lag gave
  tidy percentages for each cause, which is the shape of a number written to be quotable rather than
  measured. It is not used here. The one figure that is cited comes from a plugin vendor describing
  their own support queue, and is attributed as that rather than as a fact about anyone's hardware.


## [3.9.1] — 2026-09-17

### Fixed

- **Copy diagnostics now carries Stream Deck's own log as well as this plugin's.** The application
  keeps a separate log, and it is the component every plugin talks through — so when the complaint is
  that the whole machine is slow and other applications are lagging too, its side of the story was in
  a file the report was not reading.

  Its tail is included unfiltered, unlike this plugin's own lines. The format is Elgato's, and picking
  lines out of it would mean guessing which ones matter; twenty-five lines of everything is more
  honest than a filtered view built on an assumption.

### Internal

- **The two logs are known with different confidence, and the report is careful about it.** This
  plugin's log location is *asked of the running process* and cannot be wrong. Stream Deck's is
  *derived* from Elgato's logging guide and therefore can be — so a miss there is reported as an
  absence rather than an error, and on a platform Stream Deck does not run on it says so plainly.

- **Both platform branches are tested from whichever platform the suite runs on.** Otherwise the
  Windows path is never executed on a Mac and the Mac path never on Windows, and the one that is wrong
  is precisely the one nobody ran.

- Two things turned up while reading the documentation, recorded rather than acted on: the docs say a
  plugin's log files "never exceed 10 MiB", while the SDK that actually ships is configured for 50 MB
  — the code is what runs. And the property inspector is Chromium with DOM access, which is why a copy
  button inside it can reach the clipboard at all.


## [3.9.0] — 2026-09-17

### Added

- **A "Copy diagnostics" button in the property inspector.** One press puts everything needed to
  investigate a problem on your clipboard, ready to paste into a message or an issue.

  It replaces an instruction that ran: *find your Stream Deck plugins folder, which is in a different
  place on each platform and depends how you installed it; open the `.sdPlugin` directory; find
  `logs`; open the newest file; scroll to the bottom; find the lines beginning `health:`; copy some of
  them.* Seven steps, each one a place to give up — and none of it is the job of somebody who has
  reported that their device is slow. The plugin is the one thing that knows where its own log is, so
  it fetches it.

  ```
  Dial Countdown 3.9.0.0
  linux 6.8.0-139-generic x64 · 12 cores · 31GB · node v24.21.0
  log: <the plugin's own folder>/logs

  last 6 health, warning and gesture lines:
  2026-09-17T12:26:00.904Z INFO  dialDown
  2026-09-17T12:26:00.955Z INFO  dialUp turnedWhileDown=false down=true
  (and so on)
  ```

  It carries the **health** lines and the **gesture** lines, because those are the two kinds of
  trouble this plugin has actually had — *is it slow and is it this plugin*, and *what did the
  hardware really send*. A report that answered only one would send you back for the other. Everything
  else the plugin has ever logged is left out: a whole log is unreadable in a chat window.

  Find it under **Diagnostics**, at the bottom of the settings for any countdown.

### Internal

- **Driven end to end through the real socket rather than read, and both runs found something reading
  it had not.** `os.version()` is the *kernel's* version, not Node's — the report printed `node
  #139-Ubuntu SMP PREEMPT_DYNAMIC`, which is precisely the shape of thing that reads as a
  checked fact when it lands in a bug report. And the first version of the filter kept only health
  lines, so a *gesture* problem would have produced a report with nothing about gestures in it.

- The empty case is tested as carefully as the full one: a button that hands back an empty box reads
  as broken, so it says the first health line is about a minute away instead. Six mutations, all
  caught, including one that puts the kernel version back.


## [3.8.0] — 2026-09-17

### Added

- **The health line now reports the machine's own load, not just this plugin's.** Because the next
  thing reported was that *other applications were lagging too* — and every number in this report so
  far was about this plugin, all of which read perfectly healthy on a machine that is on its knees. A
  starved process uses little CPU precisely *because* it is not being scheduled, so the line would
  have said `cpu 0.2%` and looked like an exoneration when it was a symptom.

  ```
  health: cpu 0.4% rss 71MB controls 12 frames 9.3/s lag 2ms slowest-render 0.8ms rtt 92ms
          | machine: cpu 1% free-mem 23.4/31GB
  ```

  Everything before the bar is this plugin. Everything after it is the computer. **If the machine's
  CPU is high or its free memory is nearly gone while this plugin's own numbers are small, the plugin
  is a victim rather than a cause** — and the same line proves it, out of a log you are already
  collecting.

- **A Diagnostics section in the property inspector, showing the latest reading and where the log
  lives.** Open the inspector for any countdown and it is at the bottom: the most recent health line,
  the full path to the log folder, and a button to copy that path.

  It exists because the honest answer to "where do I read this?" was several lines long and began with
  "it depends on your platform and how Stream Deck was installed". The plugin does not have to guess —
  Stream Deck launches it from inside its own folder, so it simply reports where it is.

### Internal

- **The machine's CPU is derived from per-core times rather than a load average**, because
  `os.loadavg()` returns zeroes on Windows and this number has to mean the same thing on both
  platforms.

- **The test for it had to be written twice**, and the first version is worth recording: it asserted
  the line matched `machine: cpu \d+%`, which `cpu 0%` satisfies — so a reading stubbed out to zero
  passed it. It pegs a core now and asserts the number is above zero. That is the third check today
  written against a *format* rather than a *value* that went green against a broken build.


## [3.7.0] — 2026-09-17

### Added

- **The health line now times the round trip to Stream Deck, which is how a busy *application* is told
  from a busy plugin.** Asked the obvious question — what if something else on the machine is blocking
  it — and the honest answer needed a number that did not exist yet.

  **Nothing another plugin does can block this one directly.** Every Stream Deck plugin runs in its
  own process, so another plugin misbehaving cannot stall this one's event loop; `lag` would stay
  clean straight through it. What *is* shared is the Stream Deck application and the one USB device
  behind it — and a plugin flooding that would leave every number in this report looking healthy while
  the hardware crawled. No measurement taken inside this process could see it.

  `rtt` can, because it is the application's own answering time:

  ```
  health: cpu 0.4% rss 71MB controls 12 frames 9.3/s lag 2ms slowest-render 0.8ms rtt 92ms
  ```

  | what the line says | what it means |
  | --- | --- |
  | `cpu` high | this plugin, and this plugin's to fix |
  | `lag` high, `cpu` low | this process is blocked or starved — something else is taking the machine |
  | `rtt` high, `cpu` and `lag` low | the Stream Deck application or the device, not this plugin |
  | all low, device still slow | not the software at either end of this link |

### Internal

- The probe asks for the **global** settings, which this plugin does not use and has no handler for.
  Asking for an action's settings would have worked equally well and would have fired this plugin's
  own `didReceiveSettings` once a minute, re-applying settings nobody had touched — a measurement that
  alters what it measures. It is raced against a five second timeout, and a probe that fails or never
  returns is reported in the line rather than thrown, because a round trip that cannot complete is the
  most interesting thing the line could say.


## [3.6.0] — 2026-09-17

### Added

- **The plugin now reports what it is costing your machine, once a minute, into its own log.** Because
  "the device feels slow" is the one question that cannot be answered from a developer's desk — and
  every performance number this plugin has produced so far came from a mock host on a Linux box with
  one control on it, which says nothing about a Stream Deck + on Windows with a dozen other plugins
  running beside it.

  ```
  health: cpu 0.4% rss 71MB controls 12 frames 9.4/s lag 2ms slowest-render 0.8ms
  ```

  Four numbers, because between them they separate the three possible causes. **`cpu`** and
  **`frames`** are this plugin's to fix if they are high. **`lag`** is the one that matters for an
  unresponsive device: a plugin at 1% CPU and 400 ms of lag is *blocked*, not busy, and nothing else
  tells those two apart. **`slowest-render`** names this plugin as the cause of that lag, if it is.

  A warning is written the moment lag crosses **250 ms**, rather than waiting for the next summary, so
  a freeze leaves a timestamp you can point at. That number is the touchscreen's own double-tap
  window: once the plugin is running that late it can no longer tell a single tap from half of a
  double one, because the delay is as long as the thing it is measuring. **That is the point where
  slowness stops being cosmetic and starts changing what a gesture means** — which would explain
  presses that do not register and a clock that seems to tick unevenly, from one cause.

  The log is `logs/com.matewishkey.dial-countdown-v2.0.log`, inside the plugin's own folder.

### Internal

- **For the record, measured on a Linux desktop, and offered as a baseline rather than as a verdict:**
  one dial frame — the ring and the glyph, rendered and encoded as they are sent — costs **4 µs**,
  which is 0.01% of one core for four dials at the full render rate. Twelve controls idle at **0.3%
  CPU**; spinning a dial hard reaches **1.2%**. Nothing in that supports the plugin being the cause of
  a slow device, and nothing in it rules the possibility out on other hardware either.

- **The control count was wrong the first time it ran end to end, and only running it showed that.**
  The dial and the key are separate actions with separate instance maps, so a single shared total was
  written twice per change and whichever ran last won — four dials and eight keys reported `controls
  8`. It is counted per action and summed now. An undercount makes every per-control figure beside it
  read better than the truth, which is the one direction a health report must never be wrong in.


## [3.5.1] — 2026-09-17

### Fixed

- **A change made on the hardware could be undone by the next thing you touched in the property
  inspector.** Reported as the clicks going wrong once *auto-reset* and *fade to the end* were switched
  on. Neither setting is itself at fault — what they have in common is that you switch them on **in the
  inspector**, and the inspector is the other half of this.

  A gesture that changes the preset is written to disk a fraction of a second later, because that write
  is held back so that spinning the dial does not go to disk on every click. The inspector is brought
  up to date *by* that write — so until it lands, the inspector is both the authority on your settings
  and out of date about them. Tick any checkbox in that gap and its idea of the selected preset came
  back over the top: the clock reloaded the old preset, and the pending write then put the old
  selection on disk too, so the preset you had just chosen was gone from the screen and from the
  settings both.

  Measured against the built plugin, holding the screen to move 5m → 20m and then ticking a box: at
  80 ms and 250 ms the advance was undone; at 800 ms, past the write, it survived. All three keep it
  now. Only the selected preset is held back, and only while a write is outstanding — everything you
  actually opened the inspector to change is taken exactly as sent, including edits to the preset
  lengths themselves.

### Internal

- **Two new tests tear down in a `finally`, and the mutation harness now knows a hang from a
  failure.** Written without one, a deliberately broken build *hung* the suite rather than failing it:
  the render loop is an interval, and an assertion that throws before the teardown line leaks it and
  holds the process open. By exit code alone a hang and a pass are the same answer, which is the same
  shape of blind spot as the release gate that could not fail.


## [3.5.0] — 2026-09-17

Everything here came out of an external design review — four reviewers reading the design cold, with
no access to the diagnosis that prompted it. **None of them found the gesture model or the timer state
machine wrong in principle.** What they found is that the machinery meant to hold the design in place
had stopped checking, and six bugs had walked through the gap.

### Fixed

- **A turn of the dial up, and an equal turn back down, permanently redefined the preset.** The clock
  came back to exactly where it was; the preset behind it did not. On a 2 minute preset 20 seconds in,
  `+3m` then `-3m` left the timer's length at **4:40** — so the ring jumped from 17% to 64% with no
  time passing, the label read `from 2m` for ever, a hold of the screen was spent restoring instead of
  advancing, and **the next repeat lap ran 4:40 instead of 2:00** with nothing on screen to explain it.

  The duration was being ratcheted up to meet a clock wound above it, so the progress fraction could
  not go negative. The ratchet was one-way. Progress is clamped instead and a started clock's duration
  is left alone, which makes a turn of the dial reversible — and settles a fourth, disagreeing route
  back to "the top of the clock" that had been quietly in use by the repeat.

- **A click *down* on a nearly-finished clock *added* time, and a running clock could not be wound to
  zero.** The one-second floor is the shortest a *preset* may be set to; it was also being applied to
  the time left on a clock, which is not a preset. Paused with 400 ms to go, one click down handed back
  a full second. Winding down now reaches zero, and reaching zero while running finishes the timer
  exactly as running out of time does.

- **Changing "repeat 3 times" to 4 while it was running made it run six times.** The lap tally was
  reset whenever the repeat rule changed — right for a timer that has already finished, which is the
  case the rule was written for, and wrong underneath a run in progress: the laps already done were
  done again, labelled `×1/4` on a lap that was really the third. The property inspector sends a write
  on every keystroke while a number is typed over, so this did not need anyone to mean it.

- **On a key, one press followed by a press-and-hold did two things at once** — started the clock *and*
  advanced the preset. A press waiting to see whether it had a partner starts counting at the
  *previous* release, while the hold that is meant to settle it cannot fire until the *next* press has
  been held long enough — so the waiting one always resolved first, whatever the two thresholds were
  set to, and the code that was supposed to cancel it could never run. A press now stops counting down
  while a finger is on the key, so the hold is free to settle it. **Both thresholds are now free to be
  tuned on feel alone**, which they were not before.

- **A release of the dial that the plugin never saw the press for started the clock.** Flipping page or
  profile tears an action down and rebuilds it, and the rebuilt one has no memory of a press already in
  progress — but the countdown itself is kept and handed back. So holding the dial in for a
  minute-stepped wind, flipping away and back, and letting go landed a stray start or pause on a real
  timer. The trade is deliberate: a *lost* press now does nothing, which you recover from by pressing
  again, rather than a clock starting when nobody asked.

- **Two rapid presses of a key could leave a stray timer running that nothing could stop.** It later
  advanced the preset of a countdown that was no longer on screen, and scheduled two more timers that
  nothing could clear. It was the only timer in the plugin that could outlive the control that started
  it.

### Changed

- **The tooltips said "hold for the next preset".** A hold puts the clock right first and only moves on
  when there is nothing left to put right — which the trigger description shown on the hardware had
  correct all along. The tooltip is the one you read first, so it is now the one that agrees.

### Internal

- **`npm run demo` had no way to fail, and had been failing.** It ended in an unconditional
  `process.exit(0)`; its ✗ lines were print statements nothing read back, while the release gate judges
  that step by exit code alone — and `npm run check` does not run it at all. **v3.4.2 was released
  carrying two failing checks, under a page reading "all gates passed".** Neither was a bug in the
  plugin: one check demanded a word the state it inherited could not produce, the other slept a fixed
  3.4 seconds and called that the finish. Both are fixed; verdicts are now counted and the exit code
  means something. A pass that asserts *nothing* fails too — an empty tally is what a harness that died
  early looks like, and by exit code alone it is indistinguishable from a clean run.

- **Three of the four end-of-fade tests were true by arithmetic.** Their clock started on a whole
  second and the blink period divides a second, so the expression they asserted on was `false` at every
  instant they sampled, whatever the guards above it did. Deleting the half-duration cap — a bug that
  actually shipped once, and the thing one of those tests is *named* for — left all four green. The
  fixture now starts half a blink off the boundary, and each of the three guards was re-checked by
  deleting it and watching the right test go red.

- **Every fix here was driven against a build with that fix reverted.** Seven are caught by the unit
  suite and three by the scripted pass, which is the only thing that can reach the dial's and the key's
  own event handlers — their `@action` decorator keeps them out of a unit test. The check for the key's
  hold took three attempts to become a real one: asserting where the clock ended up cannot work, since
  the right answer and the wrong one both land on the next preset, stopped.

- **`plugin.ts` now handles uncaught exceptions and rejections with `on`.** The SDK installs its own
  with `once`, so the first throw anywhere in the process spent it — and the render loop is a 4 Hz
  interval per control, so a repeating throw there had no handler left by its second tick. The comment
  explaining why a failed connection was left unlogged was also wrong about where logging goes: a file
  beside the plugin, not back down the socket it just failed to open.


## [3.4.2] — 2026-09-17

### Fixed

- **A press of the dial could be swallowed with nothing at all on screen to show for it.** The guard
  that stops a push-and-turn from *also* starting the clock as you let go was armed by any rotation
  reported while the dial was down — **including one carrying no detents at all.** A `ticks: 0`
  rotation between the press and its release therefore ate the press, and because no detents turned,
  there was no clock movement, no word on the bottom line and no pulse of the ring to show for it
  either. The dial simply looked as though it were not wired up, in every state: it would not start an
  idle clock, would not pause a running one, would not resume a paused one, and would not restart a
  finished one.

  A rotation of nothing is not a rotation. It is now ignored outright, before the guard or the clock
  sees it. Elgato's SDK documents `ticks` as "positive or negative" and says nothing about a floor,
  about ordering, or about coalescing, so the plugin is not entitled to assume this cannot arrive —
  `rwellinger/xp_streamdeck` guards the same case, for what looks like the same reason.

### Changed

- **Whether the dial is pushed in is now read from the button events as well as the rotation's own
  flag.** `dialRotate` carries `pressed`, and that had been the only source. But `dialDown` and
  `dialUp` are separate messages from the same hardware, and where the two disagree the record
  assembled from the button's own events is the better answer — so a turn counts as a minute step if
  *either* says the dial was down. Without it a rotation whose flag lagged the button was charged at a
  second a click and then started the clock on release, which is two wrong answers from one gesture.

### Internal

- **Every dial gesture is now written to the plugin's log at `info`, which an installed build keeps.**
  One line per `dialDown`, `dialUp`, `dialRotate` (with its tick count and both readings of the button)
  and `touchTap` — bounded by how fast a hand moves, unlike the render loop, which is still silent.
  What the hardware actually emits when a knob is pressed is the one thing no amount of driving the
  mock host can answer, and every question left open here is a question about that. The file is
  `logs/com.matewishkey.dial-countdown-v2.0.log`, inside the installed plugin's own folder.

- **`npm run demo` covers the no-detent press.** The dial's own event handlers still cannot be reached
  from a unit test (#12), so the scripted pass against the built bundle is where this is asserted: a
  `dialDown`, a `ticks: 0` rotation and a `dialUp` have to leave the clock running.


## [3.4.1] — 2026-09-17

### Fixed

- **A turn of the dial on a paused clock threw the count away and put the timer back to full.** A
  timer paused at 4:56 of a five minute preset answered one click of the dial by reading **5:01**,
  sitting idle — the four seconds gone, the pause gone with them, and the preset quietly redefined as
  5:01 for every run after. It took one click, in the state you are most likely to be in when you
  reach for the dial: stopped, mid-run, about to give yourself another minute.

  The dial has always had two jobs, and which one it does depends on whether the clock has been
  started. On a clock that is running it nudges the time left. On one that has not been started there
  is no time left to nudge, so it re-scales the duration instead and the clock follows it — that is
  how you wind a preset up before you begin. **`paused` was being counted as the second kind**, on the
  reasoning that a paused timer is a stopped timer. It is not: it is a clock with time left on it, and
  re-scaling it is the one operation that discards exactly that.

  A pause now goes with `running`. The turn moves the time left, the clock stays paused, and the
  preset behind it is left alone.

- **A tap on the glass and a press of the dial cancelled each other out, and on a finished timer that
  is the state that looks broken.** A tap is held back for a quarter of a second in case a second one
  is coming — that is how "tap twice to reset" is told apart from "tap once to pause" — and the
  touchscreen sits directly above the dials, so a brush of the screen and a press of the dial are one
  reach of the hand often enough to matter. Both mean *toggle*. The pair therefore arrived as **start,
  then pause**, a quarter-second apart: the plugin said both words out loud on the bottom line, and
  the clock landed back exactly where it began.

  It is worst on a timer that has just run out, repeats included. That is the moment you press it to
  get going again, and what you get is a full, stopped clock that looks like nothing happened —
  and pressing again cannot recover, because an even number of toggles always lands back where it
  started.

  **A press on the dial now settles whatever the glass was still deciding.** The dial is unambiguous
  and acts at once, so it is the gesture that wins; the tap that was still waiting on a partner is
  dropped rather than fired afterwards. The same rule the key's long press already followed.

### Internal

- **`DOUBLE_TAP_MS` now says that 250 has never been measured against a hand.** It is the same number
  that turned out to be too short on the key in 3.4.0, and the comment claimed the opposite — that
  taps on glass "land a long way inside it" — as though it had been checked. Driven against the built
  plugin, two taps 300 ms apart arrive as two separate toggles, exactly as the key's did at 320. What
  a real finger does on glass is still unknown, and nothing in this repo can answer it.

- **`Timer.adjust`'s paused branch had no test, which is why it had no behaviour.** The suite covered
  adjusting an idle clock and adjusting a running one, and `paused` fell through to the idle case
  unexamined for as long as pausing has existed. The three tests added with the fix all fail against
  the old code for the stated reason rather than incidentally — `'idle' !== 'paused'`, and a
  `remainingMs` of 301000 on a clock that should have read 297000.

- **`npm run demo` covers the one-reach case.** The dial's own event handlers still cannot be reached
  from a unit test (#12), so the scripted pass against the built bundle is where this is asserted: a
  tap followed by a press 200 ms later has to leave the clock running, and prints the word the plugin
  answered with.

## [3.4.0] — 2026-09-15

### Fixed

- **A key could look completely dead, and pressing it again made it worse.** A press is held back for
  a moment in case a second one is coming — that is how "press twice to reset" is told apart from
  "press once to pause". The key was using the touchscreen's window of 250 ms, and a key is not
  glass: it has travel, a click, and a finger that has to come all the way back up before it can go
  down again, with only the release reported. An ordinary, deliberate double-press 320 ms apart fell
  outside that window and arrived as two separate presses instead — start, then pause.

  The clock therefore did not move, so nothing on screen said the presses had landed at all; and
  pressing again could not recover, because an even number of toggles always lands back where it
  started. The obvious response to a button that seems not to have worked was the one response that
  guaranteed it stayed that way.

  **The key now waits 500 ms for a second press**, and the touchscreen keeps its 250 ms. The cost is
  that a single press on a key acts a quarter of a second later than it used to.

### Internal

- **`docs/releasing.md` no longer contradicts itself about repo-only work.** It said that work was
  "in the git history and in the changelog" in one place, and that "extracted `#load` from
  `cyclePreset`" did not belong in the changelog in another. The project had already settled it in
  practice — 3.0.0, 3.2.0 and 3.3.0 all carry `### Internal` sections, and a later section spelled
  out that repo-only work goes under that heading — but the contradicting sentence was never
  updated, so the doc still read as an open question. It now says the one thing: everything that
  lands on `main` is recorded, and the heading decides the audience.

- **Nothing is published that the gates did not pass.** The verdict on the six gates was computed
  *below* the publish step and acted on in the last four lines of `tools/release.mjs`, so a run with
  a failing test suite tagged, pushed and created the GitHub release, and then printed "do not cut
  this" about something it had already done. `--no-gates` was the same hole by another route: it
  skips the build and the pack, so a version bump followed by a `--no-gates` run would have shipped
  whichever package was last left on disk, unchecked, under the new number. That flag was harmless
  when this tool only wrote a page and was not revisited when it started tagging.

  Both are one mistake — publishing a build nothing stands behind — so both are now one input to the
  plan, read before anything is published. The branch push stays exempt, as it is for every other
  refusal, and a `--no-gates` re-run with nothing left to cut still comes out green, because
  withholding an empty list is silence rather than a refusal.

- **The refusal for a version someone else already cut could never fire.** The remote tag was read
  with `git ls-remote --tags origin "v<version>^{}"`, and `^{}` matches only the peeled ref an
  *annotated* tag has — while `publish` cuts lightweight ones. The answer was always empty, so the
  plan always read "no tag on the remote". Every test passed throughout: the decision is pure and
  was correct about a value the untested glue around it always handed over as `null`.

  Gathering that state is now `tools/git-state.mjs`, asked with both patterns and preferring the
  peeled line, so both kinds of tag resolve to the commit that gets compared against HEAD.
  `test/git-state.test.ts` drives it against a working tree and a bare remote in a temp dir — a bare
  repo on disk is a real remote to `ls-remote`, so it needs no network, just as the plan's own tests
  need no repository. That split is the lesson: a pure core with every branch covered is still only
  as right as the state handed to it.

- **`npm run release` tags, pushes and publishes the GitHub release itself.** It was the last part
  of a release still typed by hand, and typing it by hand is how v3.2.0 reached Marketplace with no
  release behind it. Automating the tag push alone would have recreated that exact gap, so the tag,
  the branch push, the tag push and `gh release create` are one step — followed by downloading the
  published asset back and checking its content id against the build.

  It is a plan computed from the current state rather than a script, so it is **idempotent**: run it
  again and it does nothing; run it on a half-finished publish and it finishes it. It **refuses
  rather than forces** — a dirty tree, a tag already naming a different commit, a tag someone else
  pushed elsewhere, or a published release carrying a different build each stop it with the reason.
  A published asset that cannot be downloaded is treated as unknown, not as a conflict, so a flaky
  network cannot invent one. `--no-publish` runs everything and touches nothing outward-facing.

  **The branch push survives a refusal**, because it is the only one of the four acts that is not
  about this version: a run that correctly declines to move a tag must still put committed work on
  the remote, or "push it for me" stops being true exactly when there is no release due.

  The decision is pure (`tools/publish-plan.mjs`) because none of those refusals can be tested by
  trying them; `test/publish-plan.test.ts` drives all of them with no network and no repository.

- **`README.md` says how a tool gets types.** `tools/` is in `tsconfig.test.json` and the modules a
  test imports carry JSDoc annotations. Without both, every value crossing that import is `any` —
  which does not fail a typecheck, it *disables* the type-aware lint rules wherever it lands.

- **`--version` is read-only now, and documented.** It was added when this tool only wrote a page,
  where naming another version merely read a different changelog section; once `publish` started
  tagging, it would have offered to tag and publish whatever it was handed. The refusals catch the
  dangerous half — a version already tagged elsewhere is refused — but a version that had never been
  cut would have sailed through. A flag whose only use is looking must not be able to publish. It was
  also the one flag `tools/release.mjs` implemented and nothing documented.

- **`docs/releasing.md`'s release section had two numberings at once** — its prose said "step 4"
  meaning a row of its own table while "step 4" in *Cutting one* was something else entirely. The
  command's phases are named rather than numbered now, so they cannot be confused with the steps
  around them.

- **The rename left dead references behind**, found by a hygiene sweep: a stale duplicate of the
  flags paragraph in `docs/releasing.md` written against `tools/release-page.mjs`, the same dead path
  in `docs/how-it-works.md`, and — the one that mattered — the generated release page telling every
  reader to run a command that no longer exists. `--no-publish` was documented everywhere except the
  tool's own usage header. The changelog's own link definitions had also stopped at 3.1.0, so
  *Unreleased* was comparing against a two-releases-old tag.

- **`npm run release -- --no-gates` now runs the release check.** It was skipped along with the
  gates, which broke the one flow it exists for: `docs/releasing.md` says to re-run the page after
  publishing so the check goes green, and the re-run reported "not checked" for exactly that
  question. The check depends on nothing the gates produce and costs one API call.

## [3.3.0] — 2026-08-31

### Changed

- **A reset now goes back to the preset, not to wherever the dial left the clock.** Wind a 5 minute
  preset up to 8 and double-tap: you get 5 minutes.

  It used to restore the *working* duration, which meant a timer nudged once was nudged for good. 8m
  became the value every later reset returned to, the 5m in the property inspector was reachable only
  by holding the screen, and a number typed into the settings had quietly lost an argument with a
  number nudged on the hardware. That is a last-used value wearing a preset's clothes, and the whole
  reason the dial no longer writes back to the preset list is that those two are different things.

  The clock is the scratch value; the preset is the record. All three gestures that mean *put it
  back* now land in the same place — the double tap, a hold that finds something to put right, and
  the auto-reset falling due. They used to agree by coincidence and did not quite, so which one you
  reached for decided what "the top of the clock" meant.

  **The dialled length is not recoverable afterwards**, which is the trade. It is the right way round
  — getting it back is one turn of the dial, while the configured length was otherwise two gestures
  deep — but it is a real loss rather than a free win.

### Internal

Nothing that changes what the plugin does.

- **`docs/how-it-works.md` says how to add a demo step**, and its count of the pass was two steps
  behind. A step that reuses the previous step's preset length inherits that step's clock rather
  than starting a fresh one — `applySettings` reloads only when the *selected* length changed — so
  its first gesture lands on a timer already in motion and reads as the opposite of what it meant.
  It cost a debugging pass while the auto-reset step was being written.

- **`README.md` catches up with the release procedure** — `npm run release:page` was missing from
  the packaging section and `tools/release-page.mjs` from the file table, so the README and
  `docs/releasing.md` described two different releases. The `check-version` example is written
  `v<version>` now rather than naming a release it will fall behind.

- **`docs/releasing.md` says that a pushed tag is not a release.** They are two acts on two systems
  with nothing linking them, and a tag without a release is invisible to both tools — no error
  anywhere, because nothing is wrong from either one's point of view. v3.2.0 went to Marketplace off
  the release page while `gh release create` had never run, so the version in front of Elgato briefly
  had no artefact of record. The doc now carries the check that settles it, and
  `README.md` says it in a line — where a hygiene sweep also caught the previous commit having added
  the `pack` warning back beside the one already there, with two pointers to `docs/releasing.md` a
  paragraph apart.

- **The release is one command — `npm run release`.** Check, version-against-the-tag, build, pack,
  validate, demo, then ask GitHub whether this version is published and whether the published asset
  is this same build. The first failure stops it and every step's whole output is kept. Six commands
  typed by hand end up in a different order each time, which is how v3.2.0 reached Marketplace with
  no GitHub release behind it.

- **A packaged plugin has a reproducible id** — `tools/package-id.mjs`. The `.streamDeckPlugin`'s own
  sha256 is not reproducible and cannot be made so: `streamdeck pack` writes the moment of packing
  into every zip entry, so two packs of a byte-identical tree differ. Measured at 21 of 21 entries
  with matching content and 21 of 21 with differing timestamps; normalising the source tree's mtimes
  first does not help, because the stamp is the pack time. So the id hashes the archive's contents
  instead, and `docs/releasing.md`'s "is this a release?" check uses it — replacing a recipe built on
  `unzip`, which is not installed on the dev box, where a `diff` of two directories that failed to
  populate reports them as identical.

- **The release notes reduction has tests, and had two bugs.** An entry's bold lead gained a second
  full stop when it already ended in one, so `A title.` became `A title..` in notes bound for a
  public listing. And the changelog's link-reference block — the `[3.2.0]: https://…/compare/…`
  definitions at the foot of the file — was being swept into the oldest version as a 1195-character
  entry that was a wall of URLs. Neither had ever been run against a real entry. The reduction also
  gained intermediate steps and a promotion pass, so it now fills the budget rather than stepping
  over it: 3.1.0's entry went from 1385 characters to 1493 of 1500, with nothing dropped.

## [3.2.0] — 2026-08-31

### Added

- **A title.** Name a timer `Tea` and the line under the clock says so, on the dial and on the key
  alike, instead of the preset's length. Leave it empty and the length comes back, exactly as before.

  It is the plugin's own field, in the property inspector — Stream Deck's Title box stays switched
  off, because neither control can use it. A key draws its whole face as one image and the
  application composites a native title straight over the clock; a dial's touchscreen layouts are the
  plugin's own files with no `title` item and no room for one. This was reported as *the title is
  disabled and I cannot update it*, and it was: `UserTitleEnabled` has been false since 3.1.0. The
  field is now somewhere it can actually work.

  A named timer still reports the drift. `Tea · from 20m` on the dial once the clock has been wound
  off its preset — the name replacing the length must not take the warning with it.

- **Clear itself when finished**, after a wait you set. A finished timer otherwise sits reading
  `done` until somebody presses it, which is right for a timer you are watching and wrong for one on
  a page you left. Switched on, it goes back to a full, stopped clock — repeat tally included — on
  its own.

  It waits for the **whole** job: a repeating timer's earlier laps restart themselves and never reach
  it, so nothing is cleared mid-job. It is silent, since the words under the clock name the gesture
  you just made and nobody made this one. Any press, turn or reset in the meantime calls it off. And
  a timer that ran out while its page was elsewhere is timed from the moment the page came back —
  otherwise it would clear itself on the one frame where seeing `done` is the point.

### Changed

- **_Show the title_ is now _Show the label_.** It never named a title: what it switches is the line
  under the clock, which is where the title now goes. Settings written by an older build are carried
  across, so an install that had the line switched off does not come back with it switched on.

### Internal

Nothing here changes what the plugin does, and none of it goes to Marketplace —
`tools/release-page.mjs` leaves this heading out of the notes it writes for the listing, and keeps it
in the ones for the GitHub release.

- **The label rule lives in one file.** `src/label.ts` holds what the line says; the dial and the key
  each take the part that fits the room they have. It was two copies in two actions, and they had
  already drifted apart once over how a finished repeating timer reads.

- **`manifest.json`'s formatting was restored** after `streamdeck pack` rewrote it while packaging
  3.1.0 — whitespace only, and the packaged manifest parses to the same JSON either way. Recorded
  rather than skipped because `manifest.json` is a file that ships, so a byte comparison against the
  3.1.0 package would show it. Whether an entry like this belongs here at all is
  [an open question](https://github.com/matewishkey/mwk-dial-countdown/issues/14) —
  `docs/releasing.md` currently says two incompatible things about repo-only work, and *Internal* is
  half an answer to it.

- **A release page per version** — `node tools/release-page.mjs` runs every gate, keeps the whole of
  each one's output, packages the notes to paste into the two places that want them, and puts the
  lot on the shared drive. See `docs/releasing.md`.

## [3.1.0] — 2026-08-30

### Added

- **Pick a preset in the property inspector**, by clicking the dot beside it. Holding the screen or
  the key still cycles forward one at a time, which meant the fourth of four presets was three holds
  away with no way back. The panel already showed which one was loaded; now it can be told.

- **Tests for the two parts of the plugin that had none** — sound resolution, and the action
  lifecycle that owns the timers, the redraw loops and the write to disk. Four of the fixes listed
  below were found there, and every one is now held by a test that fails without it.

### Changed

- **A countdown now survives switching page or profile.** It used to be destroyed the moment the
  control left the screen, so flipping to another page for a few seconds lost the count — which for a
  timer is the worst thing that can happen. Running timers come back running, having kept counting
  while they were away; paused ones come back paused with the time they had.

  Two limits, both deliberate. It is held in memory, so **restarting Stream Deck or the plugin still
  starts you afresh** — the alternative means deciding what a timer that "finished" while the
  application was closed should do, and there is no good answer. And a timer that **ran out while you
  were away comes back silent**: the alarm says *the moment has arrived*, and by then it has been and
  gone. The screen still shows it finished.

- **The *Play a sound when done* checkbox is gone.** Choosing **No sound** in the picker is now the
  only way to turn the alert off, because it always was one of two ways to say the same thing — and
  the state where the two disagreed is exactly the bug listed below. If you had the sound switched
  off, it stays off; the setting is carried over for you.

- **The progress-bar display now acknowledges the dial too.** Every gesture and every click of the
  dial pulses a hairline around the state glyph, exactly as it does around the ring. On that display
  it previously did nothing at all, leaving the word on the bottom line as the only acknowledgement —
  which is the half you have to stop and read, and no use at all while winding.

- **Settings belonging to a switch that is off are now greyed out** — the sound picker, volume and
  *Test* button when the sound is off, the fade threshold when the fade is off, the repeat count when
  repeat is off. *Test* in particular would audition a sound the timer itself would never play.

- **The fade threshold can be set beyond an hour**, as the plugin always allowed; the panel stopped
  at 59 minutes.

- **A released build now logs at `info` rather than `trace`.** Trace logging is a development tool;
  leaving it on meant every install wrote a line for every frame of a redraw loop that runs four
  times a second, for as long as the plugin was on screen. `npm run watch` still logs at `trace`.

### Fixed

- **A timer set to *No sound* flashed an error on every finish.** With the alert switched on and the
  sound set to *No sound*, the plugin treated its own silence as a failure to play, so every
  completed countdown raised Stream Deck's alert triangle — on a timer that had done exactly what it
  was told. Silence you asked for is no longer reported as something going wrong. A sound that was
  genuinely wanted and could not be played still is.

- **A preset chosen just before switching page was forgotten.** Holding to load the next preset
  schedules the write a fraction of a second later, so that winding the dial does not write to disk
  on every click. Flipping to another page or profile inside that window threw the write away instead
  of finishing it, and coming back showed the old preset.

- **The touchscreen could be left drawing a countdown that no longer existed.** If Stream Deck ever
  announced the same control twice without announcing its removal in between, the first countdown's
  redraw loop carried on for the life of the plugin with nothing able to stop it.

- **An unrecognised colour theme could blank the ring** instead of falling back to the default one.
  Only reachable from settings written by another build, but the ring drew as nothing at all when it
  happened, rather than drawing in the default colours.

- **The property inspector could corrupt its own defaults**, so a later action added on a fresh
  button started from presets nobody had chosen.

- **Typing a preset could lose the cursor.** The plugin writes settings of its own — loading a preset
  on the hardware saves the new selection — and every such write redrew the preset rows, pulling the
  caret out of whatever was being typed.

## [3.0.1] — 2026-08-30

### Fixed

- **The dial action's tooltip still described the dial that 3.0.0 removed** — "press it to swap between
  one-second and one-minute steps, or hold it for one hour". That text is what Stream Deck shows beside
  the action in its list, so it was the one place a user could still be told to use gestures that no
  longer exist. It now describes the dial as it is: press to start or pause, turn for seconds, push in
  and turn for minutes.

  Nothing else changed. 3.0.0 was tagged but not submitted to Marketplace, so this is the build to ship.

## [3.0.0] — 2026-08-30

### Changed

- **The dial's step is no longer a mode you set — it is whether you are pushing the dial in.**
  Turn for one second a click; push the dial in and turn for one minute a click. Let go and the next
  click is a second again.

  **What you have to relearn:** pressing the dial no longer swaps the step, holding it no longer
  gives you an hour a click, and there is no `step · 1m` on the bottom line any more because there is
  no longer a mode that could be left switched on. Nothing carries over between turns, so there is
  nothing to check before you start turning.

- **Pressing the dial now starts and pauses the clock.** The job you do most often on a countdown is
  now under the hand that is already on the dial, and it acts the instant you let go — the
  touchscreen's single tap has to wait a quarter of a second first, in case a second tap is coming.
  Tapping the screen still works exactly as it did.

  A press that turned the dial is a minute-step adjustment and nothing else; letting go afterwards
  does not start the timer. **There is no long press on the dial at all** — a push is a push however
  long you lean on it, which is what makes holding it in for a long wind safe.

- **"Repeat at most N times" now means N runs in total, and it used to mean N runs *after* the
  first.** A timer set to repeat 3 times ran four times. It now runs three.

- **The middle of the ring shows the state.** A running clock shows a play triangle, a paused one two
  bars, a finished one a filled square — and only an idle clock shows the Mate Wish Key mark, if you
  have left it switched on. Previously the mark was drawn on three states out of four and silently
  swapped for a pause glyph on the fourth, so it looked as though the logo came and went at random,
  and running, idle and finished were told apart only by colour. The setting is now labelled *Logo on
  an idle clock*.

- **The plugin's icon** — the one Stream Deck shows in its preferences — is now the countdown ring
  with the mark inside it, rather than the mark alone. Elgato's guideline asks that it "accurately
  portray what your plugin does", and a monogram portrays the organisation instead. It is drawn by
  the plugin's own `renderRing`, so the icon cannot drift from the thing it depicts.

### Fixed

- **A finished repeating timer said nothing to say it had finished.** It sat on `×3/3` for ever,
  which is character-for-character what it showed while its last lap was still counting down. It now
  reads `20m · ×3/3 · done` on a dial and `done ×3/3` on a key, and the ring shows the done glyph.

- **The progress-bar layout never took the colour theme.** It used Stream Deck's built-in `$B1`
  layout, whose item keys are published nowhere, so the fill colour was being sent to a slot that may
  never have existed — and a feedback key that does not match fails silently. The plugin now ships
  its own `layouts/bar.json`, so every key it sends is a key it defined. The bar view also carries the
  same state glyph the ring does, drawn from the same code.

- **Changing the repeat settings on a finished timer left the old tally counted against the new
  rule** — raising the limit from 3 to 5 after it had stopped showed `×3/5` on a dead clock. A new
  rule now counts from the start of itself.

- **The lap counter appeared a run late.** It read `×0/3` for the whole of the first run and only
  reached `×1/3` once that run had ended. It now reads from one.

- **Every icon was very slightly the wrong shape.** The brand mark is wider than it is tall, and the
  tool that rasterised the icons stretched it to fill a square instead of fitting it — about 18% too
  tall, on the dial's icon in the Stream Deck application and on both static key faces. Rasterising
  is now done by headless Chromium, which respects the artwork's proportions. Nothing was redrawn;
  the shapes are simply no longer distorted.

### Internal

- **The property inspector's inline JavaScript has tests now** (27 of them). It is a plain page
  Stream Deck loads, so it cannot import from `src/` and carries its own copy of the settings shape —
  a copy nothing checked. `test/inspector.test.ts` drives the real page in headless Chromium over the
  DevTools protocol, and the first thing it asserts is that the page's `DEFAULTS` still match
  `src/settings.ts`. Closes #6.
- The TypeScript target moved from Node 20 to Node 24, which is the runtime the manifest declares.
  Closes #7.
- Icons are rasterised by headless Chromium rather than ImageMagick, which is not installed on the
  build machine — `npm run icons` now works without it.

## [2.0.1] — 2026-08-20

### Fixed

- The property inspector's help text contradicted itself about the dial. One paragraph still said
  "the next press of the dial puts it back", from before the dial's press was given over to setting
  the step; the paragraph directly beneath it described the current behaviour. Putting the clock back
  on its preset is the touchscreen hold.

## [2.0.0] — 2026-08-20

### Changed

- **The plugin's identifier has changed**, from `com.matewishkey.dial-countdown` to
  `com.matewishkey.dial-countdown-v2`, along with both action identifiers under it.

  **If you had an earlier version installed, its buttons will not carry over.** Stream Deck resolves a
  configured button to an action by identifier, so it now sees an action that no longer exists. Remove
  the old plugin from Stream Deck's preferences, install this one, and place the actions again. Your
  presets and appearance settings belong to the old buttons and do not migrate.

  This is not a change anybody wanted. Deleting a Marketplace listing in order to re-upload it from
  scratch leaves the old identifier permanently reserved, and the dashboard then refuses it — so the
  only way back onto Marketplace was a new one. Nothing else about the plugin changed.

## [1.5.1] — 2026-08-20

### Fixed

- The plugin no longer ships with the Node debugger switched on. `manifest.json` carried
  `Nodejs.Debug: "enabled"` from the project scaffold, which per Elgato's own manifest schema runs
  the plugin under `--inspect` whenever the Stream Deck application is in debug mode. It had been
  there since the first commit.

## [1.5.0] — 2026-08-20

### Changed

- **You set the dial's step; turning never changes it.** A click is one second. **Press the dial** to
  swap between one-second and one-minute clicks, or **hold it** for one hour a click. However far you
  turn, however fast, however long you keep going, a click is worth exactly what the last press said.

  This replaces the automatic ladder, which is the fourth design for this and the first that does not
  try to infer the step from how you are turning. Momentum escalated when you hovered over a value;
  velocity did different things depending on how briskly your wrist moved; distance travelled was
  predictable but still changed the step underneath the hand using it.
- **A step you set stays set.** Nothing expires it — not a pause, not loading a preset, not a reset.
  Because that also makes it easy to forget, any step other than the default now says so on the
  bottom line for as long as it is set, as `step · 1m`.
- **The dial's press and hold now set the step**, so preset cycling is the touchscreen's job alone —
  tap and hold the screen above the dial, or the key itself. Pressing a dial in is a fiddly,
  two-handed movement next to tapping the screen your hand is already at.
- A press from one hour a click lands on **seconds**, not minutes: coming down from a coarse step you
  almost always want the finest one, and landing on minutes would leave no single gesture back to
  seconds.
- **Press-and-turn no longer means a flat minute.** It is an ordinary rotation at the step you have
  set. It cancels the press, so letting go afterwards does not also change the step.

### Removed

- **Selecting the previous preset.** It lived on the dial's hold, which now sets the hour step.
  Holding the screen still cycles forward through the presets.

## [1.4.0] — 2026-08-20

### Changed

- **A press of the dial now puts a running clock right, instead of jumping to the next preset.** The
  rule is: if the clock is not sitting stopped and full on its preset, the first press puts it there,
  and only a press with nothing left to put right moves on. Running, paused, finished and dialled off
  its preset all count.

  It used to fire only on the last of those, on the reasoning that a running timer already has a reset
  of its own in the double tap. That was wrong twice over: the double tap is on the touchscreen and
  the press is on the dial, so reaching for one does not put the other under your finger — and being
  thrown onto another preset because you touched the dial mid-run is exactly the surprise the restore
  exists to prevent.

  Holding the dial for the previous preset, and holding the touchscreen, behave the same way.

The `from 20m` label is unchanged and still means only that the dial has wound the clock off its
preset. A timer that is merely running has not been moved anywhere, so it gets no marker — even
though a press would still put it back to full.

## [1.3.0] — 2026-08-20

### Changed

- **The dial steps in the largest unit you have already travelled.** Move ten seconds and you move in
  tens of seconds; move a minute and you move in minutes; move ten minutes and you move in ten-minute
  steps. The thresholds are not a separate table — they *are* the steps, so the whole behaviour is one
  sentence rather than something to memorise. Ten clicks to the first change, five to the next, nine
  to the last: twenty-four clicks from a second a click to twelve hours in reach, and the ladder gets
  easier to climb the further up it you are.

  This replaces the flat "every ten clicks" of 1.2.0, which changed up at the same rate whether you
  were moving in seconds or in ten-minute blocks.
- **The step shown on screen now lasts exactly as long as the gear it reports.** `+10s` is not a note
  about the click you just made — it states what the *next* click will do, so it stays up for as long
  as that is true and disappears at the instant the dial goes back to seconds. It used to fade after
  0.9 seconds while the gear ran on for another 1.1, which invited the reasonable and wrong conclusion
  that the dial had already reset. Every other acknowledgement — `pause`, `reset`, `next · 20m` —
  keeps its ordinary moment, because those really are notes about something that has finished.

Turning back still keeps the gear and starts the distance over, so hovering never runs away, and
letting go of the dial for two seconds still drops it back to seconds.

## [1.2.0] — 2026-08-20

### Changed

- **The dial changes gear on distance, not speed.** Every **ten clicks in the same direction** is one
  gear up: 1 second, then 10, then a minute, then ten. The same turn now does the same thing however
  briskly you make it — where before the step depended on how fast your wrist happened to move, which
  meant it was never quite the step you predicted.
- **Turning back keeps the step but starts the ten over.** A correction moves in the same unit as the
  movement it is correcting, and hovering — nine clicks up, nine back, over and over — never reaches
  ten in one direction, so it never escalates. The ladder is only ever climbed on purpose. Letting go
  of the dial for two seconds still drops it back to seconds.
- A batch of clicks from a hard spin is spent *across* a change of gear rather than all at the old
  step, so the eleventh click is worth ten seconds however it arrived.
- The icons are now generated from `assets/mwk-mark.svg`, the brand's own artwork file, rather than
  from path data copied into the build script. The artwork is unchanged — the generated files are
  identical, verified at 0 differing pixels — but they can no longer drift from the source.

### Added

- `docs/releasing.md` and this changelog, so version numbers stop being decided case by case.
- `npm run version:check`, which asserts `package.json`, `manifest.json` and the git tag agree. The
  manifest version once sat at `0.1.0.0` through nine releases with nothing looking at it.
- A test holding the mark drawn inside the ring to the artwork file, path for path.

## [1.1.0] — 2026-08-19

Renamed for Marketplace, and the dial's state handling rebuilt.

### Changed

- **Renamed to Dial Countdown**, from *MWK Dial Countdown*, in both the plugin name and the actions
  list category. Elgato's guidelines ask that a plugin name not repeat the organisation, which is
  already shown on Marketplace. The UUID is deliberately unchanged, so existing buttons keep working.
- **Every icon the Stream Deck application draws is white** — `#FFFFFF`, monochromatic, transparent
  background — as the guidelines require: the category icon, both action list icons, and the encoder
  canvas icon. Key faces on the hardware keep the brand red.
- **Turning the dial no longer edits your presets.** It used to write the new length straight into the
  preset list, so winding a 20 minute timer up to 23 for one call silently redefined that preset as
  23 minutes. Turning now moves only the clock in front of you, exactly as it always did for a
  *running* timer. While the clock and its preset disagree, the label says `from 20m`.
- **The dial changes gear on how fast you turn, not how long.** It used to count clicks, so any
  sustained turn escalated and there was no way to click out thirty seconds a second at a time. A
  deliberate turn now stays on seconds indefinitely; a flick changes up a gear (1s → 10s → 1min →
  10min). The gear is then *held* — through slowing down and through reversing — until you let go of
  the dial for two seconds.

### Added

- **A press of the dial puts the clock back on its preset before it moves on.** Once the clock has
  been dialled off, the first press restores it (`preset · 20m`) and the next advances
  (`next · 30m`). The same for holding the dial for the previous preset, and for holding the screen.
  This also gives the one-preset case something to do, where before it was a dead end.

### Fixed

- **Auto-repeat could not run twice.** Starting an expired repeating timer left the lap count where
  the finished run put it, so its budget read as already spent — the restarted run never repeated
  once, under a display still reading `×2/2`.
- **A failed alarm is now reported.** The sound player's result was discarded, so a timer asked to
  make a noise could finish in silence when the file had been moved or the platform had no player.
  Silence is indistinguishable from "not finished yet", which is the one thing an alarm must not be.
  It now raises Stream Deck's own alert.
- **Changing an unrelated setting no longer resets a dialled clock.** With the clock able to sit off
  its preset, touching the volume slider would have pulled it back to the preset's length.

## [1.0.0] — 2026-08-14

First stable release.

## [0.11.0] — 2026-08-14

### Fixed

- **Keys did nothing at all.** The key action sent bare `<svg>` markup, which Stream Deck discards, so
  no ring, no clock, and every gesture invisible. It sends a data URI now.
- **The double tap stopped starting the timer.** Resetting the clock and setting it running are two
  decisions, and a gesture making both leaves no way to reset without committing to a fresh run.

## [0.10.0] — 2026-08-13

### Added

- Three screen gestures — tap to pause or resume, twice to reset, hold for the next preset — and a
  **Countdown (Key)** action running the same timer on an ordinary button.

### Fixed

- The manifest version had sat at `0.1.0.0` since the first release, so the Stream Deck application
  reported the same version whichever build was installed. It now tracks the release tag.

[Unreleased]: https://github.com/matewishkey/mwk-dial-countdown/compare/v3.11.0...HEAD
[3.11.0]: https://github.com/matewishkey/mwk-dial-countdown/releases/tag/v3.11.0
[3.10.0]: https://github.com/matewishkey/mwk-dial-countdown/releases/tag/v3.10.0
[3.9.1]: https://github.com/matewishkey/mwk-dial-countdown/releases/tag/v3.9.1
[3.9.0]: https://github.com/matewishkey/mwk-dial-countdown/releases/tag/v3.9.0
[3.8.0]: https://github.com/matewishkey/mwk-dial-countdown/releases/tag/v3.8.0
[3.7.0]: https://github.com/matewishkey/mwk-dial-countdown/releases/tag/v3.7.0
[3.6.0]: https://github.com/matewishkey/mwk-dial-countdown/releases/tag/v3.6.0
[3.5.1]: https://github.com/matewishkey/mwk-dial-countdown/releases/tag/v3.5.1
[3.5.0]: https://github.com/matewishkey/mwk-dial-countdown/releases/tag/v3.5.0
[3.4.2]: https://github.com/matewishkey/mwk-dial-countdown/releases/tag/v3.4.2
[3.4.1]: https://github.com/matewishkey/mwk-dial-countdown/releases/tag/v3.4.1
[3.4.0]: https://github.com/matewishkey/mwk-dial-countdown/releases/tag/v3.4.0
[3.3.0]: https://github.com/matewishkey/mwk-dial-countdown/releases/tag/v3.3.0
[3.2.0]: https://github.com/matewishkey/mwk-dial-countdown/releases/tag/v3.2.0
[3.1.0]: https://github.com/matewishkey/mwk-dial-countdown/releases/tag/v3.1.0
[3.0.1]: https://github.com/matewishkey/mwk-dial-countdown/releases/tag/v3.0.1
[3.0.0]: https://github.com/matewishkey/mwk-dial-countdown/releases/tag/v3.0.0
[2.0.1]: https://github.com/matewishkey/mwk-dial-countdown/releases/tag/v2.0.1
[2.0.0]: https://github.com/matewishkey/mwk-dial-countdown/releases/tag/v2.0.0
[1.5.1]: https://github.com/matewishkey/mwk-dial-countdown/releases/tag/v1.5.1
[1.5.0]: https://github.com/matewishkey/mwk-dial-countdown/releases/tag/v1.5.0
[1.4.0]: https://github.com/matewishkey/mwk-dial-countdown/releases/tag/v1.4.0
[1.3.0]: https://github.com/matewishkey/mwk-dial-countdown/releases/tag/v1.3.0
[1.2.0]: https://github.com/matewishkey/mwk-dial-countdown/releases/tag/v1.2.0
[1.1.0]: https://github.com/matewishkey/mwk-dial-countdown/releases/tag/v1.1.0
[1.0.0]: https://github.com/matewishkey/mwk-dial-countdown/releases/tag/v1.0.0
[0.11.0]: https://github.com/matewishkey/mwk-dial-countdown/releases/tag/v0.11.0
[0.10.0]: https://github.com/matewishkey/mwk-dial-countdown/releases/tag/v0.10.0
