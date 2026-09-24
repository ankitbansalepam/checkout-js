import { type Cart, type Consignment, type Coupon } from '@bigcommerce/checkout-sdk';
import React, { type FunctionComponent, useState } from 'react';

import { createShopPaySession, submitShopPaySession, type ShopPaySubmitResult } from './shopPayClient';
import { getShopPayClientId, getShopPayShopId } from './shopPayConfig';
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
    label = 'Buy with Shop Pay',
    onError,
}) => {
    const [isLoading, setIsLoading] = useState(false);

    const handleClick = async () => {
        setIsLoading(true);

        try {
            const sdkSession = await createShopPaySdkSession(cart, {
                shopId: getShopPayShopId(),
                clientId: getShopPayClientId() || '',
                consignments,
                coupons,
                taxTotal,
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
                );
            let backendSession: Awaited<ReturnType<typeof createShopPaySession>>;
            const sourceIdentifier = `bc-${cart.id}-${crypto.randomUUID()}`;
            let submitIdempotencyKey: string | undefined;
            let submittedBigCommerceOrderId: number | undefined;
            let confirmationToken: string | undefined;
            let resolveSubmit: (result: ShopPaySubmitResult) => void;
            let rejectSubmit: (reason?: unknown) => void;
            const submitCompleted = new Promise<ShopPaySubmitResult>((resolve, reject) => {
                resolveSubmit = resolve;
                rejectSubmit = reject;
            });

            sdkSession.addEventListener('sessionrequested', async () => {
                try {
                    backendSession = await createShopPaySession(cart, {
                        backendUrl,
                        bcOrderId,
                        coupons,
                        sourceIdentifier,
                        taxTotal,
                    });
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
                    submittedBigCommerceOrderId = submitResult.bcOrderId;
                    confirmationToken = submitResult.confirmationToken;
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

                if (!submittedBigCommerceOrderId || !confirmationToken) {
                    onError?.(new Error('Shop Pay completed without confirmation details.'));
                    setIsLoading(false);
                    return;
                }

                setIsLoading(false);
                sdkSession.close();
                onPaymentComplete?.(submittedBigCommerceOrderId, confirmationToken);
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
