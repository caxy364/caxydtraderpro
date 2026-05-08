// src/external/bot-skeleton/services/derivWS.ts

type WSMessage = Record<string, unknown>;
type MessageCallback = (data: any) => void;

class DerivWSService {
    private demoWS: WebSocket | null = null;
    private realWS: WebSocket | null = null;
    private messageHandlers: Map<string, Set<MessageCallback>> = new Map();
    private requestId = 1;
    private isConnectingDemo = false;
    private isConnectingReal = false;
    private demoKeepAliveInterval: NodeJS.Timeout | null = null;
    private realKeepAliveInterval: NodeJS.Timeout | null = null;
    private demoAutoReconnectTimeout: NodeJS.Timeout | null = null;
    private realAutoReconnectTimeout: NodeJS.Timeout | null = null;

    // Subscriptions tracking
    private activeSymbols: any[] = [];
    private pipSizes: Record<string, number> = {};
    private hasActiveSymbols = false;
    private balance: number = 0;
    private currency: string = 'USD';
    private loginid: string = '';

    // Event callbacks for api_base compatibility
    private onOpenCallbacks: Set<() => void> = new Set();
    private onCloseCallbacks: Set<() => void> = new Set();

    // Public getters for trade engine compatibility
    get demoSocket() { return this.demoWS; }
    get realSocket() { return this.realWS; }

    // ==================== CONNECTION STATUS ====================

    isDemoConnected(): boolean {
        return this.demoWS?.readyState === WebSocket.OPEN;
    }

    isRealConnected(): boolean {
        return this.realWS?.readyState === WebSocket.OPEN;
    }

    /**
     * Market data now routes through the demo WS (new API).
     * This replaces the old wss://ws.derivws.com connection.
     */
    isMarketDataConnected(): boolean {
        return this.isDemoConnected();
    }

    getActiveAccountType(): 'demo' | 'real' {
        const activeLoginid = localStorage.getItem('active_loginid');
        return activeLoginid?.startsWith('DOT') ? 'demo' : 'real';
    }

    /**
     * Get the App ID from localStorage (set during OAuth callback)
     */
    private getAppId(): string {
        const appId = localStorage.getItem('deriv_app_id');
        if (!appId) {
            console.warn('[DerivWS] No App ID found in localStorage');
            return 'YOUR_DEFAULT_APP_ID'; // Fallback - replace with your actual App ID
        }
        return appId;
    }

    // ==================== INITIALIZATION ====================

    /**
     * Initialize WebSocket connections for both demo and real accounts.
     * Called from AuthWrapper after OAuth login.
     */
    async initialize(): Promise<void> {
        console.log('[DerivWS] Initializing OAuth WebSocket connections...');

        await Promise.all([
            this.connectDemo(),
            this.connectReal(),
        ]);

        // Active symbols now load through demo WS (new API)
        await this.getActiveSymbols();

        this.subscribeToBalance();
        this.subscribeToTransactions();
        this.subscribeToProposalOpenContract();

        console.log('[DerivWS] OAuth WebSocket connections established');
    }

    // ==================== GENERIC REQUEST/RESPONSE ====================

    /**
     * Send a request and await the typed response.
     *
     * useMarketData=true  → routes through demo WS (new API handles active_symbols, ticks, etc.)
     * useMarketData=false → routes through the active trading WS (buy, sell, balance, etc.)
     */
    sendRequest(message: WSMessage, useMarketData = false): Promise<any> {
        const reqId = this.getNextRequestId();
        message.req_id = reqId;

        let ws: WebSocket | null;

        if (useMarketData) {
            // Market data goes through demo WS — always available even when real is active
            ws = this.demoWS;
            if (!ws || ws.readyState !== WebSocket.OPEN) {
                return Promise.reject(new Error(
                    'Demo WebSocket not open (required for market data on new API)'
                ));
            }
        } else {
            ws = this.getActiveAccountType() === 'demo' ? this.demoWS : this.realWS;
            if (!ws || ws.readyState !== WebSocket.OPEN) {
                return Promise.reject(new Error('Trading WebSocket not open'));
            }
        }

        const msgType = Object.keys(message).find(k => k !== 'req_id') as string;

        return new Promise((resolve, reject) => {
            const handler = (data: any) => {
                if (data.req_id === reqId) {
                    this.removeMessageHandler(msgType, handler);
                    if (data.error) reject(data.error);
                    else resolve(data);
                }
            };

            this.addMessageHandler(msgType, handler);
            ws!.send(JSON.stringify(message));

            setTimeout(() => {
                this.removeMessageHandler(msgType, handler);
                reject(new Error(`${msgType} request timed out`));
            }, 15000);
        });
    }

