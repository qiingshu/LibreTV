# LibreTV 2.21.0 production security candidate

Prepared 2026-11-10. Review only; do not merge, deploy, or change production until ChatGPT consolidates the incremental review and the user issues a release instruction.

## Baseline and scope

Production is OVH `vps-bfd15009`, container `libretv-trial-web-1`, package 2.21.0. Immutable image `ghcr.io/librespark/libretv@sha256:009fbfba569032ea38efc07b5f7ec51724e0e14a4b7a27a2848774e2323992ca`, OCI revision `b08c8242d2a3cdb4309b40c58001c69c04593ce1`. Empty docker diff and no mounts; nextjs user; only 127.0.0.1:18080. Full sanitized current Compose/Nginx baseline and hashes are in evidence/production-baseline.json. Environment secrets/source values intentionally redacted.

This fork's main at `7542ea18dda446f27f93c28b72fe62f205bae263` is 1.1.0. **Do not build its root Dockerfile.** This PR adds a deployment package, not a replacement of production with the old fork. The candidate is exactly upstream production revision plus security.patch. The patch and final complete changed files under source/ allow line-by-line review. SHA256SUMS covers all supplied artifacts. package-lock.json is supplied in full; no unrelated lock updates.

Reviewed final released v2.21.2 SSRF implementation, not merely PR #960. Extracted only connection-aware safe callback DNS lookup, per-fetch undici dispatcher, literal checks, agent shutdown and fetch-utils integration plus locked undici 6.21.1. No player/UI/store changes. Upstream's live intent flag must additionally require LIVE_ALLOW_PRIVATE=1 at the connection scope; this patch adds that gate. Extended IPv6 link-local /10, normalized expanded IPv6, CGNAT /10 and multicast/reserved denial. Normal search/image/media callers never request a live exemption. Production LIVE_ALLOW_PRIVATE is currently unset and remains unset.

v2.22.0 also changes persistence and 18 files beyond v2.21.2, so it is deferred. This candidate does not require mobile UI changes; no claim of iPhone device validation.

Sources: https://github.com/LibreSpark/LibreTV/pull/960 ; https://github.com/LibreSpark/LibreTV/releases/tag/v2.21.2 ; https://github.com/LibreSpark/LibreTV/releases/tag/v2.22.0 .

## Validation

127 tests across 9 related files plus 1 positive strict DNS/stream fixture test passed, with full readable output in evidence/. Covers preflight-to-connection rebinding, mixed DNS answers, loopback/private/mapped/link-local IPv6, redirects, live flag absent/present, pool separation, delayed stream consumption after agent.close, login/logout/session checks, search, HLS key/map/segment rewriting, Range streaming, and playback recovery. Fixtures only: no real internal services or public vulnerability probes. The public DNS success fixture validates safeLookup then routes the checked result to its own local server. Node's forbidden port 9 initially preempted the connector assertions; corrected to a non-forbidden port before the passing run.

Typecheck and final production Next build passed; outputs included. Independent local candidate at 127.0.0.1:18081 passed eight built-route HTTP checks with a fixture password (runtime.json). Existing October browser evidence is reused for unchanged UI/playback behavior; these new tests do not claim actual media decoding or real iPhone Safari verification. No production password, real notification, paid model, or production write used.

## Independent candidate and release plan

1. Review this directory only. Run `bash prepare.sh` in an isolated checkout. It checks hashes, clones upstream and pins the production revision, then applies the patch. No old fork files enter candidate-source.
2. For candidate testing only, create `candidate.env` mode 600 with fixture password/sources. Keep LIVE_ALLOW_PRIVATE unset. Run npm ci/test/typecheck/build in candidate-source, or build using `docker compose -f compose.candidate.yaml build`. Use the unique project name and port 127.0.0.1:18081; confirm it is unused first. No Nginx/DNS/production port changes. No volume mounts. Do not mount /opt/libretv-trial anywhere.
3. For later approved production release, record the newly built image digest and source patch hash, inspect image and compare env keys/options to the saved baseline. Back up current Compose and .env locally on the host with mode 600; never print .env. Preserve the exact PASSWORD, DEFAULT_SOURCES, DEFAULT_RECOMMEND_SOURCE and LIVE_ALLOW_PRIVATE absence/current value. Keep origin hostname, Nginx login/session/cache controls and browser origin unchanged, preserving browser history/settings/IndexedDB. Current server has no mounted user data.
4. Await the user's release instruction. No production traffic switching or deployment commands have been executed here. A newly built image digest must be recorded before release; it is not the upstream 2.21.2 image and must not be mislabeled as that release.

## Recovery

Candidate recovery: stop only Compose project libretv-security-candidate-20261110 and remove only its own candidate containers; preserve fixture/evidence files. Production remains running independently.

If a future authorized release fails: restore only the backed-up production Compose image reference to the exact original digest above, retain the unchanged environment file and 127.0.0.1:18080 binding, and recreate only the web service with --no-deps --no-build --pull never. No compose down, no production directory deletion, no Nginx/DNS change and no browser storage clearing. Original image must be retained and verified locally before the release. Check status, authentication, search, proxy/HLS Range and playback after rollback. This is a reversible code-only change with no migrations.

Remaining limits: Docker image build/runtime on the target host and actual device/media decoding acceptance remain release-stage checks; local Next candidate runtime and related fixtures provide the current evidence. This PR must not be treated as a production deployment.
