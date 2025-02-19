import { h } from 'preact';
import { useEffect, useRef, useState, useMemo } from 'preact/hooks';
import useCoreContext from '../../../core/Context/useCoreContext';
import CompanyDetails from '../CompanyDetails';
import PersonalDetails from '../PersonalDetails';
import Address from '../Address';
import Checkbox from '../FormFields/Checkbox';
import ConsentCheckbox from '../FormFields/ConsentCheckbox';
import { getActiveFieldsData, getInitialActiveFieldsets, fieldsetsSchema, mapFieldKey } from './utils';
import {
    OpenInvoiceActiveFieldsets,
    OpenInvoiceFieldsetsRefs,
    OpenInvoiceProps,
    OpenInvoiceStateData,
    OpenInvoiceStateError,
    OpenInvoiceStateValid
} from './types';
import './OpenInvoice.scss';
import IbanInput from '../IbanInput';
import { ComponentMethodsRef } from '../../types';
import { enhanceErrorObjectKeys } from '../../../core/Errors/utils';
import { GenericError, SetSRMessagesReturnObject } from '../../../core/Errors/types';
import useSRPanelContext from '../../../core/Errors/useSRPanelContext';
import { SetSRMessagesReturnFn } from '../../../core/Errors/SRPanelProvider';
import Specifications from '../Address/Specifications';
import { PERSONAL_DETAILS_SCHEMA } from '../PersonalDetails/PersonalDetails';
import { COMPANY_DETAILS_SCHEMA } from '../CompanyDetails/CompanyDetails';
import { setFocusOnField } from '../../../utils/setFocus';
import { ERROR_ACTION_FOCUS_FIELD } from '../../../core/Errors/constants';

const consentCBErrorObj: GenericError = {
    isValid: false,
    errorMessage: 'consent.checkbox.invalid',
    error: 'consent.checkbox.invalid'
};

