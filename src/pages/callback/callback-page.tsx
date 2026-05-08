// src/pages/callback/callback-page.tsx

import React, { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { localize } from '@deriv-com/translations';

// Your OAuth Client ID - this works as both Client ID and App ID
const YOUR_OAUTH_CLIENT_ID = '3373S5Dny6niTFbyNDipt';

const CallbackPage: React.FC = () => {
    const [searchParams] = useSearchParams();
    const [error, setError] = useState<string | null>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        const handleCallback = async () => {
            const code = searchParams.get('code');
            const state = searchParams.get('state');
            const errorParam = searchParams.get('error');

            if (errorParam) {
                setError(errorParam);
                setLoading(false);
                console.error('[Callback] OAuth error:', errorParam);
                return;
            }

            if (!code) {
                setError('No authorization code received');
                setLoading(false);
                return;
            }

            const savedState = sessionStorage.getItem('oauth_state');
            const codeVerifier = sessionStorage.getItem('pkce_code_verifier');

            if (state !== savedState) {
                setError('State mismatch - possible CSRF attack');
                setLoading(false);
                console.error('[Callback] State mismatch');
                return;
            }

            try {
                const redirectUri = 'https://nyanyukisites.pages.dev/callback';

                console.log('[Callback] Exchanging code for token...');

                // Step 1: Exchange code for access token
                const tokenResponse = await fetch('https://auth.deriv.com/oauth2/token', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/x-www-form-urlencoded',
                    },
                    body: new URLSearchParams({
                        grant_type: 'authorization_code',
                        client_id: YOUR_OAUTH_CLIENT_ID,
                        code: code,
                        redirect_uri: redirectUri,
                        code_verifier: codeVerifier || '',
                    }),
                });

                const tokenData = await tokenResponse.json();

                if (tokenData.error) {
                    setError(tokenData.error_description || tokenData.error);
                    setLoading(false);
                    console.error('[Callback] Token error:', tokenData.error);
                    return;
                }

                const accessToken = tokenData.access_token;
                const refreshToken = tokenData.refresh_token;
                console.log('[Callback] Access token obtained');

                // Step 2: Get account info from REST API
                const accountsResponse = await fetch('https://api.derivws.com/trading/v1/options/accounts', {
                    headers: {
                        Authorization: `Bearer ${accessToken}`,
                        'Deriv-App-ID': YOUR_OAUTH_CLIENT_ID,
                    },
                });

                const accountsData = await accountsResponse.json();
                const accounts = accountsData.data || accountsData.accounts || [];
                console.log('[Callback] Accounts fetched:', accounts.length);

                if (accounts.length === 0) {
                    setError('No trading accounts found. Please contact support.');
                    setLoading(false);
                    return;
                }

                // Step 3: Build account structures
                const accountsList: Record<string, string> = {};
                const clientAccounts: Record<string, any> = {};
                // This is the format your ClientSStore.setAccountList() expects
                const accountListForStore: any[] = [];

                accounts.forEach((account: any) => {
                    const loginid = account.account_id || account.loginid;
                    const isVirtual = account.account_type === 'demo';

                    // For getToken() in ClientSStore — maps loginid → token
                    accountsList[loginid] = accessToken;

                    // Full account object for clientAccounts
                    clientAccounts[loginid] = {
                        loginid,
                        token: accessToken,
                        currency: account.currency || 'USD',
                        balance: account.balance || 0,
                        account_type: account.account_type,
                        is_virtual: isVirtual ? 1 : 0,
                        is_disabled: 0,
                        landing_company_name: isVirtual ? 'virtual' : 'svg',
                    };

                    // Format for ClientSStore.setAccountList()
                    accountListForStore.push({
                        loginid,
                        token: accessToken,
                        currency: account.currency || 'USD',
                        balance: account.balance || 0,
                        is_virtual: isVirtual ? 1 : 0,
                        is_disabled: 0,
                        landing_company_name: isVirtual ? 'virtual' : 'svg',
                        account_type: account.account_type,
                    });
                });

                // Step 4: Pick active account — prefer demo
                const demoAccount = accounts.find(
                    (acc: any) => acc.account_type === 'demo'
                );
                const realAccount = accounts.find(
                    (acc: any) => acc.account_type === 'real'
                );
                const activeAccount = demoAccount || realAccount || accounts[0];
                const activeLoginId = activeAccount?.account_id || activeAccount?.loginid;

                // Step 5: Save everything to localStorage
                // These keys are exactly what your ClientSStore reads
                localStorage.setItem('accountsList', JSON.stringify(accountsList));
                localStorage.setItem('clientAccounts', JSON.stringify(clientAccounts));
                localStorage.setItem('active_loginid', activeLoginId);
                localStorage.setItem('authToken', accessToken);
                localStorage.setItem('auth_type', 'oauth');
                localStorage.setItem('deriv_app_id', YOUR_OAUTH_CLIENT_ID);
                localStorage.setItem('oauth_client_id', YOUR_OAUTH_CLIENT_ID);

                // Store refresh token if provided
                if (refreshToken) {
                    localStorage.setItem('refresh_token', refreshToken);
                }

                // Step 6: *** THE KEY FIX ***
                // Store a flag that tells CoreStoreProvider/AuthWrapper
                // that auth is complete and the user IS logged in.
                // When window.location.href = '/' fires, the app re-reads
                // this from localStorage and sets is_logged_in = true.
                localStorage.setItem('is_logged_in', 'true');

                // Store the full account list so the store can hydrate on boot
                localStorage.setItem(
                    'account_list',
                    JSON.stringify(accountListForStore)
                );

                // Store active account details directly so the header
                // and store can immediately show correct data
                localStorage.setItem(
                    'active_account',
                    JSON.stringify({
                        loginid: activeLoginId,
                        currency: activeAccount?.currency || 'USD',
                        balance: activeAccount?.balance || 0,
                        is_virtual: activeAccount?.account_type === 'demo' ? 1 : 0,
                        landing_company_name:
                            activeAccount?.account_type === 'demo' ? 'virtual' : 'svg',
                    })
                );

                console.log('[Callback] Auth complete. Active account:', activeLoginId);
                console.log('[Callback] is_logged_in flag set in localStorage');

                // Step 7: Clean up PKCE session storage
                sessionStorage.removeItem('oauth_state');
                sessionStorage.removeItem('pkce_code_verifier');

                // Step 8: Redirect to home — app will boot and read localStorage
                // Use replace so back button doesn't return to /callback
                window.location.replace('/');
            } catch (err) {
                console.error('[Callback] Token exchange error:', err);
                setError('Failed to complete login. Please try again.');
                setLoading(false);
            }
        };

        handleCallback();
    }, [searchParams]);

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
                        border: '3px solid rgba(226,105,6,0.2)',
                        borderTopColor: '#e26906',
                        borderRightColor: '#FFD700',
                        borderRadius: '50%',
                        animation: 'spin 0.9s linear infinite',
                    }}
                />
                <p>{localize('Completing your secure login...')}</p>
                <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
            </div>
        );
    }

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
                <h2 style={{ color: '#e74c3c' }}>{localize('Login Error')}</h2>
                <p>{error}</p>
                <button
                    onClick={() => {
                        // Clear any partial state before retrying
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