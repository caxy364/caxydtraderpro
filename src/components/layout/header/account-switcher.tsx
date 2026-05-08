// src/components/layout/header/account-switcher.tsx

import React, { useEffect } from 'react';
import { lazy, Suspense, useMemo } from 'react';
import { observer } from 'mobx-react-lite';
import { CurrencyIcon } from '@/components/currency/currency-icon';
import { addComma, getDecimalPlaces } from '@/components/shared';
import Popover from '@/components/shared_ui/popover';
import { api_base } from '@/external/bot-skeleton';
import { useOauth2 } from '@/hooks/auth/useOauth2';
import { useApiBase } from '@/hooks/useApiBase';
import { useStore } from '@/hooks/useStore';
import { waitForDomElement } from '@/utils/dom-observer';
import { localize } from '@deriv-com/translations';
import { AccountSwitcher as UIAccountSwitcher, Loader, useDevice } from '@deriv-com/ui';
import DemoAccounts from './common/demo-accounts';
import RealAccounts from './common/real-accounts';
import { TAccountSwitcher, TAccountSwitcherProps, TModifiedAccount } from './common/types';
import { LOW_RISK_COUNTRIES } from './utils';
import './account-switcher.scss';

const AccountInfoWallets = lazy(() => import('./wallets/account-info-wallets'));

const tabs_labels = {
    demo: localize('Demo'),
    real: localize('Real'),
};

// Helper to get OAuth accounts from localStorage
const getOAuthAccounts = (): TModifiedAccount[] => {
    try {
        const clientAccountsStr = localStorage.getItem('clientAccounts');
        const authType = localStorage.getItem('auth_type');
        const activeLoginid = localStorage.getItem('active_loginid');
        
        if (!clientAccountsStr || authType !== 'oauth') {
            return [];
        }
        
        const clientAccounts = JSON.parse(clientAccountsStr);
        const accountsList = JSON.parse(localStorage.getItem('accountsList') || '{}');
        
        return Object.keys(clientAccounts).map(loginid => {
            const account = clientAccounts[loginid];
            const balance = account.balance || 0;
            const currency = account.currency || 'USD';
            const isVirtual = account.account_type === 'demo' || loginid.toLowerCase().includes('vrt') || loginid.toLowerCase().includes('dot');
            
            return {
                loginid: loginid,
                token: accountsList[loginid] || account.token,
                currency: currency,
                balance: typeof balance === 'number' ? balance.toFixed(2) : '0.00',
                is_virtual: isVirtual,
                isActive: loginid === activeLoginid,
                account_type: account.account_type,
                currencyLabel: isVirtual ? tabs_labels.demo : currency,
                icon: (
                    <CurrencyIcon
                        currency={currency.toLowerCase()}
                        isVirtual={isVirtual}
                    />
                ),
            };
        });
    } catch (e) {
        console.error('[AccountSwitcher] Error getting OAuth accounts:', e);
        return [];
    }
};

// Helper to get OAuth active account
const getOAuthActiveAccount = () => {
    try {
        const activeLoginid = localStorage.getItem('active_loginid');
        const authType = localStorage.getItem('auth_type');
        
        if (!activeLoginid || authType !== 'oauth') {
            return null;
        }
        
        const oAuthAccounts = getOAuthAccounts();
        return oAuthAccounts.find(acc => acc.loginid === activeLoginid) || null;
    } catch (e) {
        console.error('[AccountSwitcher] Error getting OAuth active account:', e);
        return null;
    }
};

