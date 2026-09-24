import { type Cart, type Coupon } from '@bigcommerce/checkout-sdk';

export interface ShopPaySession {
    token: string;
    checkoutUrl: string;
    sourceIdentifier: string;
}

export interface ShopPaySubmitResult {
    bcOrderId?: number;
    confirmationToken?: string;
    receipt?: unknown;
}

export interface ShopPayClientOptions {
    backendUrl: string;
    bcOrderId?: number;
    sourceIdentifier?: string;
    taxTotal?: number;
    fetcher?: typeof fetch;
}

function getErrorMessage(payload: unknown, fallback: string): string {
    if (typeof payload === 'object' && payload !== null && 'error' in payload) {
        const error = payload.error;

        if (typeof error === 'string') {
            return error;
        }
    }

    return fallback;
}

function isShopPaySession(payload: unknown): payload is ShopPaySession {
    if (typeof payload !== 'object' || payload === null) {
        return false;
    }

    return (
        'token' in payload &&
        typeof payload.token === 'string' &&
        'checkoutUrl' in payload &&
        typeof payload.checkoutUrl === 'string' &&
        'sourceIdentifier' in payload &&
        typeof payload.sourceIdentifier === 'string'
    );
}

export function createShopPaySession(
    cart: Cart,
    {
        backendUrl,
        bcOrderId,
        coupons = [],
        sourceIdentifier = `bc-${cart.id}`,
        taxTotal = 0,
        fetcher = fetch,
    }: ShopPayClientOptions & { coupons?: Coupon[] },
): Promise<ShopPaySession> {
    const items = [...cart.lineItems.physicalItems, ...cart.lineItems.digitalItems];
    const currencyCode = cart.currency.code;

    return fetcher(`${backendUrl.replace(/\/$/, '')}/shop-pay/session`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            sourceIdentifier,
            ...(bcOrderId ? { bcOrderId } : {}),
            cart: {
                cartId: cart.id,
                currencyCode,
                locale: cart.locale || 'en',
                lineItems: items.map((item) => ({
                    name: item.name,
                    quantity: item.quantity,
                    sku: item.sku,
                    imageUrl: item.imageUrl,
                    listPrice: item.listPrice,
                    salePrice: item.salePrice,
                    requiresShipping:
                        'isShippingRequired' in item ? item.isShippingRequired : false,
                })),
                subtotal: cart.baseAmount,
                total: cart.cartAmount,
                totalTax: taxTotal,
                discountCodes: coupons.map((coupon) => coupon.code),
            },
        }),
    }).then(async (response): Promise<ShopPaySession> => {
        const payload: unknown = await response.json();

        if (!response.ok) {
            throw new Error(getErrorMessage(payload, 'Unable to create Shop Pay session'));
        }

        if (!isShopPaySession(payload)) {
            throw new Error('Shop Pay session response is invalid');
        }

        return payload;
    });
}

export interface ShopPayCompleteResult {
    bcOrderId: number;
    confirmationToken: string;
}

// Asks the backend to create the BigCommerce order once Shopify has a paid order for this
// session. The backend answers 202 while Shopify is still creating the order.
export async function completeShopPaySession(
    sourceIdentifier: string,
    {
        backendUrl,
        fetcher = fetch,
        attempts = 6,
        retryDelayMs = 2000,
    }: { backendUrl: string; fetcher?: typeof fetch; attempts?: number; retryDelayMs?: number },
): Promise<ShopPayCompleteResult> {
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
        const response = await fetcher(`${backendUrl.replace(/\/$/, '')}/shop-pay/complete`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ sourceIdentifier }),
        });
        const payload: unknown = await response.json();

        if (response.status !== 202) {
            if (!response.ok) {
                throw new Error(getErrorMessage(payload, 'Unable to complete the Shop Pay order'));
            }

            return payload as ShopPayCompleteResult;
        }

        if (attempt < attempts) {
            await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
        }
    }

    throw new Error('Shop Pay has not confirmed the payment yet. Please check your email before trying again.');
}

export function submitShopPaySession(
    sourceIdentifier: string,
    options: {
        backendUrl: string;
        idempotencyKey?: string;
        paymentMethod?: string;
        billingAddress?: Record<string, unknown>;
        paymentRequest?: {
            shippingLines?: unknown[];
            totalShippingPrice?: unknown;
            total?: unknown;
        };
        fetcher?: typeof fetch;
    },
): Promise<ShopPaySubmitResult> {
    const { backendUrl, idempotencyKey, paymentMethod, paymentRequest, billingAddress, fetcher = fetch } = options;

    return fetcher(`${backendUrl.replace(/\/$/, '')}/shop-pay/submit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sourceIdentifier, idempotencyKey, paymentMethod, paymentRequest, billingAddress }),
    }).then(async (response): Promise<ShopPaySubmitResult> => {
        const payload: unknown = await response.json();

        if (!response.ok) {
            throw new Error(getErrorMessage(payload, 'Unable to submit Shop Pay session'));
        }

        return payload as ShopPaySubmitResult;
    });
}
