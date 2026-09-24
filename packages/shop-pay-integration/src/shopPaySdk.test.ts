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