const RenderAccountItems = ({
    isVirtual,
    modifiedCRAccountList,
    modifiedMFAccountList,
    modifiedVRTCRAccountList,
    switchAccount,
    activeLoginId,
    client,
    isOAuth = false,
    oAuthAccounts = [],
}: TAccountSwitcherProps & { isOAuth?: boolean; oAuthAccounts?: TModifiedAccount[] }) => {
    const { oAuthLogout } = useOauth2({ handleLogout: async () => client.logout(), client });
    const is_low_risk_country = LOW_RISK_COUNTRIES().includes(client.account_settings?.country_code ?? '');
    const is_virtual = !!isVirtual;

    useEffect(() => {
        const parent_container = document.getElementsByClassName('account-switcher-panel')?.[0] as HTMLDivElement;
        if (!isVirtual && parent_container) {
            parent_container.style.maxHeight = '70vh';
            waitForDomElement('.deriv-accordion__content', parent_container)?.then((accordionElement: unknown) => {
                const element = accordionElement as HTMLDivElement;
                if (element) {
                    element.style.maxHeight = '70vh';
                }
            });
        }
    }, [isVirtual]);

    if (is_virtual) {
        if (isOAuth && oAuthAccounts.length > 0) {
            const oAuthDemoAccounts = oAuthAccounts.filter(acc => acc.is_virtual === true);
            return (
                <DemoAccounts
                    modifiedVRTCRAccountList={oAuthDemoAccounts as TModifiedAccount[]}
                    switchAccount={switchAccount}
                    activeLoginId={activeLoginId}
                    isVirtual={is_virtual}
                    tabs_labels={tabs_labels}
                    oAuthLogout={oAuthLogout}
                    is_logging_out={client.is_logging_out}
                />
            );
        }
        return (
            <DemoAccounts
                modifiedVRTCRAccountList={modifiedVRTCRAccountList as TModifiedAccount[]}
                switchAccount={switchAccount}
                activeLoginId={activeLoginId}
                isVirtual={is_virtual}
                tabs_labels={tabs_labels}
                oAuthLogout={oAuthLogout}
                is_logging_out={client.is_logging_out}
            />
        );
    } else {
        if (isOAuth && oAuthAccounts.length > 0) {
            const oAuthRealAccounts = oAuthAccounts.filter(acc => acc.is_virtual === false);
            const oAuthCRAccounts = oAuthRealAccounts.filter(acc => acc.loginid?.includes('CR') || acc.loginid?.includes('ROT'));
            const oAuthMFAccounts = oAuthRealAccounts.filter(acc => acc.loginid?.includes('MF'));
            
            return (
                <RealAccounts
                    modifiedCRAccountList={oAuthCRAccounts as TModifiedAccount[]}
                    modifiedMFAccountList={oAuthMFAccounts as TModifiedAccount[]}
                    switchAccount={switchAccount}
                    isVirtual={is_virtual}
                    tabs_labels={tabs_labels}
                    is_low_risk_country={is_low_risk_country}
                    oAuthLogout={oAuthLogout}
                    loginid={activeLoginId}
                    is_logging_out={client.is_logging_out}
                />
            );
        }
        return (
            <RealAccounts
                modifiedCRAccountList={modifiedCRAccountList as TModifiedAccount[]}
                modifiedMFAccountList={modifiedMFAccountList as TModifiedAccount[]}
                switchAccount={switchAccount}
                isVirtual={is_virtual}
                tabs_labels={tabs_labels}
                is_low_risk_country={is_low_risk_country}
                oAuthLogout={oAuthLogout}
                loginid={activeLoginId}
                is_logging_out={client.is_logging_out}
            />
        );
    }
};

