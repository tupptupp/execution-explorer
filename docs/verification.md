# Verification report

Final engineering review recorded on 2026-10-16. Evidence below concerns `feature/workflow-engine`, not the original production demo. The reviewed starting point was `14b57f2c2c8cfc28718b124019c7e19a3ee2e9a3`, whose [CI run](https://github.com/tupptupp/execution-explorer/actions/runs/38925164207) was independently confirmed successful. No AGENTS.md was present in the repository tree.

## Checks executed during this review

| Check                                                                          | Result                        | Scope                                                                                                                              |
| ------------------------------------------------------------------------------ | ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `npm run check`                                                                | Passed                        | Strict frontend production build, isolated engine typecheck and engine tests                                                       |
| `npm --prefix packages/workflow-engine test` after final engine edits          | 38 passed                     | Includes deterministic backoff, input mutation, dependency history, duplicate event and numeric-ID regressions                     |
| `PLAYWRIGHT_CHROMIUM_EXECUTABLE=/tmp/chromium npm run test:e2e -- --workers=2` | 19 passed, 1 skipped          | Production build and desktop/mobile Chromium browser behavior; the mobile-only stage-list case is intentionally skipped on desktop |
| axe WCAG 2 A/AA + 2.1 AA                                                       | No violations in tested views | Ready and fault/recovery views on desktop and mobile                                                                               |
| `npm run format:check`                                                         | Passed                        | Repository Prettier check                                                                                                          |
| `git diff --check`                                                             | Passed                        | Patch whitespace check                                                                                                             |
| `npm audit --omit=dev --json`                                                  | Zero reported vulnerabilities | Production dependency advisories at check time; not a security audit                                                               |
| `npm run benchmark` / `node scripts/benchmark.mjs` after engine build          | Completed                     | Six cases, two warmups and ten measured samples per case; actual samples retained                                                  |

Local environment: Node 24.19.0, Linux x64. The Playwright browser CDN returned truncated archives. A separately installed Chromium 153 binary was used through the existing executable override. This temporary test dependency is outside the repository. CI uses Playwright's matched browser and engine jobs on Node 22 and 24. The final head's CI result is recorded in [PR #1](https://github.com/tupptupp/execution-explorer/pull/1); consult that result rather than treating the starting-point run above as verification of subsequent edits.

Browser tests now build and serve the production bundle, refuse to reuse another server on port 4173, and avoid development-server hot reload. An initial run against the development server had one failure when an engine edit triggered a reload during execution. The complete production-preview rerun passed without retries.

Coverage includes transient retries, inspection, JSON download, replay, persisted reload, deliberate outage recovery preserving completed steps, interruption, stop/resume, competing tabs, malformed checkpoints and malformed localStorage session identifiers. Layout checks cover page overflow, keyboard controls, reduced motion and the mobile stage list. Desktop and mobile screenshots were visually inspected. Mobile means an emulated 390px Chromium viewport, not physical iPhone or Safari validation. Automated axe results do not certify complete WCAG conformance or screen-reader usability.

## Reproduced defects and fixes

- Before the engine fixes, both new regression tests failed: caller mutation while storage was loading caused a deadlock, and a history starting a dependent before its prerequisite completed was accepted. Both pass after the fixes. The runner now copies task metadata, dependency arrays and option values before awaiting storage and checks dependency ordering across historical starts.
- Checkpoint decoding now requires string task IDs, preventing property-key coercion from admitting malformed events. Duplicate terminal events are explicitly regression-tested.
- Session loading now validates the scenario-prefixed UUID before rendering. A malformed current-session pointer falls back to a fresh session; existing IndexedDB records are not deleted. Checkpoint corruption itself still fails explicitly.
- Backoff growth is checked with mocked timers at 99/100 and 199/200 milliseconds, without real-time sleeps.

## Build and benchmark evidence

The verified production build produced approximately **262 kB JavaScript (81.4 kB gzip)** and **20.8 kB CSS (5.6 kB gzip)**. These are Vite bundle sizes, not measured network transfer, Lighthouse or Core Web Vitals.

[benchmark-results.json](benchmark-results.json) contains the final local measurements, CPU, runtime, timestamp, method and all ten samples in measurement order for each case. Percentiles use nearest-rank selection; p95 is the maximum of ten samples. There is no forced garbage collection or memory/RSS measurement. Shared-container load varies; these are illustrative costs, not a regression threshold or a statistically strong performance claim.

Full checkpoints copy and validate the accumulated journal and outputs on every transition. Comparing `none` with `memory (full checkpoint serialization)` exposes this scaling cost. The memory adapter does not measure IndexedDB latency, storage durability or production throughput. Checkpointing remains intentionally scoped to small workflows; a transactional incremental design would be needed to scale it. Browser demo durations include deliberate service waits and retry backoff.

## Deployment and release boundary

No merge, production promotion, Vercel setting or production domain was changed. Main was initially confirmed at `ad514ef62de7d6f5f6ba77001a1ae8493de65a7b`; final remote-head comparison and CI checks are recorded in PR #1.

The production HTML was successfully fetched by a read-only HTTP request and still referenced the original bundle. This does **not** establish end-to-end production functionality. Browser visits to the production/branch-preview URLs encountered network failures, and a subsequent visit was blocked by automatic safety review because of a request to an external Sentry endpoint with an unspecified payload. No attempt was made to bypass that block. Deployed UI behavior remains unverified in this review.

The branch preview was previously reported as requiring Vercel sign-in. That access condition was not successfully reverified here and is not assumed to have changed. A successful Vercel deployment status is not a deployed-browser smoke check. PR #1 remains Draft until the remaining release checks are completed. Local correctness evidence supports code review; public-demo readiness remains conditional.
