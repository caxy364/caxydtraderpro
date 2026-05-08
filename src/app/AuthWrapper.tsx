// src/app/AuthWrapper.tsx

import React from 'react';
import ChunkLoader from '@/components/loader/chunk-loader';
import { generateDerivApiInstance } from '@/external/bot-skeleton/services/api/appId';
import { localize } from '@deriv-com/translations';
import { URLUtils } from '@deriv-com/utils';
import App from './App';
import derivWS from '@/external/bot-skeleton/services/derivWS';
import { useStore } from '@/hooks/useStore';
import {
    setAccountList,
    setAuthData,
    setIsAuthorized,
    setConnectionStatus,
    CONNECTION_STATUS,
} from '@/external/bot-skeleton/services/api/observables/connection-status-stream';

let isInitializing = false;

// ─── Legacy Login ────────────────────────────────────────────────────────────

const setLocalStorageToken = async (loginInfo: URLUtils.LoginInfo[], paramsToDelete: string[]) => {
    if (!loginInfo.length) return;
    try {
        const defaultActiveAccount = URLUtils.getDefaultActiveAccount(loginInfo);
        if (!defaultActiveAccount) return;

        const accountsList: Record<string, string> = {};
        const clientAccounts: Record<string, { loginid: string; token: string; currency: string }> = {};

        loginInfo.forEach((account: { loginid: string; token: string; currency: string }) => {
            accountsList[account.loginid] = account.token;
            clientAccounts[account.loginid] = account;
        });

        localStorage.setItem('accountsList', JSON.stringify(accountsList));
        localStorage.setItem('clientAccounts', JSON.stringify(clientAccounts));

        URLUtils.filterSearchParams(paramsToDelete);
        const api = await generateDerivApiInstance();

        if (api) {
            const { authorize, error } = await api.authorize(loginInfo[0].token);
            api.disconnect();
            if (!error) {
                const firstId = authorize?.account_list[0]?.loginid;
                const filteredTokens = loginInfo.filter(token => token.loginid === firstId);
                if (filteredTokens.length) {
                    localStorage.setItem('authToken', filteredTokens[0].token);
                    localStorage.setItem('active_loginid', filteredTokens[0].loginid);
                    localStorage.setItem('auth_type', 'legacy');
                    return;
                }
            }
        }

        localStorage.setItem('authToken', loginInfo[0].token);
        localStorage.setItem('active_loginid', loginInfo[0].loginid);
        localStorage.setItem('auth_type', 'legacy');
    } catch (error) {
        console.error('[AuthWrapper] Error setting up login info:', error);
    }
};

// ─── OAuth Helpers ───────────────────────────────────────────────────────────

const isOAuthAuthenticated = (): boolean => {
    const authToken = localStorage.getItem('authToken');
    const authType = localStorage.getItem('auth_type');
    const activeLoginid = localStorage.getItem('active_loginid');
    return !!(authToken && authType === 'oauth' && activeLoginid);
};

const buildAccountList = () => {
    try {
        const clientAccountsStr = localStorage.getItem('clientAccounts');
        const accountsListStr = localStorage.getItem('accountsList');
        const authToken = localStorage.getItem('authToken') || '';

        if (!clientAccountsStr) return [];

        const clientAccounts = JSON.parse(clientAccountsStr);
        const accountsList = accountsListStr ? JSON.parse(accountsListStr) : {};

        return Object.keys(clientAccounts).map(loginid => ({
            loginid,
            token: accountsList[loginid] || authToken,
            currency: clientAccounts[loginid].currency || 'USD',
            is_virtual: clientAccounts[loginid].is_virtual === 1
                || clientAccounts[loginid].is_virtual === true
                || clientAccounts[loginid].account_type === 'demo'
                ? 1 : 0,
            account_type: clientAccounts[loginid].account_type,
            landing_company_name:
                clientAccounts[loginid].landing_company_name ||
                (clientAccounts[loginid].account_type === 'demo' ? 'virtual' : 'svg'),
            balance: clientAccounts[loginid].balance || 0,
            is_disabled: 0,
        }));
    } catch (e) {
        console.error('[AuthWrapper] buildAccountList error:', e);
        return [];
    }
};

