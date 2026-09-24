import { type Cart, type Consignment, type Coupon } from '@bigcommerce/checkout-sdk';
import React, { type FunctionComponent, useState } from 'react';

import {
    completeShopPaySession,
    createShopPaySession,
    submitShopPaySession,
    type ShopPaySubmitResult,
} from './shopPayClient';
import { getShopPayClientId, getShopPayShopId } from './shopPayConfig';
import {
    type ScheduledDeliveryAvailability,
    type ScheduledDeliverySelection,
} from './scheduledDelivery';
import { buildShopPayPaymentRequest, createShopPaySdkSession } from './shopPaySdk';

// The BigCommerce checkout after a change made in the Shop Pay popup.
export interface ShopPayCheckoutUpdate {
    cart: Cart;
    consignments: Consignment[];
    taxTotal: number;
}

export interface ShopPayButtonProps {
    cart: Cart;
    taxTotal?: number;
    bcOrderId?: number;
    onPaymentComplete?(orderId?: number, confirmationToken?: string): void;
    consignments?: Consignment[];
    coupons?: Coupon[];
    onShippingAddressChanged?(
        address: Record<string, unknown>,
        preferredShippingOptionId?: string,
    ): Promise<ShopPayCheckoutUpdate>;
    onDeliveryMethodChanged?(shippingOptionId: string): Promise<ShopPayCheckoutUpdate>;
    onDiscountCodesChanged?(codes: string[]): Promise<ShopPayCheckoutUpdate & { coupons: Coupon[] }>;
    backendUrl: string;
    // Scheduled (truck) delivery: the cart's availability and the date chosen in checkout.
    deliveryAvailability?: ScheduledDeliveryAvailability;
    scheduledDelivery?: ScheduledDeliverySelection;
    label?: string;
    onError?(error: Error): void;
}

