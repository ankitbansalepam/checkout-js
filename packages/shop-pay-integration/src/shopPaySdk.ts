import { type Cart, type Consignment, type Coupon } from '@bigcommerce/checkout-sdk';

interface ShopPayEvent {
    billingAddress?: unknown;
    shippingAddress?: Record<string, unknown>;
    deliveryMethod?: { label: string; code: string; amount: { amount: number; currencyCode: string } };
    discountCodes?: string[];
}

export interface ShopPaySdkSession {
    addEventListener(type: string, listener: (event: ShopPayEvent) => void | Promise<void>): void;
    begin(): void;
    close(): void;
    paymentRequest?: {
        paymentMethod?: string;
        shippingAddress?: Record<string, unknown>;
        shippingLines?: unknown[];
        totalShippingPrice?: unknown;
        discountCodes?: string[];
        total?: unknown;
    };
    completeSessionRequest(payload: Record<string, unknown>): void;
    completePaymentConfirmationRequest(payload?: Record<string, unknown>): void;
    completeShippingAddressChange(payload: Record<string, unknown>): void;
    completeDeliveryMethodChange(payload: Record<string, unknown>): void;
    completeDiscountCodeChange(payload: Record<string, unknown>): void;
}

interface ShopPayPaymentRequestApi {
    configure(options: {
        shopId: number;
        clientId: string;
        debug?: boolean;
        discountCodeField?: boolean;
    }): void;
    build(paymentRequest: Record<string, unknown>): Record<string, unknown>;
    createSession(options: { paymentRequest: Record<string, unknown> }): ShopPaySdkSession;
    createLogin(options: { emailInputId: string }): { render(selector: string): void };
}

interface ShopPayGlobal {
    PaymentRequest: ShopPayPaymentRequestApi;
}

declare global {
    interface Window {
        ShopPay?: ShopPayGlobal;
    }
}

let sdkLoad: Promise<ShopPayGlobal> | undefined;

export function loadShopPaySdk(): Promise<ShopPayGlobal> {
    if (typeof window === 'undefined') {
        return Promise.reject(new Error('Shop Pay can only run in a browser'));
    }

    if (window.ShopPay) {
        return Promise.resolve(window.ShopPay);
    }

    if (!sdkLoad) {
        sdkLoad = new Promise((resolve, reject) => {
            const script = document.createElement('script');
            script.src = 'https://cdn.shopify.com/shopifycloud/shop-js/shop-pay-payment-request.js';
            script.async = true;
            script.onload = () => {
                if (window.ShopPay) {
                    resolve(window.ShopPay);
                } else {
                    reject(new Error('Shop Pay SDK did not initialize'));
                }
            };
            script.onerror = () => reject(new Error('Unable to load the Shop Pay SDK'));
            document.head.appendChild(script);
        });
    }

    return sdkLoad;
}

// BigCommerce amounts can carry fractions of a cent (e.g. tax of 38.445); round half up to
// cents like BigCommerce's own totals. toFixed(6) clears float noise such as 4944.4999999.
export function roundMoney(amount: number): number {
    return Math.round(Number((amount * 100).toFixed(6))) / 100;
}

function toMoney(amount: number, currencyCode: string) {
    return { amount: roundMoney(amount), currencyCode };
}

export function buildShopPayPaymentRequest(
    cart: Cart,
    consignments: Consignment[] = [],
    coupons: Coupon[] = [],
    taxTotal = 0,
): Record<string, unknown> {
    const currencyCode = cart.currency.code;
    const items = [...cart.lineItems.physicalItems, ...cart.lineItems.digitalItems];
    const selectedShippingOptions = consignments
        .map((consignment) => consignment.selectedShippingOption)
        // BigCommerce uses null when a consignment has no shipping option selected yet.
        .filter((option): option is NonNullable<typeof option> => option != null);
    const shippingAmount = selectedShippingOptions.reduce((total, option) => total + option.cost, 0);
    const deliveryMethods = consignments.flatMap((consignment) =>
        (consignment.availableShippingOptions || []).map((option) => ({
            label: option.description,
            code: option.id,
            amount: toMoney(option.cost, currencyCode),
            ...(option.transitTime ? { detail: option.transitTime } : {}),
        })),
    );

    return {
        lineItems: items.map((item) => ({
            label: item.name,
            quantity: item.quantity,
            sku: item.sku,
            requiresShipping: 'isShippingRequired' in item ? item.isShippingRequired : false,
            originalItemPrice: toMoney(item.listPrice, currencyCode),
            finalItemPrice: toMoney(item.salePrice, currencyCode),
            originalLinePrice: toMoney(item.listPrice * item.quantity, currencyCode),
            finalLinePrice: toMoney(item.salePrice * item.quantity, currencyCode),
        })),
        discountCodes: coupons.map((coupon) => coupon.code),
        discounts: coupons.map((coupon) => ({
            label: coupon.displayName || coupon.code,
            amount: toMoney(coupon.discountedAmount, currencyCode),
        })),
        deliveryMethods,
        supportedDeliveryMethodTypes: ['SHIPPING'],
        shippingLines: selectedShippingOptions.map((option) => ({
            label: option.description,
            code: option.id,
            amount: toMoney(option.cost, currencyCode),
        })),
        subtotal: toMoney(cart.baseAmount, currencyCode),
        totalShippingPrice: {
            originalTotal: toMoney(shippingAmount, currencyCode),
            finalTotal: toMoney(shippingAmount, currencyCode),
        },
        totalTax: toMoney(taxTotal, currencyCode),
        total: toMoney(cart.cartAmount + shippingAmount, currencyCode),
        presentmentCurrency: currencyCode,
        locale: cart.locale || 'en',
    };
}

export async function createShopPaySdkSession(
    cart: Cart,
    options: {
        shopId: number;
        clientId: string;
        consignments?: Consignment[];
        coupons?: Coupon[];
        taxTotal?: number;
    },
): Promise<ShopPaySdkSession> {
    const shopPay = await loadShopPaySdk();

    shopPay.PaymentRequest.configure({
        shopId: options.shopId,
        clientId: options.clientId,
        debug: true,
    });

    return shopPay.PaymentRequest.createSession({
        paymentRequest: shopPay.PaymentRequest.build(
            buildShopPayPaymentRequest(
                cart,
                options.consignments,
                options.coupons,
                options.taxTotal,
            ),
        ),
    });
}

export async function createShopPayLogin(options: {
    shopId: number;
    clientId: string;
    emailInputId: string;
}): Promise<{ render(selector: string): void }> {
    const shopPay = await loadShopPaySdk();

    shopPay.PaymentRequest.configure({
        shopId: options.shopId,
        clientId: options.clientId,
    });

    return shopPay.PaymentRequest.createLogin({ emailInputId: options.emailInputId });
}