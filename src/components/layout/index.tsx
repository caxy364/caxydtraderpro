import { useEffect, useState } from 'react';
import clsx from 'clsx';
import Cookies from 'js-cookie';
import { Outlet } from 'react-router-dom';
import { api_base } from '@/external/bot-skeleton';
import { useOauth2 } from '@/hooks/auth/useOauth2';
import { useDevice } from '@deriv-com/ui';
import { crypto_currencies_display_order, fiat_currencies_display_order } from '../shared';
import Footer from './footer';
import AppHeader from './header';
import Body from './main-body';
import './layout.scss';

const Layout = () => {
    const { isDesktop } = useDevice();
    const { isOAuth2Enabled } = useOauth2();

    const isCallbackPage = window.location.pathname === '/callback';
    const isLoggedInCookie = Cookies.get('logged_state') === 'true';
    const isEndpointPage = window.location.pathname.includes('endpoint');
    const checkClientAccount = JSON.parse(localStorage.getItem('clientAccounts') ?? '{}');
    const getQueryParams = new URLSearchParams(window.location.search);
    const currency = getQueryParams.get('account') ?? '';
    const accountsList = JSON.parse(localStorage.getItem('accountsList') ?? '{}');
    const isClientAccountsPopulated = Object.keys(accountsList).length > 0;
    
    const ifClientAccountHasCurrency =
        Object.values(checkClientAccount).some((account: any) => account.currency === currency) ||
        currency === 'demo' ||
        currency === '';
        
    const [clientHasCurrency, setClientHasCurrency] = useState(ifClientAccountHasCurrency);

    const validCurrencies = [...fiat_currencies_display_order, ...crypto_currencies_display_order];
    const query_currency = (getQueryParams.get('account') ?? '')?.toUpperCase();
    const isCurrencyValid = validCurrencies.includes(query_currency);
    const api_accounts: any[] = [];
    let subscription: any;

    const validateApiAccounts = ({ data }: any) => {
        if (data.msg_type === 'authorize') {
            api_accounts.push(data.authorize.account_list || []);
            const allCurrencies = new Set(Object.values(checkClientAccount).map((acc: any) => acc.currency));

            const hasMissingCurrency = api_accounts?.flat().some(data => {
                if (!allCurrencies.has(data.currency)) {
                    sessionStorage.setItem('query_param_currency', currency);
                    return true;
                }
                return false;
            });

            if (hasMissingCurrency) {
                setClientHasCurrency(false);
            } else {
                sessionStorage.removeItem('query_param_currency');
            }

            if (subscription) {
                subscription?.unsubscribe();
            }
        }
    };

    useEffect(() => {
        if (isCurrencyValid && api_base.api) {
            subscription = api_base.api.onMessage().subscribe(validateApiAccounts);
        }
        return () => {
            if (subscription) subscription.unsubscribe();
        };
    }, []);

    useEffect(() => {
        // MANUAL LOGIN REDIRECT FIX
        if (
            (isLoggedInCookie && !isClientAccountsPopulated && isOAuth2Enabled && !isEndpointPage && !isCallbackPage) ||
            (!clientHasCurrency && !isCallbackPage && !isEndpointPage)
        ) {
            console.log("Redirecting to Nyanyukisites Auth...");
            
            const MY_APP_ID = '117013';
            const BRAND = 'nyanyukisites';
            const REDIRECT_URI = window.location.origin + '/callback';
            
            // This manually builds the login URL since the internal function is broken
            const loginUrl = `https://oauth.deriv.com/oauth2/authorize?app_id=${MY_APP_ID}&l=EN&brand=${BRAND}&redirect_uri=${REDIRECT_URI}`;
            
            window.location.href = loginUrl;
        }
    }, [
        isLoggedInCookie,
        isClientAccountsPopulated,
        isOAuth2Enabled,
        isEndpointPage,
        isCallbackPage,
        clientHasCurrency,
    ]);

    return (
        <div className={clsx('layout', { responsive: isDesktop, 'endpoint-page': isEndpointPage })}>
            {!isCallbackPage && !isEndpointPage && <AppHeader />}
            <Body>
                <Outlet />
            </Body>
            {!isCallbackPage && !isEndpointPage && isDesktop && <Footer />}
        </div>
    );
};

export default Layout;