import React, { type FunctionComponent } from 'react';

import { useCheckout } from '@bigcommerce/checkout/contexts';

import { ShopPayButton, type ShopPayButtonProps } from './ShopPayButton';

export type ShopPayCheckoutControlProps = Omit<ShopPayButtonProps, 'cart'> & {
    // The same control is mounted at the top of checkout and in the payment step;
    // exactly one of them renders so the shopper never sees two Shop Pay buttons.
    placement: 'top' | 'payment';
};

export const ShopPayCheckoutControl: FunctionComponent<ShopPayCheckoutControlProps> = ({
    placement,
    ...props
}) => {
    const { checkoutService } = useCheckout(() => undefined);
    const {
        selectedState: { billingAddress, cart, checkout, consignments, coupons },
    } = useCheckout(({ data }) => ({
        billingAddress: data.getBillingAddress(),
        cart: data.getCart(),
        checkout: data.getCheckout(),
        consignments: data.getConsignments() || [],
        coupons: data.getCoupons() || [],
    }));

    if (!cart) {
        return null;
    }

    // Show at the top only once shipping and billing are known (e.g. a signed-in
    // shopper with saved addresses), so Shop Pay gets real delivery options and totals.
    const hasBillingAddress = Boolean(billingAddress?.address1 && billingAddress.countryCode);
    const hasSelectedShipping =
        cart.lineItems.physicalItems.length === 0 ||
        (consignments.length > 0 &&
            consignments.every((consignment) => consignment.selectedShippingOption));
    const isReadyForTop = hasBillingAddress && hasSelectedShipping;

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
            coupons: state.getCoupons() || [],
            taxTotal: state.getCheckout()?.taxTotal || 0,
        };
    };

    const onShippingAddressChanged = async (address: Record<string, unknown>) => {
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

        await Promise.all(
            (consignments || []).map((consignment) =>
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
            onShippingAddressChanged={onShippingAddressChanged}
            onDiscountCodesChanged={onDiscountCodesChanged}
        />
    );
};
