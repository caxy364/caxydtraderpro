// src/external/bot-skeleton/services/OAuthService.ts

// Your OAuth configuration
const CLIENT_ID = '3373S5Dny6niTFbyNDipt';
const REDIRECT_URI = 'https://nyanyukisites.pages.dev/callback';
const API_BASE_URL = 'https://api.derivws.com';

// ==================== PKCE Helpers ====================

function generateCodeVerifier(length: number = 64): string {
    const array = new Uint8Array(length);
    crypto.getRandomValues(array);
    return btoa(String.fromCharCode(...array))
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/, '');
}

async function generateCodeChallenge(verifier: string): Promise<string> {
    const encoder = new TextEncoder();
    const data = encoder.encode(verifier);
    const hash = await crypto.subtle.digest('SHA-256', data);
    return btoa(String.fromCharCode(...new Uint8Array(hash)))
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/, '');
}

function generateState(): string {
    const array = new Uint8Array(16);
    crypto.getRandomValues(array);
    return Array.from(array, byte => byte.toString(16).padStart(2, '0')).join('');
}

// ==================== HELPER FUNCTIONS ====================

export const isOAuthUser = (): boolean => {
    const authType = localStorage.getItem('auth_type');
    const accessToken = localStorage.getItem('deriv_access_token');
    return authType === 'oauth' && !!accessToken;
};

export const isLegacyUser = (): boolean => {
    const authType = localStorage.getItem('auth_type');
    const authToken = localStorage.getItem('authToken');
    return authType === 'legacy' && !!authToken;
};

export const getActiveToken = (): string | null => {
    const oauthToken = localStorage.getItem('deriv_access_token');
    if (oauthToken) return oauthToken;
    const legacyToken = localStorage.getItem('authToken');
    if (legacyToken) return legacyToken;
    return null;
};

export const getActiveLoginId = (): string | null => {
    return localStorage.getItem('active_loginid');
};

// ==================== OAuth FLOW ====================

/**
 * Step 1: Initiate OAuth login flow
 */
export async function initiateOAuthLogin(): Promise<void> {
    try {
        console.log('[OAuth] Initiating OAuth login...');
        
        const codeVerifier = generateCodeVerifier(64);
        const codeChallenge = await generateCodeChallenge(codeVerifier);
        const state = generateState();
        
        console.log('[OAuth] PKCE verifier generated');
        
        // Store using consistent key names
        sessionStorage.setItem('oauth_code_verifier', codeVerifier);
        sessionStorage.setItem('oauth_state', state);
        sessionStorage.setItem('oauth_created_at', Date.now().toString());
        localStorage.setItem('oauth_code_verifier_backup', codeVerifier);
        localStorage.setItem('oauth_state_backup', state);
        
        const params = new URLSearchParams({
            response_type: 'code',
            client_id: CLIENT_ID,
            redirect_uri: REDIRECT_URI,
            scope: 'trading account_manage',
            state: state,
            code_challenge: codeChallenge,
            code_challenge_method: 'S256',
        });

        const authUrl = `https://auth.deriv.com/oauth2/auth?${params.toString()}`;
        console.log('[OAuth] Redirecting to Deriv...');
        window.location.href = authUrl;
    } catch (error) {
        console.error('[OAuth] Failed to initiate login:', error);
        throw error;
    }
}

/**
 * Step 2: Handle OAuth callback and exchange code for tokens
 */
