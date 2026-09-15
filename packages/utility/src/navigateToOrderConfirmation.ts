import { noop } from 'lodash';

import { replaceLocation } from '@bigcommerce/checkout/dom-utils';

import isBuyNowCart from './isBuyNowCart';

export default function navigateToOrderConfirmation(orderId?: number): Promise<never> {
    let url: string;

    if (orderId && isBuyNowCart()) {
        url = `/checkout/order-confirmation/${orderId.toString()}`;
    } else if (orderId) {
        url = `${window.location.pathname.replace(/\/$/, '')}/order-confirmation?orderId=${encodeURIComponent(orderId.toString())}`;
    } else {
        url = `${window.location.pathname.replace(/\/$/, '')}/order-confirmation`;
    }

    replaceLocation(url);

    return new Promise(noop);
}

export function navigateToShopPayOrderConfirmation(
    orderId?: number,
    confirmationToken?: string,
): Promise<never> {
    if (!orderId) {
        return navigateToOrderConfirmation();
    }

    const params = new URLSearchParams({
        orderId: orderId.toString(),
        shopPay: '1',
    });
    if (confirmationToken) params.set('confirmationToken', confirmationToken);
    const url = `${window.location.pathname.replace(/\/$/, '')}/order-confirmation?${params.toString()}`;

    replaceLocation(url);

    return new Promise(noop);
}
