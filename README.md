# Temporal real-world examples

Companion project for *Temporal with Node.js – The Complete Practical Tutorial*.
15 scenarios, one folder each under `src/`, each with a test under `test/`.

| Scenario | Topics | Guide |
|---|---|---|
| `payments` | Activities, retries, idempotency, typed failures | 6.5 |
| `travel-search` | Parallel + local activities, partial failure | 7.5 |
| `shopping-cart` | Signals, queries, updates, validators | 11.1 |
| `free-trial` | Durable timers | 12.3 |
| `reports` | Schedules (time zone, overlap, catch-up) | 12.4 |
| `loan-application` | Error types, timeouts | 13.5 |
| `video-transcoding` | Heartbeats, resume, cancellation | 14.1 |
| `onboarding` | Child workflows | 15.4 |
| `loyalty` | Entity workflow, continue-as-new | 15.5 |
| `email-campaign` | Bounded fan-out, pagination | 15.6 |
| `trip-booking` | Saga compensation | 16.1 |
| `expense-approval` | Human-in-the-loop, escalation | 16.2 |
| `kyc-verification` | Polling via retry policy | 16.3 |
| `document-review` | Async activity completion | 16.4 |
| `versioning` | patched / deprecatePatch / replay tests | 17.3 |

```bash
npm install
npm test          # 35 tests on Temporal's time-skipping test server (~30 s)
npm run typecheck
npm run format
```

No Temporal server is needed: tests download Temporal's test server on first run
(`reports` uses the local dev server, also downloaded automatically).

`package.json` pins `@swc/core` to 1.16.2 via `overrides`: 1.16.13 failed to load its
native binding on the verification machine (Windows, native cache permission check).

Verified with Node 24.15, @temporalio/* 1.24.0, TypeScript 7.0.2.
