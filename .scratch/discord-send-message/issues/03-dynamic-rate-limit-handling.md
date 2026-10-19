# 03: Dynamic Rate-Limit Handling (HTTP 429 & Retry-After)

**What to build:**
Handle Discord's HTTP 429 rate limits gracefully. When Discord returns a rate limit response with `retry_after`, dynamically delay the worker execution and retry up to 3 times before failing the run.

**Blocked by:** 01: Core Plain-Text Discord Action (Tracer Bullet)

**Status:** ready-for-agent

- [x] Inspect HTTP 429 response headers (`Retry-After`) and response body (`retry_after` in seconds)
- [x] Implement dynamic sleep in `sendDiscordMessage` before retry
- [x] Unit/integration tests simulating Discord 429 followed by 200 success
