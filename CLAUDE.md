# checkout-js — project conventions

## Exports

**Always use named exports. Never add new default exports.**

Much of the existing codebase uses default exports — do NOT copy that pattern.
It is legacy; the team has standardized on named exports for all new code.

```ts
// ✅ Correct
export const CustomerInfo = () => { ... };
export { CustomerInfo } from './CustomerInfo';

// ❌ Wrong — do not do this, even though existing files do
export default CustomerInfo;
```

- New files: named exports only, including React components.
- When editing an existing file that has a default export, leave the existing
  export as-is unless the task is specifically to refactor it — but any new
  symbol you export must be a named export.
- Barrel files (`index.ts`): re-export by name (`export { X } from './X'`),
  not `export { default as X }` for new modules.

## useCheckout

**Avoid bare `useCheckout()`.** Calling it with no selector subscribes the
component to the entire checkout state, so it re-renders on every state change.
Always pass a selector, or a no-op selector if you don't need reactive state.

```ts
// ✅ Need state — pass a selector returning an object, and destructure
// `selectedState` inline so values are ready to use directly
const {
    selectedState: {
        config,
        checkout,
        order,
    },
} = useCheckout(({ data }) => ({
    config: data.getConfig(),
    checkout: data.getCheckout(),
    order: data.getOrder(),
}));

// ✅ No-op selector — only for two cases where subscribing adds nothing:
//    1. Calling service methods only (checkoutService, errorLogger).
//    2. Reading state once on mount for initial local state (see useLoadCheckout).
// NOT an escape hatch: if the component renders from checkout state, use a real selector
const { checkoutService } = useCheckout(() => undefined);

// ❌ Wrong — bare call subscribes to ALL state changes
const { checkoutState } = useCheckout();
```

## Shop Pay token budget

- This checkout-js build is the store's custom checkout, and core renders the Shop Pay control in two places: `CheckoutHeader` (`placement="top"`) and `PaymentForm` (`placement="payment"`). Both render only when `getShopPayBackendUrl()` returns a URL.
- The backend URL defaults to `https://shop-pay-backend.vercel.app` in `shopPayConfig.ts`; `window.shopPayBackendUrl` overrides it. Keep all Shop Pay logic in `packages/shop-pay-integration`; core only mounts the control and the confirmation.
- Create a session only from the button click; never create sessions during render, mount, or checkout state updates.
- Use the cart selector only in `ShopPayCheckoutControl`; do not subscribe to the entire checkout state.
- Keep the button disabled while a session request is in flight to prevent duplicate DIAL or Shopify requests.
- Generate a unique `sourceIdentifier` for each new Shop Pay button attempt (`bc-{cartId}-{uuid}`); reuse the idempotency key only within that attempt.
- Create the BigCommerce order only after Shopify confirms payment: Pay now only submits (`/shop-pay/submit`); on `paymentcomplete`, checkout calls `/shop-pay/complete`, which creates the order once Shopify has a paid order for the session. Navigate only with the `bcOrderId` and `confirmationToken` it returns.
- Create at most one backend session per click; Shop Pay can fire `sessionrequested` twice.
- Card selection inside the Shop Pay popup is owned by Shopify (shop.app); checkout-js cannot preselect a card. If the popup shows "There was an issue with your selected payment method", the shopper must click the saved card before Pay now.
- The requested confirmation URL is `/checkout/order-confirmation?orderId=...&shopPay=1&confirmationToken=...`.
- Shop Pay confirmation uses `history.replaceState` plus `popstate` and renders `ShopPayOrderConfirmation` inside `CheckoutPage`; do not replace this with a full native BigCommerce confirmation navigation, because that route can 302 to cart for externally created orders.
- Exactly one Shop Pay button renders (`placement` prop): at the top for signed-in shoppers, or when billing and shipping were already known when checkout loaded; otherwise in the payment methods. Readiness is recorded once per cart, so addresses entered during checkout never move the button to the top.
- After a Shop Pay shipping address change, re-select a BigCommerce shipping option (Shop Pay's choice, then the previous one, then recommended/first). Updating the consignment address clears the selected option; a payment request without a shipping line no longer matches the delivery method shown in Shop Pay and Shopify declines the payment.
- The production build command is `npx nx run core:build --skip-nx-cache`.
- Validate only the changed package first with `npx jest packages/shop-pay-integration/src packages/utility/src/navigateToOrderConfirmation.test.ts --runInBand` and targeted type/build checks.

## Shop Pay runtime context

- Primary backend project: `C:\Project\shop-pay-backend`.
- Primary storefront project: `C:\Project\Cornorstone\Cornerstone-6.21.0`.
- Do not use `C:\Project\repo-install-check` for active builds or runtime.
- Storefront: `https://shoppaystore.mybigcommerce.com` (store hash `ocqei08gqj`). Shopify store: `mynewstore-9969.myshopify.com` (Shopify Payments in test mode).
- Checkout loader: `https://checkout-js-weld.vercel.app/auto-loader.js`. A push to `master` auto-deploys it to Vercel production (team `shop-pay`, project `checkout-js`); `vercel ls checkout-js` shows status.
- Backend: `https://shop-pay-backend.vercel.app`, the default in `shopPayConfig.ts` (`window.shopPayBackendUrl` overrides it). Deployed with `vercel --prod` from the backend folder, not from git.
- To confirm a deploy contains a change, fetch `auto-loader.js`, then grep the `checkout-*.js` chunk it lists for a distinctive identifier.