    // ==================== API METHODS ====================

    /**
     * Get active symbols — routes through demo WS (new API).
     * This also populates api_base for compatibility
     */
    async getActiveSymbols(): Promise<any[]> {
        if (this.hasActiveSymbols && this.activeSymbols.length > 0) {
            // Also ensure api_base has them
            if (typeof window !== 'undefined' && (window as any).api_base) {
                (window as any).api_base.active_symbols = this.activeSymbols;
                (window as any).api_base.has_active_symbols = true;
            }
            return this.activeSymbols;
        }

        if (!this.isDemoConnected()) {
            await this.connectDemo();
        }

        const data = await this.sendRequest({ active_symbols: 'brief' }, true);

        const symbols = data.active_symbols;
        const pipSizes: Record<string, number> = {};

        symbols.forEach(({ symbol, pip }: { symbol: string; pip: string }) => {
            pipSizes[symbol] = +(+pip).toExponential().substring(3);
        });

        this.activeSymbols = symbols;
        this.pipSizes = pipSizes;
        this.hasActiveSymbols = true;

        // Populate api_base for ActiveSymbols class
        if (typeof window !== 'undefined' && (window as any).api_base) {
            (window as any).api_base.active_symbols = symbols;
            (window as any).api_base.has_active_symbols = true;
        }

        console.log(`[DerivWS] Loaded ${symbols.length} active symbols`);
        return symbols;
    }

    /**
     * Get contracts for a symbol — routes through demo WS (new API).
     */
    async getContractsFor(symbol: string, currency?: string, landingCompany?: string): Promise<any> {
        if (!this.isDemoConnected()) {
            await this.connectDemo();
        }

        const request: WSMessage = {
            contracts_for: symbol,
            currency: currency || 'USD',
            product_type: 'basic',
        };

        if (landingCompany) {
            request.landing_company = landingCompany;
        }

        return this.sendRequest(request, true);
    }

    /**
     * Get landing company details — routes through demo WS (new API).
     */
    async getLandingCompanyDetails(landingCompany: string): Promise<any> {
        if (!this.isDemoConnected()) {
            await this.connectDemo();
        }

        return this.sendRequest({ landing_company_details: landingCompany }, true);
    }

    /**
     * Subscribe to balance updates and sync with client store.
     */
    subscribeToBalance(): void {
        const reqId = this.getNextRequestId();

        const balanceHandler = (data: any) => {
            if (data.balance) {
                this.balance = data.balance;
                this.currency = data.currency;
                this.loginid = data.loginid;

                try {
                    const balanceData = {
                        balance: data.balance,
                        currency: data.currency,
                        loginid: data.loginid,
                        updated_at: new Date().toISOString(),
                    };
                    localStorage.setItem(`balance_${data.loginid}`, JSON.stringify(balanceData));
                } catch (e) {
                    console.warn('[DerivWS] Could not store balance data:', e);
                }

                window.dispatchEvent(new CustomEvent('balance-update', {
                    detail: {
                        balance: data.balance,
                        currency: data.currency,
                        loginid: data.loginid,
                        msg_type: 'balance',
                    },
                }));
            }
        };

        this.addMessageHandler('balance', balanceHandler);
        this.send({ balance: 1, subscribe: 1, req_id: reqId });
        console.log('[DerivWS] Subscribed to balance updates');
    }