// ─── THE KEY FIX: syncOAuthToClientStore now takes client as param
//     and is also exported so CoreStoreProvider can call it too ─────────────

export const syncOAuthToClientStore = (client: any): boolean => {
    try {
        const authToken = localStorage.getItem('authToken');
        const activeLoginid = localStorage.getItem('active_loginid');
        const clientAccountsStr = localStorage.getItem('clientAccounts');

        if (!authToken || !activeLoginid || !clientAccountsStr) {
            console.warn('[AuthWrapper] Missing OAuth data for sync');
            return false;
        }

        const clientAccounts = JSON.parse(clientAccountsStr);
        const account = clientAccounts[activeLoginid];

        if (!account) {
            console.warn('[AuthWrapper] No account found for loginid:', activeLoginid);
            return false;
        }

        const allAccountsList = buildAccountList();

        // ── Update observables (useApiBase reads these) ──
        setAuthData({
            authorize: {
                account_list: allAccountsList,
                loginid: activeLoginid,
                currency: account.currency || 'USD',
                balance: account.balance || 0,
                is_virtual: account.account_type === 'demo' ? 1 : 0,
            },
        });
        setAccountList(allAccountsList);
        setIsAuthorized(true);

        // ── Update MobX ClientSStore ──
        if (client) {
            client.setLoginId(activeLoginid);
            client.setAccountList(allAccountsList);
            client.setCurrency(account.currency || 'USD');
            client.setBalance(String(account.balance || '0'));
            client.setIsLoggedIn(true);   // ← THIS is what shows the app as logged in

            // Hydrate accounts map directly in case setAccountList misses it
            if (!client.accounts) client.accounts = {};
            allAccountsList.forEach((acc: any) => {
                client.accounts[acc.loginid] = acc;
            });

            console.log('[AuthWrapper] ✅ ClientSStore synced — is_logged_in = true');
        }

        return true;
    } catch (error) {
        console.error('[AuthWrapper] syncOAuthToClientStore error:', error);
        return false;
    }
};

// ─── OAuth WebSocket Init ────────────────────────────────────────────────────

const initializeOAuthWebSockets = async (client?: any) => {
    if (isInitializing) {
        console.log('[AuthWrapper] Already initializing, skipping...');
        return false;
    }

    isInitializing = true;

    try {
        console.log('[AuthWrapper] Initializing OAuth WebSocket connections...');
        window.derivWS = derivWS;

        const isRealConnected = derivWS.isRealConnected?.();
        const isDemoConnected = derivWS.isDemoConnected?.();

        if (!isRealConnected || !isDemoConnected) {
            await Promise.all([derivWS.connectDemo(), derivWS.connectReal()]);
            console.log('[AuthWrapper] OAuth WebSocket connections established');
        } else {
            console.log('[AuthWrapper] WebSockets already connected');
        }

        // Wait for sockets to stabilise
        await new Promise(resolve => setTimeout(resolve, 500));

        // Sync store if client is ready
        if (client) {
            syncOAuthToClientStore(client);
        }

        setConnectionStatus(CONNECTION_STATUS.OPENED);
        console.log('[AuthWrapper] Connection status → OPENED');

        window.dispatchEvent(
            new CustomEvent('oauth-login-complete', {
                detail: {
                    loginid: localStorage.getItem('active_loginid'),
                    isOAuth: true,
                },
            })
        );

        return true;
    } catch (error) {
        console.error('[AuthWrapper] Failed to initialize OAuth WebSockets:', error);
        return false;
    } finally {
        isInitializing = false;
    }
};

