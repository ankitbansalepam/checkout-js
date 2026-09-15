import { type Cart } from '@bigcommerce/checkout-sdk';

import { createShopPaySession } from './shopPayClient';

const cart = {
    id: 'cart-123',
    currency: { code: 'USD' },
    locale: 'en',
    baseAmount: 100,
    cartAmount: 95,
    lineItems: {
        physicalItems: [
            {
                name: 'Item',
                quantity: 1,
                sku: 'SKU-1',
                imageUrl: '/item.jpg',
                listPrice: 100,
                salePrice: 95,
                isShippingRequired: true,
            },
        ],
        digitalItems: [],
    },
} as unknown as Cart;

describe('createShopPaySession', () => {
    it('sends the checkout cart to the backend', async () => {
        const fetcher = jest.fn().mockResolvedValue({
            ok: true,
            json: () => ({
                token: 'token',
                checkoutUrl: 'https://shop.example/checkout',
                sourceIdentifier: 'bc-cart-123',
            }),
        });

        await expect(
            createShopPaySession(cart, { backendUrl: 'https://api.example/', fetcher }),
        ).resolves.toEqual({
            token: 'token',
            checkoutUrl: 'https://shop.example/checkout',
            sourceIdentifier: 'bc-cart-123',
        });

        expect(fetcher).toHaveBeenCalledWith(
            'https://api.example/shop-pay/session',
            expect.objectContaining({ method: 'POST' }),
        );
    });
});
