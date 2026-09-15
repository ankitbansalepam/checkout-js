declare global {
    interface Window {
        shopPayBackendUrl?: string;
        shopPayClientId?: string;
        shopPayShopId?: number;
    }
}

// POC: public URL of shop-pay-backend (ngrok tunnel of localhost:8787).
// ngrok rotates this subdomain on every restart — update THIS one line when it
// changes (or set window.shopPayBackendUrl to override without editing source).
const DEFAULT_SHOP_PAY_BACKEND_URL = 'https://df86-203-170-48-2.ngrok-free.app';

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
