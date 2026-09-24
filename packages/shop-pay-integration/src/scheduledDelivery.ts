import { type Cart } from '@bigcommerce/checkout-sdk';
import { useEffect, useSyncExternalStore } from 'react';

// Scheduled (truck) delivery for carts containing products the backend marks as
// scheduled: only the scheduled services (e.g. White Glove / Green Glove) are offered,
// and the shopper must pick a delivery date. Shared by the shipping step and Shop Pay.

export interface ScheduledDeliveryAvailability {
    scheduled: boolean;
    services: string[];
    eligible: boolean | null;
    dates: string[];
}

export interface ScheduledDeliverySelection {
    date: string;
    instructions: string;
}

export interface ScheduledDeliveryAddress {
    countryCode?: string;
    postalCode?: string;
}

export interface ScheduledDeliveryState {
    status: 'idle' | 'loading' | 'ready' | 'error';
    cartId?: string;
    availability?: ScheduledDeliveryAvailability;
    selection?: ScheduledDeliverySelection;
}

let state: ScheduledDeliveryState = { status: 'idle' };
let loadedKey: string | undefined;
const listeners = new Set<() => void>();

const storageKey = (cartId: string) => `shopPayScheduledDelivery:${cartId}`;

function setState(next: ScheduledDeliveryState) {
    state = next;

    try {
        if (next.cartId) {
            if (next.selection) {
                sessionStorage.setItem(storageKey(next.cartId), JSON.stringify(next.selection));
            } else {
                sessionStorage.removeItem(storageKey(next.cartId));
            }
        }
    } catch {
        // Storage can be unavailable (private mode); the selection then lasts until reload.
    }

    listeners.forEach((listener) => listener());
}

function readStoredSelection(cartId: string): ScheduledDeliverySelection | undefined {
    try {
        const value = sessionStorage.getItem(storageKey(cartId));

        return value ? (JSON.parse(value) as ScheduledDeliverySelection) : undefined;
    } catch {
        return undefined;
    }
}

function subscribe(listener: () => void) {
    listeners.add(listener);

    return () => {
        listeners.delete(listener);
    };
}

export function getCartProductIds(cart: Cart): number[] {
    return [...cart.lineItems.physicalItems, ...cart.lineItems.digitalItems].map(
        (item) => item.productId,
    );
}

export async function fetchScheduledDeliveryOptions(
    backendUrl: string,
    productIds: number[],
    address?: ScheduledDeliveryAddress,
    fetcher: typeof fetch = fetch,
): Promise<ScheduledDeliveryAvailability> {
    const response = await fetcher(`${backendUrl.replace(/\/$/, '')}/delivery/options`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            productIds,
            ...(address?.countryCode ? { address } : {}),
        }),
    });

    if (!response.ok) {
        throw new Error('Unable to load delivery options');
    }

    return (await response.json()) as ScheduledDeliveryAvailability;
}

export function loadScheduledDelivery(
    backendUrl: string,
    cart: Cart,
    address?: ScheduledDeliveryAddress,
): void {
    const productIds = getCartProductIds(cart);
    const key = JSON.stringify([cart.id, [...productIds].sort(), address?.countryCode, address?.postalCode]);

    if (loadedKey === key && state.status !== 'error') {
        return;
    }

    loadedKey = key;

    const sameCart = state.cartId === cart.id;

    setState({
        status: 'loading',
        cartId: cart.id,
        availability: sameCart ? state.availability : undefined,
        selection: sameCart ? state.selection : readStoredSelection(cart.id),
    });

    fetchScheduledDeliveryOptions(backendUrl, productIds, address)
        .then((availability) => {
            if (loadedKey !== key) {
                return;
            }

            // A date chosen for another address may no longer be available.
            const selection =
                state.selection && (!address?.countryCode || availability.dates.includes(state.selection.date))
                    ? state.selection
                    : undefined;

            setState({ ...state, status: 'ready', availability, selection });
        })
        .catch(() => {
            if (loadedKey === key) {
                setState({ ...state, status: 'error' });
            }
        });
}

export function setScheduledDeliverySelection(selection?: ScheduledDeliverySelection): void {
    setState({ ...state, selection });
}

export function useScheduledDeliveryState(): ScheduledDeliveryState {
    return useSyncExternalStore(subscribe, () => state);
}

// Loads (once per cart, products and address) and returns the scheduled delivery state.
export function useScheduledDelivery(
    backendUrl: string | undefined,
    cart: Cart | undefined,
    address?: ScheduledDeliveryAddress,
): ScheduledDeliveryState {
    const productKey = cart ? getCartProductIds(cart).join(',') : '';

    useEffect(() => {
        if (backendUrl && cart) {
            loadScheduledDelivery(backendUrl, cart, address);
        }
    }, [backendUrl, cart?.id, productKey, address?.countryCode, address?.postalCode]);

    return useScheduledDeliveryState();
}

// Scheduled carts may only use the scheduled services; other carts may not use them.
export function filterShippingOptionsForCart<T extends { description: string }>(
    options: T[],
    availability?: ScheduledDeliveryAvailability,
): T[] {
    if (!availability) {
        return options;
    }

    return options.filter(
        (option) => availability.services.includes(option.description) === availability.scheduled,
    );
}

// True while a scheduled cart still needs an eligible address and a delivery date.
export function isScheduledDeliveryIncomplete(deliveryState: ScheduledDeliveryState): boolean {
    const { availability, selection } = deliveryState;

    return Boolean(availability?.scheduled) && (availability?.eligible === false || !selection?.date);
}

export function formatDeliveryDate(date: string): string {
    return new Date(`${date}T12:00:00Z`).toLocaleDateString('en-US', {
        weekday: 'short',
        month: 'short',
        day: 'numeric',
        timeZone: 'UTC',
    });
}
