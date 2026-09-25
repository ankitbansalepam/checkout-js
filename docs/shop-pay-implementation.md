# Shop Pay implementation: step by step

This guide walks through how Shop Pay was added to the BigCommerce custom checkout, in the order you would build or rebuild it. For the backend route details and the history of issues found along the way, see `shop-pay-backend/INTEGRATION_GUIDE.md`. For diagrams of each flow, see [shop-pay-flow-diagrams.md](shop-pay-flow-diagrams.md), and for the architecture, [shop-pay-architecture.md](shop-pay-architecture.md).

## How it fits together

| Part | Repository | Hosted at | Role |
| --- | --- | --- | --- |
| Custom checkout | `checkout-js` | `https://checkout-js-weld.vercel.app/auto-loader.js` | Renders the Shop Pay button, opens the Shop Pay popup, keeps the BigCommerce checkout in sync |
| Backend | `shop-pay-backend` | `https://shop-pay-backend.vercel.app` | Holds all secrets; calls the Shopify Storefront API and the BigCommerce API |
| Storefront | `Cornerstone-6.21.0` | `https://shoppaystore.mybigcommerce.com` | BigCommerce Stencil theme; loads the custom checkout |
| Shopify store | — | `mynewstore-9969.myshopify.com` | Processes the Shop Pay payment and creates the Shopify order |

BigCommerce stays the order of record. Shopify takes the payment. Every successful checkout therefore creates two linked orders: one in Shopify and one in BigCommerce.

```
Shopper clicks Shop Pay (checkout-js)
  → Shop Pay popup (shop.app) asks for a session
  → backend creates a Shop Pay session (Shopify Storefront API)
  → shopper confirms address, delivery and card in the popup
  → backend submits the payment (Shopify) and creates the order (BigCommerce)
  → checkout shows the order confirmation
```

## Part 1: Set up Shopify

1. **Create a Shop Pay Commerce Component store.** A regular Shopify store can't use the Shop Pay Wallet API. Sign up through the Shop Pay Wallet link on [Get started with Shop Pay Wallet](https://shopify.dev/docs/api/commerce-components/pay). This project uses `mynewstore-9969.myshopify.com`.
2. **Turn on Shopify Payments in test mode**, so test cards such as `4242 4242 4242 4242` work.
3. **Install the Shop sales channel.** Note the **Shop ID** (`76503548087`) and the **Shop Pay client ID**.
4. **Allow the checkout domain.** Add `https://shoppaystore.mybigcommerce.com` to the Shop Pay domain allow list.
5. **Create a Storefront API access token** with the Shop Pay payment request scopes. The backend uses it as `STOREFRONT_API_TOKEN`.
6. **Create an Admin API access token** (`shpat_…`). The backend uses it as `ADMIN_API_TOKEN` for reconciliation, and it's also handy for checking orders when troubleshooting.
7. **Create the `orders/create` webhook in Shopify Admin** (Settings → Notifications → Webhooks → Create webhook: Order creation, JSON, URL `https://shop-pay-backend.vercel.app/webhooks/shopify/orders`). Copy the key shown under "Your webhooks will be signed with …" into Vercel as `SHOPIFY_WEBHOOK_SECRET`, redeploy, and click **Send test notification**. Don't create it through the Admin API: the Shop channel app doesn't show the secret that signs app-created webhooks, so every delivery would be rejected.

## Part 2: Set up BigCommerce

