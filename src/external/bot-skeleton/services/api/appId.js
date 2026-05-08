import { getSocketURL } from '@/components/shared';
import { website_name } from '@/utils/site-config';
import DerivAPIBasic from '@deriv/deriv-api/dist/DerivAPIBasic';
import { getInitialLanguage } from '@deriv-com/translations';
import APIMiddleware from './api-middleware';

export const generateDerivApiInstance = () => {
    // Your specific App ID
    const MY_APP_ID = '117013';
    
    // We prioritize your ID, but allow a query param 'app_id' in the URL to override it for testing
    const query_params = new URLSearchParams(window.location.search);
    const cleanedAppId = query_params.get('app_id') || MY_APP_ID;
    
    const socket_url = `wss://ws.binaryws.com/websockets/v3?app_id=${cleanedAppId}&l=${getInitialLanguage()}&brand=${website_name.toLowerCase()}`;
    
    const deriv_socket = new WebSocket(socket_url);
    const deriv_api = new DerivAPIBasic({
        connection: deriv_socket,
        middleware: new APIMiddleware({}),
    });
    return deriv_api;
};

export const getLoginId = () => {
    const login_id = localStorage.getItem('active_loginid');
    if (login_id && login_id !== 'null') return login_id;
    return null;
};

export const V2GetActiveToken = () => {
    const token = localStorage.getItem('authToken');
    if (token && token !== 'null') return token;
    return null;
};

export const V2GetActiveClientId = () => {
    const token = V2GetActiveToken();
    if (!token) return null;
    
    try {
        const account_list = JSON.parse(localStorage.getItem('accountsList') || '{}');
        if (account_list && account_list !== 'null') {
            const active_clientId = Object.keys(account_list).find(key => account_list[key] === token);
            return active_clientId;
        }
    } catch (e) {
        return null;
    }
    return null;
};

export const getToken = () => {
    const active_loginid = getLoginId();
    let client_accounts = {};
    
    try {
        client_accounts = JSON.parse(localStorage.getItem('accountsList') || '{}');
    } catch (e) {
        client_accounts = {};
    }

    const active_token = (client_accounts && client_accounts[active_loginid]) || '';
    
    return {
        token: active_token || undefined,
        account_id: active_loginid || undefined,
    };
};