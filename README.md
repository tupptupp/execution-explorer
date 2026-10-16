# Execution Explorer

**An independent design-engineering portfolio concept by Martin Carlsson.**

**[▶ Try the live demo](https://execution-explorer-sigma.vercel.app)** · [Source code](https://github.com/tupptupp/execution-explorer)

A responsive observability interface for examining workflow executions, failure states, retries, and step-by-step traces. Built to explore how complex operational data can be made more understandable through interaction design.

> **Demo only.** All execution records and metrics are synthetic. This application has no backend and does not connect to Restate or any other company's production systems. It is not an official product.

## Features
- Search by execution name, ID, or workflow
- Filter by status and environment
- Select a run to inspect a multi-stage timeline
- Inspect errors, retries, durations, and stage descriptions
- Responsive desktop and mobile layout
- Copy execution IDs where browser clipboard access is available

## Stack
React 19, TypeScript, Vite, Lucide icons, CSS.

## Local setup
```bash
npm install
npm run dev
```

Production build:
```bash
npm run build
npm run preview
```

## Design notes
This project prioritizes information hierarchy, quick scanning, status clarity, accessible native controls and drill-down inspection. The sample data is intentionally deterministic so UI states can be reviewed without API credentials.

## Scope & attribution
Concept, product direction and visual review: **Martin Carlsson**. Implementation developed with **AI-assisted engineering**. This project is a standalone demonstration and uses no proprietary code, assets or customer data from Formodo.

**Verification:** Successfully deployed on Vercel. The project owner reported passing five manual functional checks covering search, status filters, execution timeline, environment filters and mobile layout. These are manual checks, not automated test coverage or a security audit.
