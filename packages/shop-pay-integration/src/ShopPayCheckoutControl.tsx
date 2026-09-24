import React, { type FunctionComponent } from 'react';

import { useCheckout } from '@bigcommerce/checkout/contexts';

import { ShopPayButton, type ShopPayButtonProps } from './ShopPayButton';

export type ShopPayCheckoutControlProps = Omit<ShopPayButtonProps, 'cart'> & {
    // The same control is mounted at the top of checkout and in the payment step;
    // exactly one of them renders so the shopper never sees two Shop Pay buttons.
    placement: 'top' | 'payment';
};

// Checkout readiness recorded the first time a control renders for a cart. Both
// placements read it, so they agree on where the single Shop Pay button goes.
const initialReadinessByCartId = new Map<string, boolean>();

export const resetShopPayPlacement = () => initialReadinessByCartId.clear();

export const ShopPayCheckoutControl: FunctionComponent<ShopPayCheckoutControlProps> = ({
    placement,
    ...props
}) => {
    const { checkoutService } = useCheckout(() => undefined);
    const {
        selectedState: { billingAddress, cart, checkout, consignments, coupons, isSignedIn },
    } = useCheckout(({ data }) => ({
        billingAddress: data.getBillingAddress(),
        cart: data.getCart(),
        checkout: data.getCheckout(),
        consignments: data.getConsignments() || [],
        coupons: data.getCoupons() || [],
        isSignedIn: data.getCustomer()?.isGuest === false,
    }));

    if (!cart) {
        return null;
    }

    // Show at the top for signed-in shoppers, and when shipping and billing were already
    // known when checkout loaded. A guest who fills them in during checkout keeps Shop Pay
    // in the payment methods, so the button doesn't jump to the top once their addresses
    // are complete.
    const hasBillingAddress = Boolean(billingAddress?.address1 && billingAddress.countryCode);
    const hasSelectedShipping =
        cart.lineItems.physicalItems.length === 0 ||
        (consignments.length > 0 &&
            consignments.every((consignment) => consignment.selectedShippingOption));

    if (!initialReadinessByCartId.has(cart.id)) {
        initialReadinessByCartId.set(cart.id, hasBillingAddress && hasSelectedShipping);
    }

    const isReadyForTop = isSignedIn || initialReadinessByCartId.get(cart.id);

    if ((placement === 'top') !== isReadyForTop) {
        return null;
    }

    const onDiscountCodesChanged = async (codes: string[]) => {
        const currentCodes = coupons.map((coupon) => coupon.code);
        const codesToRemove = currentCodes.filter((code) => !codes.includes(code));
        const codesToAdd = codes.filter((code) => !currentCodes.includes(code));

        await Promise.all(codesToRemove.map((code) => checkoutService.removeCoupon(code)));

        for (const code of codesToAdd) {
            try {
                await checkoutService.applyCoupon(code);
            } catch {
                // Invalid/expired codes are surfaced to the buyer via completeDiscountCodeChange.
            }
        }

        const state = checkoutService.getState().data;

        return {
            cart: state.getCart() || cart,
            consignments: state.getConsignments() || [],
            coupons: state.getCoupons() || [],
            taxTotal: state.getCheckout()?.taxTotal || 0,
        };
    };

    const onDeliveryMethodChanged = async (shippingOptionId: string) => {
        const currentConsignments = checkoutService.getState().data.getConsignments() || [];

        await Promise.all(
            currentConsignments
                .filter(
                    (consignment) =>
                        consignment.selectedShippingOption?.id !== shippingOptionId &&
                        (consignment.availableShippingOptions || []).some(
                            ({ id }) => id === shippingOptionId,
                        ),
                )
                .map((consignment) =>
                    checkoutService.selectConsignmentShippingOption(consignment.id, shippingOptionId),
                ),
        );

        const state = checkoutService.getState().data;

        return {
            cart: state.getCart() || cart,
            consignments: state.getConsignments() || [],
            taxTotal: state.getCheckout()?.taxTotal || 0,
        };
    };

    const onShippingAddressChanged = async (
        address: Record<string, unknown>,
        preferredShippingOptionId?: string,
    ) => {
        const firstName = String(address.firstName || address.givenName || '');
        const lastName = String(address.lastName || address.familyName || '');
        const address1 = String(address.address1 || address.addressLine1 || '');
        const address2 = String(address.address2 || address.addressLine2 || '');
        const stateOrProvince = String(
            address.stateOrProvince || address.province || address.administrativeArea || '',
        );
        const stateOrProvinceCode = String(
            address.stateOrProvinceCode || address.provinceCode || address.administrativeArea || '',
        );
        const shippingAddress = {
            company: '',
            firstName,
            lastName,
            address1,
            address2,
            city: String(address.city || ''),
            stateOrProvince,
            stateOrProvinceCode,
            countryCode: String(address.countryCode || ''),
            postalCode: String(address.zip || address.postalCode || ''),
            phone: String(address.phone || ''),
            customFields: [],
        };
        const cartItems = [...cart.lineItems.physicalItems, ...cart.lineItems.digitalItems];

        // A signed-in shopper can open Shop Pay from the top before checkout has a
        // consignment; create one for the whole cart from the Shop Pay address.
        if (!consignments.length && cart.lineItems.physicalItems.length) {
            await checkoutService.updateShippingAddress(shippingAddress);
        }

        await Promise.all(
            consignments.map((consignment) =>
                checkoutService.updateConsignment({
                    id: consignment.id,
                    address: shippingAddress,
                    shippingAddress,
                    lineItems: consignment.lineItemIds
                        .map((itemId) => {
                            const item = cartItems.find((cartItem) => cartItem.id === itemId);

                            return item ? { itemId, quantity: item.quantity } : null;
                        })
                        .filter((item): item is { itemId: string; quantity: number } => item !== null),
                }),
            ),
        );

        await checkoutService.loadShippingOptions();

        // Changing the address clears BigCommerce's selected shipping option. Re-select one so
        // the payment request keeps a shipping line; otherwise its total no longer matches the
        // delivery method shown in Shop Pay and Shopify declines the payment.
        await Promise.all(
            (checkoutService.getState().data.getConsignments() || []).map((consignment) => {
                const options = consignment.availableShippingOptions || [];
                const previousOptionId = consignments.find(({ id }) => id === consignment.id)
                    ?.selectedShippingOption?.id;
                const option =
                    options.find(({ id }) => id === preferredShippingOptionId) ||
                    options.find(({ id }) => id === previousOptionId) ||
                    options.find(({ isRecommended }) => isRecommended) ||
                    options[0];

                if (!option || consignment.selectedShippingOption?.id === option.id) {
                    return undefined;
                }

                return checkoutService.selectConsignmentShippingOption(consignment.id, option.id);
            }),
        );

        const updatedConsignments = checkoutService.getState().data.getConsignments() || [];
        const hasPhysicalItems = cart.lineItems.physicalItems.length > 0;
        const hasShippingMethods = updatedConsignments.some(
            (consignment) => (consignment.availableShippingOptions || []).length > 0,
        );

        if (hasPhysicalItems && !hasShippingMethods) {
            throw new Error(
                'No shipping methods are available for this address. Return to checkout, choose a supported shipping address, and select a shipping method before trying Shop Pay again.',
            );
        }

        return {
            cart: checkoutService.getState().data.getCart() || cart,
            consignments: updatedConsignments,
            taxTotal: checkoutService.getState().data.getCheckout()?.taxTotal || 0,
        };
    };

    return (
        <ShopPayButton
            {...props}
            cart={cart}
            taxTotal={checkout?.taxTotal || 0}
            consignments={consignments}
            coupons={coupons}
            onDeliveryMethodChanged={onDeliveryMethodChanged}
            onShippingAddressChanged={onShippingAddressChanged}
            onDiscountCodesChanged={onDiscountCodesChanged}
        />
    );
};
