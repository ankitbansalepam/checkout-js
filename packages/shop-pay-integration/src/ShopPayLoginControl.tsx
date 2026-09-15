import React, { type FunctionComponent, useEffect, useRef } from 'react';

import { getShopPayClientId, getShopPayShopId } from './shopPayConfig';
import { createShopPayLogin } from './shopPaySdk';

export interface ShopPayLoginControlProps {
    emailInputId: string;
}

// Recognizes a returning Shop Pay user as soon as they type their email, so
// they can authenticate before opening the Shop Pay button/popup at all.
export const ShopPayLoginControl: FunctionComponent<ShopPayLoginControlProps> = ({
    emailInputId,
}) => {
    const containerId = `shop-pay-login-${emailInputId}`;
    const hasRendered = useRef(false);

    useEffect(() => {
        if (hasRendered.current) {
            return;
        }

        hasRendered.current = true;

        createShopPayLogin({
            shopId: getShopPayShopId(),
            clientId: getShopPayClientId() || '',
            emailInputId,
        })
            .then((login) => login.render(`#${containerId}`))
            .catch(() => {
                // Non-fatal: the buyer can still use the Shop Pay button/popup flow.
            });
    }, [containerId, emailInputId]);

    return <div id={containerId} />;
};
