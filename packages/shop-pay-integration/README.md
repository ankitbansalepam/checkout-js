# Shop Pay integration

A small adapter for a custom BigCommerce checkout application. It opens the Shop Pay payment request popup, relays its events (session, shipping address, delivery method, discount codes, payment confirmation) to the Shop Pay backend, and keeps the BigCommerce checkout in sync.

```tsx
import { ShopPayCheckoutControl } from '@bigcommerce/checkout/shop-pay-integration';

<ShopPayCheckoutControl
    backendUrl={getShopPayBackendUrl()}
    onError={onUnhandledError}
    onPaymentComplete={navigateToShopPayOrderConfirmation}
    placement="payment"
/>;
```

The backend URL must allow the checkout origin through CORS. Do not put Shopify, BigCommerce, webhook, or DIAL credentials in the browser.

## Placement

Checkout mounts the control twice, at the top (`placement="top"`, in `CheckoutHeader`) and in the payment methods (`placement="payment"`, in `PaymentForm`). Exactly one renders:

- **Top**: when a billing address and a shipping method were already known when checkout loaded, e.g. a signed-in shopper with saved addresses, or a digital-only cart.
- **Payment methods**: otherwise, including when the shopper enters shipping and billing during checkout.

Readiness is recorded the first time a control renders for a cart, so completing the addresses mid-checkout doesn't move the button. Tests call `resetShopPayPlacement()` between cases.

## Backend URL

`getShopPayBackendUrl()` defaults to the deployed backend, `https://shop-pay-backend.vercel.app`. Set `window.shopPayBackendUrl` before loading checkout to point at another backend:

```html
<script>
  window.shopPayBackendUrl = 'https://shop-pay.example.com';
</script>
```

`window.shopPayClientId` and `window.shopPayShopId` override the Shop Pay client and shop IDs the same way.

## Tests

```powershell
npx jest packages/shop-pay-integration/src --runInBand
```

See `shop-pay-backend/INTEGRATION_GUIDE.md` for the end-to-end flow, deployment, and troubleshooting.
