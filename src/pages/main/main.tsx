import React, { lazy, Suspense, useEffect, useState, useCallback } from 'react';
import { observer } from 'mobx-react-lite';
import ChunkLoader from '@/components/loader/chunk-loader';
import DesktopWrapper from '@/components/shared_ui/desktop-wrapper';
import Dialog from '@/components/shared_ui/dialog';
import MobileWrapper from '@/components/shared_ui/mobile-wrapper';
import Tabs from '@/components/shared_ui/tabs/tabs';
import TradingViewModal from '@/components/trading-view-chart/trading-view-modal';
import { DBOT_TABS } from '@/constants/bot-contents';
import { api_base, updateWorkspaceName } from '@/external/bot-skeleton';
import { CONNECTION_STATUS } from '@/external/bot-skeleton/services/api/observables/connection-status-stream';
import { useApiBase } from '@/hooks/useApiBase';
import { useStore } from '@/hooks/useStore';
import { Localize, localize } from '@deriv-com/translations';
import { useDevice } from '@deriv-com/ui';
import RunPanel from '../../components/run-panel';
import ChartModal from '../chart/chart-modal';
import Dashboard from '../dashboard';
import RunStrategy from '../dashboard/run-strategy';

// --- Lazy Components ---
const Chart = lazy(() => import('../chart'));
const Tutorial = lazy(() => import('../tutorials'));

// These files need to be created in the same directory
const NyanyukiPro = lazy(() => import('./NyanyukiPro'));
const DigitCircleTool = lazy(() => import('./DigitCircleTool'));

// Helper to check if user is using OAuth
const isOAuthUser = (): boolean => {
    const authType = localStorage.getItem('auth_type');
    const accessToken = localStorage.getItem('deriv_access_token');
    return authType === 'oauth' && !!accessToken;
};

// Helper to check if WebSocket is connected (works for both legacy and OAuth)
const isWebSocketConnected = (connectionStatus: string): boolean => {
    // For OAuth users, check if derivWS is connected
    if (isOAuthUser()) {
        const derivWS = (window as any).derivWS;
        if (derivWS) {
            return derivWS.isDemoConnected?.() || derivWS.isRealConnected?.();
        }
        return false;
    }
    
    // For legacy users, check connection status
    return connectionStatus === CONNECTION_STATUS.OPENED;
};

// Get App ID dynamically
const getAppId = (): string => {
    if (isOAuthUser()) {
        return localStorage.getItem('deriv_app_id') || 
               localStorage.getItem('oauth_client_id') || 
               '117013';
    }
    return '117013';
};

