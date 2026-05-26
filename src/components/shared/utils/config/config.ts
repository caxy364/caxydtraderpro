import { LocalStorageConstants, LocalStorageUtils, URLUtils } from '@deriv-com/utils';
import { isStaging } from '../url/helpers';
import { deriv_urls } from '../url/constants';
import { DERIV_APP_ID } from '@/constants/deriv-app-config';

/**
 * =========================================================
 * SINGLE SOURCE OF TRUTH — CRITICAL CONSTANTS
 * =========================================================
 */

export const LEGACY_APP_ID = '111670';
export const OAUTH_CLIENT_ID = '32UpAZvxBqalqEFHVMTNS';
export const APP_DOMAIN = 'https://europrinter.vercel.app';

const APP_ID_NUM = parseInt(LEGACY_APP_ID, 10);

export const APP_IDS = {
    LOCALHOST:    APP_ID_NUM,
    TMP_STAGING:  APP_ID_NUM,
    STAGING:      APP_ID_NUM,
    STAGING_BE:   APP_ID_NUM,
    STAGING_ME:   APP_ID_NUM,
    PRODUCTION:   APP_ID_NUM,
    PRODUCTION_BE: APP_ID_NUM,
    PRODUCTION_ME: APP_ID_NUM,
    LIVE:         APP_ID_NUM,
};

export const livechat_license_id = 12049137;
export const livechat_client_id = '66aa088aad5a414484c1fd1fa8a5ace7';

export const domain_app_ids = {
    'master.bot-standalone.pages.dev': APP_IDS.TMP_STAGING,
    'staging-dbot.deriv.com':          APP_IDS.STAGING,
    'staging-dbot.deriv.be':           APP_IDS.STAGING_BE,
    'staging-dbot.deriv.me':           APP_IDS.STAGING_ME,
    'dbot.deriv.com':                  APP_IDS.PRODUCTION,
    'dbot.deriv.be':                   APP_IDS.PRODUCTION_BE,
    'dbot.deriv.me':                   APP_IDS.PRODUCTION_ME,
    'bot.derivlite.com':               APP_IDS.LIVE,
    'europrinter.vercel.app':          APP_IDS.LIVE,
};

export const getCurrentProductionDomain = () =>
    !/^staging\./.test(window.location.hostname) &&
    Object.keys(domain_app_ids).find(domain => window.location.hostname === domain);

export const isLocal = () => /localhost(:\d+)?$/i.test(window.location.hostname);

export const isProduction = (): boolean => {
    if (window.location.hostname === 'europrinter.vercel.app') return true;
    const all_domains = Object.keys(domain_app_ids).map(domain => `(www\\.)?${domain.replace('.', '\\.')}`);
    return new RegExp(`^(${all_domains.join('|')})$`, 'i').test(window.location.hostname);
};

export const isTestLink = (): boolean => {
    return (
        window.location.origin.includes('.vercel.app') ||
        window.location.origin.includes('.binary.sx') ||
        window.location.origin.includes('bot-65f.pages.dev') ||
        isLocal()
    );
};

/**
 * =========================================================
 * APP ID — STRICT VALIDATION (LEGACY SAFETY LOCK)
 * =========================================================
 * Only LEGACY_APP_ID (111670) is valid for WebSocket flows.
 * OAUTH_CLIENT_ID is a separate credential — never mixed here.
 * Any other value (61554, 69811, etc.) is rejected immediately.
 */
export const getAppId = (): string => {
    let app_id = window.localStorage.getItem('config.app_id');

    if (app_id !== LEGACY_APP_ID) {
        if (app_id) {
            console.warn(`[CONFIG] Stale/invalid App ID "${app_id}" detected — resetting to ${LEGACY_APP_ID}`);
        }
        app_id = LEGACY_APP_ID;
        window.localStorage.setItem('config.app_id', app_id);
    }

    return app_id;
};

/**
 * =========================================================
 * LOCALSTORAGE CLEANUP — ANTI-CLUTTER GUARD
 * =========================================================
 * Call once on app boot to remove stale or injected IDs.
 */
export const sanitizeConfigStorage = () => {
    const storedAppId = window.localStorage.getItem('config.app_id');

    if (!storedAppId || storedAppId !== LEGACY_APP_ID) {
        if (storedAppId) {
            console.warn(`[CONFIG] sanitizeConfigStorage: removing bad App ID "${storedAppId}"`);
        }
        window.localStorage.setItem('config.app_id', LEGACY_APP_ID);
    }

    if (!window.localStorage.getItem('config.server_url')) {
        window.localStorage.setItem('config.server_url', getDefaultServerURL());
    }
};

/**
 * =========================================================
 * SERVER SELECTION
 * =========================================================
 */
const getDefaultServerURL = (): string => {
    if (isTestLink()) return 'ws.derivws.com';

    const searchParams = new URLSearchParams(window.location.search);
    const active_loginid_from_url = searchParams.get('acct1');
    const loginid = window.localStorage.getItem('active_loginid') ?? active_loginid_from_url;
    const is_real = loginid && !/^(VRT|VRW)/.test(loginid);

    return `${is_real ? 'green' : 'blue'}.derivws.com`;
};

export const getDefaultAppIdAndUrl = () => {
    const server_url = getDefaultServerURL();
    const app_id = getAppId();
    return { app_id: parseInt(app_id, 10), server_url };
};

export const getSocketURL = (): string =>
    window.localStorage.getItem('config.server_url') ?? getDefaultServerURL();

export const checkAndSetEndpointFromUrl = () => {
    if (!isTestLink()) return false;

    const url_params = new URLSearchParams(location.search.slice(1));

    if (url_params.has('qa_server') && url_params.has('app_id')) {
        const qa_server = url_params.get('qa_server') || '';
        const app_id = url_params.get('app_id') || '';

        url_params.delete('qa_server');
        url_params.delete('app_id');

        if (/^(www\.)?qa[0-9]{1,4}\.deriv.dev|(.*)\.derivws\.com$/.test(qa_server) && /^[0-9]+$/.test(app_id)) {
            localStorage.setItem('config.app_id', LEGACY_APP_ID);
            localStorage.setItem('config.server_url', qa_server.replace(/"/g, ''));
        }

        const params = url_params.toString();
        location.href = `${location.origin}${location.pathname}${params ? `?${params}` : ''}${location.hash || ''}`;
        return true;
    }

    return false;
};

export const getDebugServiceWorker = () => !!parseInt(window.localStorage.getItem('debug_service_worker') || '0');

/**
 * =========================================================
 * OAUTH URL GENERATION
 * =========================================================
 * Uses OAUTH_CLIENT_ID — never mixed with LEGACY_APP_ID.
 * Always enforces europrinter.vercel.app as redirect domain.
 */
export const generateOAuthURL = (): string => {
    const { getOauthURL } = URLUtils;
    const oauth_url = new URL(getOauthURL());

    oauth_url.searchParams.set('client_id', OAUTH_CLIENT_ID);
    oauth_url.searchParams.set('redirect_uri', `${APP_DOMAIN}/callback`);

    const configured_server_url =
        LocalStorageUtils.getValue(LocalStorageConstants.configServerURL) ||
        localStorage.getItem('config.server_url') ||
        '';

    const valid_server_urls = ['green.derivws.com', 'red.derivws.com', 'blue.derivws.com'];
    if (configured_server_url && valid_server_urls.includes(configured_server_url)) {
        oauth_url.hostname = configured_server_url;
    }

    return oauth_url.toString();
};
