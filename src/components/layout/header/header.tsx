// src/components/layout/header/header.tsx

import clsx from 'clsx';
import { observer } from 'mobx-react-lite';
import { useEffect, useState } from 'react';
import { standalone_routes } from '@/components/shared';
import Button from '@/components/shared_ui/button';
import { StandaloneCircleUserRegularIcon } from '@deriv/quill-icons/Standalone';
import { Localize, useTranslations } from '@deriv-com/translations';
import { Header, useDevice, Wrapper } from '@deriv-com/ui';
import { Tooltip } from '@deriv-com/ui';
import { AppLogo } from '../app-logo';
import AccountSwitcher from './account-switcher';
import MobileMenu from './mobile-menu';
import './header.scss';
import { generateCodeVerifier, generateCodeChallenge, generateState } from '@/utils/pkce';

// Custom hook for real-time balance updates
const useHeaderBalance = () => {
    const [liveBalance, setLiveBalance] = useState<number | null>(null);
    const [balanceDelta, setBalanceDelta] = useState<number>(0);
    const [currency, setCurrency] = useState<string>('USD');

    useEffect(() => {
        let ws: WebSocket | null = null;
        let reconnectTimeout: NodeJS.Timeout;
        
        const connectWebSocket = () => {
            // Use the Deriv WebSocket endpoint
            ws = new WebSocket('wss://ws.derivws.com/websockets/v3?app_id=101761');
            
            ws.onopen = () => {
                console.log('[Balance WebSocket] Connected');
                // Authorize using stored token if available
                const authToken = localStorage.getItem('authToken');
                if (authToken) {
                    ws?.send(JSON.stringify({ 
                        authorize: authToken,
                        req_id: 1 
                    }));
                }
                
                // Subscribe to balance updates
                ws?.send(JSON.stringify({ 
                    balance: 1, 
                    subscribe: 1,
                    req_id: 2 
                }));
            };
            
            ws.onmessage = (event) => {
                try {
                    const data = JSON.parse(event.data);
                    
                    if (data?.msg_type === 'authorize') {
                        console.log('[Balance WebSocket] Authorized');
                        // Get currency from authorize response
                        if (data.authorize?.currency) {
                            setCurrency(data.authorize.currency);
                        }
                    }
                    
                    if (data?.msg_type === 'balance') {
                        const newBalance = data.balance?.balance;
                        const previousBalance = liveBalance;
                        
                        if (newBalance !== undefined) {
                            setLiveBalance(newBalance);
                            
                            // Calculate delta if we had previous balance
                            if (previousBalance !== null && previousBalance !== newBalance) {
                                const delta = newBalance - previousBalance;
                                setBalanceDelta(delta);
                                
                                // Clear delta after 3 seconds
                                setTimeout(() => {
                                    setBalanceDelta(0);
                                }, 3000);
                            }
                        }
                    }
                } catch (error) {
                    console.error('[Balance WebSocket] Error parsing message:', error);
                }
            };
            
            ws.onerror = (error) => {
                console.error('[Balance WebSocket] Error:', error);
            };
            
            ws.onclose = () => {
                console.log('[Balance WebSocket] Disconnected, reconnecting in 5s...');
                reconnectTimeout = setTimeout(connectWebSocket, 5000);
            };
        };
        
        connectWebSocket();
        
        return () => {
            if (reconnectTimeout) clearTimeout(reconnectTimeout);
            if (ws && ws.readyState === WebSocket.OPEN) {
                ws.close();
            }
        };
    }, []);
    
    return { liveBalance, currency, balanceDelta };
};

