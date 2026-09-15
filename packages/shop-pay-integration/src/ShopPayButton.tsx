import { type Cart, type Consignment, type Coupon } from '@bigcommerce/checkout-sdk';
import React, { type FunctionComponent, useState } from 'react';

import { getShopPayClientId, getShopPayShopId } from './shopPayConfig';
import { createShopPaySession } from './shopPayClient';
import { buildShopPayPaymentRequest, createShopPaySdkSession } from './shopPaySdk';

export interface ShopPayButtonProps {
    cart: Cart;
    taxTotal?: number;
    bcOrderId?: number;
    onPaymentComplete?(orderId?: number, confirmationToken?: string): void;
    consignments?: Consignment[];
    coupons?: Coupon[];
    onShippingAddressChanged?(address: Record<string, unknown>): Promise<{
        consignments: Consignment[];
        taxTotal: number;
    }>;
    onDiscountCodesChanged?(codes: string[]): Promise<{
        cart: Cart;
        coupons: Coupon[];
        taxTotal: number;
    }>;
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
            let backendSession: Awaited<ReturnType<typeof createShopPaySession>>;
            let submitIdempotencyKey: string | undefined;
            let submittedBigCommerceOrderId: number | undefined;
            let confirmationToken: string | undefined;

            sdkSession.addEventListener('sessionrequested', async () => {
                try {
                    backendSession = await createShopPaySession(cart, {
                        backendUrl,
                        bcOrderId,
                        coupons,
                        taxTotal,
                    });
                    sdkSession.completeSessionRequest({
                        token: backendSession.token,
                        checkoutUrl: backendSession.checkoutUrl,
                        sourceIdentifier: backendSession.sourceIdentifier,
                        updatedPaymentRequest: buildShopPayPaymentRequest(
                            cart,
                            consignments,
                            coupons,
                            taxTotal,
                        ),
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
                    const submitResult = await import('./shopPayClient').then(
                        ({ submitShopPaySession }) =>
                            submitShopPaySession(backendSession.sourceIdentifier, {
                                backendUrl,
                                idempotencyKey: submitIdempotencyKey,
                                paymentMethod: sdkSession.paymentRequest?.paymentMethod,
                                paymentRequest: sdkSession.paymentRequest,
                                billingAddress: event.billingAddress as Record<string, unknown>,
                            }),
                    );
                    submittedBigCommerceOrderId = submitResult.bcOrderId;
                    confirmationToken = submitResult.confirmationToken;
                    sdkSession.completePaymentConfirmationRequest();
                } catch (error) {
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
                    const { consignments: updatedConsignments, taxTotal: updatedTaxTotal } =
                        await onShippingAddressChanged(event.shippingAddress);
                    sdkSession.completeShippingAddressChange({
                        updatedPaymentRequest: buildShopPayPaymentRequest(
                            cart,
                            updatedConsignments,
                            coupons,
                            updatedTaxTotal,
                        ),
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
                    const {
                        cart: updatedCart,
                        coupons: updatedCoupons,
                        taxTotal: updatedTaxTotal,
                    } =
                        await onDiscountCodesChanged(enteredCodes);
                    const acceptedCodes = updatedCoupons.map((coupon) => coupon.code);
                    const rejectedCodes = enteredCodes.filter((code) => !acceptedCodes.includes(code));

                    sdkSession.completeDiscountCodeChange({
                        updatedPaymentRequest: buildShopPayPaymentRequest(
                            updatedCart,
                            consignments,
                            updatedCoupons,
                            updatedTaxTotal,
                        ),
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

            sdkSession.addEventListener('deliverymethodchanged', (event) => {
                const currentPaymentRequest = sdkSession.paymentRequest || {};
                const deliveryMethod = event.deliveryMethod;

                if (!deliveryMethod) {
                    sdkSession.completeDeliveryMethodChange({
                        updatedPaymentRequest: {
                            ...currentPaymentRequest,
                            shippingLines: [],
                            totalShippingPrice: undefined,
                            total: { amount: cart.cartAmount, currencyCode: cart.currency.code },
                        },
                    });
                    return;
                }

                try {
                    sdkSession.completeDeliveryMethodChange({
                        updatedPaymentRequest: {
                            ...currentPaymentRequest,
                            shippingLines: [
                                {
                                    label: deliveryMethod.label,
                                    code: deliveryMethod.code,
                                    amount: deliveryMethod.amount,
                                },
                            ],
                            totalShippingPrice: { finalTotal: deliveryMethod.amount },
                            total: {
                                amount: cart.cartAmount + deliveryMethod.amount.amount,
                                currencyCode: deliveryMethod.amount.currencyCode,
                            },
                        },
                    });
                } catch (error) {
                    sdkSession.completeDeliveryMethodChange({
                        errors: [{ type: 'generalError', message: String(error) }],
                    });
                }
            });

            sdkSession.addEventListener('paymentcomplete', () => {
                setIsLoading(false);
                onPaymentComplete?.(submittedBigCommerceOrderId, confirmationToken);
                sdkSession.close();
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