const AccountSwitcher = observer(({ activeAccount: propActiveAccount }: TAccountSwitcher) => {
    const { isDesktop } = useDevice();
    const { accountList } = useApiBase();
    const { ui, run_panel, client } = useStore();
    const { accounts } = client;
    const { toggleAccountsDialog, is_accounts_switcher_on, account_switcher_disabled_message } = ui;
    const { is_stop_button_visible } = run_panel;
    const has_wallet = Object.keys(accounts).some(id => accounts[id].account_category === 'wallet');
    
    const isOAuthActive = localStorage.getItem('auth_type') === 'oauth' && localStorage.getItem('authToken');
    
    const oAuthAccounts = useMemo(() => {
        if (isOAuthActive) {
            return getOAuthAccounts();
        }
        return [];
    }, [isOAuthActive]);
    
    const oAuthActiveAccount = useMemo(() => {
        if (isOAuthActive) {
            return getOAuthActiveAccount();
        }
        return null;
    }, [isOAuthActive, oAuthAccounts]);
    
    const modifiedAccountList = useMemo(() => {
        if (isOAuthActive && oAuthAccounts.length > 0) {
            return oAuthAccounts;
        }
        
        return accountList?.map(account => {
            return {
                ...account,
                balance: addComma(
                    client.all_accounts_balance?.accounts?.[account?.loginid]?.balance?.toFixed(
                        getDecimalPlaces(account.currency)
                    ) ?? '0'
                ),
                currencyLabel: account?.is_virtual
                    ? tabs_labels.demo
                    : (client.website_status?.currencies_config?.[account?.currency]?.name ?? account?.currency),
                icon: (
                    <CurrencyIcon
                        currency={account?.currency?.toLowerCase()}
                        isVirtual={Boolean(account?.is_virtual)}
                    />
                ),
                isVirtual: Boolean(account?.is_virtual),
                isActive: account?.loginid === propActiveAccount?.loginid,
            };
        }) ?? [];
    }, [
        accountList,
        client.all_accounts_balance?.accounts,
        client.website_status?.currencies_config,
        propActiveAccount?.loginid,
        isOAuthActive,
        oAuthAccounts,
    ]);
    
    const modifiedCRAccountList = useMemo(() => {
        return modifiedAccountList?.filter(account => account?.loginid?.includes('CR') || account?.loginid?.includes('ROT')) ?? [];
    }, [modifiedAccountList]);

    const modifiedMFAccountList = useMemo(() => {
        return modifiedAccountList?.filter(account => account?.loginid?.includes('MF')) ?? [];
    }, [modifiedAccountList]);

    const modifiedVRTCRAccountList = useMemo(() => {
        return modifiedAccountList?.filter(account => account?.loginid?.includes('VRT') || account?.loginid?.includes('DOT')) ?? [];
    }, [modifiedAccountList]);

    const switchAccount = async (loginId: number | string) => {
        const loginIdStr = loginId.toString();
        const currentActive = isOAuthActive ? oAuthActiveAccount?.loginid : propActiveAccount?.loginid;
        
        if (loginIdStr === currentActive) return;
        
        let token;
        
        if (isOAuthActive) {
            const accountsList = JSON.parse(localStorage.getItem('accountsList') ?? '{}');
            token = accountsList[loginIdStr];
            if (!token) {
                console.error('[AccountSwitcher] No token found for OAuth account:', loginIdStr);
                return;
            }
            localStorage.setItem('authToken', token);
            localStorage.setItem('active_loginid', loginIdStr);
            window.location.reload();
        } else {
            const account_list = JSON.parse(localStorage.getItem('accountsList') ?? '{}');
            token = account_list[loginIdStr];
            if (!token) return;
            localStorage.setItem('authToken', token);
            localStorage.setItem('active_loginid', loginIdStr);
            await api_base?.init(true);
            const search_params = new URLSearchParams(window.location.search);
            const selected_account = modifiedAccountList.find(acc => acc.loginid === loginIdStr);
            if (!selected_account) return;
            const account_param = selected_account.is_virtual ? 'demo' : selected_account.currency;
            search_params.set('account', account_param);
            window.history.pushState({}, '', `${window.location.pathname}?${search_params.toString()}`);
        }
    };

    const effectiveActiveAccount = isOAuthActive ? oAuthActiveAccount : propActiveAccount;
    
    if (!effectiveActiveAccount) {
        return null;
    }

    if ((has_wallet && !isOAuthActive) || (isOAuthActive && oAuthAccounts.some(acc => acc.loginid?.includes('wallet')))) {
        return (
            <Suspense fallback={<Loader />}>
                <AccountInfoWallets is_dialog_on={is_accounts_switcher_on} toggleDialog={toggleAccountsDialog} />
            </Suspense>
        );
    }

    return (
        <Popover
            className='run-panel__info'
            classNameBubble='run-panel__info--bubble'
            alignment='bottom'
            message={account_switcher_disabled_message}
            zIndex='5'
        >
            <UIAccountSwitcher
                activeAccount={effectiveActiveAccount}
                isDisabled={is_stop_button_visible}
                tabsLabels={tabs_labels}
                modalContentStyle={{
                    content: {
                        top: isDesktop ? '30%' : '50%',
                        borderRadius: '10px',
                    },
                }}
            >
                <UIAccountSwitcher.Tab title={tabs_labels.real}>
                    <RenderAccountItems
                        modifiedCRAccountList={modifiedCRAccountList as TModifiedAccount[]}
                        modifiedMFAccountList={modifiedMFAccountList as TModifiedAccount[]}
                        switchAccount={switchAccount}
                        activeLoginId={effectiveActiveAccount?.loginid}
                        client={client}
                        isOAuth={isOAuthActive}
                        oAuthAccounts={oAuthAccounts}
                    />
                </UIAccountSwitcher.Tab>
                <UIAccountSwitcher.Tab title={tabs_labels.demo}>
                    <RenderAccountItems
                        modifiedVRTCRAccountList={modifiedVRTCRAccountList as TModifiedAccount[]}
                        switchAccount={switchAccount}
                        isVirtual
                        activeLoginId={effectiveActiveAccount?.loginid}
                        client={client}
                        isOAuth={isOAuthActive}
                        oAuthAccounts={oAuthAccounts}
                    />
                </UIAccountSwitcher.Tab>
            </UIAccountSwitcher>
        </Popover>
    );
});

export default AccountSwitcher;