    /**
     * Subscribe to transaction updates.
     */
    subscribeToTransactions(): void {
        const reqId = this.getNextRequestId();

        const transactionHandler = (data: any) => {
            if (data.transaction) {
                try {
                    const loginid = data.transaction.loginid || this.loginid;
                    const txCache = sessionStorage.getItem(`transactions_${loginid}`) || '[]';
                    const transactions = JSON.parse(txCache);
                    transactions.push({
                        ...data.transaction,
                        cached_at: new Date().toISOString(),
                    });
                    sessionStorage.setItem(
                        `transactions_${loginid}`,
                        JSON.stringify(transactions.slice(-100))
                    );
                } catch (e) {
                    console.warn('[DerivWS] Could not cache transaction:', e);
                }

                window.dispatchEvent(new CustomEvent('transaction-update', {
                    detail: { ...data.transaction, msg_type: 'transaction' },
                }));
            }
        };

        this.addMessageHandler('transaction', transactionHandler);
        this.send({ transaction: 1, subscribe: 1, req_id: reqId });
        console.log('[DerivWS] Subscribed to transaction updates');
    }

    /**
     * Subscribe to proposal open contract updates.
     */
    subscribeToProposalOpenContract(): void {
        const reqId = this.getNextRequestId();

        const contractHandler = (data: any) => {
            if (data.proposal_open_contract) {
                const contract = data.proposal_open_contract;
                const loginid = contract.loginid || this.loginid;

                try {
                    const contractCacheKey = `open_contracts_${loginid}`;
                    const cacheStr = sessionStorage.getItem(contractCacheKey) || '[]';
                    const contracts = JSON.parse(cacheStr);
                    const existingIndex = contracts.findIndex(
                        (c: any) => c.contract_id === contract.contract_id
                    );
                    if (existingIndex >= 0) {
                        contracts[existingIndex] = contract;
                    } else {
                        contracts.push(contract);
                    }
                    sessionStorage.setItem(contractCacheKey, JSON.stringify(contracts.slice(-50)));
                } catch (e) {
                    console.warn('[DerivWS] Could not cache open contract:', e);
                }

                window.dispatchEvent(new CustomEvent('proposal-open-contract', {
                    detail: { ...contract, msg_type: 'proposal_open_contract' },
                }));
            }
        };

        this.addMessageHandler('proposal_open_contract', contractHandler);
        this.send({ proposal_open_contract: 1, subscribe: 1, req_id: reqId });
        console.log('[DerivWS] Subscribed to proposal open contract updates');
    }

    // ==================== TRADING METHODS ====================

    /**
     * Get a proposal for a trade.
     */
    async getProposal(params: {
        amount: number;
        contract_type: string;
        symbol: string;
        duration: number;
        duration_unit?: string;
        basis?: string;
        barrier?: string;
    }, accountType?: 'demo' | 'real'): Promise<any> {
        const type = accountType || this.getActiveAccountType();
        const ws = type === 'demo' ? this.demoWS : this.realWS;

        if (!ws || ws.readyState !== WebSocket.OPEN) {
            throw new Error(`WebSocket not connected for ${type}`);
        }

        const reqId = this.getNextRequestId();

        const proposalRequest: WSMessage = {
            proposal: 1,
            amount: params.amount,
            contract_type: params.contract_type,
            symbol: params.symbol,
            duration: params.duration,
            duration_unit: params.duration_unit || 't',
            basis: params.basis || 'stake',
            subscribe: 0,
            req_id: reqId,
        };

        if (params.barrier) proposalRequest.barrier = params.barrier;

        return new Promise((resolve, reject) => {
            const handler = (data: any) => {
                if (data.req_id === reqId) {
                    this.removeMessageHandler('proposal', handler);
                    if (data.error) reject(data.error);
                    else resolve(data);
                }
            };

            this.addMessageHandler('proposal', handler);
            ws.send(JSON.stringify(proposalRequest));

            setTimeout(() => {
                this.removeMessageHandler('proposal', handler);
                reject(new Error('Proposal timeout'));
            }, 10000);
        });
    }

