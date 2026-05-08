// src/external/bot-skeleton/services/api/api_base.ts

import CommonStore from '@/stores/common-store';
import { TAuthData } from '@/types/api-types';
import { observer as globalObserver } from '../../utils/observer';
import { doUntilDone, socket_state } from '../tradeEngine/utils/helpers';
import {
    CONNECTION_STATUS,
    setAccountList,
    setAuthData,
    setConnectionStatus,
    setIsAuthorized,
    setIsAuthorizing,
} from './observables/connection-status-stream';
import ApiHelpers from './api-helpers';
import { generateDerivApiInstance, V2GetActiveClientId, V2GetActiveToken } from './appId';
import chart_api from './chart-api';

type CurrentSubscription = {
    id: string;
    unsubscribe: () => void;
};

type SubscriptionPromise = Promise<{
    subscription: CurrentSubscription;
}>;

type TApiBaseApi = {
    connection: {
        readyState: keyof typeof socket_state;
        addEventListener: (event: string, callback: () => void) => void;
        removeEventListener: (event: string, callback: () => void) => void;
    };
    send: (data: unknown) => void;
    disconnect: () => void;
    authorize: (token: string) => Promise<{ authorize: TAuthData; error: unknown }>;
    getSelfExclusion: () => Promise<unknown>;
    onMessage: () => {
        subscribe: (callback: (message: unknown) => void) => {
            unsubscribe: () => void;
        };
    };
} & ReturnType<typeof generateDerivApiInstance>;

class APIBase {
    api: TApiBaseApi | null = null;
    token: string = '';
    account_id: string = '';
    pip_sizes = {};
    account_info = {};
    is_running = false;
    subscriptions: CurrentSubscription[] = [];
    time_interval: ReturnType<typeof setInterval> | null = null;
    has_active_symbols = false;
    is_stopping = false;
    active_symbols = [];
    current_auth_subscriptions: SubscriptionPromise[] = [];
    is_authorized = false;
    active_symbols_promise: Promise<void> | null = null;
    common_store: CommonStore | undefined;
    landing_company: string | null = null;

    // Helper to check if user is OAuth
    private isOAuthUser(): boolean {
        const authType = localStorage.getItem('auth_type');
        const authToken = localStorage.getItem('authToken');
        const clientAccounts = localStorage.getItem('clientAccounts');
        return authType === 'oauth' && !!authToken && !!clientAccounts;
    }

    unsubscribeAllSubscriptions = () => {
        this.current_auth_subscriptions?.forEach(subscription_promise => {
            subscription_promise.then(({ subscription }) => {
                if (subscription?.id) {
                    this.api?.send({
                        forget: subscription.id,
                    });
                }
            });
        });
        this.current_auth_subscriptions = [];
    };

    onsocketopen() {
        setConnectionStatus(CONNECTION_STATUS.OPENED);
    }

    onsocketclose() {
        setConnectionStatus(CONNECTION_STATUS.CLOSED);
        this.reconnectIfNotConnected();
    }

    async init(force_create_connection = false) {
        this.toggleRunButton(true);

        // OAuth users: skip legacy WS init, use derivWS instead
        if (this.isOAuthUser()) {
            console.log('[APIBase] OAuth user detected, skipping legacy API initialization');
            this.toggleRunButton(false);
            setConnectionStatus(CONNECTION_STATUS.OPENED);
            setIsAuthorized(true);

            // Ensure active_symbols_promise is always set for OAuth
            // so that ActiveSymbols.retrieveActiveSymbols() doesn't hang
            if (!this.has_active_symbols) {
                this.active_symbols_promise = this.getActiveSymbols() as Promise<void>;
            }
            return;
        }

        // Legacy initialization
        if (this.api) {
            this.unsubscribeAllSubscriptions();
        }

        if (!this.api || this.api?.connection.readyState !== 1 || force_create_connection) {
            if (this.api?.connection) {
                ApiHelpers.disposeInstance();
                setConnectionStatus(CONNECTION_STATUS.CLOSED);
                this.api.disconnect();
                this.api.connection.removeEventListener('open', this.onsocketopen.bind(this));
                this.api.connection.removeEventListener('close', this.onsocketclose.bind(this));
            }
            this.api = generateDerivApiInstance();
            this.api?.connection.addEventListener('open', this.onsocketopen.bind(this));
            this.api?.connection.addEventListener('close', this.onsocketclose.bind(this));
        }

        if (!this.has_active_symbols && !V2GetActiveToken()) {
            this.active_symbols_promise = this.getActiveSymbols() as Promise<void>;
        }

        this.initEventListeners();

        if (this.time_interval) clearInterval(this.time_interval);
        this.time_interval = null;

        if (V2GetActiveToken()) {
            setIsAuthorizing(true);
            await this.authorizeAndSubscribe();
        }

        chart_api.init(force_create_connection);
    }

    getConnectionStatus() {
        if (this.api?.connection) {
            const ready_state = this.api.connection.readyState;
            return socket_state[ready_state as keyof typeof socket_state] || 'Unknown';
        }
        return 'Socket not initialized';
    }

    terminate() {
        if (this.api) this.api.disconnect();
    }

    initEventListeners() {
        if (window) {
            window.addEventListener('online', this.reconnectIfNotConnected);
            window.addEventListener('focus', this.reconnectIfNotConnected);
        }
    }

    async createNewInstance(account_id: string) {
        if (this.account_id !== account_id) {
            await this.init();
        }
    }

