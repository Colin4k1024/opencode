---
name: verification-loop
description: How to design verification loops, regression, and observability
---

# Verification Loop

## Design
- Define “done” as testable outcomes: tests pass, metrics in range, no known regressions
- Run checks as close to the change as possible: pre-commit (lint, unit), CI (build, test, e2e), and post-deploy (smoke, canary)
- Automate the loop: commit → build → test → deploy → verify; manual gates only where necessary

## Regression
- Keep a stable core: unit tests for business logic; integration tests for critical paths
- Tag flaky tests and fix or quarantine; do not let flakiness block the main branch
- Use baselines for visual or performance tests; update intentionally with explicit review

## Observability
- Log with structure (JSON, levels); include correlation ids across services
- Metrics: latency, error rate, throughput for key operations; alert on SLO breaches
- Traces: span key operations; sample in production to control cost
- Dashboards: one per service or flow; avoid unused or stale panels

## Feedback
- Fail fast in CI; surface errors clearly in the PR or commit status
- Post-deploy: run smoke tests and watch error rate; rollback or fix-forward based on runbooks