export async function handleOAuthCallback(code: string, receivedState: string): Promise<any> {
    try {
        console.log('[OAuth] Processing OAuth callback...');
        console.log('[OAuth] Looking for stored state and verifier...');
        
        // Get stored data using consistent keys
        let storedState = sessionStorage.getItem('oauth_state');
        let codeVerifier = sessionStorage.getItem('oauth_code_verifier');
        
        // Try backups if not found
        if (!storedState || !codeVerifier) {
            console.log('[OAuth] Trying backup storage...');
            storedState = localStorage.getItem('oauth_state_backup');
            codeVerifier = localStorage.getItem('oauth_code_verifier_backup');
        }
        
        // Log what we found
        console.log('[OAuth] Stored state found:', !!storedState);
        console.log('[OAuth] Code verifier found:', !!codeVerifier);
        console.log('[OAuth] Received state:', receivedState?.substring(0, 20) + '...');
        
        if (!storedState || !codeVerifier) {
            console.error('[OAuth] Missing stored data. SessionStorage keys:', Object.keys(sessionStorage));
            console.error('[OAuth] LocalStorage keys:', Object.keys(localStorage));
            throw new Error('No OAuth session found. Please try logging in again.');
        }
        
        // Validate state
        if (receivedState !== storedState) {
            console.error('[OAuth] State mismatch');
            console.error('[OAuth] Expected:', storedState);
            console.error('[OAuth] Received:', receivedState);
            throw new Error('Security validation failed. Please try again.');
        }
        
        console.log('[OAuth] State validated successfully');
        
        // Clear stored data
        sessionStorage.removeItem('oauth_state');
        sessionStorage.removeItem('oauth_code_verifier');
        sessionStorage.removeItem('oauth_created_at');
        localStorage.removeItem('oauth_state_backup');
        localStorage.removeItem('oauth_code_verifier_backup');
        
        console.log('[OAuth] Exchanging code for token...');
        
        // Exchange code for tokens
        const tokenResponse = await fetch('https://auth.deriv.com/oauth2/token', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({
                grant_type: 'authorization_code',
                client_id: CLIENT_ID,
                redirect_uri: REDIRECT_URI,
                code: code,
                code_verifier: codeVerifier,
            })
        });
        
        if (!tokenResponse.ok) {
            const errorText = await tokenResponse.text();
            console.error('[OAuth] Token exchange failed:', tokenResponse.status, errorText);
            throw new Error(`Token exchange failed: ${tokenResponse.status}`);
        }
        
        const tokens = await tokenResponse.json();
        
        if (!tokens.access_token) {
            throw new Error('No access token received');
        }
        
        console.log('[OAuth] Tokens received successfully');
        
        // Store tokens
        localStorage.setItem('deriv_access_token', tokens.access_token);
        localStorage.setItem('deriv_refresh_token', tokens.refresh_token || '');
        localStorage.setItem('deriv_token_expires_at', (Date.now() + ((tokens.expires_in || 3600) * 1000)).toString());
        localStorage.setItem('auth_type', 'oauth');
        localStorage.setItem('deriv_app_id', CLIENT_ID);
        localStorage.setItem('oauth_client_id', CLIENT_ID);
        localStorage.setItem('authToken', tokens.access_token);
        
        // Fetch user account info
        const userInfo = await fetchUserAccountInfo(tokens.access_token);
        if (userInfo) {
            localStorage.setItem('active_loginid', userInfo.loginid);
            localStorage.setItem('user_currency', userInfo.currency);
            localStorage.setItem('is_virtual', userInfo.is_virtual.toString());
            console.log('[OAuth] User info stored for:', userInfo.loginid);
        }
        
        return tokens;
    } catch (error) {
        console.error('[OAuth] Failed to handle callback:', error);
        // Clear stored data on error
        sessionStorage.removeItem('oauth_state');
        sessionStorage.removeItem('oauth_code_verifier');
        sessionStorage.removeItem('oauth_created_at');
        localStorage.removeItem('oauth_state_backup');
        localStorage.removeItem('oauth_code_verifier_backup');
        throw error;
    }
}

/**
 * Step 3: Fetch user account information from Deriv API
 */
export async function fetchUserAccountInfo(accessToken: string): Promise<any> {
    try {
        console.log('[OAuth] Fetching user account info...');
        
        const response = await fetch(`${API_BASE_URL}/trading/v1/options/accounts`, {
            method: 'GET',
            headers: {
                'Deriv-App-ID': CLIENT_ID,
                'Authorization': `Bearer ${accessToken}`,
                'Content-Type': 'application/json'
            }
        });
        
        if (!response.ok) {
            throw new Error(`Failed to fetch account info: ${response.status}`);
        }
        
        const data = await response.json();
        const accounts = data.accounts || data.data || [];
        const activeAccount = accounts.find((acc: any) => acc.is_active) || accounts[0];
        
        if (!activeAccount) {
            throw new Error('No active account found');
        }
        
        // Store accounts list
        const accountsList: Record<string, string> = {};
        const clientAccounts: Record<string, any> = {};
        
        accounts.forEach((account: any) => {
            const loginid = account.account_id || account.loginid;
            if (loginid) {
                accountsList[loginid] = accessToken;
                clientAccounts[loginid] = {
                    loginid: loginid,
                    token: accessToken,
                    currency: account.currency || 'USD',
                    balance: account.balance || 0,
                    account_type: account.account_type,
                    is_virtual: account.account_type === 'demo',
                };
            }
        });
        
        localStorage.setItem('accountsList', JSON.stringify(accountsList));
        localStorage.setItem('clientAccounts', JSON.stringify(clientAccounts));
        
        return {
            loginid: activeAccount.account_id || activeAccount.loginid,
            currency: activeAccount.currency || 'USD',
            balance: activeAccount.balance || 0,
            is_virtual: activeAccount.account_type === 'demo',
            account_type: activeAccount.account_type,
            landing_company_name: activeAccount.landing_company_name || (activeAccount.account_type === 'demo' ? 'virtual' : ''),
        };
    } catch (error) {
        console.error('[OAuth] Failed to fetch user info:', error);
        return null;
    }
}

/**
 * Step 4: Get WebSocket URL with OTP
 */
