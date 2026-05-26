// src/pages/callback/callback-page.tsx

import React, { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { localize } from '@deriv-com/translations';
import { requestOidcToken, requestLegacyToken } from '@deriv-com/auth-client';

const CallbackPage: React.FC = () => {
    const [searchParams] = useSearchParams();
    const [error, setError] = useState<string | null>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        const handleCallback = async () => {
            // ── LEGACY LOGIN PARAMS ──────────────────────────────────────
            const token1 = searchParams.get('token1');
            const acct1 = searchParams.get('acct1');
            const cur1 = searchParams.get('cur1');

            // ── OIDC PARAMS ───────────────────────────────────────────────
            const code = searchParams.get('code');
            const errorParam = searchParams.get('error');

            if (errorParam) {
                setError(errorParam);
                setLoading(false);
                console.error('[Callback] Auth error:', errorParam);
                return;
            }

            if (!code && !token1) {
                setError('No authorization code or legacy token received.');
                setLoading(false);
                return;
            }

            // ================================================================
            // LEGACY LOGIN FLOW  (acct1 / token1 / cur1 URL params)
            // ================================================================
            if (token1 && acct1) {
                try {
                    console.log('[Callback] Processing legacy login...');

                    const isVirtual = acct1.startsWith('VR');

                    const accountsList: Record<string, string> = { [acct1]: token1 };
                    const clientAccounts: Record<string, any> = {
                        [acct1]: {
                            loginid: acct1,
                            token: token1,
                            currency: cur1 || 'USD',
                            balance: 0,
                            is_virtual: isVirtual ? 1 : 0,
                            is_disabled: 0,
                            landing_company_name: isVirtual ? 'virtual' : 'svg',
                        },
                    };
                    const accountListForStore = [
                        {
                            loginid: acct1,
                            token: token1,
                            currency: cur1 || 'USD',
                            balance: 0,
                            is_virtual: isVirtual ? 1 : 0,
                            is_disabled: 0,
                            landing_company_name: isVirtual ? 'virtual' : 'svg',
                        },
                    ];

                    localStorage.setItem('accountsList', JSON.stringify(accountsList));
                    localStorage.setItem('clientAccounts', JSON.stringify(clientAccounts));
                    localStorage.setItem('account_list', JSON.stringify(accountListForStore));
                    localStorage.setItem('active_loginid', acct1);
                    localStorage.setItem('authToken', token1);
                    localStorage.setItem('auth_type', 'legacy');
                    localStorage.setItem('config.app_id', '111670');
                    localStorage.setItem('is_logged_in', 'true');
                    localStorage.setItem('active_account', JSON.stringify({
                        loginid: acct1,
                        currency: cur1 || 'USD',
                        balance: 0,
                        is_virtual: isVirtual ? 1 : 0,
                        landing_company_name: isVirtual ? 'virtual' : 'svg',
                    }));
                    localStorage.setItem('user_currency', cur1 || 'USD');

                    console.log('[Callback] Legacy login saved:', acct1);
                    window.location.replace('/');
                    return;

                } catch (err) {
                    console.error('[Callback] Legacy login error:', err);
                    setError('Failed to complete legacy login.');
                    setLoading(false);
                    return;
                }
            }

            // ================================================================
            // OIDC / PKCE LOGIN FLOW
            // Uses @deriv-com/auth-client to exchange OIDC code → trading tokens
            // ================================================================
            try {
                console.log('[Callback] Processing OIDC login...');

                // Step 1: Exchange OIDC code for access token
                const { accessToken } = await requestOidcToken({
                    redirectCallbackUri: `${window.location.origin}/callback`,
                });

                if (!accessToken) {
                    setError('Authentication failed: no access token received.');
                    setLoading(false);
                    return;
                }

                console.log('[Callback] OIDC access token obtained, fetching trading tokens...');

                // Step 2: Exchange access token for real Deriv WS trading tokens
                // Returns: { acct1, token1, cur1, acct2?, token2?, cur2?, acct3?, token3?, cur3? }
                const legacyTokens = await requestLegacyToken(accessToken);

                if (!legacyTokens?.acct1 || !legacyTokens?.token1) {
                    setError('No trading accounts found. Please ensure your Deriv account is active.');
                    setLoading(false);
                    return;
                }

                console.log('[Callback] Trading tokens obtained, building session...');

                // Step 3: Build account structures from LegacyTokens (up to 3 accounts)
                const accountsList: Record<string, string> = {};
                const clientAccounts: Record<string, any> = {};
                const accountListForStore: any[] = [];

                for (let i = 1; i <= 3; i++) {
                    const acct = legacyTokens[`acct${i}` as keyof typeof legacyTokens];
                    const tkn = legacyTokens[`token${i}` as keyof typeof legacyTokens];
                    const cur = legacyTokens[`cur${i}` as keyof typeof legacyTokens];

                    if (!acct || !tkn) break;

                    const isVirt = acct.startsWith('VR');

                    accountsList[acct] = tkn;
                    clientAccounts[acct] = {
                        loginid: acct,
                        token: tkn,
                        currency: cur || 'USD',
                        balance: 0,
                        is_virtual: isVirt ? 1 : 0,
                        is_disabled: 0,
                        landing_company_name: isVirt ? 'virtual' : 'svg',
                    };
                    accountListForStore.push({
                        loginid: acct,
                        token: tkn,
                        currency: cur || 'USD',
                        balance: 0,
                        is_virtual: isVirt ? 1 : 0,
                        is_disabled: 0,
                        landing_company_name: isVirt ? 'virtual' : 'svg',
                    });
                }

                // Step 4: Select primary account (prefer real over virtual)
                const primaryAccount =
                    accountListForStore.find(a => !a.loginid.startsWith('VR')) ||
                    accountListForStore[0];

                // Step 5: Save to localStorage — same structure as legacy login
                // auth_type is 'legacy' because we now have real WS trading tokens
                localStorage.setItem('accountsList', JSON.stringify(accountsList));
                localStorage.setItem('clientAccounts', JSON.stringify(clientAccounts));
                localStorage.setItem('account_list', JSON.stringify(accountListForStore));
                localStorage.setItem('active_loginid', primaryAccount.loginid);
                localStorage.setItem('authToken', primaryAccount.token);
                localStorage.setItem('auth_type', 'legacy');
                localStorage.setItem('config.app_id', '111670');
                localStorage.setItem('is_logged_in', 'true');
                localStorage.setItem('active_account', JSON.stringify({
                    loginid: primaryAccount.loginid,
                    currency: primaryAccount.currency,
                    balance: 0,
                    is_virtual: primaryAccount.is_virtual,
                    landing_company_name: primaryAccount.landing_company_name,
                }));
                localStorage.setItem('user_currency', primaryAccount.currency);

                console.log('[Callback] OIDC login complete:', primaryAccount.loginid);
                window.location.replace('/');

            } catch (err) {
                console.error('[Callback] OIDC login error:', err);
                setError('Login failed. Please try again.');
                setLoading(false);
            }
        };

        handleCallback();
    }, [searchParams]);

    // LOADING SCREEN
    if (loading) {
        return (
            <div style={{
                display: 'flex',
                flexDirection: 'column',
                justifyContent: 'center',
                alignItems: 'center',
                height: '100vh',
                background: '#07090e',
                color: '#F0F4FF',
                gap: '20px',
            }}>
                <div style={{
                    width: '48px',
                    height: '48px',
                    border: '3px solid rgba(226,105,6,0.2)',
                    borderTopColor: '#e26906',
                    borderRightColor: '#FFD700',
                    borderRadius: '50%',
                    animation: 'spin 0.9s linear infinite',
                }} />
                <p>{localize('Completing your login...')}</p>
                <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
            </div>
        );
    }

    // ERROR SCREEN
    if (error) {
        return (
            <div style={{
                display: 'flex',
                flexDirection: 'column',
                justifyContent: 'center',
                alignItems: 'center',
                height: '100vh',
                background: '#07090e',
                color: '#F0F4FF',
                textAlign: 'center',
                padding: '20px',
                gap: '20px',
            }}>
                <h2 style={{ color: '#e74c3c' }}>{localize('Login Error')}</h2>
                <p>{error}</p>
                <button
                    onClick={() => {
                        localStorage.removeItem('is_logged_in');
                        localStorage.removeItem('authToken');
                        localStorage.removeItem('accountsList');
                        window.location.href = '/';
                    }}
                    style={{
                        color: '#e26906',
                        background: 'transparent',
                        cursor: 'pointer',
                        padding: '10px 20px',
                        border: '1px solid #e26906',
                        borderRadius: '4px',
                        fontSize: '14px',
                    }}
                >
                    {localize('Return to Home')}
                </button>
            </div>
        );
    }

    return null;
};

export default CallbackPage;