export const ShopPayButton: FunctionComponent<ShopPayButtonProps> = ({
    cart,
    taxTotal = 0,
    bcOrderId,
    onPaymentComplete,
    consignments,
    coupons,
    onShippingAddressChanged,
    onDeliveryMethodChanged,
    onDiscountCodesChanged,
    backendUrl,
    deliveryAvailability,
    scheduledDelivery,
    label = 'Buy with Shop Pay',
    onError,
}) => {
    const [isLoading, setIsLoading] = useState(false);

    const handleClick = async () => {
        setIsLoading(true);

        const delivery = { availability: deliveryAvailability, selection: scheduledDelivery };

        try {
            const sdkSession = await createShopPaySdkSession(cart, {
                shopId: getShopPayShopId(),
                clientId: getShopPayClientId() || '',
                consignments,
                coupons,
                taxTotal,
                delivery,
            });
            // Latest BigCommerce checkout state; every payment request is rebuilt from it so the
            // Shop Pay total always matches the BigCommerce checkout total the backend verifies.
            const latest = { cart, consignments, coupons: coupons || [], taxTotal };
            const buildLatestPaymentRequest = () =>
                buildShopPayPaymentRequest(
                    latest.cart,
                    latest.consignments,
                    latest.coupons,
                    latest.taxTotal,
                    delivery,
                );
            let backendSession: Awaited<ReturnType<typeof createShopPaySession>>;
            // One backend session per attempt: Shop Pay can ask twice, and a second Shopify
            // session would leave the popup paying one while the backend submits the other.
            let backendSessionRequest: ReturnType<typeof createShopPaySession> | undefined;
            const sourceIdentifier = `bc-${cart.id}-${crypto.randomUUID()}`;
            let submitIdempotencyKey: string | undefined;
            let resolveSubmit: (result: ShopPaySubmitResult) => void;
            let rejectSubmit: (reason?: unknown) => void;
            const submitCompleted = new Promise<ShopPaySubmitResult>((resolve, reject) => {
                resolveSubmit = resolve;
                rejectSubmit = reject;
            });

            sdkSession.addEventListener('sessionrequested', async () => {
                try {
                    backendSessionRequest ??= createShopPaySession(cart, {
                        backendUrl,
                        bcOrderId,
                        coupons,
                        sourceIdentifier,
                        taxTotal,
                        scheduledDelivery: deliveryAvailability?.scheduled ? scheduledDelivery : undefined,
                    });
                    backendSession = await backendSessionRequest;
                    sdkSession.completeSessionRequest({
                        token: backendSession.token,
                        checkoutUrl: backendSession.checkoutUrl,
                        sourceIdentifier: backendSession.sourceIdentifier,
                        updatedPaymentRequest: buildLatestPaymentRequest(),
                    });
                } catch (error) {
                    sdkSession.completeSessionRequest({
                        errors: [{ type: 'generalError', message: String(error) }],
                    });
                }
            });

            sdkSession.addEventListener('paymentconfirmationrequested', async (event) => {
                if (!backendSession) {
                    sdkSession.completePaymentConfirmationRequest({
                        errors: [{ type: 'generalError', message: 'Shop Pay session is unavailable.' }],
                    });
                    return;
                }

                try {
                    submitIdempotencyKey ??= crypto.randomUUID();
                    const submitResult = await submitShopPaySession(backendSession.sourceIdentifier, {
                        backendUrl,
                        idempotencyKey: submitIdempotencyKey,
                        paymentMethod: sdkSession.paymentRequest?.paymentMethod,
                        paymentRequest: sdkSession.paymentRequest,
                        billingAddress: event.billingAddress as Record<string, unknown>,
                    });
                    resolveSubmit(submitResult);
                    sdkSession.completePaymentConfirmationRequest();
                } catch (error) {
                    rejectSubmit(error);
                    sdkSession.completePaymentConfirmationRequest({
                        errors: [{ type: 'generalError', message: String(error) }],
                    });
                }
            });

            sdkSession.addEventListener('shippingaddresschanged', async (event) => {
                if (!onShippingAddressChanged || !event.shippingAddress) {
                    sdkSession.completeShippingAddressChange({
                        errors: [{ type: 'generalError', message: 'Shipping rates are unavailable.' }],
                    });
                    return;
                }

                try {
                    const [selectedShippingLine] = (sdkSession.paymentRequest?.shippingLines ||
                        []) as Array<{ code?: string }>;
                    Object.assign(
                        latest,
                        await onShippingAddressChanged(
                            event.shippingAddress,
                            selectedShippingLine?.code,
                        ),
                    );
                    sdkSession.completeShippingAddressChange({
                        updatedPaymentRequest: buildLatestPaymentRequest(),
                    });
                } catch (error) {
                    sdkSession.completeShippingAddressChange({
                        errors: [
                            {
                                type: 'shippingAddressError',
                                message:
                                    error instanceof Error
                                        ? error.message
                                        : String(error),
                            },
                        ],
                    });
                }
            });

            sdkSession.addEventListener('discountcodechanged', async (event) => {
                if (!onDiscountCodesChanged) {
                    sdkSession.completeDiscountCodeChange({
                        errors: [{ type: 'generalError', message: 'Discount codes are unavailable.' }],
                    });
                    return;
                }

                const enteredCodes = event.discountCodes || [];

                try {
                    Object.assign(latest, await onDiscountCodesChanged(enteredCodes));

                    const acceptedCodes = latest.coupons.map((coupon) => coupon.code);
                    const rejectedCodes = enteredCodes.filter((code) => !acceptedCodes.includes(code));

                    sdkSession.completeDiscountCodeChange({
                        updatedPaymentRequest: buildLatestPaymentRequest(),
                        ...(rejectedCodes.length
                            ? {
                                  errors: [
                                      {
                                          type: 'discountCodeError',
                                          message: "That discount code isn't valid.",
                                      },
                                  ],
                              }
                            : {}),
                    });
                } catch (error) {
                    sdkSession.completeDiscountCodeChange({
                        errors: [{ type: 'discountCodeError', message: String(error) }],
                    });
                }
            });

            sdkSession.addEventListener('deliverymethodchanged', async (event) => {
                const deliveryMethod = event.deliveryMethod;

                if (!deliveryMethod || !onDeliveryMethodChanged) {
                    sdkSession.completeDeliveryMethodChange({
                        errors: [{ type: 'generalError', message: 'Delivery methods are unavailable.' }],
                    });
                    return;
                }

                try {
                    // Select the same option in BigCommerce so its checkout total and the
                    // order's shipping match what the shopper chose in Shop Pay.
                    Object.assign(latest, await onDeliveryMethodChanged(deliveryMethod.code));
                    sdkSession.completeDeliveryMethodChange({
                        updatedPaymentRequest: buildLatestPaymentRequest(),
                    });
                } catch (error) {
                    sdkSession.completeDeliveryMethodChange({
                        errors: [{ type: 'generalError', message: String(error) }],
                    });
                }
            });

            sdkSession.addEventListener('paymentcomplete', async () => {
                try {
                    await submitCompleted;
                } catch {
                    setIsLoading(false);
                    return;
                }

                let completion: Awaited<ReturnType<typeof completeShopPaySession>>;

                try {
                    // The backend creates the BigCommerce order only once Shopify has a paid
                    // order for this session.
                    completion = await completeShopPaySession(sourceIdentifier, { backendUrl });
                } catch (error) {
                    onError?.(error instanceof Error ? error : new Error(String(error)));
                    setIsLoading(false);
                    return;
                }

                setIsLoading(false);
                sdkSession.close();
                onPaymentComplete?.(completion.bcOrderId, completion.confirmationToken);
            });

            sdkSession.addEventListener('windowclosed', () => setIsLoading(false));
            sdkSession.begin();
        } catch (error) {
            const normalizedError = error instanceof Error ? error : new Error(String(error));

            onError?.(normalizedError);
            setIsLoading(false);
        }
    };

    return (
        <button
            className="button button--primary optimizedCheckout-buttonPrimary shopPayButton"
            disabled={isLoading}
            onClick={handleClick}
            type="button"
        >
            {isLoading ? 'Opening Shop Pay...' : label}
        </button>
    );
};