// InfoIcon component
const InfoIcon = () => {
    const [isDropdownOpen, setIsDropdownOpen] = useState(false);

    const socialLinks = [
        {
            name: 'Telegram',
            url: 'https://t.me/nyanyukisite',
            icon: (
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
                    <path d="M12 0C5.37 0 0 5.37 0 12C0 18.63 5.37 24 12 24C18.63 24 24 18.63 24 12C24 5.37 18.63 0 12 0ZM17.94 8.19L15.98 17.03C15.82 17.67 15.42 17.83 14.88 17.52L11.88 15.33L10.44 16.71C10.27 16.88 10.12 17.03 9.79 17.03L10.02 13.97L15.61 8.9C15.87 8.67 15.56 8.54 15.22 8.77L8.21 13.31L5.24 12.38C4.62 12.19 4.61 11.74 5.38 11.43L17.08 7.08C17.6 6.9 18.06 7.23 17.94 8.19Z" fill="#229ED9"/>
                </svg>
            )
        },
        {
            name: 'Email',
            url: 'mailto:nyanyukibornvick@gmail.com',
            icon: (
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
                    <path d="M20 4H4C2.9 4 2.01 4.9 2.01 6L2 18C2 19.1 2.9 20 4 20H20C21.1 20 22 19.1 22 18V6C22 4.9 21.1 4 20 4ZM19.6 8.25L12.53 12.67C12.21 12.87 11.79 12.87 11.47 12.67L4.4 8.25C4.15 8.09 4 7.82 4 7.53C4 6.86 4.73 6.46 5.3 6.81L12 11L18.7 6.81C19.27 6.46 20 6.86 20 7.53C20 7.82 19.85 8.09 19.6 8.25Z" fill="#EA4335"/>
                </svg>
            )
        },
        {
            name: 'TikTok',
            url: 'https://tiktok.com/@nyanyuki.ste',
            icon: (
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
                    <path d="M16.6 5.82C16.9165 5.03962 17.5397 4.03743 17.54 3H14.45V15.4C14.4261 16.071 14.1428 16.7066 13.6597 17.1729C13.1766 17.6393 12.5316 17.8999 11.86 17.91C10.44 17.91 9.26 16.77 9.26 15.36C9.26 13.73 10.76 12.44 12.39 12.76V9.64C9.05 9.34 6.2 11.88 6.2 15.36C6.2 18.71 9 21.02 11.85 21.02C14.89 21.02 17.54 18.37 17.54 15.33V9.01C18.793 9.90985 20.2974 10.3926 21.84 10.39V7.3C21.84 7.3 19.96 7.39 18.6 5.82Z" fill="black"/>
                </svg>
            )
        },
        {
            name: 'WhatsApp',
            url: 'https://wa.me/254700728778',
            icon: (
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
                    <path d="M12 2C6.48 2 2 6.48 2 12C2 13.85 2.49 15.55 3.36 17.02L2.05 21.95L7.08 20.66C8.51 21.48 10.19 22 12 22C17.52 22 22 17.52 22 12C22 6.48 17.52 2 12 2ZM16.53 15.5C16.37 15.93 15.71 16.33 15.19 16.43C14.5 16.57 13.96 16.48 12.06 15.75C9.54 14.78 7.9 12.23 7.77 12.07C7.64 11.91 6.76 10.73 6.76 9.5C6.76 8.27 7.4 7.66 7.65 7.39C7.9 7.12 8.18 7.05 8.36 7.05C8.54 7.05 8.72 7.05 8.88 7.06C9.04 7.07 9.27 7 9.49 7.47C9.71 7.94 10.18 9.17 10.25 9.31C10.32 9.45 10.36 9.62 10.27 9.82C9.75 10.93 9.17 10.86 9.54 11.47C10.41 12.87 11.38 13.47 12.62 14.09C12.89 14.23 13.06 14.21 13.21 14.04C13.36 13.87 13.81 13.35 13.98 13.11C14.15 12.87 14.32 12.91 14.54 12.99C14.76 13.07 15.98 13.67 16.23 13.8C16.48 13.93 16.64 13.99 16.71 14.09C16.78 14.19 16.78 14.57 16.53 15.5Z" fill="#25D366"/>
                </svg>
            )
        }
    ];

    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            const target = event.target as HTMLElement;
            if (!target.closest('.social-dropdown') && !target.closest('.info-icon')) {
                setIsDropdownOpen(false);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    const handleLinkClick = (url: string) => {
        window.open(url, '_blank', 'noopener,noreferrer');
        setIsDropdownOpen(false);
    };

    return (
        <div className="social-dropdown-container">
            <button 
                className="info-icon" 
                onClick={() => setIsDropdownOpen(!isDropdownOpen)}
                aria-label="Contact us"
            >
                <svg width="28" height="28" viewBox="0 0 32 32" fill="none">
                    <circle cx="16" cy="16" r="15" fill="#0128c6"/>
                    <circle cx="10" cy="16" r="2.5" fill="white"/>
                    <circle cx="16" cy="16" r="2.5" fill="white"/>
                    <circle cx="22" cy="16" r="2.5" fill="white"/>
                </svg>
            </button>
            {isDropdownOpen && (
                <div className="social-dropdown">
                    <div className="social-dropdown__header">
                        <span>Contact Us</span>
                    </div>
                    <div className="social-dropdown__links">
                        {socialLinks.map((link, index) => (
                            <button
                                key={index}
                                className="social-link"
                                onClick={() => handleLinkClick(link.url)}
                            >
                                <span className="social-link__icon">{link.icon}</span>
                                <span className="social-link__name">{link.name}</span>
                            </button>
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
};

// Main Header Component
const AppHeader = observer(() => {
    const { isDesktop } = useDevice();
    const { localize } = useTranslations();
    
    const [isOAuth, setIsOAuth] = useState(false);
    const [oauthActiveAccount, setOauthActiveAccount] = useState<any>(null);
    const [forceUpdate, setForceUpdate] = useState(0);
    
    // Use the balance hook for real-time updates
    const { liveBalance, currency, balanceDelta } = useHeaderBalance();
    
    const getOAuthActiveAccount = () => {
        try {
            const authType = localStorage.getItem('auth_type');
            const activeLoginid = localStorage.getItem('active_loginid');
            const clientAccountsStr = localStorage.getItem('clientAccounts');
            
            if (authType !== 'oauth' || !activeLoginid || !clientAccountsStr) {
                return null;
            }
            
            const clientAccounts = JSON.parse(clientAccountsStr);
            const account = clientAccounts[activeLoginid];
            
            if (!account) {
                return null;
            }
            
            // Use liveBalance if available, otherwise fall back to stored balance
            const displayBalance = liveBalance !== null ? liveBalance : (account.balance || 0);
            
            return {
                loginid: activeLoginid,
                currency: account.currency || currency || 'USD',
                balance: displayBalance,
                is_virtual: account.account_type === 'demo',
                currencyLabel: account.account_type === 'demo' ? 'Demo' : account.currency,
                icon: null,
                displayBalance: `${displayBalance.toFixed(2)} ${account.currency || currency || 'USD'}`,
                balanceDelta: balanceDelta,
            };
        } catch (e) {
            console.error('[Header] Error getting OAuth active account:', e);
            return null;
        }
    };
    
    const checkOAuthStatus = () => {
        const authType = localStorage.getItem('auth_type');
        const token = localStorage.getItem('authToken');
        const clientAccounts = localStorage.getItem('clientAccounts');
        
        const isOAuthActive = !!(token && authType === 'oauth' && clientAccounts);
        setIsOAuth(isOAuthActive);
        
        if (isOAuthActive) {
            const activeAccount = getOAuthActiveAccount();
            setOauthActiveAccount(activeAccount);
            console.log('[Header] OAuth active account:', activeAccount);
        } else {
            setOauthActiveAccount(null);
        }
        
        return isOAuthActive;
    };
    
    useEffect(() => {
        checkOAuthStatus();
        
        const handleStorageChange = (event: StorageEvent) => {
            if (event.key === 'clientAccounts' || event.key === 'auth_type' || event.key === 'authToken' || event.key === 'active_loginid') {
                console.log('[Header] Storage changed, re-checking OAuth status');
                checkOAuthStatus();
                setForceUpdate(prev => prev + 1);
            }
        };
        
        const handleOAuthComplete = (event: CustomEvent) => {
            console.log('[Header] OAuth complete event received:', event.detail);
            setTimeout(() => {
                checkOAuthStatus();
                setForceUpdate(prev => prev + 1);
            }, 100);
        };
        
        window.addEventListener('storage', handleStorageChange);
        window.addEventListener('oauth-login-complete', handleOAuthComplete as EventListener);
        
        return () => {
            window.removeEventListener('storage', handleStorageChange);
            window.removeEventListener('oauth-login-complete', handleOAuthComplete as EventListener);
        };
    }, [liveBalance, currency, balanceDelta]); // Re-run when balance updates
    
    const handleSwiftCashRedirect = () => {
        window.open('https://app.swiftcashfx.com/', '_blank', 'noopener,noreferrer');
    };

    const handleLegacyLogin = () => {
        window.location.replace('https://oauth.deriv.com/oauth2/authorize?app_id=101761&l=EN&brand=nyanyukisites');
    };

    const handleSecureOAuthLogin = async () => {
        const clientId = '3373S5Dny6niTFbyNDipt';
        const redirectUri = 'https://nyanyukisites.pages.dev/callback';
        const scope = 'trade account_manage';

        const codeVerifier = generateCodeVerifier();
        const codeChallenge = await generateCodeChallenge(codeVerifier);
        const state = generateState();

        sessionStorage.setItem('pkce_code_verifier', codeVerifier);
        sessionStorage.setItem('oauth_state', state);

        const params = new URLSearchParams({
            response_type: 'code',
            client_id: clientId,
            redirect_uri: redirectUri,
            scope,
            state,
            code_challenge: codeChallenge,
            code_challenge_method: 'S256',
        });

        const authUrl = `https://auth.deriv.com/oauth2/auth?${params.toString()}`;
        console.log('[Header] OAuth Redirect:', authUrl);
        window.location.assign(authUrl);
    };

    const renderAccountSection = () => {
        if (isOAuth && oauthActiveAccount) {
            return <AccountSwitcher activeAccount={oauthActiveAccount} />;
        } else if (!isOAuth) {
            return (
                <div className='auth-actions'>
                    <Button tertiary className="login-button-red" onClick={handleLegacyLogin}>
                        <Localize i18n_default_text='Legacy Login' />
                    </Button>
                    <Button tertiary className="login-button-green" onClick={handleSecureOAuthLogin}>
                        <Localize i18n_default_text='Secure Login' />
                    </Button>
                    <Button primary onClick={() => window.open(standalone_routes.signup)}>
                        <Localize i18n_default_text='Sign up' />
                    </Button>
                </div>
            );
        }
        return null;
    };

    return (
        <Header className={clsx('app-header', { 'app-header--desktop': isDesktop, 'app-header--mobile': !isDesktop })}>
            <Wrapper variant='left'>
                <AppLogo />
                <MobileMenu />
                {isDesktop && (
                    <div className="brand-text">
                        <span className="brand-text__name">Nyanyuki.site</span>
                        <span className="brand-text__powered">Powered by <span>Deriv</span></span>
                    </div>
                )}
                <InfoIcon />
            </Wrapper>
            <Wrapper variant='right'>
                {isOAuth && oauthActiveAccount && (
                    <div className="swiftcash-buttons">
                        <button className="swiftcash-button swiftcash-button--deposit" onClick={handleSwiftCashRedirect}>
                            Deposit
                        </button>
                        <button className="swiftcash-button swiftcash-button--withdraw" onClick={handleSwiftCashRedirect}>
                            Withdraw
                        </button>
                    </div>
                )}
                {renderAccountSection()}
            </Wrapper>
        </Header>
    );
});

export default AppHeader;