1. **Create an API account** (Settings → API → Store-level API accounts) with at least:
   - Orders: modify (the backend creates and updates orders)
   - Carts: modify (the backend reads the cart's customer and deletes the cart after the order)
   - Products: read-only (the backend maps Shop Pay line items to products by SKU)
2. Note the **store hash** (`ocqei08gqj`) and the **access token**.
3. **Give every product a unique SKU.** The backend finds BigCommerce products by SKU when it creates the order.
4. **Configure shipping zones and tax** as you want shoppers to be charged. Shop Pay shows BigCommerce's shipping options and totals, including tax on shipping if tax applies to it.

## Part 3: Build and deploy the backend

The backend is a single Express app, `shop-pay-backend/server.js`.

1. **Install and configure locally.**
   ```powershell
   cd C:\Project\shop-pay-backend
   npm install
   ```
   Create `.env` with the values below. Never commit it or print its values.

   | Variable | Value |
   | --- | --- |
   | `SHOP_DOMAIN` | `mynewstore-9969.myshopify.com` |
   | `SHOP_ID` | Shopify shop ID |
   | `STOREFRONT_API_TOKEN` | From Part 1, step 5 |
   | `ADMIN_API_TOKEN` | From Part 1, step 6 |
   | `SHOPIFY_WEBHOOK_SECRET` | From Part 1, step 7 |
   | `SHOPIFY_API_VERSION` | `2025-07` |
   | `BIGCOMMERCE_STORE_HASH` / `BIGCOMMERCE_ACCESS_TOKEN` | From Part 2 |
   | `BIGCOMMERCE_CREATE_ORDER` | `true` |
   | `BIGCOMMERCE_PAID_STATUS_ID` | `11` (Awaiting Fulfillment) |
   | `ALLOWED_ORIGIN` | Comma-separated storefront origins, e.g. `https://shoppaystore.mybigcommerce.com` |

2. **Understand the routes.**

   | Route | Called when | What it does |
   | --- | --- | --- |
   | `POST /shop-pay/session` | The popup asks for a session | Validates the cart, calls `shopPayPaymentRequestSessionCreate`, stores the session with a random confirmation token |
   | `POST /shop-pay/submit` | The shopper presses Pay now | Merges the final shipping lines and totals, rejects the payment unless the total equals BigCommerce's checkout total, calls `shopPayPaymentRequestSessionSubmit` with an idempotency key. This only starts payment processing; no order is created yet |
   | `POST /shop-pay/complete` | Shop Pay reports the payment complete | Finds the Shopify order for the session (Admin API), checks it is paid and its total matches, then creates the BigCommerce order (linked to the signed-in customer, if any). Answers 202 while Shopify is still creating the order |
   | `GET /bigcommerce/orders/:id` | The confirmation page loads | Checks the confirmation token (valid for 15 minutes), returns the order, deletes the BigCommerce cart |
   | `POST /webhooks/shopify/orders` | Shopify creates an order | Verifies the HMAC. If checkout never completed the payment (e.g. the tab was closed), creates the BigCommerce order; otherwise makes sure it is marked paid |
   | `GET /health/webhooks` | Daily Vercel cron (09:00 UTC), or by hand with `Authorization: Bearer <CRON_SECRET>` | Reports verified webhook deliveries, rejections and failures, and paid Shopify orders still without a BigCommerce order after 10 minutes; 503 when something is wrong |
   | `POST /delivery/options` | The shipping step and Shop Pay load | Says whether the cart needs scheduled (truck) delivery and which dates are available for the address (mock ATP); see diagram 7 in [shop-pay-flow-diagrams.md](shop-pay-flow-diagrams.md) |
   | `GET /health` | Anytime | Liveness check |

3. **Deploy to Vercel.**
   ```powershell
   vercel --prod
   ```
   This uploads the folder; it isn't deployed from git. Add the `.env` values as Vercel environment variables. `.vercelignore` keeps `.env`, `data/` and logs out of the upload.
4. **Check the deployment.**
   ```powershell
   curl https://shop-pay-backend.vercel.app/health
   curl -i -X OPTIONS -H "Origin: https://shoppaystore.mybigcommerce.com" -H "Access-Control-Request-Method: POST" https://shop-pay-backend.vercel.app/shop-pay/session
   ```
   The preflight must return `204`. For another storefront domain, add it to `ALLOWED_ORIGIN` in Vercel and run `vercel redeploy`.

Sessions are stored in Upstash Redis (`upstash-kv-cobalt-drawer`, iad1, connected via Vercel Marketplace; env `KV_REST_API_URL`/`KV_REST_API_TOKEN`), keyed `shop-pay:session:{sourceIdentifier}` plus `shop-pay:order:{bcOrderId}`, 7-day TTL. Without those env vars `sessionStore.js` falls back to a JSON file (`SESSION_STORE_PATH`), which suits only a single local process. The startup log says which store is in use.

## Part 4: Build the checkout-js package

The Shop Pay code lives in `packages/shop-pay-integration/src`.

1. **`shopPayConfig.ts`** returns the backend URL (`https://shop-pay-backend.vercel.app` by default), the Shop Pay client ID and the shop ID. `window.shopPayBackendUrl`, `window.shopPayClientId` and `window.shopPayShopId` override them.
2. **`shopPaySdk.ts`** loads Shopify's script (`https://cdn.shopify.com/shopifycloud/shop-js/shop-pay-payment-request.js`) and builds the payment request from the BigCommerce cart: line items, discounts, delivery methods (the consignment's shipping options), the selected shipping line, tax and total.
3. **`shopPayClient.ts`** calls the backend's `/shop-pay/session` and `/shop-pay/submit`.
4. **`ShopPayButton.tsx`** creates the Shop Pay session when the button is clicked (never on render) and handles the popup's events:

   | Event | Handling |
   | --- | --- |
   | `sessionrequested` | Creates the backend session with a new `sourceIdentifier` (`bc-{cartId}-{uuid}`) and returns its token |
   | `shippingaddresschanged` | Updates the BigCommerce shipping address, re-selects a shipping option, returns rebuilt totals |
   | `deliverymethodchanged` | Selects the same shipping option in BigCommerce, then rebuilds the shipping line and total |
   | `discountcodechanged` | Applies or removes BigCommerce coupons and reports invalid codes |
   | `paymentconfirmationrequested` | Submits the payment to the backend with one idempotency key per attempt |
   | `paymentcomplete` | Calls `/shop-pay/complete` (retrying while Shopify is still creating its order), then closes the popup and opens the confirmation |
   | `windowclosed` | Re-enables the button |

   The button stays disabled while a request is in progress, so a shopper can't start two sessions.
