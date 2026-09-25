# Shop Pay architecture

How the Shop Pay integration is built and deployed: the modules in each repository, the services they depend on, and where everything runs. For step-by-step flows, see [shop-pay-flow-diagrams.md](shop-pay-flow-diagrams.md); for setup, see [shop-pay-implementation.md](shop-pay-implementation.md).

## 1. Component architecture

The code modules in `checkout-js` and `shop-pay-backend`, and what each one calls.

```mermaid
flowchart TB
    subgraph Storefront["BigCommerce storefront (Cornerstone theme)"]
        Page["/checkout page<br/>loads auto-loader.js"]
    end

    subgraph CheckoutJS["checkout-js (browser)"]
        direction TB
        subgraph Core["packages/core — mount points"]
            Customer["GuestForm / LoginForm<br/>(customer step)"]
            Header["CheckoutHeader<br/>(top button)"]
            ShipFooter["ShippingFormFooter +<br/>ShippingOptionsForm<br/>(shipping step)"]
            PayForm["PaymentForm<br/>(payment step)"]
            Confirm["CheckoutPage →<br/>ShopPayOrderConfirmation"]
        end
        subgraph SPI["packages/shop-pay-integration"]
            Login["ShopPayLoginControl<br/>Shop Pay sign-in"]
            Control["ShopPayCheckoutControl<br/>placement, checkout sync"]
            Button["ShopPayButton<br/>popup events"]
            Sched["scheduledDelivery +<br/>ScheduledDeliveryFields"]
            Sdk["shopPaySdk<br/>payment request"]
            Client["shopPayClient<br/>backend calls"]
            Config["shopPayConfig<br/>backend URL, IDs"]
        end
        Nav["packages/utility<br/>navigateToShopPayOrderConfirmation"]
    end

    subgraph Backend["shop-pay-backend (Node / Express)"]
        direction TB
        Routes["server.js routes<br/>/shop-pay/session · submit · complete<br/>/delivery/options · /bigcommerce/orders/:id<br/>/webhooks/shopify/orders · /health/webhooks"]
        Validation["validation.js<br/>cart, totals"]
        Delivery["delivery.js<br/>scheduled delivery, mock ATP"]
        Store["sessionStore.js<br/>sessions, locks, pending, stats"]
    end

    Redis[("Upstash Redis")]

    subgraph ShopifyExt["Shopify"]
        ShopJS["Shop Pay SDK<br/>cdn.shopify.com"]
        PopupExt["Shop Pay popup<br/>shop.app"]
        StorefrontAPI["Storefront API<br/>payment request session"]
        AdminAPI["Admin API<br/>orders"]
        Webhook["orders/create webhook"]
    end

    subgraph BCExt["BigCommerce"]
        BCSdk["Checkout SDK / storefront API<br/>cart, consignments, coupons"]
        BCMgmt["Management API<br/>v3 catalog, carts, checkouts<br/>v2 orders"]
    end

    Page --> CheckoutJS
    Customer --> Login
    Header --> Control
    PayForm --> Control
    ShipFooter --> Sched
    Control --> Button
    Control --> Sched
    Button --> Sdk
    Button --> Client
    Sched --> Client
    Button --> Nav --> Confirm
    Confirm --> Client
    Client --> Config
    Sdk --> ShopJS --> PopupExt
    Login --> ShopJS
    Control --> BCSdk
    ShipFooter --> BCSdk

    Client -->|HTTPS + CORS| Routes
    Routes --> Validation
    Routes --> Delivery
    Routes --> Store --> Redis
    Routes --> StorefrontAPI
    Routes --> AdminAPI
    Routes --> BCMgmt
    Webhook -->|HMAC-signed| Routes
```

### Explanation

- **The storefront only loads checkout.** The Cornerstone theme's `/checkout` page loads the custom checkout from `auto-loader.js`, configured in the BigCommerce control panel. The theme has no Shop Pay code.
- **`packages/core` only mounts things.** Five places in the standard checkout render Shop Pay pieces:
  - the customer step (Shop Pay sign-in for recognised emails);
  - the top of checkout and the payment step (the Shop Pay button; exactly one shows);
  - the shipping step (scheduled-delivery options and the date picker);
  - the checkout page (the Shop Pay order confirmation).
- **`packages/shop-pay-integration` holds all Shop Pay logic:**
  - `ShopPayCheckoutControl` decides where the button shows, and keeps the BigCommerce checkout in sync with the popup (address, delivery method, coupons).
  - `ShopPayButton` runs one Shop Pay attempt: it opens the popup, answers its events, submits the payment and calls `/shop-pay/complete`.
  - `shopPaySdk` loads Shopify's script and builds the payment request from BigCommerce's cart.
  - `scheduledDelivery` and `ScheduledDeliveryFields` handle truck delivery: service filtering, the date and instructions.
  - `shopPayClient` wraps the backend calls, and `shopPayConfig` holds the backend URL and the Shop Pay IDs.
- **`packages/utility`** switches to the order confirmation without reloading the page.
- **The backend is a single Express app with three helper modules:**
  - `validation.js`: checks the cart, the final payment request and the total against BigCommerce.
  - `delivery.js`: decides which products need scheduled delivery, and returns the available dates (mock ATP).
  - `sessionStore.js`: sessions, completion locks, pending payments and webhook stats, in Upstash Redis (or a local JSON file in development).
