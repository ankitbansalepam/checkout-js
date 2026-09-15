# Shop Pay integration

A small adapter for a custom BigCommerce checkout application. It sends the SDK cart to the Shop Pay backend and opens the returned Shop Pay checkout URL while preserving the merchant checkout window.

```tsx
import { ShopPayCheckoutControl } from '@bigcommerce/checkout/shop-pay-integration';

<ShopPayCheckoutControl backendUrl="https://shop-pay.example.com" onError={onUnhandledError} />;
```

The backend URL must allow the checkout origin through CORS. Do not put Shopify, BigCommerce, webhook, or DIAL credentials in the browser.

## Custom checkout wiring

Set the public backend URL before mounting the checkout application:

```html
<script>
  window.shopPayBackendUrl = 'https://shop-pay.example.com';
</script>
```

The hosted checkout core does not render this control. A custom checkout app must import and render `ShopPayCheckoutControl` explicitly. Leave it unset for stores that do not use the POC.

For this local POC, the control defaults to `http://127.0.0.1:8787`. Start the backend with `npm start` in `shop-pay-backend`, or set `window.shopPayBackendUrl` to a deployed HTTPS backend before loading checkout.