5. **`ShopPayCheckoutControl.tsx`** is the component checkout renders. It reads checkout state through `useCheckout` with a selector, and:
   - decides placement (see Part 5);
   - updates the BigCommerce shipping address when Shop Pay sends one, creating the shipping record first if checkout has none;
   - re-selects a shipping option afterwards. Changing the address clears BigCommerce's selected option, and a payment request without a shipping line makes Shopify decline the payment.

## Part 5: Wire it into checkout

1. **Two placements, one button.**
   - `packages/core/src/app/checkout/components/CheckoutHeader.tsx` renders the control with `placement="top"` ("Checkout with Shop Pay").
   - `packages/core/src/app/payment/PaymentForm.tsx` renders it with `placement="payment"`, among the payment methods.

   | Shopper | Where Shop Pay appears |
   | --- | --- |
   | Signed in | Top |
   | Guest whose addresses were already on the checkout when it loaded | Top |
   | Guest who enters addresses during checkout | Payment methods, and it stays there |

2. **Order confirmation.** `navigateToShopPayOrderConfirmation` (in `packages/utility/src/navigateToOrderConfirmation.ts`) changes the URL to `/checkout/order-confirmation?orderId=…&shopPay=1&confirmationToken=…` without reloading the page. `CheckoutPage.tsx` sees the change and renders `ShopPayOrderConfirmation`, which fetches the order from the backend. A full page load of the native confirmation route would redirect to the cart, because BigCommerce can't find orders created through its API there.

## Part 6: Build and deploy checkout-js

1. **Test and build.**
   ```powershell
   npx jest packages/shop-pay-integration/src packages/utility/src/navigateToOrderConfirmation.test.ts --runInBand
   npx nx run core:build --skip-nx-cache
   ```
2. **Deploy.** Push to `master`. Vercel builds with `NX_SKIP_NX_CACHE=true npm run build` and publishes `dist` to `https://checkout-js-weld.vercel.app`. Check progress with `vercel ls checkout-js`.
3. **Confirm the new code is live.** Fetch `auto-loader.js`, find the `checkout-*.js` file it lists, and search that file for a name from your change. Shoppers need a hard refresh (Ctrl+Shift+R) to pick up a new version.

## Part 7: Point the storefront at the custom checkout

1. In the BigCommerce control panel, open **Settings → Checkout**, choose the custom checkout, and set the script URL to `https://checkout-js-weld.vercel.app/auto-loader.js`.
2. No Cornerstone theme change is needed for Shop Pay. The theme's checkout and order-confirmation templates must stay in place, because checkout-js renders into them.

## Part 8: Test end to end

| Scenario | Expected result |
| --- | --- |
| Guest enters addresses during checkout | Shop Pay only in the payment methods; paying creates a guest order |
| Signed-in shopper | Shop Pay at the top; the BigCommerce order has their customer ID |
| Change the shipping address in the popup | Shipping method re-selected; payment succeeds |
| Change the delivery method in the popup | Shipping on the BigCommerce order matches the popup |
| Apply a discount code in the popup | Valid codes reduce the total; invalid codes show an error |
| After paying | Confirmation page shows the order; the cart is empty |

After each payment, check:
- **Shopify admin → Orders:** a paid order whose `sourceIdentifier` starts with `bc-{cartId}`.
- **BigCommerce → Orders:** the matching order with the same items, shipping and total.

## Part 9: Troubleshooting

1. **Backend logs:** `vercel logs shop-pay-backend.vercel.app --since 30m --expand`. A `POST /shop-pay/session` with no `POST /shop-pay/submit` after it means Shopify rejected the payment inside the popup and never asked the backend to submit.
2. **"There was an issue with your selected payment method":**
   - If the saved card is listed but not selected, click it, then press Pay now. Shopify controls card selection, and checkout can't preselect it.
   - If it happens after the address changed, check that the shipping method was re-selected (Part 4, step 5).
   - The popup's own console (right-click in the popup → Inspect) shows Shopify's reason; the checkout page's console doesn't.
3. **CORS errors:** the storefront origin is missing from `ALLOWED_ORIGIN` (Part 3, step 4).
4. **Old behaviour after a deploy:** the browser is using a cached bundle; hard-refresh, and confirm the change is live (Part 6, step 3).
5. **`Unknown sourceIdentifier` on submit:** the submit reached a different Vercel instance than the session; see the note at the end of Part 3.

## Recording a demo

`scripts/record-shop-pay-demo.mjs` records a narrated demo of a guest checkout paid with Shop Pay and saves `packages/test-framework/videos/shop-pay-demo/shop-pay-demo.mp4`. It needs ffmpeg (set `FFMPEG_PATH`). You sign in to Shop Pay and press Pay now yourself when the popup opens.

```powershell
$env:FFMPEG_PATH = '<path>\ffmpeg.exe'
node scripts/record-shop-pay-demo.mjs
```
