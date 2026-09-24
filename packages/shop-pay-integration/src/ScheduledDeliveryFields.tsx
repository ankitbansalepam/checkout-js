import React, { type FunctionComponent } from 'react';

import { useCheckout } from '@bigcommerce/checkout/contexts';

import {
    formatDeliveryDate,
    setScheduledDeliverySelection,
    useScheduledDelivery,
} from './scheduledDelivery';
import { getShopPayBackendUrl } from './shopPayConfig';

// "Schedule your delivery" fields shown in the shipping step when the cart contains
// products that need scheduled (truck) delivery.
export const ScheduledDeliveryFields: FunctionComponent = () => {
    const {
        selectedState: { cart, address },
    } = useCheckout(({ data }) => ({
        cart: data.getCart(),
        address: data.getConsignments()?.[0]?.address,
    }));
    const { status, availability, selection } = useScheduledDelivery(getShopPayBackendUrl(), cart, {
        countryCode: address?.countryCode,
        postalCode: address?.postalCode,
    });

    if (!availability?.scheduled) {
        return null;
    }

    const instructions = selection?.instructions || '';

    return (
        <fieldset className="form-fieldset scheduledDelivery">
            <legend className="form-legend optimizedCheckout-headingSecondary">
                Schedule your delivery
            </legend>

            {!address?.countryCode && (
                <p className="form-field-description">
                    Enter your shipping address to see available delivery dates.
                </p>
            )}

            {address?.countryCode && status === 'loading' && (
                <p className="form-field-description">Checking available delivery dates…</p>
            )}

            {status === 'error' && (
                <p className="form-inlineMessage" role="alert">
                    Delivery dates couldn't be loaded. Please try again.
                </p>
            )}

            {availability.eligible === false && (
                <p className="form-inlineMessage" role="alert">
                    Scheduled delivery isn't available for this address. Please use a different
                    shipping address.
                </p>
            )}

            {availability.dates.length > 0 && (
                <>
                    <div className="form-field">
                        <label className="form-label optimizedCheckout-form-label" htmlFor="scheduledDeliveryDate">
                            Delivery date
                        </label>
                        <select
                            className="form-select optimizedCheckout-form-select"
                            id="scheduledDeliveryDate"
                            onChange={(event) =>
                                setScheduledDeliverySelection(
                                    event.target.value
                                        ? { date: event.target.value, instructions }
                                        : undefined,
                                )
                            }
                            value={selection?.date || ''}
                        >
                            <option value="">Select a date</option>
                            {availability.dates.map((date) => (
                                <option key={date} value={date}>
                                    {formatDeliveryDate(date)}
                                </option>
                            ))}
                        </select>
                    </div>

                    <div className="form-field">
                        <label
                            className="form-label optimizedCheckout-form-label"
                            htmlFor="scheduledDeliveryInstructions"
                        >
                            Delivery instructions (optional)
                        </label>
                        <textarea
                            className="form-input optimizedCheckout-form-input"
                            disabled={!selection?.date}
                            id="scheduledDeliveryInstructions"
                            maxLength={500}
                            onChange={(event) =>
                                selection?.date &&
                                setScheduledDeliverySelection({
                                    date: selection.date,
                                    instructions: event.target.value,
                                })
                            }
                            placeholder="e.g. buzzer number, gated community"
                            rows={3}
                            value={instructions}
                        />
                    </div>
                </>
            )}
        </fieldset>
    );
};