    /**
     * Buy a contract using a proposal ID.
     */
    async buyContract(proposalId: string, price: number, accountType?: 'demo' | 'real'): Promise<any> {
        const type = accountType || this.getActiveAccountType();
        const ws = type === 'demo' ? this.demoWS : this.realWS;

        if (!ws || ws.readyState !== WebSocket.OPEN) {
            throw new Error(`WebSocket not connected for ${type}`);
        }

        const reqId = this.getNextRequestId();

        const buyRequest = {
            buy: proposalId,
            price: price,
            subscribe: 1,
            req_id: reqId,
        };

        return new Promise((resolve, reject) => {
            const handler = (data: any) => {
                if (data.req_id === reqId) {
                    this.removeMessageHandler('buy', handler);
                    if (data.error) reject(data.error);
                    else resolve(data);
                }
            };

            this.addMessageHandler('buy', handler);
            ws.send(JSON.stringify(buyRequest));

            setTimeout(() => {
                this.removeMessageHandler('buy', handler);
                reject(new Error('Buy timeout'));
            }, 10000);
        });
    }

    /**
     * Sell an open contract.
     */
    async sellContract(contractId: string, accountType?: 'demo' | 'real'): Promise<any> {
        const type = accountType || this.getActiveAccountType();
        const ws = type === 'demo' ? this.demoWS : this.realWS;

        if (!ws || ws.readyState !== WebSocket.OPEN) {
            throw new Error(`WebSocket not connected for ${type}`);
        }

        const reqId = this.getNextRequestId();

        const sellRequest = {
            sell: contractId,
            req_id: reqId,
        };

        return new Promise((resolve, reject) => {
            const handler = (data: any) => {
                if (data.req_id === reqId) {
                    this.removeMessageHandler('sell', handler);
                    if (data.error) reject(data.error);
                    else resolve(data);
                }
            };

            this.addMessageHandler('sell', handler);
            ws.send(JSON.stringify(sellRequest));

            setTimeout(() => {
                this.removeMessageHandler('sell', handler);
                reject(new Error('Sell timeout'));
            }, 10000);
        });
    }

    /**
     * Request ticks history — routes through demo WS (new API).
     */
    async requestTicksHistory(symbol: string, count: number = 1000, granularity?: number): Promise<any> {
        if (!this.isDemoConnected()) {
            await this.connectDemo();
        }

        const request: WSMessage = {
            ticks_history: symbol,
            subscribe: 1,
            end: 'latest',
            count,
        };

        if (granularity) request.granularity = granularity;

        return this.sendRequest(request, true);
    }

    /**
     * Simple trade method — gets proposal and buys automatically.
     */
    async placeTrade(params: {
        amount: number;
        contract_type: string;
        symbol?: string;
        duration?: number;
        barrier?: string;
    }, accountType?: 'demo' | 'real'): Promise<any> {
        const type = accountType || this.getActiveAccountType();
        const symbol = params.symbol || 'R_100';
        const duration = params.duration || 60;

        const proposalResponse = await this.getProposal({
            amount: params.amount,
            contract_type: params.contract_type,
            symbol,
            duration,
            ...(params.barrier && { barrier: params.barrier }),
        }, type);

        if (!proposalResponse.proposal) throw new Error('No proposal received');

        const proposal = proposalResponse.proposal;
        const buyResponse = await this.buyContract(proposal.id, proposal.ask_price, type);

        return buyResponse;
    }

    // ==================== MESSAGE HANDLING ====================

    private addMessageHandler(msgType: string, callback: MessageCallback): void {
        if (!this.messageHandlers.has(msgType)) {
            this.messageHandlers.set(msgType, new Set());
        }
        this.messageHandlers.get(msgType)!.add(callback);
    }

    private removeMessageHandler(msgType: string, callback: MessageCallback): void {
        const handlers = this.messageHandlers.get(msgType);
        if (handlers) {
            handlers.delete(callback);
        }
    }

    public addMessageHandlerPublic(msgType: string, callback: MessageCallback): void {
        this.addMessageHandler(msgType, callback);
    }

    public removeMessageHandlerPublic(msgType: string, callback: MessageCallback): void {
        this.removeMessageHandler(msgType, callback);
    }

    /**
     * Generic send — routes to the active trading WS by default.
     */
    send(message: WSMessage, accountType?: 'demo' | 'real'): void {
        const type = accountType || this.getActiveAccountType();
        const ws = type === 'demo' ? this.demoWS : this.realWS;

        if (ws?.readyState === WebSocket.OPEN) {
            if (!message.req_id) {
                message.req_id = this.getNextRequestId();
            }
            ws.send(JSON.stringify(message));
        } else {
            console.warn(`[DerivWS] Cannot send ${type} message, WebSocket not open.`);
        }
    }

