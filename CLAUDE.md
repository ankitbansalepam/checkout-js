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

- Keep the Shop Pay control out of checkout-js core and hosted checkout. Only a custom checkout app may import and render it.
- Keep the custom checkout backend URL opt-in through `window.shopPayBackendUrl`.
- Create a session only from the button click; never create sessions during render, mount, or checkout state updates.
- Use the cart selector only in `ShopPayCheckoutControl`; do not subscribe to the entire checkout state.
- Keep the button disabled while a session request is in flight to prevent duplicate DIAL or Shopify requests.
- Generate a unique `sourceIdentifier` for each new Shop Pay button attempt (`bc-{cartId}-{uuid}`); reuse the idempotency key only within that attempt.
- The Shop Pay completion must wait for the backend submit result before navigating.
- The requested confirmation URL is `/checkout/order-confirmation?orderId=...&shopPay=1&confirmationToken=...`.
- Shop Pay confirmation uses `history.replaceState` plus `popstate` and renders `ShopPayOrderConfirmation` inside `CheckoutPage`; do not replace this with a full native BigCommerce confirmation navigation, because that route can 302 to cart for externally created orders.
- The development bundle is served from `build` on port 8081 and exposed through the current checkout ngrok tunnel. Run `npx webpack --mode development` after source changes, then serve with `npx http-server build --cors -c-1 -p 8081`.
- The production build command is `npx nx run core:build --skip-nx-cache`.
- Validate only the changed package first with `npx jest packages/shop-pay-integration/src/shopPayClient.test.ts packages/utility/src/navigateToOrderConfirmation.test.ts --runInBand` and targeted type/build checks.

## Shop Pay runtime context

- Primary backend project: `C:\Project\shop-pay-backend`.
- Primary storefront project: `C:\Project\Cornorstone\Cornerstone-6.21.0`.
- Do not use `C:\Project\repo-install-check` for active builds or runtime.
- Current development loader: `https://d8ff-49-36-241-63.ngrok-free.app/auto-loader-dev.js`.
- Current backend URL in `shopPayConfig.ts`: `https://e1bd-2405-201-5c36-70b1-38bb-431c-cab1-41c4.ngrok-free.app`.
- Ngrok URLs rotate. When the backend tunnel changes, update `shopPayConfig.ts` and backend `.env` CORS, rebuild, and verify the public bundle before testing.
