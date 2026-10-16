# Verification report

Recorded on 2026-10-16. Claims below refer to this development revision, not the original production demo. Commands are reproducible from the repository root with dependencies installed.

## Automated checks actually executed locally

| Check                                             | Result                                         | Scope                                                                          |
| ------------------------------------------------- | ---------------------------------------------- | ------------------------------------------------------------------------------ |
| `npm run build`                                   | Passed                                         | Strict TypeScript frontend compilation and Vite production bundle              |
| `npm --prefix packages/workflow-engine run check` | Passed                                         | Isolated strict engine typecheck                                               |
| `npm run test:engine`                             | 34 passed                                      | Node test runner, including 20 deterministic seeded DAG shapes inside one test |
| `npm run test:e2e`                                | 16 passed                                      | Eight scenarios in desktop and mobile Chromium configurations                  |
| axe WCAG 2 A/AA + 2.1 AA checks                   | No violations in tested views                  | Ready and fault/recovery views, desktop and mobile                             |
| `npm audit --omit=dev`                            | Zero reported vulnerabilities at time of check | Production dependency advisory scan, not a security audit                      |

Local runtime: Node 24.19.0 on Linux x64. Browser tests used Chromium 153 from a separately installed test binary via `PLAYWRIGHT_CHROMIUM_EXECUTABLE` because the default Playwright CDN returned invalid archives in the execution environment. That workaround is not a project dependency. CI uses Playwright's matched browser download and Node 22/24 engine jobs. CI also passed for implementation commit `4b9d77cda860e3fb0b975a6b02abae0101a5d564`: [GitHub Actions run](https://github.com/tupptupp/execution-explorer/actions/runs/38918005550). Both Node 22/24 engine jobs and the complete console/browser job succeeded with Playwright’s matched browser download.

Browser coverage includes a real transient retry, immutable inspector output, JSON download, event scrubbing, persisted reload, outage acknowledgement and recovery without rerunning completed entry steps, reload during active execution, stop and resume, competing tabs, keyboard skip link, reduced-motion preference, and page-width overflow. Mobile uses a 390px viewport in Chromium; it is not a physical iPhone or Safari test. Focus, native controls and the graph were also inspected in generated desktop/mobile screenshots. Automated axe checks do not certify complete accessibility or screen-reader usability.

## Measured build size

The local build at this verification point produced approximately **261 kB JavaScript (81 kB gzip)** and **19 kB CSS (5.3 kB gzip)**. Exact filenames and sizes can change with code changes. These are Vite build outputs, not measured network transfer or Core Web Vitals. There are no runtime image, video or webfont downloads, WebGL libraries, analytics scripts or always-running animation loops.

## Measured engine costs

`npm run benchmark` builds the engine and runs `scripts/benchmark.mjs`. Raw results, timestamp, runtime, CPU and methodology are in [benchmark-results.json](benchmark-results.json). Each case uses a serial no-I/O chain, two warmups and ten measured samples. Percentiles use nearest-rank selection; p95 is effectively the slowest of these ten samples. The measurements are illustrative microbenchmarks from one shared container, not statistically strong throughput guarantees.

Compare the `none` and `memory (full checkpoint serialization)` cases. Full snapshots copy the entire journal and accumulated outputs on every transition; larger cases expose significant overhead. The memory adapter measures validation/copy/serialization overhead, **not real IndexedDB latency or disk durability**. Browser task durations additionally include deliberate simulated service waits, timer scheduling, storage, rendering and retry backoff.

There is no claim of production throughput, distributed safety, exactly-once effects, power-loss durability, Lighthouse score, Core Web Vitals, or a penetration test.

## Deployment and release

Implementation commit `4b9d77cda860e3fb0b975a6b02abae0101a5d564` passed local checks and GitHub Actions. Vercel reported the separate deployment successful at 2026-10-16 14:43 UTC. The [branch preview](https://execution-explorer-git-feature-workflo-b64f9e-tupptupp1337-3910.vercel.app) redirected the verification browser to Vercel login. Its deployed UI therefore has **not** yet been independently smoke-tested. The preview is not currently a publicly accessible portfolio demo; Vercel access and a deliberate public-preview release decision remain required. No authentication protection was disabled.

The development branch is verified before updating its PR. Vercel's GitHub integration can create a branch preview without changing the production alias. Live-preview and GitHub Actions outcomes are linked from PR #1 once available. `main` and the original production deployment must remain unchanged until an explicit release decision. A Vercel build-success status alone does not prove browser behavior; the preview needs a separate smoke check.
