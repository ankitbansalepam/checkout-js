declare global {
    interface Window {
        shopPayBackendUrl?: string;
        shopPayClientId?: string;
        shopPayShopId?: number;
    }
}

// POC: public URL of shop-pay-backend deployed on Vercel.
// This is the permanent URL - no need to update unless redeploying.
// (or set window.shopPayBackendUrl to override without editing source).
const DEFAULT_SHOP_PAY_BACKEND_URL = 'https://shop-pay-backend.vercel.app';

export function getShopPayBackendUrl(): string | undefined {
    if (typeof window === 'undefined') {
        return undefined;
    }

    const backendUrl = window.shopPayBackendUrl || DEFAULT_SHOP_PAY_BACKEND_URL;

    return backendUrl.trim();
}

export function getShopPayClientId(): string | undefined {
    if (typeof window === 'undefined') {
        return undefined;
    }

    return window.shopPayClientId || '12c6494a-a2c5-4288-a018-f22b270db598';
}

export function getShopPayShopId(): number {
    if (typeof window === 'undefined') {
        return 76503548087;
    }

    return window.shopPayShopId || 76503548087;
}
