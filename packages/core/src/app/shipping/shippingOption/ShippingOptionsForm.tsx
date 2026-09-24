import { type CheckoutSelectors, type ShippingOption } from '@bigcommerce/checkout-sdk';
import { type FormikProps } from 'formik';
import { noop } from 'lodash';
import React, { type ReactElement, useEffect } from 'react';

import { useAnalytics } from '@bigcommerce/checkout/contexts';
import { TranslatedString } from '@bigcommerce/checkout/locale';
import {
    filterShippingOptionsForCart,
    getShopPayBackendUrl,
    useScheduledDelivery,
} from '@bigcommerce/checkout/shop-pay-integration';

import { withFormikExtended } from '../../common/form';
import getRecommendedShippingOption from '../getRecommendedShippingOption';
import { getShippingOptionIds } from '../utils';

import { ConsignmentDetails } from './MultiShippingConsignmentDetails';
import { NoShippingOptions } from './NoShippingOption';
import {
    type ShippingOptionsProps,
    type WithCheckoutShippingOptionsProps,
} from './ShippingOptions';
import ShippingOptionsList from './ShippingOptionsList';
import './ShippingOptionsForm.scss';

export type ShippingOptionsFormProps = ShippingOptionsProps & WithCheckoutShippingOptionsProps;

export interface ShippingOptionsFormValues {
    shippingOptionIds: {
        [shippingOptionIds: string]: string;
    };
}

const ShippingOptionsForm = (
    props: ShippingOptionsFormProps & FormikProps<ShippingOptionsFormValues>,
): ReactElement => {
    const {
        consignments,
        cart,
        isMultiShippingMode,
        selectShippingOption,
        isLoading,
        shouldShowShippingOptions,
        invalidShippingMessage,
        methodId,
        subscribeToConsignments,
        setFieldValue,
        shippingFormRenderTimestamp,
        setValues,
    } = props;
    const { analyticsTracker } = useAnalytics();
    // Scheduled-delivery carts only get the scheduled services; other carts don't.
    const scheduledDelivery = useScheduledDelivery(getShopPayBackendUrl(), cart, {
        countryCode: consignments?.[0]?.address?.countryCode,
        postalCode: consignments?.[0]?.address?.postalCode,
    });
    const getAllowedOptions = (options: ShippingOption[] = []) =>
        filterShippingOptionsForCart(options, scheduledDelivery.availability);

    // Switch away from a selected option this cart may not use (e.g. Flat rate on a mattress).
    useEffect(() => {
        if (scheduledDelivery.status !== 'ready' || isMultiShippingMode) {
            return;
        }

        (consignments || []).forEach((consignment) => {
            const allowed = getAllowedOptions(consignment.availableShippingOptions);

            if (
                !allowed.length ||
                allowed.some(({ id }) => id === consignment.selectedShippingOption?.id)
            ) {
                return;
            }

            const next = allowed.find(({ isRecommended }) => isRecommended) || allowed[0];

            void Promise.resolve(selectShippingOption(consignment.id, next.id)).then(() =>
                setFieldValue(`shippingOptionIds.${consignment.id}`, next.id),
            );
        });
    }, [scheduledDelivery.availability, scheduledDelivery.status, consignments]);

    const selectDefaultShippingOptions = async ({ data }: CheckoutSelectors) => {
        const consignment = (data.getConsignments() || []).find(
            ({ selectedShippingOption, availableShippingOptions: shippingOptions }) =>
                !selectedShippingOption && shippingOptions,
        );

        if (!consignment || !consignment.availableShippingOptions) {
            return;
        }

        const { availableShippingOptions, id } = consignment;
        const recommendedOption = getRecommendedShippingOption(availableShippingOptions);
        const singleShippingOption =
            availableShippingOptions.length === 1 && availableShippingOptions[0];
        const defaultShippingOption = recommendedOption || singleShippingOption;

        if (!defaultShippingOption) {
            return;
        }

        await selectShippingOption(id, defaultShippingOption.id);
        setFieldValue(`shippingOptionIds.${id}`, defaultShippingOption.id);
    };

    useEffect(() => {
        const unsubscribe = subscribeToConsignments(selectDefaultShippingOptions);

        return () => {
            if (unsubscribe) {
                unsubscribe();
            }
        };
    }, []);

    useEffect(() => {
        if (consignments?.length && shouldShowShippingOptions) {
            analyticsTracker.showShippingMethods();
        }
    }, [consignments, shouldShowShippingOptions]);

    useEffect(() => {
        if (shippingFormRenderTimestamp) {
            setValues(getShippingOptionIds(props));
        }
    }, [shippingFormRenderTimestamp]);

    if (!consignments?.length || !shouldShowShippingOptions) {
        return (
            <NoShippingOptions
                isLoading={isLoading()}
                message={
                    <TranslatedString
                        id={
                            methodId || isMultiShippingMode
                                ? 'shipping.select_shipping_address_text'
                                : 'shipping.enter_shipping_address_text'
                        }
                    />
                }
            />
        );
    }

    return (
        <>
            {consignments.map((consignment) => (
                <div className="shippingOptions-container form-fieldset" key={consignment.id}>
                    {isMultiShippingMode && (
                        <ConsignmentDetails cart={cart} consignment={consignment} />
                    )}

                    <ShippingOptionsList
                        consignmentId={consignment.id}
                        inputName={`shippingOptionIds.${consignment.id}`}
                        isLoading={isLoading(consignment.id)}
                        isMultiShippingMode={isMultiShippingMode}
                        onSelectedOption={selectShippingOption}
                        selectedShippingOptionId={
                            consignment.selectedShippingOption &&
                            consignment.selectedShippingOption.id
                        }
                        shippingOptions={getAllowedOptions(consignment.availableShippingOptions)}
                    />

                    {!getAllowedOptions(consignment.availableShippingOptions).length && (
                        <NoShippingOptions
                            isLoading={isLoading(consignment.id)}
                            message={invalidShippingMessage}
                        />
                    )}
                </div>
            ))}
        </>
    );
};

export default withFormikExtended<ShippingOptionsFormProps, ShippingOptionsFormValues>({
    handleSubmit: noop,
    mapPropsToValues: getShippingOptionIds,
})(ShippingOptionsForm);
