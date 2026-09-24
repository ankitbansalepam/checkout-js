import { render, screen } from '@testing-library/react';
import React from 'react';

import { ShopPayCheckoutControl } from './ShopPayCheckoutControl';

let checkoutData: Record<string, unknown>;
let checkoutService: Record<string, unknown>;
let buttonProps: Record<string, any>;

jest.mock('@bigcommerce/checkout/contexts', () => ({
    useCheckout: (selector: (state: { data: Record<string, () => unknown> }) => unknown) => ({
        checkoutService,
        selectedState: selector({
            data: {
                getBillingAddress: () => checkoutData.billingAddress,
                getCart: () => checkoutData.cart,
                getCheckout: () => ({ taxTotal: 0 }),
                getConsignments: () => checkoutData.consignments,
                getCoupons: () => [],
            },
        }),
    }),
}));

jest.mock('./ShopPayButton', () => ({
    ShopPayButton: (props: Record<string, unknown>) => {
        buttonProps = props;

        return <button type="button">Shop Pay</button>;
    },
}));

const physicalCart = { lineItems: { physicalItems: [{ id: 'item-1' }], digitalItems: [] } };
const digitalCart = { lineItems: { physicalItems: [], digitalItems: [{ id: 'item-2' }] } };
const billingAddress = { address1: '1 Main St', countryCode: 'US' };
const shippedConsignment = { id: 'c-1', selectedShippingOption: { id: 'ship-1' } };
const unshippedConsignment = { id: 'c-1', selectedShippingOption: undefined };

const renderAt = (placement: 'top' | 'payment') =>
    render(<ShopPayCheckoutControl backendUrl="https://backend.test" placement={placement} />);

beforeEach(() => {
    checkoutService = {};
});

describe('ShopPayCheckoutControl placement', () => {
    it('renders only at the top when billing address and shipping method are known', () => {
        checkoutData = { billingAddress, cart: physicalCart, consignments: [shippedConsignment] };

        renderAt('top');
        expect(screen.getByText('Shop Pay')).toBeInTheDocument();

        renderAt('payment');
        expect(screen.getAllByText('Shop Pay')).toHaveLength(1);
    });

    it('renders only in the payment step when no shipping method is selected', () => {
        checkoutData = { billingAddress, cart: physicalCart, consignments: [unshippedConsignment] };

        renderAt('top');
        expect(screen.queryByText('Shop Pay')).not.toBeInTheDocument();

        renderAt('payment');
        expect(screen.getByText('Shop Pay')).toBeInTheDocument();
    });

    it('renders only in the payment step when the billing address is missing', () => {
        checkoutData = { billingAddress: undefined, cart: physicalCart, consignments: [shippedConsignment] };

        renderAt('top');
        expect(screen.queryByText('Shop Pay')).not.toBeInTheDocument();

        renderAt('payment');
        expect(screen.getByText('Shop Pay')).toBeInTheDocument();
    });

    it('does not require a shipping method for digital-only carts', () => {
        checkoutData = { billingAddress, cart: digitalCart, consignments: [] };

        renderAt('top');
        expect(screen.getByText('Shop Pay')).toBeInTheDocument();

        renderAt('payment');
        expect(screen.getAllByText('Shop Pay')).toHaveLength(1);
    });
});

describe('ShopPayCheckoutControl shipping address change', () => {
    it('re-selects the Shop Pay delivery method after the address update clears it', async () => {
        const cart = {
            lineItems: { physicalItems: [{ id: 'item-1', quantity: 1 }], digitalItems: [] },
        };
        const options = [
            { id: 'ship-1', isRecommended: true },
            { id: 'ship-2', isRecommended: false },
        ];
        let stateConsignments: Array<Record<string, unknown>> = [
            { id: 'c-1', availableShippingOptions: options, selectedShippingOption: undefined },
        ];
        const selectConsignmentShippingOption = jest.fn(async (id: string, optionId: string) => {
            stateConsignments = [
                { id, availableShippingOptions: options, selectedShippingOption: { id: optionId } },
            ];
        });

        checkoutService = {
            updateConsignment: jest.fn(async () => undefined),
            loadShippingOptions: jest.fn(async () => undefined),
            selectConsignmentShippingOption,
            getState: () => ({
                data: {
                    getConsignments: () => stateConsignments,
                    getCheckout: () => ({ taxTotal: 0 }),
                },
            }),
        };
        checkoutData = {
            billingAddress,
            cart,
            consignments: [{ id: 'c-1', lineItemIds: ['item-1'], selectedShippingOption: { id: 'ship-1' } }],
        };

        renderAt('top');

        const result = await buttonProps.onShippingAddressChanged(
            { address1: '1 Main St', city: 'Blue Ash', countryCode: 'US', zip: '45236' },
            'ship-2',
        );

        expect(selectConsignmentShippingOption).toHaveBeenCalledWith('c-1', 'ship-2');
        expect(result.consignments[0].selectedShippingOption).toEqual({ id: 'ship-2' });
    });
});
