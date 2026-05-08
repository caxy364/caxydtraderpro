// src/app/CoreStoreProvider.tsx

import { useCallback, useEffect, useMemo, useRef } from 'react';
import Cookies from 'js-cookie';
import { observer } from 'mobx-react-lite';
import { getDecimalPlaces, toMoment } from '@/components/shared';
import { FORM_ERROR_MESSAGES } from '@/components/shared/constants/form-error-messages';
import { initFormErrorMessages } from '@/components/shared/utils/validation/declarative-validation-rules';
import { api_base } from '@/external/bot-skeleton';
import { useOauth2 } from '@/hooks/auth/useOauth2';
import { useApiBase } from '@/hooks/useApiBase';
import { useStore } from '@/hooks/useStore';
import { syncOAuthToClientStore } from './AuthWrapper';
import { TLandingCompany, TSocketResponseData } from '@/types/api-types';
import { useTranslations } from '@deriv-com/translations';

// ─── Helpers ──────────────────────────────────────────────────────────────────

const isOAuthUser = () => {
    return (
        localStorage.getItem('auth_type') === 'oauth' &&
        !!localStorage.getItem('authToken') &&
        !!localStorage.getItem('clientAccounts')
    );
};

// ─── Component ────────────────────────────────────────────────────────────────

const CoreStoreProvider: React.FC<{ children: React.ReactNode }> = observer(({ children }) => {
    const { isAuthorizing, isAuthorized, connectionStatus, accountList, activeLoginid } = useApiBase();

    const appInitialization = useRef(false);
    const accountInitialization = useRef(false);
    const oauthSynced = useRef(false);
    const timeInterval = useRef<NodeJS.Timeout | null>(null);
    const msg_listener = useRef<{ unsubscribe: () => void } | null>(null);
    const { client, common, transactions: transactionsStore } = useStore() ?? {};

    const { currentLang } = useTranslations();

    // ── Safe logout — prevents "e is not a function" crash ────────────────
    const handleLogout = useCallback(async () => {
        try {
            if (client?.logout) await client.logout();
        } catch (e) {
            console.warn('[CoreStoreProvider] Logout error:', e);
        }
    }, [client]);

    const { oAuthLogout, isOAuth2Enabled } = useOauth2({
        handleLogout,
        client,
    });

    const isLoggedOutCookie = Cookies.get('logged_state') === 'false';

    // ── Logout if cookie says logged out ──────────────────────────────────
    useEffect(() => {
        if (isLoggedOutCookie && isOAuth2Enabled && client?.is_logged_in) {
            try {
                oAuthLogout();
            } catch (e) {
                console.warn('[CoreStoreProvider] oAuthLogout error:', e);
            }
        }
    }, [isLoggedOutCookie, oAuthLogout, isOAuth2Enabled, client?.is_logged_in]);

    // ── Sync OAuth state the moment client store becomes available ─────────
    useEffect(() => {
        if (client && isOAuthUser() && !client.is_logged_in && !oauthSynced.current) {
            oauthSynced.current = true;
            console.log('[CoreStoreProvider] OAuth user — client store now ready, syncing auth state...');
            const success = syncOAuthToClientStore(client);
            if (success) {
                console.log('[CoreStoreProvider] ✅ OAuth sync complete — user is now logged in');
            }
        }
    }, [client]);

    // ── Active account derived from accountList ───────────────────────────
    const activeAccount = useMemo(
        () => accountList?.find(account => account.loginid === activeLoginid),
        [activeLoginid, accountList]
    );

    // ── Sync accountList into store ───────────────────────────────────────
    useEffect(() => {
        if (client && activeAccount) {
            client?.setLoginId(activeLoginid);
            client?.setAccountList(accountList);
            client?.setIsLoggedIn(true);
        }
    }, [accountList, activeAccount, activeLoginid, client]);

    // ── Balance from all_accounts_balance ─────────────────────────────────
    useEffect(() => {
        const currentBalanceData =
            client?.all_accounts_balance?.accounts?.[activeAccount?.loginid ?? ''];
        if (currentBalanceData) {
            client?.setBalance(
                currentBalanceData.balance.toFixed(getDecimalPlaces(currentBalanceData.currency))
            );
            client?.setCurrency(currentBalanceData.currency);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [activeAccount?.loginid, client?.all_accounts_balance]);

    // ── NEW: Real-time balance updates from derivWS ───────────────────────
    // derivWS dispatches 'balance-update' on every balance WebSocket message.
    // We catch it here and update the MobX store → header re-renders instantly.
    useEffect(() => {
        if (!client) return;

        const handleBalanceUpdate = (event: Event) => {
            const { balance, currency, loginid } = (event as CustomEvent).detail ?? {};
            if (!loginid) return;

            console.log(`[CoreStoreProvider] 💰 Balance update: ${loginid} → ${balance} ${currency}`);

            // Update store so header reflects new balance
            client.setBalance(String(balance));
            client.setCurrency(currency);

            // Update all_accounts_balance for computed values
            const existing = client.all_accounts_balance || { accounts: {} };
            client.setAllAccountsBalance({
                ...existing,
                accounts: {
                    ...(existing.accounts || {}),
                    [loginid]: { balance, currency },
                },
            });

            // Persist to localStorage
            try {
                const raw = localStorage.getItem('clientAccounts');
                if (raw) {
                    const parsed = JSON.parse(raw);
                    if (parsed[loginid]) {
                        parsed[loginid].balance = balance;
                        parsed[loginid].currency = currency;
                        localStorage.setItem('clientAccounts', JSON.stringify(parsed));
                    }
                }
            } catch (_) { /* non-critical */ }
        };

        window.addEventListener('balance-update', handleBalanceUpdate);
        return () => window.removeEventListener('balance-update', handleBalanceUpdate);
    }, [client]);

    // ── NEW: Transaction updates from derivWS → transactions store ────────
    // derivWS dispatches 'transaction-update' on every buy/sell/expire event.
    // Forward it to the MobX transactions store so the Transactions panel
    // and run panel update in real time.
    useEffect(() => {
        if (!transactionsStore) return;

        const handleTransactionUpdate = (event: Event) => {
            const detail = (event as CustomEvent).detail;
            if (!detail) return;

            console.log('[CoreStoreProvider] 📋 Transaction update:', detail.action);

            try {
                // transactions store listens via onMessage (same shape as WS messages)
                transactionsStore?.onMessage?.({ data: detail });
            } catch (e) {
                console.warn('[CoreStoreProvider] Error forwarding transaction to store:', e);
            }
        };

        window.addEventListener('transaction-update', handleTransactionUpdate);
        return () => window.removeEventListener('transaction-update', handleTransactionUpdate);
    }, [transactionsStore]);

    // ── NEW: Proposal open contract → updates run panel live ──────────────
    useEffect(() => {
        if (!transactionsStore) return;

        const handleProposalOpenContract = (event: Event) => {
            const detail = (event as CustomEvent).detail;
            if (!detail) return;

            try {
                transactionsStore?.onMessage?.({ data: detail });
            } catch (e) {
                console.warn('[CoreStoreProvider] Error forwarding proposal_open_contract:', e);
            }
        };

        window.addEventListener('proposal-open-contract', handleProposalOpenContract);
        return () => window.removeEventListener('proposal-open-contract', handleProposalOpenContract);
    }, [transactionsStore]);

    // ── Language ──────────────────────────────────────────────────────────
    useEffect(() => {
        initFormErrorMessages(FORM_ERROR_MESSAGES());
        return () => {
            if (timeInterval.current) clearInterval(timeInterval.current);
        };
    }, []);

    useEffect(() => {
        if (common && currentLang) {
            common.setCurrentLanguage(currentLang);
        }
    }, [currentLang, common]);

    // ── App init: website status + server time ────────────────────────────
    useEffect(() => {
        if (client && !isAuthorizing && !appInitialization.current) {
            appInitialization.current = true;

            if (!isOAuthUser() && api_base.api) {
                api_base.api?.websiteStatus().then((res: TSocketResponseData<'website_status'>) => {
                    client.setWebsiteStatus(res.website_status);
                });
            } else {
                console.log('[CoreStoreProvider] OAuth user, skipping websiteStatus call');
                client.setWebsiteStatus({
                    clients_country: '',
                    currencies_config: {},
                } as TSocketResponseData<'website_status'>['website_status']);
            }

            timeInterval.current = setInterval(() => {
                if (api_base.api) {
                    api_base.api
                        ?.time()
                        .then((res: TSocketResponseData<'time'>) => {
                            common.setServerTime(toMoment(res.time), false);
                        })
                        .catch(() => {
                            common.setServerTime(toMoment(Date.now()), true);
                        });
                } else {
                    common.setServerTime(toMoment(Date.now()), true);
                }
            }, 10000);
        }
    }, [client, common, isAuthorizing]);

    // ── Legacy WS message handler ─────────────────────────────────────────
    const handleMessages = useCallback(
        async (res: Record<string, unknown>) => {
            if (!res) return;
            const data = res.data as TSocketResponseData<'balance'>;
            const { msg_type, error } = data;

            if (
                error?.code === 'AuthorizationRequired' ||
                error?.code === 'DisabledClient' ||
                error?.code === 'InvalidToken'
            ) {
                try {
                    await oAuthLogout();
                } catch (e) {
                    console.warn('[CoreStoreProvider] oAuthLogout error:', e);
                }
            }

            if (msg_type === 'balance' && data && !error) {
                const balance = data.balance;
                if (balance?.accounts) {
                    client.setAllAccountsBalance(balance);
                } else if (balance?.loginid) {
                    if (!client?.all_accounts_balance?.accounts || !balance?.loginid) return;
                    const accounts = { ...client.all_accounts_balance.accounts };
                    const currentLoggedInBalance = { ...accounts[balance.loginid] };
                    currentLoggedInBalance.balance = balance.balance;
                    const updatedAccounts = {
                        ...client.all_accounts_balance,
                        accounts: {
                            ...client.all_accounts_balance.accounts,
                            [balance.loginid]: currentLoggedInBalance,
                        },
                    };
                    client.setAllAccountsBalance(updatedAccounts);
                }
            }
        },
        [client, oAuthLogout]
    );

    useEffect(() => {
        if (!isAuthorizing && client) {
            if (api_base?.api) {
                const subscription = api_base?.api?.onMessage().subscribe(handleMessages);
                msg_listener.current = { unsubscribe: subscription?.unsubscribe };
            } else {
                console.log('[CoreStoreProvider] OAuth user, skipping message subscription');
            }
        }

        return () => {
            if (msg_listener.current) {
                msg_listener.current.unsubscribe?.();
            }
        };
    }, [connectionStatus, handleMessages, isAuthorizing, isAuthorized, client]);

    // ── Account settings / landing company (legacy only) ──────────────────
    useEffect(() => {
        if (!isAuthorizing && isAuthorized && !accountInitialization.current && client) {
            accountInitialization.current = true;

            if (isOAuthUser()) {
                console.log(
                    '[CoreStoreProvider] OAuth user detected, skipping getSettings and getAccountStatus calls'
                );
                client.setAccountSettings({
                    country_code: '',
                    email: '',
                    full_name: '',
                    preferred_language: 'EN',
                } as TSocketResponseData<'get_settings'>['get_settings']);
                return;
            }

            if (api_base.api) {
                api_base.api.getSettings().then((settingRes: TSocketResponseData<'get_settings'>) => {
                    client?.setAccountSettings(settingRes.get_settings);
                    api_base.api
                        .landingCompany({
                            landing_company: settingRes.get_settings?.country_code,
                        })
                        .then((res: TSocketResponseData<'landing_company'>) => {
                            client?.setLandingCompany(res.landing_company as unknown as TLandingCompany);
                        });
                });

                api_base.api.getAccountStatus().then((res: TSocketResponseData<'get_account_status'>) => {
                    client?.setAccountStatus(res.get_account_status);
                });
            }
        }
    }, [isAuthorizing, isAuthorized, client]);

    return <>{children}</>;
});

export default CoreStoreProvider;