- **External services:**
  - Shopify's Storefront API creates and submits the payment session.
  - Shopify's Admin API confirms that an order was paid.
  - Shopify's `orders/create` webhook is the safety net for creating orders.
  - BigCommerce's Checkout SDK is used in the browser; its Management API is used by the backend for products, carts, checkouts and orders.
- **Security boundaries:**
  - The browser only ever holds public IDs: the Shop ID, the client ID and the backend URL.
  - Every token and secret stays in the backend.
  - The backend accepts browser calls only from allowed origins (CORS). It also checks every webhook's HMAC signature.

## 2. Deployment architecture

Where each part runs, how it's deployed, and where configuration and secrets live.

```mermaid
flowchart LR
    Dev(["Developer"])

    subgraph GitHub["GitHub (ankitbansalepam)"]
        RepoCheckout["checkout-js"]
        RepoBackend["shop-pay-backend"]
        RepoTheme["Cornerstone-6.21.0"]
    end

    subgraph VercelTeam["Vercel team 'shop-pay' (Hobby plan)"]
        VCheckout["checkout-js project<br/>checkout-js-weld.vercel.app<br/>static bundle (dist)"]
        VBackend["shop-pay-backend project<br/>shop-pay-backend.vercel.app<br/>Node serverless function"]
        VCron["Cron: daily 09:00 UTC<br/>/health/webhooks"]
        VEnv["Environment variables (Sensitive)<br/>Shopify tokens, webhook secret,<br/>BigCommerce token, ALLOWED_ORIGIN,<br/>CRON_SECRET, KV_REST_API_*"]
    end

    Upstash[("Upstash Redis<br/>upstash-kv-cobalt-drawer, iad1<br/>via Vercel Marketplace")]

    subgraph BC["BigCommerce store 'shoppaystore' (ocqei08gqj)"]
        BCTheme["Cornerstone theme"]
        BCSettings["Checkout setting:<br/>custom script URL →<br/>auto-loader.js"]
        BCData["Catalog, shipping zones<br/>(Flat rate, White/Green Glove),<br/>tax, orders"]
    end

    subgraph SH["Shopify store 'mynewstore-9969'<br/>(Shop Pay Commerce Component)"]
        SHApp["Shop channel app:<br/>Shop ID, client ID,<br/>Storefront + Admin tokens,<br/>allowed origins"]
        SHWebhook["Settings → Notifications:<br/>orders/create webhook<br/>+ signing key"]
        SHPay["Shopify Payments<br/>(test mode)"]
    end

    Shopper(["Shopper's browser"])

    Dev -->|git push master| RepoCheckout -->|auto-deploy| VCheckout
    Dev -->|vercel --prod<br/>folder upload| VBackend
    Dev -.->|git push, backup only| RepoBackend
    Dev -.->|theme deploy| BCTheme
    RepoTheme -.-> BCTheme
    VEnv --> VBackend
    VCron --> VBackend
    VBackend <--> Upstash

    Shopper --> BCTheme
    BCSettings -->|loads| VCheckout
    Shopper -->|API calls| VBackend
    Shopper -->|popup| SHPay
    VBackend --> SHApp
    VBackend --> BCData
    SHWebhook -->|HMAC-signed POST| VBackend
```

### Explanation

- **Two Vercel projects, deployed differently:**
  - **checkout-js** deploys automatically on every push to `master`. Vercel builds it with `NX_SKIP_NX_CACHE=true npm run build` and serves the `dist` bundle, including `auto-loader.js`, from `checkout-js-weld.vercel.app`.
  - **shop-pay-backend** is deployed by hand with `vercel --prod`, which uploads the folder. Pushing to GitHub only keeps a copy of the code. It runs as a single Node serverless function at `shop-pay-backend.vercel.app`.
- **Configuration lives in three places:**
  - **Vercel environment variables** (all Sensitive, so they can't be read back): the Shopify Storefront and Admin tokens, the webhook signing secret, the BigCommerce token, the allowed storefront origins, the cron secret, and the Upstash connection added by the Marketplace integration.
  - **BigCommerce:** the checkout's custom script URL (`auto-loader.js`), the products with their custom fields, the shipping zones and methods (Flat rate, White Glove, Green Glove), tax settings, and the orders.
  - **Shopify:** the Shop channel app (Shop ID, client ID, API tokens, allowed origins for the Shop Pay component), the `orders/create` webhook and its signing key (Settings → Notifications), and Shopify Payments (currently in test mode).
- **Upstash Redis** is connected to the backend project through the Vercel Marketplace, in the same region as the function (Washington, D.C., `iad1`), so session reads are fast.
- **The daily cron** runs `/health/webhooks` at 09:00 UTC. The Hobby plan allows only daily cron jobs, and problems are reported only in Vercel's logs.
- **Runtime traffic:**
  - The shopper's browser loads the storefront, which loads checkout from Vercel.
  - The browser then calls the backend directly (CORS-checked) and opens the Shop Pay popup on Shopify.
  - The backend talks to Shopify and BigCommerce server-to-server.
  - Shopify calls the backend back with the signed webhook.
- **The theme** is deployed to BigCommerce separately from the other two, and GitHub holds its source. It needs no Shop Pay changes.
