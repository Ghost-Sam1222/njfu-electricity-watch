# Collection and notification error privacy

The error boundary accepts only locally authored `PublicError` messages for CLI logs and failure notifications. Unexpected exceptions receive a generic message. Upstream response text, network exception details, URLs and stack traces are not copied to those outputs. HTTP failures keep their numeric status and standard HTTP reason; CAS business failures keep their numeric code.

The collection CLI rejects responses without a finite balance instead of recording a successful empty reading. The existing Actions failure marker preserves the last known balance and marks it as unknown; old successful cache entries still become stale after 18 hours. Failed Bark delivery exits unsuccessfully and does not mark notifications as sent. Failure notifications use the same HTTP/JSON/business-result validation as ordinary notifications.

Proxy subscription URL parsing catches invalid addresses without printing the input. Proxy startup failure reports failure without copying credential-bearing core logs into public Actions output. Core logs remain local to the runner.

## Verification

Run `node --test test/error-privacy.test.mjs`.

All 12 synthetic checks passed. They exercise the actual collection CLI, failure notification, Actions failure-marker command, network-diagnostic entry point and proxy-setup script in disposable directories. Cases cover CAS network/HTTP/business errors, HTML instead of balance data, Bark network/HTTP/JSON/business errors, invalid Bark/base/subscription URLs, and proxy startup logs containing synthetic credentials. The tests assert unsuccessful exit status, absence of the synthetic credential from captured output and failure-notification bodies, preservation of cached balances after query failure, failure visibility, and stale-cache classification.

The collection CLI initially failed five of the first nine checks: four credential disclosures and an HTML response incorrectly recorded as success. Separate tests then reproduced invalid diagnostic/subscription URL disclosures and proxy core-log disclosure before their fixes.

No real credentials, school queries, notifications, Actions runs or deployments are used by this verification. It validates error handling with mocked failures, not the availability of any external service.

## Dashboard consumer verification

Run `node --test test/dashboardConsumer.test.mjs`. Three focused checks execute the existing `docs/app.js` page entry point with synthetic fetch responses and DOM/canvas sinks. Failure snapshots come from the real `mark-collection-failure.mjs` command in disposable directories; balance alerts come from the existing threshold evaluator with synthetic 70/40/20 bands.

Cached 70/40/20 balances already render as unavailable after failure or expiry, with the failure/stale status taking priority over their old balance alerts. Recent successful balances retain their warning/critical appearance. Unknown readings render as `--`, without inventing zero.

One gap was reproduced before the fix: the very first failed collection, with no prior success timestamp, rendered as “无数据” instead of “采集失败”. The status classifier now checks explicit failure before absence of timestamps. All three checks pass. This verifies the real JavaScript consumer and generated card markup, but does not test browser pixels, external hosting or live data.