// --- Modern Icons with Gradient Colors ---
const DashboardIcon = () => (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M3 13h8V3H3v10zm0 8h8v-6H3v6zm10 0h8V11h-8v10zm0-18v6h8V3h-8z" fill="url(#dashboard-gradient)" />
        <defs>
            <linearGradient id="dashboard-gradient" x1="3" y1="3" x2="21" y2="21" gradientUnits="userSpaceOnUse">
                <stop stopColor="#FF6B6B" />
                <stop offset="1" stopColor="#FF8E8E" />
            </linearGradient>
        </defs>
    </svg>
);

const BotBuilderIcon = () => (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path fillRule="evenodd" clipRule="evenodd" d="M20,9.85714286 L20,14.1428571 C20,15.2056811 19.0732946,16 18,16 L6,16 C4.92670537,16 4,15.2056811 4,14.1428571 L4,9.85714286 C4,8.79431889 4.92670537,8 6,8 L18,8 C19.0732946,8 20,8.79431889 20,9.85714286 Z M6,10 L6,14 L18,14 L18,10 L6,10 Z M2,19 L2,17 L22,17 L22,19 L2,19 Z M2,7 L2,5 L22,5 L22,7 L2,7 Z" fill="url(#botbuilder-gradient)" />
        <defs>
            <linearGradient id="botbuilder-gradient" x1="2" y1="5" x2="22" y2="19" gradientUnits="userSpaceOnUse">
                <stop stopColor="#4ECDC4" />
                <stop offset="1" stopColor="#45B7D1" />
            </linearGradient>
        </defs>
    </svg>
);

const DTraderIcon = () => (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M12 2L2 7L12 12L22 7L12 2Z" fill="url(#dtrader-gradient1)" />
        <path d="M2 17L12 22L22 17" fill="url(#dtrader-gradient2)" />
        <path d="M2 12L12 17L22 12" fill="url(#dtrader-gradient3)" />
        <circle cx="12" cy="12" r="2" fill="white" />
        <defs>
            <linearGradient id="dtrader-gradient1" x1="2" y1="2" x2="22" y2="12" gradientUnits="userSpaceOnUse">
                <stop stopColor="#2ECC71" />
                <stop offset="1" stopColor="#27AE60" />
            </linearGradient>
            <linearGradient id="dtrader-gradient2" x1="2" y1="17" x2="22" y2="22" gradientUnits="userSpaceOnUse">
                <stop stopColor="#27AE60" />
                <stop offset="1" stopColor="#2ECC71" />
            </linearGradient>
            <linearGradient id="dtrader-gradient3" x1="2" y1="12" x2="22" y2="17" gradientUnits="userSpaceOnUse">
                <stop stopColor="#2ECC71" />
                <stop offset="1" stopColor="#27AE60" />
            </linearGradient>
        </defs>
    </svg>
);

const FreeBotsIcon = () => (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M10,13H4a1,1,0,0,0-1,1v6a1,1,0,0,0,1,1h6a1,1,0,0,0,1-1V14A1,1,0,0,0,10,13ZM9,19H5V15H9ZM20,3H14a1,1,0,0,0-1,1v6a1,1,0,0,0,1,1h6a1,1,0,0,0,1-1V4A1,1,0,0,0,20,3ZM19,9H15V5h4Zm1,7H18V14a1,1,0,0,0-2,0v2H14a1,1,0,0,0,0,2h2v2a1,1,0,0,0,2,0V18h2a1,1,0,0,0,0-2ZM10,3H4A1,1,0,0,0,3,4v6a1,1,0,0,0,1,1h6a1,1,0,0,0,1-1V4A1,1,0,0,0,10,3ZM9,9H5V5H9Z" fill="url(#freebots-gradient)" />
        <defs>
            <linearGradient id="freebots-gradient" x1="3" y1="3" x2="21" y2="21" gradientUnits="userSpaceOnUse">
                <stop stopColor="#F39C12" />
                <stop offset="1" stopColor="#E67E22" />
            </linearGradient>
        </defs>
    </svg>
);

const AnalysisToolIcon = () => (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M7.5 3.5V6.5" stroke="url(#analysis-gradient)" strokeWidth="2" strokeLinecap="round" />
        <path d="M7.5 14.5V18.5" stroke="url(#analysis-gradient)" strokeWidth="2" strokeLinecap="round" />
        <path d="M6.8 6.5C6.08203 6.5 5.5 7.08203 5.5 7.8V13.2C5.5 13.918 6.08203 14.5 6.8 14.5H8.2C8.91797 14.5 9.5 13.918 9.5 13.2V7.8C9.5 7.08203 8.91797 6.5 8.2 6.5H6.8Z" stroke="url(#analysis-gradient)" strokeWidth="2" />
        <path d="M16.5 6.5V11.5" stroke="url(#analysis-gradient)" strokeWidth="2" strokeLinecap="round" />
        <path d="M16.5 16.5V20.5" stroke="url(#analysis-gradient)" strokeWidth="2" strokeLinecap="round" />
        <path d="M15.8 11.5C15.082 11.5 14.5 12.082 14.5 12.8V15.2C14.5 15.918 15.082 16.5 15.8 16.5H17.2C17.918 16.5 18.5 15.918 18.5 15.2V12.8C18.5 12.082 17.918 11.5 17.2 11.5H15.8Z" stroke="url(#analysis-gradient)" strokeWidth="2" />
        <defs>
            <linearGradient id="analysis-gradient" x1="5.5" y1="3.5" x2="18.5" y2="20.5" gradientUnits="userSpaceOnUse">
                <stop stopColor="#F1C40F" />
                <stop offset="1" stopColor="#F39C12" />
            </linearGradient>
        </defs>
    </svg>
);

const DigitCircleIcon = () => (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
        <circle cx="12" cy="12" r="9" stroke="url(#digit-gradient)" strokeWidth="2" />
        <path d="M12 7V12L15 15" stroke="url(#digit-gradient)" strokeWidth="2" strokeLinecap="round" />
        <defs>
            <linearGradient id="digit-gradient" x1="3" y1="3" x2="21" y2="21" gradientUnits="userSpaceOnUse">
                <stop stopColor="#9B59B6" />
                <stop offset="1" stopColor="#8E44AD" />
            </linearGradient>
        </defs>
    </svg>
);

const SignalsIcon = () => (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M8 6.00067L21 6.00139M8 12.0007L21 12.0015M8 18.0007L21 18.0015M3.5 6H3.51M3.5 12H3.51M3.5 18H3.51M4 6C4 6.27614 3.77614 6.5 3.5 6.5C3.22386 6.5 3 6.27614 3 6C3 5.72386 3.22386 5.5 3.5 5.5C3.77614 5.5 4 5.72386 4 6ZM4 12C4 12.2761 3.77614 12.5 3.5 12.5C3.22386 12.5 3 12.2761 3 12C3 11.7239 3.22386 11.5 3.5 11.5C3.77614 11.5 4 11.7239 4 12ZM4 18C4 18.2761 3.77614 18.5 3.5 18.5C3.22386 18.5 3 18.2761 3 18C3 17.7239 3.22386 17.5 3.5 17.5C3.77614 17.5 4 17.7239 4 18Z" stroke="url(#signals-gradient)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        <defs>
            <linearGradient id="signals-gradient" x1="3" y1="5.5" x2="21" y2="18.5" gradientUnits="userSpaceOnUse">
                <stop stopColor="#E74C3C" />
                <stop offset="1" stopColor="#C0392B" />
            </linearGradient>
        </defs>
    </svg>
);

const TradingHubIcon = () => (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M21.49 13.926l-3.273 2.48c.054-.663.116-1.435.143-2.275.04-.89.023-1.854-.043-2.835-.043-.487-.097-.98-.184-1.467-.077-.485-.196-.982-.31-1.39-.238-.862-.535-1.68-.9-2.35-.352-.673-.786-1.173-1.12-1.462-.172-.144-.31-.248-.414-.306l-.153-.093c-.083-.05-.187-.056-.275-.003-.13.08-.175.252-.1.388l.01.02s.11.198.258.54c.07.176.155.38.223.63.08.24.14.528.206.838.063.313.114.66.17 1.03l.15 1.188c.055.44.106.826.13 1.246.03.416.033.85.026 1.285.004.872-.063 1.76-.115 2.602-.062.853-.12 1.65-.172 2.335 0 .04-.004.073-.005.11l-.115-.118-2.996-3.028-1.6.454 5.566 6.66 6.394-5.803-1.503-.677z" fill="url(#trading-gradient1)" />
        <path d="M2.503 9.48L5.775 7c-.054.664-.116 1.435-.143 2.276-.04.89-.023 1.855.043 2.835.043.49.097.98.184 1.47.076.484.195.98.31 1.388.237.862.534 1.68.9 2.35.35.674.785 1.174 1.12 1.463.17.145.31.25.413.307.1.06.152.093.152.093.083.05.187.055.275.003.13-.08.175-.252.1-.388l-.01-.02s-.11-.2-.258-.54c-.07-.177-.155-.38-.223-.63-.082-.242-.14-.528-.207-.84-.064-.312-.115-.658-.172-1.027-.046-.378-.096-.777-.15-1.19-.053-.44-.104-.825-.128-1.246-.03-.415-.033-.85-.026-1.285-.004-.872.063-1.76.115-2.603.064-.853.122-1.65.174-2.334 0-.04.004-.074.005-.11l.114.118 2.996 3.027 1.6-.454L7.394 3 1 8.804l1.503.678z" fill="url(#trading-gradient2)" />
        <defs>
            <linearGradient id="trading-gradient1" x1="1" y1="3" x2="22" y2="22" gradientUnits="userSpaceOnUse">
                <stop stopColor="#3498DB" />
                <stop offset="1" stopColor="#2980B9" />
            </linearGradient>
            <linearGradient id="trading-gradient2" x1="1" y1="3" x2="22" y2="22" gradientUnits="userSpaceOnUse">
                <stop stopColor="#2980B9" />
                <stop offset="1" stopColor="#3498DB" />
            </linearGradient>
        </defs>
    </svg>
);

const TutorialsIcon = () => (
    <svg width="24" height="24" viewBox="0 0 192 192" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path stroke="url(#tutorial-gradient)" strokeWidth="12" d="M170 96c0-45-4.962-49.999-50-50H72c-45.038.001-50 5-50 50s4.962 49.999 50 50h48c45.038-.001 50-5 50-50Z" />
        <path stroke="url(#tutorial-gradient)" strokeLinecap="round" strokeLinejoin="round" strokeWidth="12" d="m82 74 34 22-34 22" />
        <defs>
            <linearGradient id="tutorial-gradient" x1="22" y1="46" x2="170" y2="146" gradientUnits="userSpaceOnUse">
                <stop stopColor="#1ABC9C" />
                <stop offset="1" stopColor="#16A085" />
            </linearGradient>
        </defs>
    </svg>
);

const ChartsIcon = () => (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M21 21H7.8C6.11984 21 5.27976 21 4.63803 20.673C4.07354 20.3854 3.6146 19.9265 3.32698 19.362C3 18.7202 3 17.8802 3 16.2V3M6 15L10 11L14 15L20 9M20 9V13M20 9H16" stroke="url(#charts-gradient)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        <defs>
            <linearGradient id="charts-gradient" x1="3" y1="3" x2="21" y2="21" gradientUnits="userSpaceOnUse">
                <stop stopColor="#E67E22" />
                <stop offset="1" stopColor="#D35400" />
            </linearGradient>
        </defs>
    </svg>
);

const BotIcon = () => (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8zm-1-13h2v6h-2zm0 8h2v2h-2z" fill="url(#bot-gradient)" />
        <defs>
            <linearGradient id="bot-gradient" x1="2" y1="2" x2="22" y2="22" gradientUnits="userSpaceOnUse">
                <stop stopColor="#95A5A6" />
                <stop offset="1" stopColor="#7F8C8D" />
            </linearGradient>
        </defs>
    </svg>
);

const NyanyukiProIcon = () => (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M12 2L2 7L12 12L22 7L12 2Z" stroke="url(#nyanyuki-gradient1)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M2 17L12 22L22 17" stroke="url(#nyanyuki-gradient2)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M2 12L12 17L22 12" stroke="url(#nyanyuki-gradient3)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        <circle cx="12" cy="12" r="2" fill="url(#nyanyuki-gradient4)" />
        <defs>
            <linearGradient id="nyanyuki-gradient1" x1="2" y1="2" x2="22" y2="12" gradientUnits="userSpaceOnUse">
                <stop stopColor="#FF6B6B" />
                <stop offset="1" stopColor="#FF8E8E" />
            </linearGradient>
            <linearGradient id="nyanyuki-gradient2" x1="2" y1="17" x2="22" y2="22" gradientUnits="userSpaceOnUse">
                <stop stopColor="#4ECDC4" />
                <stop offset="1" stopColor="#45B7D1" />
            </linearGradient>
            <linearGradient id="nyanyuki-gradient3" x1="2" y1="12" x2="22" y2="17" gradientUnits="userSpaceOnUse">
                <stop stopColor="#FFE194" />
                <stop offset="1" stopColor="#F1C40F" />
            </linearGradient>
            <linearGradient id="nyanyuki-gradient4" x1="10" y1="10" x2="14" y2="14" gradientUnits="userSpaceOnUse">
                <stop stopColor="#9B59B6" />
                <stop offset="1" stopColor="#8E44AD" />
            </linearGradient>
        </defs>
    </svg>
);

let NYANYUKI_BOT_STOP_HANDLER = null;

// --- DTRADER TAB COMPONENT (Updated for OAuth) ---
const DTraderTab = observer(() => {
    const { client } = useStore();
    
    const loginId = localStorage.getItem('active_loginid') || client.loginid;
    const accountsList = JSON.parse(localStorage.getItem('accountsList') || '{}');
    
    // Get token - works for both OAuth and legacy
    let token = localStorage.getItem('deriv_access_token') || 
                localStorage.getItem('authToken') || 
                accountsList[loginId] || '';
    
    const currency = client.accounts?.[loginId]?.currency || 'USD';
    
    // Use dynamic App ID
    const appId = getAppId();

    const iframeSrc = token
        ? `https://deriv-dtrader.vercel.app/dtrader?acct1=${loginId}&token1=${token}&cur1=${currency}&lang=EN&app_id=${appId}`
        : `https://deriv-dtrader.vercel.app/dtrader`;

    return (
        <iframe
            key={token || 'guest'}
            src={iframeSrc}
            title="DTrader"
            width="100%"
            height="100%"
            style={{
                border: 'none',
                position: 'absolute',
                top: 0,
                left: 0,
                right: 0,
                bottom: 0
            }}
            scrolling="yes"
            allow="fullscreen; clipboard-write; payment"
        />
    );
});

// --- Memoized DTrader Styles ---
const DTraderStyles = React.memo(() => (
    <style>{`
        .dtrader-fullscreen {
            position: relative;
            width: 100%;
            height: calc(100vh - 18rem);
            overflow: hidden;
            background: #ffffff;
            margin-top: 2rem;
            margin-bottom: 2rem;
            border-radius: 12px;
            box-shadow: 0 10px 30px rgba(0, 0, 0, 0.1);
        }
        @media (max-width: 768px) {
            .dtrader-fullscreen {
                height: calc(100vh - 14rem);
                margin-top: 1rem;
                margin-bottom: 1rem;
            }
        }
        .dtrader-fullscreen iframe {
            width: 100% !important;
            height: 100% !important;
            border: none !important;
            border-radius: 12px;
            position: absolute !important;
            top: 0 !important;
            left: 0 !important;
            right: 0 !important;
            bottom: 0 !important;
            z-index: 1;
            transform: scale(0.98);
            transform-origin: center center;
            transition: transform 0.3s ease;
        }
        .dtrader-fullscreen iframe:hover {
            transform: scale(1);
        }
        #id-dtrader .dc-tabs__content {
            padding: 0 !important;
            margin: 0 !important;
            position: relative;
            height: calc(100vh - 8rem);
            display: flex;
            align-items: center;
            justify-content: center;
        }
        @media (max-width: 768px) {
            #id-dtrader .dc-tabs__content {
                height: calc(100vh - 6rem);
            }
        }
        #id-dtrader .dc-tabs__content > div {
            height: auto;
            min-height: 85%;
            max-height: 95%;
            width: 98%;
            margin: 0 auto;
            position: relative;
        }
        @media (min-width: 1024px) {
            .dtrader-fullscreen {
                height: calc(100vh - 16rem);
                max-width: 1400px;
                margin-left: auto;
                margin-right: auto;
            }
            #id-dtrader .dc-tabs__content > div {
                min-height: 90%;
                max-height: 98%;
                width: 95%;
            }
            .dtrader-fullscreen iframe {
                transform: scale(1);
            }
        }
        @media (min-width: 1600px) {
            .dtrader-fullscreen {
                height: calc(100vh - 14rem);
                max-width: 1600px;
            }
        }
        .main__tabs .dc-tabs__item {
            transition: all 0.3s ease;
            border-radius: 10px 10px 0 0;
            margin: 0 2px;
        }
        .main__tabs .dc-tabs__item:hover {
            background: rgba(0, 0, 0, 0.05);
            transform: translateY(-2px);
        }
        .main__tabs .dc-tabs__active {
            background: linear-gradient(145deg, #667eea 0%, #764ba2 100%) !important;
            color: white !important;
            box-shadow: 0 4px 15px rgba(102, 126, 234, 0.3);
        }
        .main__tabs .dc-tabs__active svg {
            filter: brightness(0) invert(1);
        }
        .main__tabs .dc-tabs__active-line {
            background: linear-gradient(90deg, #667eea, #764ba2) !important;
            height: 4px !important;
            border-radius: 4px 4px 0 0;
        }
    `}</style>
));

// --- Memoized Floating Help Tab ---
const FloatingHelpTab = React.memo(() => {
    const [isMobile, setIsMobile] = useState(window.innerWidth < 768);
    
    useEffect(() => {
        const handleResize = () => setIsMobile(window.innerWidth < 768);
        window.addEventListener('resize', handleResize);
        return () => window.removeEventListener('resize', handleResize);
    }, []);
    
    return (
        <a
            href="https://nyanyukiautotradeguide.pages.dev/"
            target="_blank"
            rel="noopener noreferrer"
            style={{
                position: 'fixed',
                bottom: isMobile ? '20px' : '30px',
                right: isMobile ? '20px' : 'auto',
                left: isMobile ? 'auto' : '30px',
                width: isMobile ? '56px' : '64px',
                height: isMobile ? '56px' : '64px',
                borderRadius: '50%',
                background: 'linear-gradient(145deg, #1F2937 0%, #111827 100%)',
                boxShadow: '0 4px 15px rgba(0, 0, 0, 0.2)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                cursor: 'pointer',
                transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
                zIndex: 9999,
                border: '2px solid rgba(255, 255, 255, 0.1)',
                backdropFilter: 'blur(5px)',
                textDecoration: 'none',
                color: 'white',
                fontSize: isMobile ? '28px' : '32px',
                fontWeight: 'bold',
                touchAction: 'manipulation',
                WebkitTapHighlightColor: 'transparent',
                willChange: 'transform',
                transform: 'translateZ(0)',
            }}
            title="Click to view Nyanyuki Bot Guide"
        >
            <span style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                width: '100%',
                height: '100%',
                textShadow: '0 2px 5px rgba(0, 0, 0, 0.3)',
            }}>
                ?
            </span>
        </a>
    );
});

// --- Tab Constants ---
const TAB_INDICES = {
    DASHBOARD: 0,
    BOT_BUILDER: 1,
    DTRADER: 2,
    FREE_BOTS: 3,
    AUTO_TRADES: 4,
    DIGIT_CIRCLE: 5,
    SIGNALS: 6,
    TRADINGVIEW: 7,
    CHARTS: 8,
    TUTORIALS: 9
};

// --- Main AppWrapper Component ---
const AppWrapper = observer(() => {
    const { connectionStatus } = useApiBase();
    const { dashboard, load_modal, run_panel, summary_card } = useStore();
    const {
        active_tab,
        is_chart_modal_visible,
        is_trading_view_modal_visible,
        setActiveTab,
    } = dashboard;
    const { onEntered } = load_modal;
    const { is_dialog_open, dialog_options, onCancelButtonClick, onCloseDialog, onOkButtonClick, stopBot, is_drawer_open } = run_panel;
    const { cancel_button_text, ok_button_text, title, message } = dialog_options as { [key: string]: string };
    const { clear } = summary_card;
    const { DASHBOARD, BOT_BUILDER, ANALYSIS_TOOL, SIGNALS } = DBOT_TABS;
    const { isDesktop } = useDevice();

    const [bots, setBots] = useState<any[]>([]);

    // ✅ Fixed: Updated connection status handling for new API
    useEffect(() => {
        const isConnected = isWebSocketConnected(connectionStatus);
        
        if (!isConnected) {
            const is_bot_running = document.getElementById('db-animation__stop-button') !== null;
            if (is_bot_running) {
                clear();
                stopBot();
                api_base.setIsRunning(false);
            }
        }
    }, [clear, connectionStatus, stopBot]);

    useEffect(() => {
        const fetchBots = async () => {
            const botFiles = [
                'Envy-differ.xml', 'H_L auto vault.xml', 
                'Top-notch 2.xml', 'super_under.xml', 'Auto_c4.xml',
                'Even_odd.xml', 'digit_annalysis.xml', 'over-bot.xml', 'under-8bot.xml', 
                'under7_bulkybot.xml', 'over 2 _over 4 recovery.xml'
            ];
            const botPromises = botFiles.map(async (file) => {
                try {
                    const response = await fetch(file);
                    if (!response.ok) return null;
                    const text = await response.text();
                    return { title: file, xmlContent: text };
                } catch (error) { 
                    console.warn(`[AppWrapper] Failed to fetch bot: ${file}`, error);
                    return null; 
                }
            });
            const bots = (await Promise.all(botPromises)).filter(Boolean);
            setBots(bots);
        };
        fetchBots();
    }, []);

    const handleTabChange = useCallback((tab_index: number) => {
        setActiveTab(tab_index);
    }, [setActiveTab]);

    const handleBotClick = useCallback(async (bot: { xmlContent: string }) => {
        setActiveTab(DBOT_TABS.BOT_BUILDER);
        if (typeof load_modal.loadFileFromContent === 'function') {
            await load_modal.loadFileFromContent(bot.xmlContent);
        }
        updateWorkspaceName(bot.xmlContent);
    }, [setActiveTab, load_modal]);

    const handleOpen = useCallback(async () => {
        await load_modal.loadFileFromRecent();
        setActiveTab(DBOT_TABS.BOT_BUILDER);
    }, [load_modal, setActiveTab]);

    useEffect(() => {
        const handleContextMenu = (e: MouseEvent) => {
            e.preventDefault();
            return false;
        };
        const handleKeyDown = (e: KeyboardEvent) => {
            if (
                e.key === 'F12' ||
                (e.ctrlKey && e.shiftKey && ['I', 'J', 'C', 'K'].includes(e.key)) ||
                (e.ctrlKey && ['U', 'u', 'S', 's'].includes(e.key))
            ) {
                e.preventDefault();
                return false;
            }
        };
        document.addEventListener('contextmenu', handleContextMenu);
        document.addEventListener('keydown', handleKeyDown);
        return () => {
            document.removeEventListener('contextmenu', handleContextMenu);
            document.removeEventListener('keydown', handleKeyDown);
        };
    }, []);

    useEffect(() => {
        const devToolsCheck = () => {
            const threshold = 160;
            if (
                window.outerWidth - window.innerWidth > threshold ||
                window.outerHeight - window.innerHeight > threshold
            ) {
                document.body.innerHTML = '';
                window.location.reload();
            }
        };
        const interval = setInterval(devToolsCheck, 1000);
        return () => clearInterval(interval);
    }, []);

    // Tab visibility guard for WebSocket
    useEffect(() => {
        const handleVisibilityChange = () => {
            const wsEvent = new CustomEvent('tabHidden', { 
                detail: { hidden: document.hidden } 
            });
            window.dispatchEvent(wsEvent);
        };
        document.addEventListener('visibilitychange', handleVisibilityChange);
        return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
    }, []);

    const showRunPanel = [
        DBOT_TABS.BOT_BUILDER,
        TAB_INDICES.CHARTS,
        DBOT_TABS.ANALYSIS_TOOL,
        DBOT_TABS.SIGNALS,
        5
    ].includes(active_tab) && active_tab !== TAB_INDICES.DTRADER;

    return (
        <React.Fragment>
            <DTraderStyles />
            
            <div className='main'>
                <div className='main__container'>
                    <Tabs active_index={active_tab} className='main__tabs' onTabItemChange={onEntered} onTabItemClick={handleTabChange} top>
                        <div label={<><DashboardIcon /><Localize i18n_default_text='Dashboard' /></>} id='id-dbot-dashboard'>
                            <Dashboard handleTabChange={handleTabChange} />
                            <button onClick={handleOpen}>Load Bot</button>
                        </div>

                        <div label={<><BotBuilderIcon /><Localize i18n_default_text='Bot Builder' /></>} id='id-bot-builder' />

                        <div label={<><DTraderIcon /><Localize i18n_default_text='DTrader' /></>} id='id-dtrader'>
                            <div className="dtrader-fullscreen">
                                <DTraderTab />
                            </div>
                        </div>

                        <div label={<><FreeBotsIcon /><Localize i18n_default_text='Free Bots' /></>} id='id-free-bots'>
                            <div className='free-bots'>
                                <h2 className='free-bots__heading'><Localize i18n_default_text='Free Bots' /></h2>
                                <div className='free-bots__content-wrapper'>
                                    <ul className='free-bots__content'>
                                        {bots.map((bot, index) => (
                                            <li className='free-bot' key={index} onClick={() => handleBotClick(bot)}>
                                                <BotIcon />
                                                <div className='free-bot__details'>
                                                    <h3 className='free-bot__title'>{bot.title}</h3>
                                                </div>
                                            </li>
                                        ))}
                                    </ul>
                                </div>
                            </div>
                        </div>

                        <div label={<><AnalysisToolIcon /><Localize i18n_default_text='Auto Trades' /></>} id='id-analysis-tool'>
                            <Suspense fallback={<ChunkLoader message='Loading Auto Trades...' />}>
                                <NyanyukiPro />
                            </Suspense>
                        </div>

                        <div label={<><DigitCircleIcon /><Localize i18n_default_text='Digit Circle' /></>} id='id-digit-circle'>
                            <Suspense fallback={<ChunkLoader message='Loading Digit Circle...' />}>
                                <DigitCircleTool />
                            </Suspense>
                        </div>

                        <div label={<><SignalsIcon /><Localize i18n_default_text='Signals' /></>} id='id-signals'>
                            <div className="signals-fullscreen">
                                <iframe 
                                    src="https://tracktool.netlify.app/signals.html" 
                                    width="100%" 
                                    height="100%" 
                                    style={{ border: 'none', position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }} 
                                    scrolling="yes" 
                                    allow="fullscreen" 
                                    title="Signals"
                                />
                            </div>
                        </div>

                        <div label={<><TradingHubIcon /><Localize i18n_default_text='Tradingview' /></>} id='id-tradingview'>
                            <div className="tradingview-fullscreen">
                                <iframe 
                                    src="https://charts.deriv.com/deriv" 
                                    width="100%" 
                                    height="100%" 
                                    style={{ border: 'none', position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }} 
                                    scrolling="yes" 
                                    allow="fullscreen" 
                                    title="TradingView"
                                />
                            </div>
                        </div>

                        <div label={<><ChartsIcon /><Localize i18n_default_text='Charts' /></>} id='id-charts'>
                            <Suspense fallback={<ChunkLoader message={localize('Please wait, loading chart...')} />}>
                                <Chart show_digits_stats={false} />
                            </Suspense>
                        </div>

                        <div label={<><TutorialsIcon /><Localize i18n_default_text='Tutorials' /></>} id='id-tutorials'>
                            <Suspense fallback={<ChunkLoader message={localize('Please wait, loading tutorials...')} />}>
                                <Tutorial handleTabChange={handleTabChange} />
                            </Suspense>
                        </div>
                    </Tabs>
                </div>
            </div>

            <DesktopWrapper>
                <div className='main__run-strategy-wrapper'>
                    <RunStrategy />
                    {showRunPanel && <RunPanel />}
                </div>
                <ChartModal />
                <TradingViewModal />
            </DesktopWrapper>

            <MobileWrapper>
                {showRunPanel && <RunPanel />}
            </MobileWrapper>

            <Dialog 
                cancel_button_text={cancel_button_text || localize('Cancel')} 
                confirm_button_text={ok_button_text || localize('Ok')} 
                has_close_icon 
                is_visible={is_dialog_open} 
                onCancel={onCancelButtonClick} 
                onClose={onCloseDialog} 
                onConfirm={onOkButtonClick || onCloseDialog} 
                title={title}
            >
                {message}
            </Dialog>

            <FloatingHelpTab />
        </React.Fragment>
    );
});

export default AppWrapper;