export async function getWebSocketUrlWithOTP(accountId: string, accessToken: string): Promise<string> {
    try {
        console.log('[OAuth] Requesting WebSocket URL with OTP for account:', accountId);
        
        const response = await fetch(
            `${API_BASE_URL}/trading/v1/options/accounts/${accountId}/otp`,
            {
                method: 'POST',
                headers: {
                    'Deriv-App-ID': CLIENT_ID,
                    'Authorization': `Bearer ${accessToken}`,
                    'Content-Type': 'application/json'
                }
            }
        );
        
        if (!response.ok) {
            const error = await response.text();
            throw new Error(`Failed to get OTP: ${response.status} - ${error}`);
        }
        
        const data = await response.json();
        let wsUrl: string | null = data.websocket_url || data.data?.websocket_url || data.url;
        
        if (!wsUrl) {
            console.error('[OAuth] Response structure:', data);
            throw new Error('No WebSocket URL received from OTP endpoint');
        }
        
        console.log('[OAuth] WebSocket URL obtained successfully');
        return wsUrl;
    } catch (error) {
        console.error('[OAuth] Failed to get WebSocket URL:', error);
        throw error;
    }
}

/**
 * Refresh expired access token
 */
export async function refreshAccessToken(): Promise<string | null> {
    try {
        const refreshToken = localStorage.getItem('deriv_refresh_token');
        if (!refreshToken) {
            throw new Error('No refresh token available');
        }
        
        console.log('[OAuth] Refreshing access token...');
        
        const response = await fetch('https://auth.deriv.com/oauth2/token', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({
                grant_type: 'refresh_token',
                client_id: CLIENT_ID,
                refresh_token: refreshToken,
            })
        });
        
        if (!response.ok) {
            throw new Error('Token refresh failed');
        }
        
        const tokens = await response.json();
        
        if (tokens.access_token) {
            localStorage.setItem('deriv_access_token', tokens.access_token);
            localStorage.setItem('deriv_refresh_token', tokens.refresh_token || '');
            localStorage.setItem('deriv_token_expires_at', (Date.now() + ((tokens.expires_in || 3600) * 1000)).toString());
            localStorage.setItem('authToken', tokens.access_token);
            console.log('[OAuth] Access token refreshed successfully');
            return tokens.access_token;
        }
        return null;
    } catch (error) {
        console.error('[OAuth] Failed to refresh token:', error);
        logoutOAuth();
        return null;
    }
}

/**
 * Check if OAuth token is valid
 */
export function isOAuthValid(): boolean {
    const accessToken = localStorage.getItem('deriv_access_token');
    const expiresAt = localStorage.getItem('deriv_token_expires_at');
    const authType = localStorage.getItem('auth_type');
    
    if (!accessToken || authType !== 'oauth') return false;
    if (expiresAt && Date.now() < parseInt(expiresAt)) return true;
    
    return false;
}

/**
 * Logout OAuth user only
 */
export function logoutOAuth(): void {
    console.log('[OAuth] Logging out OAuth user...');
    
    localStorage.removeItem('deriv_access_token');
    localStorage.removeItem('deriv_refresh_token');
    localStorage.removeItem('deriv_token_expires_at');
    localStorage.removeItem('deriv_app_id');
    localStorage.removeItem('oauth_client_id');
    localStorage.removeItem('deriv_ws_url');
    localStorage.removeItem('deriv_ws_otp');
    localStorage.removeItem('deriv_account_id');
    localStorage.removeItem('accountsList');
    localStorage.removeItem('clientAccounts');
    localStorage.removeItem('active_loginid');
    localStorage.removeItem('user_currency');
    localStorage.removeItem('is_virtual');
    
    if (localStorage.getItem('auth_type') === 'oauth') {
        localStorage.removeItem('auth_type');
    }
    
    // Clear OAuth session storage
    sessionStorage.removeItem('oauth_state');
    sessionStorage.removeItem('oauth_code_verifier');
    sessionStorage.removeItem('oauth_created_at');
    localStorage.removeItem('oauth_state_backup');
    localStorage.removeItem('oauth_code_verifier_backup');
    
    console.log('[OAuth] OAuth data cleared');
}

/**
 * Clear ALL authentication data
 */
export function logoutAll(): void {
    console.log('[Auth] Clearing all authentication data...');
    logoutOAuth();
    localStorage.removeItem('authToken');
    sessionStorage.clear();
    console.log('[Auth] All authentication data cleared');
}

/**
 * Setup legacy authentication
 */
export function setupLegacyAuth(token: string, loginId: string, accountsList: Record<string, string>, clientAccounts: Record<string, any>): void {
    console.log('[Auth] Setting up legacy authentication...');
    
    localStorage.setItem('authToken', token);
    localStorage.setItem('active_loginid', loginId);
    localStorage.setItem('auth_type', 'legacy');
    localStorage.setItem('accountsList', JSON.stringify(accountsList));
    localStorage.setItem('clientAccounts', JSON.stringify(clientAccounts));
    
    console.log('[Auth] Legacy authentication setup complete');
}