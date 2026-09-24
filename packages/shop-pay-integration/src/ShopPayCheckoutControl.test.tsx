import { render, screen } from '@testing-library/react';
import React from 'react';

import { resetShopPayPlacement, ShopPayCheckoutControl } from './ShopPayCheckoutControl';

let checkoutData: Record<string, unknown>;
let checkoutService: Record<string, unknown>;
let buttonProps: Record<string, any>;
let deliveryState: Record<string, any>;

const parcelDelivery = {
    status: 'ready',
    availability: { scheduled: false, services: ['White Glove Delivery'], eligible: null, dates: [] },
};

jest.mock('./scheduledDelivery', () => ({
    ...jest.requireActual('./scheduledDelivery'),
    useScheduledDelivery: () => deliveryState,
}));

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
                getCustomer: () => checkoutData.customer,
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
    deliveryState = parcelDelivery;
    resetShopPayPlacement();
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

describe('ShopPayCheckoutControl placement when addresses are filled in during checkout', () => {
    it('stays in the payment step after shipping and billing are completed', () => {
        checkoutData = { billingAddress: undefined, cart: physicalCart, consignments: [unshippedConsignment] };

        const { unmount } = renderAt('top');

        expect(screen.queryByText('Shop Pay')).not.toBeInTheDocument();
        unmount();

        checkoutData = { billingAddress, cart: physicalCart, consignments: [shippedConsignment] };

        renderAt('top');
        expect(screen.queryByText('Shop Pay')).not.toBeInTheDocument();

        renderAt('payment');
        expect(screen.getByText('Shop Pay')).toBeInTheDocument();
    });
});

describe('ShopPayCheckoutControl placement for signed-in shoppers', () => {
    it('renders only at the top even before addresses are known', () => {
        checkoutData = {
            billingAddress: undefined,
            cart: physicalCart,
            consignments: [],
            customer: { isGuest: false },
        };

        renderAt('top');
        expect(screen.getByText('Shop Pay')).toBeInTheDocument();

        renderAt('payment');
        expect(screen.getAllByText('Shop Pay')).toHaveLength(1);
    });
});

describe('ShopPayCheckoutControl scheduled delivery', () => {
    const scheduledAvailability = {
        scheduled: true,
        services: ['White Glove Delivery'],
        eligible: true,
        dates: ['2026-09-29'],
    };

    beforeEach(() => {
        checkoutData = {
            billingAddress,
            cart: physicalCart,
            consignments: [shippedConsignment],
            customer: { isGuest: false },
        };
    });

    it('never shows the top button for a scheduled-delivery cart', () => {
        deliveryState = { status: 'ready', availability: scheduledAvailability };

        renderAt('top');

        expect(screen.queryByText('Shop Pay')).not.toBeInTheDocument();
    });

    it('asks for a delivery date before offering Shop Pay in the payment step', () => {
        deliveryState = { status: 'ready', availability: scheduledAvailability };

        renderAt('payment');

        expect(screen.queryByText('Shop Pay')).not.toBeInTheDocument();
        expect(screen.getByText(/Choose a delivery date/)).toBeInTheDocument();
    });

    it('passes the chosen date to Shop Pay in the payment step', () => {
        const selection = { date: '2026-09-29', instructions: 'Buzz 12' };

        deliveryState = { status: 'ready', availability: scheduledAvailability, selection };

        renderAt('payment');

        expect(screen.getByText('Shop Pay')).toBeInTheDocument();
        expect(buttonProps.scheduledDelivery).toEqual(selection);
        expect(buttonProps.deliveryAvailability).toEqual(scheduledAvailability);
    });
});

describe('ShopPayCheckoutControl delivery method change', () => {
    it('selects the Shop Pay delivery method in BigCommerce', async () => {
        const options = [{ id: 'ship-1' }, { id: 'ship-2' }];
        let stateConsignments: Array<Record<string, unknown>> = [
            { id: 'c-1', availableShippingOptions: options, selectedShippingOption: { id: 'ship-1' } },
        ];
        const selectConsignmentShippingOption = jest.fn(async (id: string, optionId: string) => {
            stateConsignments = [
                { id, availableShippingOptions: options, selectedShippingOption: { id: optionId } },
            ];
        });

        checkoutService = {
            selectConsignmentShippingOption,
            getState: () => ({
                data: {
                    getConsignments: () => stateConsignments,
                    getCart: () => undefined,
                    getCheckout: () => ({ taxTotal: 0 }),
                },
            }),
        };
        checkoutData = { billingAddress, cart: physicalCart, consignments: stateConsignments };

        renderAt('top');

        const result = await buttonProps.onDeliveryMethodChanged('ship-2');

        expect(selectConsignmentShippingOption).toHaveBeenCalledWith('c-1', 'ship-2');
        expect(result.consignments[0].selectedShippingOption).toEqual({ id: 'ship-2' });
        expect(result.cart).toBe(physicalCart);
    });
});

describe('ShopPayCheckoutControl shipping address change', () => {
    it('creates a consignment from the Shop Pay address when checkout has none', async () => {
        const options = [{ id: 'ship-1', isRecommended: true }];
        let stateConsignments: Array<Record<string, unknown>> = [];
        const updateShippingAddress = jest.fn(async () => {
            stateConsignments = [{ id: 'c-1', availableShippingOptions: options }];
        });
        const selectConsignmentShippingOption = jest.fn(async (id: string, optionId: string) => {
            stateConsignments = [
                { id, availableShippingOptions: options, selectedShippingOption: { id: optionId } },
            ];
        });

        checkoutService = {
            updateShippingAddress,
            updateConsignment: jest.fn(),
            loadShippingOptions: jest.fn(async () => undefined),
            selectConsignmentShippingOption,
            getState: () => ({
                data: {
                    getConsignments: () => stateConsignments,
                    getCart: () => undefined,
                    getCheckout: () => ({ taxTotal: 0 }),
                },
            }),
        };
        checkoutData = {
            cart: { lineItems: { physicalItems: [{ id: 'item-1', quantity: 1 }], digitalItems: [] } },
            consignments: [],
            customer: { isGuest: false },
        };

        renderAt('top');

        const result = await buttonProps.onShippingAddressChanged({
            address1: '1 Main St',
            city: 'Blue Ash',
            countryCode: 'US',
            zip: '45236',
        });

        expect(updateShippingAddress).toHaveBeenCalledWith(
            expect.objectContaining({ address1: '1 Main St', postalCode: '45236' }),
        );
        expect(checkoutService.updateConsignment).not.toHaveBeenCalled();
        expect(selectConsignmentShippingOption).toHaveBeenCalledWith('c-1', 'ship-1');
        expect(result.consignments[0].selectedShippingOption).toEqual({ id: 'ship-1' });
    });

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
                    getCart: () => undefined,
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