// ─── AuthWrapper Component ───────────────────────────────────────────────────

export const AuthWrapper = () => {
    const [isAuthComplete, setIsAuthComplete] = React.useState(false);
    const { loginInfo, paramsToDelete } = URLUtils.getLoginInfoFromURL();
    const isOAuth = isOAuthAuthenticated();
    const { client } = useStore() || {};
    const hasInitialized = React.useRef(false);
    const clientRef = React.useRef(client);

    // Keep clientRef current — this is the key fix for the timing issue.
    // When initializeAuth() runs, client may be null. But by the time
    // the OAuth sync actually needs to fire, the store is ready.
    // We watch client and re-sync whenever it becomes available.
    React.useEffect(() => {
        clientRef.current = client;
    }, [client]);

    // ── Re-sync when client store becomes available after OAuth boot ──────
    React.useEffect(() => {
        if (client && isOAuth && isAuthComplete) {
            const alreadyLoggedIn = client.is_logged_in;
            if (!alreadyLoggedIn) {
                console.log('[AuthWrapper] Client store now ready — syncing OAuth state...');
                syncOAuthToClientStore(client);
            }
        }
    }, [client, isOAuth, isAuthComplete]);

    React.useEffect(() => {
        const initializeAuth = async () => {
            if (hasInitialized.current) return;
            hasInitialized.current = true;

            try {
                // ── Case 1: Legacy login via URL params ──────────────────
                if (loginInfo.length > 0) {
                    console.log('[AuthWrapper] Legacy login via URL params');
                    await setLocalStorageToken(loginInfo, paramsToDelete);
                    setIsAuthComplete(true);
                    return;
                }

                // ── Case 2: OAuth stored session ─────────────────────────
                if (isOAuth) {
                    console.log('[AuthWrapper] OAuth session detected, initializing...');
                    // Pass clientRef.current — may be null here, that's OK.
                    // The useEffect above will re-sync when client is ready.
                    await initializeOAuthWebSockets(clientRef.current);
                    setIsAuthComplete(true);
                    console.log('[AuthWrapper] Auth initialization complete, showing site');
                    return;
                }

                // ── Case 3: Legacy stored session ────────────────────────
                const legacyToken = localStorage.getItem('authToken');
                const legacyType = localStorage.getItem('auth_type');
                if (legacyToken && legacyType === 'legacy') {
                    console.log('[AuthWrapper] Legacy stored session detected');
                    const storedLoginid = localStorage.getItem('active_loginid');
                    if (storedLoginid && clientRef.current) {
                        clientRef.current.setLoginId(storedLoginid);
                        clientRef.current.setIsLoggedIn(true);
                    }
                    setIsAuthorized(true);
                }

                // ── Case 4: Not logged in ────────────────────────────────
                URLUtils.filterSearchParams(['lang']);
            } catch (error) {
                console.error('[AuthWrapper] Auth initialization error:', error);
            } finally {
                console.log('[AuthWrapper] Auth initialization complete, showing site');
                setIsAuthComplete(true);
            }
        };

        initializeAuth();

        // Safety timeout — never block the UI forever
        const safetyTimeout = setTimeout(() => {
            if (!isAuthComplete) {
                console.warn('[AuthWrapper] Safety timeout — forcing auth completion');
                setIsAuthComplete(true);
            }
        }, 8000);

        const handleStorageChange = (event: StorageEvent) => {
            if (event.key === 'auth_type' && event.newValue === 'oauth' && !hasInitialized.current) {
                console.log('[AuthWrapper] OAuth login detected via storage event');
                window.location.reload();
            }
        };

        window.addEventListener('storage', handleStorageChange);

        return () => {
            window.removeEventListener('storage', handleStorageChange);
            clearTimeout(safetyTimeout);
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    if (!isAuthComplete) {
        return <ChunkLoader message={localize('Initializing your account...')} />;
    }

    return <App />;
};