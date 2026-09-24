import React, { useEffect, useState } from 'react';

import { getShopPayBackendUrl } from '@bigcommerce/checkout/shop-pay-integration';
import { OrderConfirmationPageSkeleton } from '@bigcommerce/checkout/ui';

import OrderConfirmationSection from './OrderConfirmationSection';

interface BigCommerceOrder {
    id: number;
    status: string;
    customer_name?: string;
    customer_email?: string;
    subtotal_inc_tax?: string | number;
    total_tax?: string | number;
    total_inc_tax: string;
    shipping_cost_inc_tax?: string | number;
    currency_code: string;
    products?: Array<{
        id?: number;
        name: string;
        quantity: number;
        price_inc_tax: number | string;
        image_url?: string;
    }>;
}

export const ShopPayOrderConfirmation = ({
    confirmationToken,
    orderId,
}: {
    confirmationToken: string;
    orderId: number;
}) => {
    const [order, setOrder] = useState<BigCommerceOrder>();
    const [error, setError] = useState<string>();

    useEffect(() => {
        const backendUrl = getShopPayBackendUrl();

        fetch(`${backendUrl}/bigcommerce/orders/${orderId}`, {
            headers: { 'X-Shop-Pay-Confirmation-Token': confirmationToken },
        })
            .then(async (response) => {
                if (!response.ok) throw new Error('Unable to load order confirmation');
                return response.json() as Promise<BigCommerceOrder>;
            })
            .then(setOrder)
            .catch((reason: Error) => setError(reason.message));
    }, [orderId]);

    if (error) {
        return (
            <div className="layout optimizedCheckout-contentPrimary">
                <div className="layout-main">
                    <div className="orderConfirmation">
                        <OrderConfirmationSection>
                            <p className="shopPayOrderConfirmation-error">{error}</p>
                        </OrderConfirmationSection>
                    </div>
                </div>
            </div>
        );
    }

    if (!order) return <OrderConfirmationPageSkeleton />;

    const siteLink = typeof window !== 'undefined' ? window.location.origin : '/';
    const formatAmount = (amount: number | string): string => Number(amount).toFixed(2);
    const subtotal = order.subtotal_inc_tax ?? order.total_inc_tax;
    const shipping = order.shipping_cost_inc_tax ?? '0.00';
    const tax = order.total_tax ?? '0.00';

    return (
        <div className="layout optimizedCheckout-contentPrimary shopPayOrderConfirmationLayout">
            <div className="layout-main">
                <div className="orderConfirmation shopPayOrderConfirmation">
                    <h1 className="optimizedCheckout-headingPrimary">
                        Thank you{order.customer_name ? ` ${order.customer_name}` : ''}!
                    </h1>

                    <OrderConfirmationSection>
                        <p>
                            Your order number is <strong>{order.id}</strong>
                        </p>
                        <p>
                            An email will be sent containing information about your purchase.
                            {order.customer_email && (
                                <>
                                    {' '}If you have any questions about your purchase, email us at{' '}
                                    <a href={`mailto:${order.customer_email}`}>{order.customer_email}</a>.
                                </>
                            )}
                        </p>
                    </OrderConfirmationSection>

                    <div className="continueButtonContainer">
                        <form action={siteLink} method="get" target="_top">
                            <button
                                className="button button--secondary"
                                type="submit"
                            >
                                Continue shopping
                            </button>
                        </form>
                    </div>
                </div>
            </div>
            <aside className="layout-cart">
                <article className="cart optimizedCheckout-orderSummary shopPayOrderSummary">
                    <header className="cart-header">
                        <h2 className="cart-header-title">Order Summary</h2>
                        <button className="shopPayOrderSummary-print" onClick={() => window.print()} type="button">
                            Print
                        </button>
                    </header>
                    <section className="cart-section shopPayOrderSummary-items">
                        <h3 className="shopPayOrderSummary-count">
                            {order.products?.reduce((count, product) => count + product.quantity, 0) || 0}{' '}
                            {order.products?.length === 1 ? 'Item' : 'Items'}
                        </h3>
                        {order.products?.map((product, index) => (
                            <div
                                className="shopPayOrderSummary-item"
                                key={product.id || `${product.name}-${index}`}
                            >
                                {product.image_url && (
                                    <img
                                        alt=""
                                        className="shopPayOrderSummary-image"
                                        src={product.image_url}
                                    />
                                )}
                                <span>
                                    {product.quantity} x {product.name}
                                </span>
                                <strong>
                                    {order.currency_code} {formatAmount(product.price_inc_tax)}
                                </strong>
                            </div>
                        ))}
                    </section>
                    <section className="cart-section shopPayOrderSummary-totals">
                        <p><span>Subtotal</span><span>{order.currency_code} {formatAmount(subtotal)}</span></p>
                        <p><span>Shipping</span><span>{order.currency_code} {formatAmount(shipping)}</span></p>
                        <p><span>Tax</span><span>{order.currency_code} {formatAmount(tax)}</span></p>
                    </section>
                    <section className="cart-section shopPayOrderSummary-total">
                        <strong>Total ({order.currency_code})</strong>
                        <strong>{order.currency_code} {formatAmount(order.total_inc_tax)}</strong>
                    </section>
                </article>
            </aside>
        </div>
    );
};