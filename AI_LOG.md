# AI log

How I used AI tools while building WikiPulse.

**Tool:** Claude Code (Claude Opus 5.5) in VS Code, used as a pair programmer:
reading the brief and data, proposing designs, writing code and tests, and
running the app against the live stream and the sample.

**How I worked with it:** I asked for small, testable pieces, had it run the
tests and the real app after every step, and checked results against real
data (sample file, live stream, screenshots) instead of trusting the
explanation. Most of the corrections below came from that habit.

---

## 1. Understanding the data before writing code

- **What I asked:** read the brief and analyse `sample_events.jsonl`: field
  coverage, event types, and anything unusual.
- **What I kept:** the list of problems it found became the parser's test
  checklist: one truncated JSON line, events missing `title`/`wiki`/`user`,
  30 duplicate ids, a timestamp in milliseconds, 55 out-of-order events,
  `log`/`categorize` events, HTML/script in comments and two prompt-injection
  comments. Each now has a test (`backend/tests/test_parser.py`).
- **What I changed:** it treated the injection text as a problem only for the
  AI prompt. I also made it a *rule* signal: a summary that tries to instruct a
  moderation system is itself evidence of bad faith.

## 2. The AI wrote a bug, and a test caught it (AI was wrong)

- **What I asked:** a WebSocket hub that sends a new client the recent edits,
  then streams new ones every second.
- **What went wrong:** the first version sent edits that were waiting for the
  next tick twice: once in the `hello` message and again in the next batch, so
  the feed showed duplicates. The explanation it gave was confident; the
  integration test (`test_websocket_hello_then_snapshots`) failed.
- **What I changed:** every accepted edit now gets a sequence number, and each
  client remembers the last one it was sent. A regression test
  (`test_new_client_does_not_get_edits_it_already_has`) covers it.

## 3. Rules that looked right but failed on real data (AI was wrong)

- **What I asked:** rule-based vandalism signals (blanking, large removals,
  profanity, injection, anonymous editors).
- **What went wrong:** on the sample they looked perfect. Run against the live
  stream, two of the first flags were false positives: a Dutch user clearing
  their own sandbox page, and an Italian page turned into a redirect after a
  merge (summary "unione su [[…]]", "merged into").
- **What I changed:** user pages are skipped for size rules, and merge/redirect
  summaries in several languages explain a size drop. Both cases are now tests.
  Lesson: the sample was clean in ways real traffic is not.

## 4. Trusting bots: a reasonable default I narrowed

- **What it proposed:** treat registered bots as trusted and lower their scores.
- **What I kept:** lower scores for bots on size changes, since bots routinely
  make large edits.
- **What I rejected:** applying it to everything. One of the injection comments
  in the sample is sent by a bot account (`ExampleBot28`), so injection and
  markup signals are never softened for bots.

## 5. Arithmetic and layout mistakes caught by checking output

- **Test arithmetic:** in a test for combined signals it asserted a score above
  0.9. The code was right (1 − 0.4·0.6·0.8·0.8·0.85 = 0.869). I changed the test
  to the exact value with the formula in a comment.
- **Layout:** the first grid left a large empty gap under the chart, and on
  mobile one card was narrower than the rest (a desktop `align-items` rule
  leaking into the mobile layout). Neither showed up in unit tests. I found
  them by taking screenshots of the running app in light, dark and mobile views.
- **Right-to-left text:** on the live stream, Arabic titles scrambled the
  English summary around them. Fixed with `<bdi>` in the UI and Unicode
  isolates in server-written summaries.

## 6. Making the feed smooth, and a bug only the browser test caught (AI was wrong)

- **What I asked:** make the live feed feel smooth. The stream delivers ~40
  edits per second in one batch, so the list jumped every second.
- **What I kept:** new edits trickle in over the second, rows fade in, the feed
  holds still while the pointer is over it, top-page reordering slides, and
  counters glide to new values (all switched off for reduced-motion users).
- **What went wrong:** to tell "new filter" from "more edits", the first version
  replaced the list only when old and new lists had no edits in common. After
  filtering to French, the French edits were already on screen, so the feed
  kept showing every wiki. Unit tests passed; the Playwright test failed.
- **What I changed:** the reducer now bumps a `feedVersion` whenever the server
  replaces the feed, and the trickle resets on that explicit signal instead of
  a guess. A unit test covers the overlapping case.

## 7. Charts, and what the live stream taught me (AI was wrong)

- **What I asked:** add more impressive charts.
- **What I kept:** a scrolling edits-per-second "heartbeat", per-minute stacks
  by wiki, an editor-mix bar, an edit-size histogram, click-to-filter wiki
  bars and per-page sparklines, all hand-written SVG with tooltips.
- **What went wrong:** the editor-mix chart showed 0 anonymous editors. The
  code assumed logged-out editors appear as IP addresses; on today's stream
  Wikipedia gives them temporary accounts (`~2026-61790-62`) instead. The same
  assumption meant the vandalism rule for anonymous editors never fired.
  The live data also showed two more false positives: a section heading
  "IdiotSavant" (inserted by MediaWiki, not typed) tripped the language rule,
  and small Wikidata items losing one claim looked like "71% removed".
- **What I changed:** temporary accounts count as logged out, auto-inserted
  `/* section */` text is ignored by language rules, and percentage-based
  removal rules need at least 1,000 bytes removed. Each has a test.

## 8. Moving the browser tests to Cypress, and a data problem nobody had listed (AI was wrong)

- **What I asked:** replace the Playwright tests with Cypress, then make the
  tests cover every feature, including the problems in the sample data.
- **What I kept:** one spec per area (login, dashboard, assistant, tour, data
  quality). The data-quality spec reads `sample_events.jsonl` itself, works
  out what should survive (no broken JSON, no `log`/`categorize`, no untitled
  events, no repeats) and checks the back end counters, the stats, the API and
  the feed all agree.
- **What went wrong:** the first data test identified events only by
  `meta.id` and failed on one edit. That edit ("History of computing") has no
  `meta` block at all, a problem missing from the list in section 1. The back
  end already handled it (it falls back to `<wiki>:rc:<id>`); the AI's test did
  not follow the parser's own rule. Separately, Cypress would not start at all
  from the VS Code terminal: VS Code sets `ELECTRON_RUN_AS_NODE`, which turns
  Cypress's Electron app into plain Node.
- **What I changed:** the test now uses the parser's id rule, and a new test
  checks the edit without `meta` reaches the dashboard. The `e2e` scripts clear
  `ELECTRON_RUN_AS_NODE` themselves. I also learnt the test back end must be
  fresh: after five minutes the replayed sample leaves the rolling window, so
  a long-open Cypress window fails tests that pass on a new run.

## What I checked by hand

- The AI path is tested with a fake model and a mocked HTTP API (which checks the
  exact request sent to Claude). I will verify it with the real key before the demo.
- The prompt-injection defences were reviewed line by line, not just
  generated: data escaping, schema validation, and the rule that the AI cannot
  clear an injection flag.

## What I chose not to use AI for

- _[Fill in, e.g. final review of each diff before committing, the design
  decisions in the README, commit messages, or anything you wrote yourself.]_