    reconnectIfNotConnected = () => {
        // Skip for OAuth users - they use derivWS for connection
        if (this.isOAuthUser()) {
            console.log('[APIBase] OAuth user, skipping reconnect');
            return;
        }

        console.log('connection state: ', this.api?.connection?.readyState);
        if (this.api?.connection?.readyState && this.api?.connection?.readyState > 1) {
            console.log('Info: Connection to the server was closed, trying to reconnect.');
            this.init(true);
        }
    };

    async authorizeAndSubscribe() {
        // Skip for OAuth users
        if (this.isOAuthUser()) {
            console.log('[APIBase] OAuth user, skipping authorizeAndSubscribe');
            return;
        }

        const token = V2GetActiveToken();
        if (token) {
            this.token = token;
            this.account_id = V2GetActiveClientId() ?? '';

            if (!this.api) return;

            try {
                const { authorize, error } = await this.api.authorize(this.token);
                if (error) return error;

                if (this.has_active_symbols) {
                    this.toggleRunButton(false);
                } else {
                    this.active_symbols_promise = this.getActiveSymbols() as Promise<void>;
                }
                this.account_info = authorize;
                setAccountList(authorize.account_list);
                setAuthData(authorize);
                setIsAuthorized(true);
                this.is_authorized = true;
                this.subscribe();
                this.getSelfExclusion();
            } catch (e) {
                this.is_authorized = false;
                setIsAuthorized(false);
                globalObserver.emit('Error', e);
            } finally {
                setIsAuthorizing(false);
            }
        }
    }

    async getSelfExclusion() {
        if (!this.api || !this.is_authorized) return;
        if (this.isOAuthUser()) return;
        await this.api.getSelfExclusion();
    }

    async subscribe() {
        // Skip for OAuth users - subscriptions handled by derivWS
        if (this.isOAuthUser()) {
            console.log('[APIBase] OAuth user, skipping legacy subscriptions');
            return;
        }

        const subscribeToStream = (streamName: string) => {
            return doUntilDone(
                () => {
                    const subscription = this.api?.send({
                        [streamName]: 1,
                        subscribe: 1,
                        ...(streamName === 'balance' ? { account: 'all' } : {}),
                    });
                    if (subscription) {
                        this.current_auth_subscriptions.push(subscription);
                    }
                    return subscription;
                },
                [],
                this
            );
        };

        const streamsToSubscribe = ['balance', 'transaction', 'proposal_open_contract'];
        await Promise.all(streamsToSubscribe.map(subscribeToStream));
    }

    getActiveSymbols = async () => {
        // OAuth path: pull symbols from derivWS which already fetched them
        if (this.isOAuthUser()) {
            // Return immediately if already populated
            if (this.active_symbols.length) {
                this.has_active_symbols = true;
                this.toggleRunButton(false);
                return this.active_symbols;
            }

            try {
                // derivWS singleton already fetched symbols during initialize()
                // Import dynamically to avoid circular deps
                const { default: derivWS } = await import('../derivWS');

                let symbols = derivWS.getActiveSymbolsList();

                if (!symbols || symbols.length === 0) {
                    console.log('[APIBase] derivWS symbols not ready yet, fetching now...');
                    symbols = await derivWS.getActiveSymbols();
                }

                if (symbols && symbols.length > 0) {
                    const pip_sizes: Record<string, number> = {};
                    symbols.forEach(({ symbol, pip }: { symbol: string; pip: string }) => {
                        pip_sizes[symbol] = +(+pip).toExponential().substring(3);
                    });
                    this.pip_sizes = pip_sizes;
                    this.active_symbols = symbols;
                    this.has_active_symbols = true;
                    this.toggleRunButton(false);
                    console.log(`[APIBase] OAuth: loaded ${symbols.length} active symbols from derivWS`);
                } else {
                    console.warn('[APIBase] OAuth: derivWS returned no active symbols');
                }
            } catch (error) {
                console.error('[APIBase] OAuth: failed to load active symbols from derivWS:', error);
            }

            return this.active_symbols;
        }

        // Legacy path: fetch via WebSocket API
        await doUntilDone(() => this.api?.send({ active_symbols: 'brief' }), [], this).then(
            ({ active_symbols = [], error = {} }) => {
                const pip_sizes = {};
                if (active_symbols.length) this.has_active_symbols = true;
                active_symbols.forEach(({ symbol, pip }: { symbol: string; pip: string }) => {
                    (pip_sizes as Record<string, number>)[symbol] = +(+pip).toExponential().substring(3);
                });
                this.pip_sizes = pip_sizes as Record<string, number>;
                this.toggleRunButton(false);
                this.active_symbols = active_symbols;
                return active_symbols || error;
            }
        );
    };

    toggleRunButton = (toggle: boolean) => {
        const run_button = document.querySelector('#db-animation__run-button');
        if (!run_button) return;
        (run_button as HTMLButtonElement).disabled = toggle;
    };

    setIsRunning(toggle = false) {
        this.is_running = toggle;
    }

    pushSubscription(subscription: CurrentSubscription) {
        this.subscriptions.push(subscription);
    }

    clearSubscriptions() {
        this.subscriptions.forEach(s => s.unsubscribe());
        this.subscriptions = [];

        const global_timeouts = globalObserver.getState('global_timeouts') ?? [];
        global_timeouts.forEach((_: unknown, i: number) => {
            clearTimeout(i);
        });
    }
}

export const api_base = new APIBase();