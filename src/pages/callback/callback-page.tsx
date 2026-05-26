// src/pages/callback/callback-page.tsx

import React, { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { localize } from '@deriv-com/translations';

// Your OAuth Client ID
const YOUR_OAUTH_CLIENT_ID = '32UpAZvxBqalqEFHVMTNS';

const CallbackPage: React.FC = () => {
    const [searchParams] = useSearchParams();
    const [error, setError] = useState<string | null>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        const handleCallback = async () => {
            const code = searchParams.get('code');

            // LEGACY TOKENS
            const token1 = searchParams.get('token1');
            const acct1 = searchParams.get('acct1');
            const cur1 = searchParams.get('cur1');

            const state = searchParams.get('state');
            const errorParam = searchParams.get('error');

            //
            // OAUTH ERROR
            //
            if (errorParam) {
                setError(errorParam);
                setLoading(false);

                console.error('[Callback] OAuth error:', errorParam);

                return;
            }

            //
            // NO VALID AUTH RESPONSE
            //
            if (!code && !token1) {
                setError('No authorization code or legacy token received');
                setLoading(false);

                return;
            }

            //
            // ============================================================
            // LEGACY LOGIN FLOW
            // ============================================================
            //
            if (token1 && acct1) {
                try {
                    console.log('[Callback] Processing legacy login...');

                    const isVirtual = acct1.startsWith('VR');

                    const accountsList: Record<string, string> = {
                        [acct1]: token1,
                    };

                    const clientAccounts: Record<string, any> = {
                        [acct1]: {
                            loginid: acct1,
                            token: token1,
                            currency: cur1 || 'USD',
                            balance: 0,
                            is_virtual: isVirtual ? 1 : 0,
                            is_disabled: 0,
                            landing_company_name: isVirtual
                                ? 'virtual'
                                : 'svg',
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
                            landing_company_name: isVirtual
                                ? 'virtual'
                                : 'svg',
                        },
                    ];

                    //
                    // SAVE STORAGE
                    //
                    localStorage.setItem(
                        'accountsList',
                        JSON.stringify(accountsList)
                    );

                    localStorage.setItem(
                        'clientAccounts',
                        JSON.stringify(clientAccounts)
                    );

                    localStorage.setItem(
                        'account_list',
                        JSON.stringify(accountListForStore)
                    );

                    localStorage.setItem('active_loginid', acct1);

                    localStorage.setItem('authToken', token1);

                    localStorage.setItem('auth_type', 'legacy');

                    localStorage.setItem('config.app_id', '111670');

                    localStorage.setItem('is_logged_in', 'true');

                    localStorage.setItem(
                        'active_account',
                        JSON.stringify({
                            loginid: acct1,
                            currency: cur1 || 'USD',
                            balance: 0,
                            is_virtual: isVirtual ? 1 : 0,
                            landing_company_name: isVirtual
                                ? 'virtual'
                                : 'svg',
                        })
                    );

                    console.log(
                        '[Callback] Legacy login successful:',
                        acct1
                    );

                    //
                    // REDIRECT
                    //
                    window.location.replace('/');

                    return;
                } catch (err) {
                    console.error(
                        '[Callback] Legacy login error:',
                        err
                    );

                    setError('Failed to complete legacy login.');

                    setLoading(false);

                    return;
                }
            }

            //
            // ============================================================
            // SECURE PKCE LOGIN FLOW
            // ============================================================
            //

            const savedState = sessionStorage.getItem('oauth_state');
            const codeVerifier = sessionStorage.getItem(
                'pkce_code_verifier'
            );

            if (state !== savedState) {
                setError('State mismatch - possible CSRF attack');

                setLoading(false);

                console.error('[Callback] State mismatch');

                return;
            }

            try {
                const redirectUri =
                    'https://europrinter.vercel.app/callback';

                console.log(
                    '[Callback] Exchanging code for token...'
                );

                //
                // STEP 1: TOKEN EXCHANGE
                //
                const tokenResponse = await fetch(
                    'https://auth.deriv.com/oauth2/token',
                    {
                        method: 'POST',
                        headers: {
                            'Content-Type':
                                'application/x-www-form-urlencoded',
                        },
                        body: new URLSearchParams({
                            grant_type: 'authorization_code',
                            client_id: YOUR_OAUTH_CLIENT_ID,
                            code: code!,
                            redirect_uri: redirectUri,
                            code_verifier: codeVerifier || '',
                        }),
                    }
                );

                const tokenData = await tokenResponse.json();

                if (tokenData.error) {
                    setError(
                        tokenData.error_description ||
                            tokenData.error
                    );

                    setLoading(false);

                    console.error(
                        '[Callback] Token error:',
                        tokenData.error
                    );

                    return;
                }

                const accessToken = tokenData.access_token;
                const refreshToken = tokenData.refresh_token;

                console.log(
                    '[Callback] Access token obtained'
                );

                //
                // STEP 2: FETCH ACCOUNTS
                //
                const accountsResponse = await fetch(
                    'https://api.derivws.com/trading/v1/options/accounts',
                    {
                        headers: {
                            Authorization: `Bearer ${accessToken}`,
                            'Deriv-App-ID':
                                YOUR_OAUTH_CLIENT_ID,
                        },
                    }
                );

                const accountsData =
                    await accountsResponse.json();

                const accounts =
                    accountsData.data ||
                    accountsData.accounts ||
                    [];

                console.log(
                    '[Callback] Accounts fetched:',
                    accounts.length
                );

                if (accounts.length === 0) {
                    setError(
                        'No trading accounts found. Please contact support.'
                    );

                    setLoading(false);

                    return;
                }

                //
                // STEP 3: BUILD STORAGE STRUCTURES
                //
                const accountsList: Record<string, string> =
                    {};

                const clientAccounts: Record<string, any> =
                    {};

                const accountListForStore: any[] = [];

                accounts.forEach((account: any) => {
                    const loginid =
                        account.account_id ||
                        account.loginid;

                    const isVirtual =
                        account.account_type === 'demo';

                    accountsList[loginid] = accessToken;

                    clientAccounts[loginid] = {
                        loginid,
                        token: accessToken,
                        currency:
                            account.currency || 'USD',
                        balance: account.balance || 0,
                        account_type:
                            account.account_type,
                        is_virtual: isVirtual ? 1 : 0,
                        is_disabled: 0,
                        landing_company_name:
                            isVirtual
                                ? 'virtual'
                                : 'svg',
                    };

                    accountListForStore.push({
                        loginid,
                        token: accessToken,
                        currency:
                            account.currency || 'USD',
                        balance: account.balance || 0,
                        is_virtual: isVirtual ? 1 : 0,
                        is_disabled: 0,
                        landing_company_name:
                            isVirtual
                                ? 'virtual'
                                : 'svg',
                        account_type:
                            account.account_type,
                    });
                });

                //
                // STEP 4: ACTIVE ACCOUNT
                //
                const demoAccount = accounts.find(
                    (acc: any) =>
                        acc.account_type === 'demo'
                );

                const realAccount = accounts.find(
                    (acc: any) =>
                        acc.account_type === 'real'
                );

                const activeAccount =
                    demoAccount ||
                    realAccount ||
                    accounts[0];

                const activeLoginId =
                    activeAccount?.account_id ||
                    activeAccount?.loginid;

                //
                // STEP 5: SAVE STORAGE
                //
                localStorage.setItem(
                    'accountsList',
                    JSON.stringify(accountsList)
                );

                localStorage.setItem(
                    'clientAccounts',
                    JSON.stringify(clientAccounts)
                );

                localStorage.setItem(
                    'active_loginid',
                    activeLoginId
                );

                localStorage.setItem(
                    'authToken',
                    accessToken
                );

                localStorage.setItem(
                    'auth_type',
                    'oauth'
                );

                localStorage.setItem(
                    'deriv_app_id',
                    YOUR_OAUTH_CLIENT_ID
                );

                localStorage.setItem(
                    'oauth_client_id',
                    YOUR_OAUTH_CLIENT_ID
                );

                if (refreshToken) {
                    localStorage.setItem(
                        'refresh_token',
                        refreshToken
                    );
                }

                localStorage.setItem(
                    'is_logged_in',
                    'true'
                );

                localStorage.setItem('config.app_id', '111670');

                localStorage.setItem(
                    'account_list',
                    JSON.stringify(accountListForStore)
                );

                localStorage.setItem(
                    'active_account',
                    JSON.stringify({
                        loginid: activeLoginId,
                        currency:
                            activeAccount?.currency ||
                            'USD',
                        balance:
                            activeAccount?.balance || 0,
                        is_virtual:
                            activeAccount?.account_type ===
                            'demo'
                                ? 1
                                : 0,
                        landing_company_name:
                            activeAccount?.account_type ===
                            'demo'
                                ? 'virtual'
                                : 'svg',
                    })
                );

                localStorage.setItem(
                    'user_currency',
                    activeAccount?.currency || 'USD'
                );

                console.log(
                    '[Callback] Secure login complete:',
                    activeLoginId
                );

                //
                // CLEANUP
                //
                sessionStorage.removeItem(
                    'oauth_state'
                );

                sessionStorage.removeItem(
                    'pkce_code_verifier'
                );

                //
                // REDIRECT
                //
                window.location.replace('/');
            } catch (err) {
                console.error(
                    '[Callback] Token exchange error:',
                    err
                );

                setError(
                    'Failed to complete login. Please try again.'
                );

                setLoading(false);
            }
        };

        handleCallback();
    }, [searchParams]);

    //
    // LOADING SCREEN
    //
    if (loading) {
        return (
            <div
                style={{
                    display: 'flex',
                    flexDirection: 'column',
                    justifyContent: 'center',
                    alignItems: 'center',
                    height: '100vh',
                    background: '#07090e',
                    color: '#F0F4FF',
                    gap: '20px',
                }}
            >
                <div
                    style={{
                        width: '48px',
                        height: '48px',
                        border:
                            '3px solid rgba(226,105,6,0.2)',
                        borderTopColor: '#e26906',
                        borderRightColor: '#FFD700',
                        borderRadius: '50%',
                        animation:
                            'spin 0.9s linear infinite',
                    }}
                />

                <p>
                    {localize(
                        'Completing your login...'
                    )}
                </p>

                <style>{`
                    @keyframes spin {
                        to {
                            transform: rotate(360deg);
                        }
                    }
                `}</style>
            </div>
        );
    }

    //
    // ERROR SCREEN
    //
    if (error) {
        return (
            <div
                style={{
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
                }}
            >
                <h2 style={{ color: '#e74c3c' }}>
                    {localize('Login Error')}
                </h2>

                <p>{error}</p>

                <button
                    onClick={() => {
                        localStorage.removeItem(
                            'is_logged_in'
                        );

                        localStorage.removeItem(
                            'authToken'
                        );

                        localStorage.removeItem(
                            'accountsList'
                        );

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
                        transition: 'all 0.3s',
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
