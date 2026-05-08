/**
 * CurrencyToggle.tsx
 * 
 * Place this file at: src/components/currency-toggle/CurrencyToggle.tsx
 * 
 * A clean USD <-> KES toggle button to add to your AppHeader.
 */

import React from 'react';
import { useCurrencySwitcher } from '@/hooks/useCurrencySwitcher';
import './currency-toggle.scss';

const CurrencyToggle = () => {
    const { currency, toggleCurrency, usdToKesRate, isLoadingRate } = useCurrencySwitcher();
    const isKES = currency === 'KES';

    return (
        <div className='currency-toggle' title={`Rate: 1 USD = KSh ${usdToKesRate.toFixed(2)}`}>
            <span className={`currency-toggle__label ${!isKES ? 'currency-toggle__label--active' : ''}`}>
                USD
            </span>

            <button
                className={`currency-toggle__switch ${isKES ? 'currency-toggle__switch--kes' : ''}`}
                onClick={toggleCurrency}
                aria-label={`Switch to ${isKES ? 'USD' : 'KES'}`}
            >
                <span className='currency-toggle__thumb' />
            </button>

            <span className={`currency-toggle__label ${isKES ? 'currency-toggle__label--active' : ''}`}>
                KSh
            </span>

            {isLoadingRate && (
                <span className='currency-toggle__loading'>⟳</span>
            )}
        </div>
    );
};

export default CurrencyToggle;