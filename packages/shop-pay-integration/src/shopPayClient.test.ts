import { type Cart } from '@bigcommerce/checkout-sdk';

import { completeShopPaySession, createShopPaySession } from './shopPayClient';

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

describe('completeShopPaySession', () => {
    const respond = (status: number, body: unknown) =>
        Promise.resolve({ ok: status < 300, status, json: () => Promise.resolve(body) } as Response);

    it('retries while the backend reports the payment as pending', async () => {
        const fetcher = jest
            .fn()
            .mockReturnValueOnce(respond(202, { pending: true }))
            .mockReturnValueOnce(respond(200, { bcOrderId: 116, confirmationToken: 'token' }));

        await expect(
            completeShopPaySession('bc-1', { backendUrl: 'https://backend.test/', fetcher, retryDelayMs: 0 }),
        ).resolves.toEqual({ bcOrderId: 116, confirmationToken: 'token' });
        expect(fetcher).toHaveBeenCalledTimes(2);
        expect(fetcher).toHaveBeenCalledWith('https://backend.test/shop-pay/complete', expect.anything());
    });

    it('fails when the payment is never confirmed', async () => {
        const fetcher = jest.fn(() => respond(202, { pending: true }));

        await expect(
            completeShopPaySession('bc-1', { backendUrl: 'https://backend.test', fetcher, attempts: 2, retryDelayMs: 0 }),
        ).rejects.toThrow('has not confirmed the payment');
    });

    it('surfaces backend errors', async () => {
        const fetcher = jest.fn(() => respond(409, { error: 'The Shopify payment does not match the order total' }));

        await expect(
            completeShopPaySession('bc-1', { backendUrl: 'https://backend.test', fetcher, retryDelayMs: 0 }),
        ).rejects.toThrow('does not match');
    });
});