export default function OpenInvoice(props: OpenInvoiceProps) {
    const { countryCode, visibility } = props;
    const { i18n } = useCoreContext();

    /** An object by which to expose 'public' members to the parent UIElement */
    const openInvoiceRef = useRef<ComponentMethodsRef>({});
    // Just call once
    if (!Object.keys(openInvoiceRef.current).length) {
        props.setComponentRef?.(openInvoiceRef.current);
    }

    const isValidating = useRef(false);

    /** SR stuff */
    const { setSRMessagesFromObjects, shouldMoveFocusSR } = useSRPanelContext();

    // Generate a setSRMessages function - implemented as a partial, since the initial set of arguments don't change.
    const setSRMessages: SetSRMessagesReturnFn = setSRMessagesFromObjects?.({
        fieldTypeMappingFn: mapFieldKey
    });

    const specifications = useMemo(() => new Specifications(), []);
    /** end SR stuff */

    const initialActiveFieldsets: OpenInvoiceActiveFieldsets = getInitialActiveFieldsets(visibility, props.data);
    const [activeFieldsets, setActiveFieldsets] = useState<OpenInvoiceActiveFieldsets>(initialActiveFieldsets);

    const { current: fieldsetsRefs } = useRef<OpenInvoiceFieldsetsRefs>(
        fieldsetsSchema.reduce((acc, fieldset) => {
            acc[fieldset] = ref => {
                fieldsetsRefs[fieldset].current = ref;
            };
            return acc;
        }, {})
    );

    const checkFieldsets = () => Object.keys(activeFieldsets).every(fieldset => !activeFieldsets[fieldset] || !!valid[fieldset]);
    const hasConsentCheckbox = !!props.consentCheckboxLabel;
    const isStandAloneButton = !hasConsentCheckbox && Object.keys(activeFieldsets).every(key => !activeFieldsets[key]);
    const showSeparateDeliveryAddressCheckbox = visibility.deliveryAddress === 'editable' && visibility.billingAddress !== 'hidden';

    const [data, setData] = useState<OpenInvoiceStateData>({
        ...props.data,
        ...(hasConsentCheckbox && { consentCheckbox: false })
    });
    const [errors, setErrors] = useState<OpenInvoiceStateError>({});
    const [valid, setValid] = useState<OpenInvoiceStateValid>({});
    const [status, setStatus] = useState('ready');

    // Expose methods expected by parent
    openInvoiceRef.current.showValidation = () => {
        isValidating.current = true;
        fieldsetsSchema.forEach(fieldset => {
            if (fieldsetsRefs[fieldset].current) fieldsetsRefs[fieldset].current.showValidation();
        });

        setErrors({
            ...(hasConsentCheckbox && { consentCheckbox: data.consentCheckbox ? null : consentCBErrorObj })
        });
    };

    openInvoiceRef.current.setStatus = setStatus;

    useEffect(() => {
        const fieldsetsAreValid: boolean = checkFieldsets();
        const consentCheckboxValid: boolean = !hasConsentCheckbox || !!valid.consentCheckbox;
        const isValid: boolean = fieldsetsAreValid && consentCheckboxValid;
        const newData: OpenInvoiceStateData = getActiveFieldsData(activeFieldsets, data);

        const DELIVERY_ADDRESS_PREFIX = 'deliveryAddress:';

        /** Create messages for SRPanel */
        // Extract nested errors from the various child components...
        const {
            companyDetails: extractedCompanyDetailsErrors,
            personalDetails: extractedPersonalDetailsErrors,
            bankAccount: extractedBankAccountErrors,
            billingAddress: extractedBillingAddressErrors,
            deliveryAddress: extractedDeliveryAddressErrors,
            ...remainingErrors
        } = errors;

        // (Differentiate between billingAddress and deliveryAddress errors by adding a prefix to the latter)
        const enhancedDeliveryAddressErrors = enhanceErrorObjectKeys(extractedDeliveryAddressErrors, DELIVERY_ADDRESS_PREFIX);

        // ...and then collate the errors into a new object so that they all sit at top level
        const errorsForPanel = {
            ...(typeof extractedCompanyDetailsErrors === 'object' && extractedCompanyDetailsErrors),
            ...(typeof extractedPersonalDetailsErrors === 'object' && extractedPersonalDetailsErrors),
            ...(typeof extractedBankAccountErrors === 'object' && extractedBankAccountErrors),
            ...(typeof extractedBillingAddressErrors === 'object' && extractedBillingAddressErrors),
            ...(typeof enhancedDeliveryAddressErrors === 'object' && enhancedDeliveryAddressErrors),
            ...remainingErrors
        };

        // Create layout
        const companyDetailsLayout: string[] = COMPANY_DETAILS_SCHEMA;

        const personalDetailsReqFields: string[] = props.personalDetailsRequiredFields ?? PERSONAL_DETAILS_SCHEMA;
        const personalDetailLayout: string[] = PERSONAL_DETAILS_SCHEMA.filter(x => personalDetailsReqFields?.includes(x));

        const bankAccountLayout = ['holder', 'iban'];

        const billingAddressLayout = specifications.getAddressSchemaForCountryFlat(data.billingAddress?.country);

        const deliveryAddressLayout = specifications.getAddressSchemaForCountryFlat(data.deliveryAddress?.country);
        // In order to sort the deliveryAddress errors the layout entries need to have the same (prefixed) identifier as the errors themselves
        const deliveryAddressLayoutEnhanced = deliveryAddressLayout.map(item => `${DELIVERY_ADDRESS_PREFIX}${item}`);

        const fullLayout = companyDetailsLayout.concat(personalDetailLayout, bankAccountLayout, billingAddressLayout, deliveryAddressLayoutEnhanced, [
            'consentCheckbox'
        ]);

        // Country specific address labels
        const countrySpecificLabels = specifications.getAddressLabelsForCountry(data.billingAddress?.country ?? data.deliveryAddress?.country);

        // Set messages: Pass dynamic props (errors, layout etc) to SRPanel via partial
        const srPanelResp: SetSRMessagesReturnObject = setSRMessages?.({
            errors: errorsForPanel,
            isValidating: isValidating.current,
            layout: fullLayout,
            countrySpecificLabels
        });

        // A call to focus the first field in error will always follow the call to validate the whole form
        if (srPanelResp?.action === ERROR_ACTION_FOCUS_FIELD) {
            // Focus first field in error, if required
            if (shouldMoveFocusSR) setFocusOnField('.adyen-checkout__open-invoice', srPanelResp.fieldToFocus);
            // Remove 'showValidation' mode - allowing time for collation of all the fields in error whilst it is 'showValidation' mode (some errors come in a second render pass)
            setTimeout(() => {
                isValidating.current = false;
            }, 300);
        }

        props.onChange({ data: newData, errors, valid, isValid });
    }, [data, activeFieldsets]);

    const handleFieldset = key => state => {
        setData(prevData => ({ ...prevData, [key]: state.data }));
        setValid(prevValid => ({ ...prevValid, [key]: state.isValid }));
        setErrors(prevErrors => ({ ...prevErrors, [key]: state.errors }));
    };

    const handleSeparateDeliveryAddress = () => {
        setActiveFieldsets(prevActiveFields => ({
            ...prevActiveFields,
            deliveryAddress: !activeFieldsets.deliveryAddress
        }));
    };

    const handleConsentCheckbox = e => {
        const { checked } = e.target;
        setData(prevData => ({ ...prevData, consentCheckbox: checked }));
        setValid(prevValid => ({ ...prevValid, consentCheckbox: checked }));
        setErrors(prevErrors => ({ ...prevErrors, consentCheckbox: !checked }));
    };

    return (
        <div className="adyen-checkout__open-invoice">
            {activeFieldsets.companyDetails && (
                <CompanyDetails
                    data={props.data.companyDetails}
                    label="companyDetails"
                    onChange={handleFieldset('companyDetails')}
                    setComponentRef={fieldsetsRefs.companyDetails}
                    visibility={visibility.companyDetails}
                />
            )}

            {activeFieldsets.personalDetails && (
                <PersonalDetails
                    data={props.data.personalDetails}
                    requiredFields={props.personalDetailsRequiredFields}
                    label="personalDetails"
                    onChange={handleFieldset('personalDetails')}
                    setComponentRef={fieldsetsRefs.personalDetails}
                    visibility={visibility.personalDetails}
                />
            )}

            {activeFieldsets.bankAccount && (
                <IbanInput
                    holderName={true}
                    label="bankAccount"
                    data={data.bankAccount}
                    onChange={handleFieldset('bankAccount')}
                    ref={fieldsetsRefs.bankAccount}
                />
            )}

            {activeFieldsets.billingAddress && (
                <Address
                    allowedCountries={props.allowedCountries}
                    countryCode={countryCode}
                    requiredFields={props.billingAddressRequiredFields}
                    specifications={props.billingAddressSpecification}
                    data={data.billingAddress}
                    label="billingAddress"
                    onChange={handleFieldset('billingAddress')}
                    setComponentRef={fieldsetsRefs.billingAddress}
                    visibility={visibility.billingAddress}
                />
            )}

            {showSeparateDeliveryAddressCheckbox && (
                <Checkbox
                    label={i18n.get('separateDeliveryAddress')}
                    checked={activeFieldsets.deliveryAddress}
                    classNameModifiers={['separateDeliveryAddress']}
                    name="separateDeliveryAddress"
                    onChange={handleSeparateDeliveryAddress}
                />
            )}

            {activeFieldsets.deliveryAddress && (
                <Address
                    allowedCountries={props.allowedCountries}
                    countryCode={countryCode}
                    data={data.deliveryAddress}
                    label="deliveryAddress"
                    onChange={handleFieldset('deliveryAddress')}
                    setComponentRef={fieldsetsRefs.deliveryAddress}
                    visibility={visibility.deliveryAddress}
                />
            )}

            {hasConsentCheckbox && (
                <ConsentCheckbox
                    data={data}
                    errorMessage={!!errors.consentCheckbox}
                    label={props.consentCheckboxLabel}
                    onChange={handleConsentCheckbox}
                    i18n={i18n}
                />
            )}

            {props.showPayButton &&
                props.payButton({
                    status,
                    classNameModifiers: [...(isStandAloneButton ? ['standalone'] : [])],
                    label: i18n.get('confirmPurchase')
                })}
        </div>
    );
}