    /**
     * On message handler (compatible with api_base).
     */
    onMessage(): {
        subscribe: (callback: (message: any) => void) => { unsubscribe: () => void };
    } {
        return {
            subscribe: (callback: (message: any) => void) => {
                const wrappedCallback = (data: any) => {
                    callback({ data });
                };
                this.addMessageHandler('*', wrappedCallback);
                return {
                    unsubscribe: () => {
                        this.removeMessageHandler('*', wrappedCallback);
                    },
                };
            },
        };
    }

    addEventListener(event: 'open' | 'close', callback: () => void): void {
        if (event === 'open') {
            this.onOpenCallbacks.add(callback);
            if (this.isDemoConnected() || this.isRealConnected()) {
                callback();
            }
        } else if (event === 'close') {
            this.onCloseCallbacks.add(callback);
        }
    }

    removeEventListener(event: 'open' | 'close', callback: () => void): void {
        if (event === 'open') {
            this.onOpenCallbacks.delete(callback);
        } else if (event === 'close') {
            this.onCloseCallbacks.delete(callback);
        }
    }

    disconnect(): void {
        this.disconnectAll();
    }

    // ==================== PRIVATE CONNECTION METHODS ====================

    /**
     * Fetch account info from the new Deriv API REST endpoint.
     */
    private async getAccountInfo(accountType: 'demo' | 'real'): Promise<any> {
        try {
            const authToken = localStorage.getItem('authToken');
            if (!authToken) {
                console.warn('[DerivWS] No authToken found in localStorage');
                return null;
            }

            const appId = this.getAppId();

            const accountsResponse = await fetch('https://api.derivws.com/trading/v1/options/accounts', {
                method: 'GET',
                headers: {
                    'Authorization': `Bearer ${authToken}`,
                    'Deriv-App-ID': appId,
                    'Content-Type': 'application/json',
                },
            });

            if (!accountsResponse.ok) {
                console.error(`[DerivWS] Accounts fetch failed: ${accountsResponse.status}`);
                return null;
            }

            const accountsData = await accountsResponse.json();
            const accounts = accountsData.data || accountsData.accounts || [];

            const targetAccount = accounts.find((acc: any) => {
                const type = (acc.account_type || '').toLowerCase();
                return accountType === 'demo'
                    ? (type === 'demo' || type === 'virtual')
                    : (type === 'real' || type === 'financial');
            });

            if (!targetAccount) {
                console.warn(`[DerivWS] No ${accountType} account found in response`);
                return null;
            }

            return {
                loginid: targetAccount.account_id,
                currency: targetAccount.currency || 'USD',
                balance: parseFloat(targetAccount.balance) || 0,
                account_type: accountType,
                is_virtual: accountType === 'demo',
            };
        } catch (error) {
            console.error('[DerivWS] Error getting account info:', error);
            return null;
        }
    }

