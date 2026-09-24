---
name: shop-pay-integration
description: "Use when working on Shop Pay checkout, session conflicts, CORS, ngrok URLs, stale bundles, order confirmation redirects, webhook reconciliation, or checkout build errors such as polyfill, manifest, and card-validator failures."
---

# Shop Pay Integration Workflow

## Token-efficient execution

- Start from the exact user error, URL, file, route, or command; do not scan all repositories.
- Read only the owning implementation and one nearby test/call site before editing.
- State one local hypothesis and one discriminating validation check, then act.
- Use parallel reads for independent files and avoid pasting generated bundles into context.
- Inspect generated `build`/`dist` files only with targeted string checks after source changes.
- Run the narrowest validation first; do not run broad tests unless the focused check requires it.
- Keep progress updates and final reports concise; record durable facts here instead of rediscovering them.

## Repository scope

- Use only the primary repositories: `C:\Project\checkout-js`, `C:\Project\shop-pay-backend`, and `C:\Project\Cornorstone\Cornerstone-6.21.0`.
- Do not use `C:\Project\repo-install-check` for active builds or runtime.
- Keep Shopify credentials and webhook secrets server-side. Never print `.env` values.

## Runtime map

- Checkout dev loader is served from the primary checkout build on port 8081.
- Backend runs from the primary backend project on port 8787.
- Ngrok URLs rotate. Query the local ngrok API before assuming a URL: `http://127.0.0.1:4040/api/tunnels` for checkout and `http://127.0.0.1:4041/api/tunnels` for backend.
- When the backend URL changes, update `packages/shop-pay-integration/src/shopPayConfig.ts` and backend `.env` `ALLOWED_ORIGIN`, rebuild, and verify the public bundle.

## Required checkout flow

1. Shop Pay button click creates a session; never create sessions during render or mount.
2. Each new attempt uses a unique `sourceIdentifier` (`bc-{cartId}-{uuid}`). Reuse the idempotency key only inside that attempt.
3. `paymentcomplete` must wait for backend submit completion and require both `bcOrderId` and `confirmationToken`.
4. The confirmation URL must remain `/checkout/order-confirmation?orderId=...&shopPay=1&confirmationToken=...`.
5. Use in-app `history.replaceState` plus `popstate` and render `ShopPayOrderConfirmation` from `CheckoutPage`; a full native route request can 302 to cart for externally created orders.
6. Delete the BigCommerce cart only after the authenticated confirmation endpoint retrieves the order.

## Backend safeguards

- Persist session mappings; the current POC uses atomic file-backed `data/shop-pay-sessions.json`. Use managed Redis/Postgres for multi-instance production.
- Verify webhook HMAC using the raw request body and set a real `SHOPIFY_WEBHOOK_SECRET` before enabling webhook processing.
- Treat duplicate Shopify order webhooks as idempotent.
- Current flow creates the BigCommerce order during `/shop-pay/submit`; the webhook reconciles it. Do not claim full webhook-created order flow without changing this contract.

## Troubleshooting checklist

- CORS error: test `OPTIONS /shop-pay/session` with `Origin: https://integrateshoppay.mybigcommerce.com`; restart backend after `.env` changes.
- `409 Conflict`: inspect `sourceIdentifier`; a reused `bc-{cartId}` means an old in-memory/persisted session is being reused.
- `502` from checkout ngrok: confirm the static server port matches the tunnel target; serve `build` on 8081.
- Old backend URL in browser: inspect the exact public `/checkout.js`; regenerate the `build` directory, not only `dist`.
- Confirmation 302/404: preserve the exact checkout confirmation URL and in-app navigation behavior.
- Polyfill/manifest/card-validator errors: run the primary build, inspect the first TypeScript error, and fix the owning source before changing generated output.

## Validation commands

- `npx jest packages/shop-pay-integration/src/shopPayClient.test.ts packages/utility/src/navigateToOrderConfirmation.test.ts --runInBand`
- `npx webpack --mode development`
- `npx nx run core:build --skip-nx-cache`
- Backend: `node --check server.js` and `GET http://localhost:8787/health`

## Demo video

- Recorder: `scripts/record-shop-pay-demo.mjs`.
- Run from primary checkout: `$env:SHOP_PAY_DEMO_URL='https://integrateshoppay.mybigcommerce.com/checkout'; node scripts/record-shop-pay-demo.mjs`.
- Output is written under `packages/test-framework/videos/shop-pay-demo`.
- The Shop Pay wallet/payment step is intentionally manual; complete it in the headed browser during the recording window.

## Backlog status

- Core MVP flow is implemented: Shop Pay session, payment request, address/delivery updates, discount updates, submit, BigCommerce order creation, confirmation display, and delayed cart cleanup.
- Remaining MVP work: ATP eligibility checks and ATP delivery time slots (SHP-06, SHP-15, SHP-25).
- Partially implemented: webhook setup/order reconciliation (listener and duplicate protection exist, but current BigCommerce creation is submit-time); session persistence is local JSON, not managed storage.
- Out of scope per the sheet: CI/CD, reconciliation job, fulfillment sync/monitoring, fraud integration, OmniTracks, truck eligibility extension, and Google address correction.

## Known runtime facts

- `d8ff.../auto-loader-dev.js` is the checkout tunnel and must target localhost:8081. `e1bd...` is the backend tunnel and must target localhost:8787; they are different services.
- A `502` from d8ff usually means the checkout static server is stopped or running on 8080 instead of 8081.
- A browser request to the old `6e89...` URL means stale `build/checkout.js` or a `window.shopPayBackendUrl` override is loaded. Inspect the public `/checkout.js`, regenerate `build`, and hard-refresh.
- A `302` from `/checkout/order-confirmation` is BigCommerce native route handling. Shop Pay must use in-app history navigation so the custom confirmation renders before the native route can redirect to cart.
- An empty `SHOPIFY_WEBHOOK_SECRET` intentionally causes webhook requests to return 401; never work around this by disabling HMAC verification.
