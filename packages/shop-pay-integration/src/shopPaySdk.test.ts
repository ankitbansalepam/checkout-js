import { type Cart, type Consignment } from '@bigcommerce/checkout-sdk';

import { buildShopPayPaymentRequest, roundMoney } from './shopPaySdk';

describe('roundMoney', () => {
    it('rounds half a cent up like BigCommerce totals', () => {
        expect(roundMoney(49.445)).toBe(49.45);
        expect(roundMoney(38.444)).toBe(38.44);
        expect(roundMoney(11)).toBe(11);
    });
});

const cart = {
    baseAmount: 25,
    cartAmount: 25,
    currency: { code: 'USD' },
    lineItems: { physicalItems: [], digitalItems: [] },
} as unknown as Cart;

describe('buildShopPayPaymentRequest', () => {
    it('ignores consignments without a selected shipping option', () => {
        const consignments = [
            { id: 'c-1', selectedShippingOption: null, availableShippingOptions: [] },
        ] as unknown as Consignment[];

        const request = buildShopPayPaymentRequest(cart, consignments);

        expect(request.shippingLines).toEqual([]);
        expect(request.total).toEqual({ amount: 25, currencyCode: 'USD' });
    });
});

describe('buildShopPayPaymentRequest delivery methods', () => {
    const options = [
        { id: 'flat', description: 'Flat rate', cost: 10 },
        { id: 'white', description: 'White Glove Delivery', cost: 80 },
    ];
    const availability = { scheduled: false, services: ['White Glove Delivery'], eligible: null, dates: [] };

    it('leaves scheduled services out for other carts', () => {
        const consignments = [
            { id: 'c-1', selectedShippingOption: options[0], availableShippingOptions: options },
        ] as unknown as Consignment[];

        const request = buildShopPayPaymentRequest(cart, consignments, [], 0, { availability });

        expect((request.deliveryMethods as Array<{ code: string }>).map(({ code }) => code)).toEqual(['flat']);
    });

    it('offers only the chosen scheduled service, dated with the chosen day', () => {
        const consignments = [
            { id: 'c-1', selectedShippingOption: options[1], availableShippingOptions: options },
        ] as unknown as Consignment[];

        const request = buildShopPayPaymentRequest(cart, consignments, [], 0, {
            availability: { ...availability, scheduled: true, eligible: true, dates: ['2026-09-29'] },
            selection: { date: '2026-09-29', instructions: '' },
        });

        expect(request.deliveryMethods).toEqual([
            expect.objectContaining({
                code: 'white',
                label: 'White Glove Delivery – Tue, Sep 29',
                minDeliveryDate: '2026-09-29T00:00:00Z',
                maxDeliveryDate: '2026-09-29T23:59:59Z',
            }),
        ]);
        expect(request.shippingLines).toEqual([
            expect.objectContaining({ code: 'white', label: 'White Glove Delivery – Tue, Sep 29' }),
        ]);
        expect(request.total).toEqual({ amount: 105, currencyCode: 'USD' });
    });
});