    /**
     * Exchange OAuth token for a one-time WebSocket password (OTP)
     * using the new Deriv API endpoint.
     */
    private async getOTP(accountType: 'demo' | 'real'): Promise<string | null> {
        try {
            const authToken = localStorage.getItem('authToken');
            if (!authToken) {
                console.warn('[DerivWS] No authToken — cannot request OTP');
                return null;
            }

            const accountInfo = await this.getAccountInfo(accountType);
            if (!accountInfo) {
                console.warn(`[DerivWS] Cannot get OTP — no ${accountType} account info`);
                return null;
            }

            const accountId = accountInfo.loginid;
            const appId = this.getAppId();

            const otpResponse = await fetch(
                `https://api.derivws.com/trading/v1/options/accounts/${accountId}/otp`,
                {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${authToken}`,
                        'Deriv-App-ID': appId,
                        'Content-Type': 'application/json',
                    },
                }
            );

            if (!otpResponse.ok) {
                console.error(`[DerivWS] OTP fetch failed for ${accountType}: ${otpResponse.status}`);
                return null;
            }

            const otpData = await otpResponse.json();

            // Extract OTP from response
            let otp: string | null = null;

            if (otpData.data?.otp) {
                otp = otpData.data.otp;
            } else if (otpData.data?.url) {
                const match = otpData.data.url.match(/[?&]otp=([^&]+)/);
                if (match?.[1]) otp = match[1];
            } else if (otpData.otp) {
                otp = otpData.otp;
            }

            if (!otp) {
                console.error('[DerivWS] OTP not found in response:', otpData);
            }

            return otp;
        } catch (error) {
            console.error('[DerivWS] Error getting OTP:', error);
            return null;
        }
    }

    private updateLocalStorageWithAccount(accountData: any, type: string): void {
        try {
            const loginid = accountData.loginid;
            const authToken = localStorage.getItem('authToken');

            const existingClientAccounts = localStorage.getItem('clientAccounts');
            const clientAccounts = existingClientAccounts
                ? JSON.parse(existingClientAccounts)
                : {};

            clientAccounts[loginid] = {
                loginid,
                token: authToken,
                currency: accountData.currency,
                balance: accountData.balance,
                account_type: type,
                is_virtual: type === 'demo',
            };
            localStorage.setItem('clientAccounts', JSON.stringify(clientAccounts));

            if (!localStorage.getItem('active_loginid')) {
                localStorage.setItem('active_loginid', loginid);
            }
        } catch (error) {
            console.error('[DerivWS] Error updating localStorage:', error);
        }
    }

    private startKeepAlive(type: 'demo' | 'real'): void {
        if (type === 'demo' && this.demoKeepAliveInterval) {
            clearInterval(this.demoKeepAliveInterval);
        }
        if (type === 'real' && this.realKeepAliveInterval) {
            clearInterval(this.realKeepAliveInterval);
        }

        const newInterval = setInterval(() => {
            const ws = type === 'demo' ? this.demoWS : this.realWS;

            if (ws?.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify({ ping: 1, req_id: this.getNextRequestId() }));
            }
        }, 30000);

        if (type === 'demo') this.demoKeepAliveInterval = newInterval;
        else this.realKeepAliveInterval = newInterval;
    }

    /**
     * Connect to the new demo WebSocket using OTP.
     * URL: wss://api.derivws.com/trading/v1/options/ws/demo?otp=<OTP>
     */
    async connectDemo(): Promise<void> {
        if (this.demoWS?.readyState === WebSocket.OPEN) return;
        if (this.isConnectingDemo) return;

        this.isConnectingDemo = true;

        try {
            const accountInfo = await this.getAccountInfo('demo');
            if (accountInfo) this.updateLocalStorageWithAccount(accountInfo, 'demo');

            const otp = await this.getOTP('demo');
            if (!otp) {
                console.error('[DerivWS] Could not get OTP for demo — connection aborted');
                this.isConnectingDemo = false;
                return;
            }

            const wsUrl = `wss://api.derivws.com/trading/v1/options/ws/demo?otp=${otp}`;

            this.demoWS = new WebSocket(wsUrl);

            this.demoWS.onopen = () => {
                console.log('[DerivWS] ✅ Demo WebSocket connection established');
                this.isConnectingDemo = false;
                this.startKeepAlive('demo');
                this.onOpenCallbacks.forEach(cb => cb());
            };

            this.demoWS.onmessage = (event) => {
                try {
                    const data = JSON.parse(event.data);
                    const msgType = data.msg_type
                        || Object.keys(data).find(k => !['req_id', 'error', 'echo_req'].includes(k));

                    if (msgType && this.messageHandlers.has(msgType)) {
                        this.messageHandlers.get(msgType)!.forEach(handler => handler(data));
                    }
                    if (this.messageHandlers.has('*')) {
                        this.messageHandlers.get('*')!.forEach(handler => handler(data));
                    }
                } catch (error) {
                    console.error('[DerivWS] Error parsing demo message:', error);
                }
            };

            this.demoWS.onerror = (error) => {
                console.error('[DerivWS] Demo WebSocket error:', error);
                this.isConnectingDemo = false;
            };

            this.demoWS.onclose = () => {
                console.log('[DerivWS] Demo WebSocket closed');
                this.demoWS = null;
                this.isConnectingDemo = false;
                this.hasActiveSymbols = false;
                this.onCloseCallbacks.forEach(cb => cb());

                if (this.demoAutoReconnectTimeout) clearTimeout(this.demoAutoReconnectTimeout);
                this.demoAutoReconnectTimeout = setTimeout(() => {
                    console.log('[DerivWS] Auto-reconnecting demo WebSocket...');
                    this.connectDemo();
                }, 5000);
            };
        } catch (error) {
            console.error('[DerivWS] Failed to connect demo:', error);
            this.isConnectingDemo = false;
        }
    }

    /**
     * Connect to the new real WebSocket using OTP.
     * URL: wss://api.derivws.com/trading/v1/options/ws/real?otp=<OTP>
     */
    async connectReal(): Promise<void> {
        if (this.realWS?.readyState === WebSocket.OPEN) return;
        if (this.isConnectingReal) return;

        this.isConnectingReal = true;

        try {
            const accountInfo = await this.getAccountInfo('real');
            if (accountInfo) this.updateLocalStorageWithAccount(accountInfo, 'real');

            const otp = await this.getOTP('real');
            if (!otp) {
                console.warn('[DerivWS] Could not get OTP for real — connection skipped');
                this.isConnectingReal = false;
                return;
            }

            const wsUrl = `wss://api.derivws.com/trading/v1/options/ws/real?otp=${otp}`;

            this.realWS = new WebSocket(wsUrl);

            this.realWS.onopen = () => {
                console.log('[DerivWS] ✅ Real WebSocket connection established');
                this.isConnectingReal = false;
                this.startKeepAlive('real');
                this.onOpenCallbacks.forEach(cb => cb());
            };

            this.realWS.onmessage = (event) => {
                try {
                    const data = JSON.parse(event.data);
                    const msgType = data.msg_type
                        || Object.keys(data).find(k => !['req_id', 'error', 'echo_req'].includes(k));

                    if (msgType && this.messageHandlers.has(msgType)) {
                        this.messageHandlers.get(msgType)!.forEach(handler => handler(data));
                    }
                    if (this.messageHandlers.has('*')) {
                        this.messageHandlers.get('*')!.forEach(handler => handler(data));
                    }
                } catch (error) {
                    console.error('[DerivWS] Error parsing real message:', error);
                }
            };

            this.realWS.onerror = (error) => {
                console.error('[DerivWS] Real WebSocket error:', error);
                this.isConnectingReal = false;
            };

            this.realWS.onclose = () => {
                console.log('[DerivWS] Real WebSocket closed');
                this.realWS = null;
                this.isConnectingReal = false;
                this.onCloseCallbacks.forEach(cb => cb());

                if (this.realAutoReconnectTimeout) clearTimeout(this.realAutoReconnectTimeout);
                this.realAutoReconnectTimeout = setTimeout(() => {
                    console.log('[DerivWS] Auto-reconnecting real WebSocket...');
                    this.connectReal();
                }, 5000);
            };
        } catch (error) {
            console.error('[DerivWS] Failed to connect real:', error);
            this.isConnectingReal = false;
        }
    }

    private getNextRequestId(): number {
        return this.requestId++;
    }

    disconnectAll(): void {
        if (this.demoAutoReconnectTimeout) clearTimeout(this.demoAutoReconnectTimeout);
        if (this.realAutoReconnectTimeout) clearTimeout(this.realAutoReconnectTimeout);
        if (this.demoKeepAliveInterval) clearInterval(this.demoKeepAliveInterval);
        if (this.realKeepAliveInterval) clearInterval(this.realKeepAliveInterval);

        if (this.demoWS) {
            this.demoWS.close(1000, 'Manual disconnect');
            this.demoWS = null;
        }
        if (this.realWS) {
            this.realWS.close(1000, 'Manual disconnect');
            this.realWS = null;
        }
    }

    // ==================== GETTERS ====================

    getBalance(): number { return this.balance; }
    getCurrency(): string { return this.currency; }
    getLoginId(): string { return this.loginid; }
    getActiveSymbolsList(): any[] { return this.activeSymbols; }
    getPipSizes(): Record<string, number> { return this.pipSizes; }
    isAuthorized(): boolean { return this.isDemoConnected() || this.isRealConnected(); }
}

export default new DerivWSService();