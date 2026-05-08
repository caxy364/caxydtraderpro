/**
 * useCurrencySwitcher.ts
 * 
 * Place this file at: src/hooks/useCurrencySwitcher.ts
 * 
 * This hook provides USD <-> KES currency switching throughout your app.
 * The KES rate is fetched live from an exchange rate API.
 */

import { useState, useEffect, useCallback } from 'react';

// Fallback rate if API is unavailable
const FALLBACK_USD_TO_KES = 129.5;

type TCurrency = 'USD' | 'KES';

let globalCurrency: TCurrency = 'USD';
let globalRate: number = FALLBACK_USD_TO_KES;
const listeners: Set<() => void> = new Set();

const notify = () => listeners.forEach(fn => fn());

export const useCurrencySwitcher = () => {
    const [currency, setCurrencyState] = useState<TCurrency>(globalCurrency);
    const [usdToKesRate, setUsdToKesRate] = useState<number>(globalRate);
    const [isLoadingRate, setIsLoadingRate] = useState(false);

    // Subscribe to global state changes
    useEffect(() => {
        const update = () => {
            setCurrencyState(globalCurrency);
            setUsdToKesRate(globalRate);
        };
        listeners.add(update);
        return () => { listeners.delete(update); };
    }, []);

    // Fetch live exchange rate on mount
    useEffect(() => {
        const fetchRate = async () => {
            setIsLoadingRate(true);
            try {
                const res = await fetch(
                    'https://api.exchangerate-api.com/v4/latest/USD'
                );
                if (res.ok) {
                    const data = await res.json();
                    const rate = data?.rates?.KES;
                    if (rate && typeof rate === 'number') {
                        globalRate = rate;
                        setUsdToKesRate(rate);
                        notify();
                    }
                }
            } catch {
                // Use fallback rate silently
            } finally {
                setIsLoadingRate(false);
            }
        };

        fetchRate();
        // Refresh rate every 30 minutes
        const interval = setInterval(fetchRate, 30 * 60 * 1000);
        return () => clearInterval(interval);
    }, []);

    const toggleCurrency = useCallback(() => {
        globalCurrency = globalCurrency === 'USD' ? 'KES' : 'USD';
        notify();
    }, []);

    const setCurrency = useCallback((c: TCurrency) => {
        globalCurrency = c;
        notify();
    }, []);

    /**
     * Convert a USD amount to the currently selected currency.
     * Pass `fromCurrency` if the source is already KES.
     */
    const convertAmount = useCallback(
        (amount: number, fromCurrency: 'USD' | 'KES' = 'USD'): number => {
            if (globalCurrency === 'USD') {
                return fromCurrency === 'KES' ? amount / globalRate : amount;
            } else {
                return fromCurrency === 'USD' ? amount * globalRate : amount;
            }
        },
        [usdToKesRate] // eslint-disable-line react-hooks/exhaustive-deps
    );

    /**
     * Format an amount with the correct currency symbol.
     * Input is always treated as USD unless `fromCurrency` is specified.
     */
    const formatAmount = useCallback(
        (amount: number, fromCurrency: 'USD' | 'KES' = 'USD'): string => {
            const converted = convertAmount(amount, fromCurrency);
            if (globalCurrency === 'KES') {
                return `KSh ${converted.toLocaleString('en-KE', {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2,
                })}`;
            }
            return `$${converted.toLocaleString('en-US', {
                minimumFractionDigits: 2,
                maximumFractionDigits: 2,
            })}`;
        },
        [convertAmount]
    );

    const currencySymbol = currency === 'KES' ? 'KSh' : '$';
    const currencyCode = currency;

    return {
        currency,
        usdToKesRate,
        isLoadingRate,
        toggleCurrency,
        setCurrency,
        convertAmount,
        formatAmount,
        currencySymbol,
        currencyCode,
    };
};

export default useCurrencySwitcher;