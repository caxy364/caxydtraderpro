import React from 'react';
import { observer } from 'mobx-react-lite';
import { useStore } from '@/hooks/useStore';
import derivWS from '@/external/bot-skeleton/services/derivWS';

type SymbolInfo = {
    symbol: string;
    display_name: string;
    market_display_name?: string;
    subgroup_display_name?: string;
};

type ProposalResult = {
    id: string;
    ask_price: number;
    payout: number;
    longcode: string;
    spot: number;
    spot_time: number;
};

type OpenTrade = {
    contract_id: string;
    contract_type: string;
    buy_price: number;
    symbol: string;
    entry_spot: number | null;
    status: 'open' | 'won' | 'lost' | 'sold';
    profit?: number;
    exit_tick?: number;
};

const CONTRACT_TYPES: { label: string; value: string; color: string }[] = [
    { label: '▲ Rise', value: 'CALL', color: '#00a79e' },
    { label: '▼ Fall', value: 'PUT', color: '#ec3f3f' },
    { label: '↑ Higher', value: 'ONETOUCH', color: '#f79f26' },
    { label: '↓ Lower', value: 'NOTOUCH', color: '#9b8ce0' },
];

const DURATION_UNITS: { label: string; value: string; min: number; max: number }[] = [
    { label: 'Ticks', value: 't', min: 1, max: 10 },
    { label: 'Seconds', value: 's', min: 15, max: 3600 },
    { label: 'Minutes', value: 'm', min: 1, max: 1440 },
    { label: 'Hours', value: 'h', min: 1, max: 24 },
    { label: 'Days', value: 'd', min: 1, max: 365 },
];

export const DTraderTab = observer(() => {
    const { client } = useStore();

    const currency = client.currency || localStorage.getItem('user_currency') || 'USD';
    const loginId = client.loginid || localStorage.getItem('active_loginid') || '';
    const balance = client.balance || '0';

    const [symbols, setSymbols] = React.useState<SymbolInfo[]>([]);
    const [selectedSymbol, setSelectedSymbol] = React.useState('R_100');
    const [contractType, setContractType] = React.useState('CALL');
    const [duration, setDuration] = React.useState(5);
    const [durationUnit, setDurationUnit] = React.useState('t');
    const [amount, setAmount] = React.useState(10);
    const [currentSpot, setCurrentSpot] = React.useState<number | null>(null);
    const [proposal, setProposal] = React.useState<ProposalResult | null>(null);
    const [proposalLoading, setProposalLoading] = React.useState(false);
    const [isConnected, setIsConnected] = React.useState(false);
    const [error, setError] = React.useState<string | null>(null);
    const [buyStatus, setBuyStatus] = React.useState<string | null>(null);
    const [openTrades, setOpenTrades] = React.useState<OpenTrade[]>([]);
    const [isLoadingSymbols, setIsLoadingSymbols] = React.useState(true);

    const tickSubRef = React.useRef<number | null>(null);
    const proposalTimeoutRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
    const forgotProposalRef = React.useRef<string | null>(null);

    const isConnectedRef = React.useRef(false);

    const checkConnection = React.useCallback(() => {
        const connected = derivWS.isDemoConnected() || derivWS.isRealConnected();
        setIsConnected(connected);
        isConnectedRef.current = connected;
        return connected;
    }, []);

    const handleTickMessage = React.useCallback((data: any) => {
        if (data.tick?.quote) {
            setCurrentSpot(data.tick.quote);
        } else if (data.ohlc?.close) {
            setCurrentSpot(parseFloat(data.ohlc.close));
        }
    }, []);

    const subscribeToTicks = React.useCallback((sym: string) => {
        derivWS.removeMessageHandlerPublic('tick', handleTickMessage);
        const reqId = Date.now();
        tickSubRef.current = reqId;
        derivWS.addMessageHandlerPublic('tick', handleTickMessage);
        derivWS.send({ ticks: sym, subscribe: 1, req_id: reqId });
    }, [handleTickMessage]);

    const unsubscribeTicks = React.useCallback(() => {
        derivWS.removeMessageHandlerPublic('tick', handleTickMessage);
        if (tickSubRef.current) {
            derivWS.send({ forget_all: 'ticks' });
            tickSubRef.current = null;
        }
    }, [handleTickMessage]);

    const forgotProposal = React.useCallback(() => {
        if (forgotProposalRef.current) {
            derivWS.send({ forget: forgotProposalRef.current });
            forgotProposalRef.current = null;
        }
    }, []);

    const getProposal = React.useCallback(async (sym: string, cType: string, dur: number, durUnit: string, amt: number, cur: string) => {
        if (!isConnectedRef.current) return;
        forgotProposal();
        setProposalLoading(true);
        setProposal(null);
        if (proposalTimeoutRef.current) clearTimeout(proposalTimeoutRef.current);

        proposalTimeoutRef.current = setTimeout(async () => {
            try {
                if (!isConnectedRef.current) {
                    setProposalLoading(false);
                    return;
                }
                const result = await derivWS.getProposal({
                    amount: amt,
                    contract_type: cType,
                    symbol: sym,
                    duration: dur,
                    duration_unit: durUnit,
                    basis: 'stake',
                }, derivWS.getActiveAccountType());

                if (result?.proposal) {
                    const p = result.proposal;
                    forgotProposalRef.current = p.id;
                    setProposal({
                        id: p.id,
                        ask_price: p.ask_price,
                        payout: p.payout,
                        longcode: p.longcode,
                        spot: p.spot,
                        spot_time: p.spot_time,
                    });
                } else {
                    setProposal(null);
                }
            } catch (e: any) {
                if (e?.code !== 'RequestCancelled') {
                    setProposal(null);
                }
            } finally {
                setProposalLoading(false);
            }
        }, 600);
    }, [forgotProposal]);

    React.useEffect(() => {
        let mounted = true;
        let retryTimeout: ReturnType<typeof setTimeout>;

        const initialize = async () => {
            const connected = checkConnection();
            if (!connected) {
                setIsLoadingSymbols(false);
                setError('Not connected to Deriv. Please log in again.');
                return;
            }

            try {
                let syms = derivWS.getActiveSymbolsList();
                if (!syms || syms.length === 0) {
                    syms = await derivWS.getActiveSymbols();
                }
                if (!mounted) return;

                const formatted: SymbolInfo[] = syms.map((s: any) => ({
                    symbol: s.symbol,
                    display_name: s.display_name || s.symbol,
                    market_display_name: s.market_display_name,
                    subgroup_display_name: s.subgroup_display_name,
                }));

                setSymbols(formatted);
                setIsLoadingSymbols(false);
                setError(null);

                const defaultSym = formatted.find(s => s.symbol === 'R_100') || formatted[0];
                if (defaultSym) {
                    setSelectedSymbol(defaultSym.symbol);
                    subscribeToTicks(defaultSym.symbol);
                }
            } catch (e) {
                if (!mounted) return;
                setIsLoadingSymbols(false);
                retryTimeout = setTimeout(initialize, 3000);
            }
        };

        const connTimer = setInterval(() => {
            if (mounted) checkConnection();
        }, 2000);

        initialize();

        return () => {
            mounted = false;
            clearInterval(connTimer);
            if (retryTimeout) clearTimeout(retryTimeout);
            unsubscribeTicks();
            forgotProposal();
            if (proposalTimeoutRef.current) clearTimeout(proposalTimeoutRef.current);
        };
    }, []);

    React.useEffect(() => {
        if (!isConnected || isLoadingSymbols) return;
        subscribeToTicks(selectedSymbol);
        return () => unsubscribeTicks();
    }, [selectedSymbol, isConnected]);

    React.useEffect(() => {
        if (!isConnected) return;
        getProposal(selectedSymbol, contractType, duration, durationUnit, amount, currency);
    }, [selectedSymbol, contractType, duration, durationUnit, amount, isConnected]);

    const handleBuy = async () => {
        if (!proposal) return;
        setBuyStatus('placing');
        setError(null);
        try {
            const result = await derivWS.buyContract(proposal.id, proposal.ask_price, derivWS.getActiveAccountType());
            if (result?.buy) {
                const b = result.buy;
                setBuyStatus('bought');
                setOpenTrades(prev => [...prev, {
                    contract_id: b.contract_id,
                    contract_type: contractType,
                    buy_price: b.buy_price,
                    symbol: selectedSymbol,
                    entry_spot: b.start_time || null,
                    status: 'open',
                }]);
                setProposal(null);
                forgotProposalRef.current = null;
                setTimeout(() => {
                    setBuyStatus(null);
                    getProposal(selectedSymbol, contractType, duration, durationUnit, amount, currency);
                }, 2000);
            }
        } catch (e: any) {
            setError(e?.message || 'Buy failed. Please try again.');
            setBuyStatus(null);
        }
    };

    const durUnitInfo = DURATION_UNITS.find(u => u.value === durationUnit) || DURATION_UNITS[0];
    const ctInfo = CONTRACT_TYPES.find(c => c.value === contractType) || CONTRACT_TYPES[0];

    const groupedSymbols = React.useMemo(() => {
        const groups: Record<string, SymbolInfo[]> = {};
        symbols.forEach(s => {
            const group = s.market_display_name || 'Other';
            if (!groups[group]) groups[group] = [];
            groups[group].push(s);
        });
        return groups;
    }, [symbols]);

    return (
        <div style={{
            display: 'flex',
            flexDirection: 'column',
            height: '100%',
            minHeight: '500px',
            background: '#0e0e1a',
            color: '#e8e8f0',
            fontFamily: '"IBM Plex Sans", "Inter", sans-serif',
            overflow: 'auto',
        }}>
            <div style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '12px 20px',
                background: '#161624',
                borderBottom: '1px solid #2a2a3e',
            }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    <span style={{ fontWeight: 700, fontSize: 18, color: '#fff', letterSpacing: 1 }}>
                        DTrader
                    </span>
                    <span style={{
                        background: isConnected ? '#00a79e22' : '#ec3f3f22',
                        color: isConnected ? '#00c4bb' : '#ec3f3f',
                        border: `1px solid ${isConnected ? '#00a79e44' : '#ec3f3f44'}`,
                        borderRadius: 20,
                        padding: '2px 10px',
                        fontSize: 11,
                        fontWeight: 600,
                    }}>
                        {isConnected ? '● Live' : '○ Disconnected'}
                    </span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
                    {loginId && (
                        <span style={{ fontSize: 12, color: '#888', fontFamily: 'monospace' }}>
                            {loginId}
                        </span>
                    )}
                    <div style={{ textAlign: 'right' }}>
                        <div style={{ fontSize: 11, color: '#888' }}>Balance</div>
                        <div style={{ fontSize: 15, fontWeight: 700, color: '#fff' }}>
                            {parseFloat(balance).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} {currency}
                        </div>
                    </div>
                </div>
            </div>

            <div style={{
                display: 'flex',
                flex: 1,
                gap: 0,
                overflow: 'hidden',
                flexWrap: 'wrap',
            }}>
                <div style={{
                    flex: '1 1 320px',
                    padding: 20,
                    borderRight: '1px solid #2a2a3e',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 20,
                    overflowY: 'auto',
                }}>
                    <div>
                        <label style={{ fontSize: 11, color: '#888', fontWeight: 600, textTransform: 'uppercase', letterSpacing: 1 }}>
                            Market
                        </label>
                        <div style={{ marginTop: 8 }}>
                            {isLoadingSymbols ? (
                                <div style={{ color: '#888', fontSize: 13, padding: '10px 0' }}>Loading markets...</div>
                            ) : (
                                <select
                                    value={selectedSymbol}
                                    onChange={e => setSelectedSymbol(e.target.value)}
                                    style={{
                                        width: '100%',
                                        background: '#1e1e2e',
                                        border: '1px solid #3a3a50',
                                        borderRadius: 8,
                                        color: '#fff',
                                        padding: '10px 14px',
                                        fontSize: 14,
                                        outline: 'none',
                                        cursor: 'pointer',
                                    }}
                                >
                                    {Object.entries(groupedSymbols).map(([group, syms]) => (
                                        <optgroup key={group} label={group} style={{ background: '#1e1e2e' }}>
                                            {syms.map(s => (
                                                <option key={s.symbol} value={s.symbol} style={{ background: '#1e1e2e' }}>
                                                    {s.display_name}
                                                </option>
                                            ))}
                                        </optgroup>
                                    ))}
                                </select>
                            )}
                        </div>
                        {currentSpot !== null && (
                            <div style={{ marginTop: 8, display: 'flex', alignItems: 'center', gap: 8 }}>
                                <span style={{ fontSize: 11, color: '#888' }}>Spot Price</span>
                                <span style={{ fontSize: 16, fontWeight: 700, color: '#00c4bb', fontFamily: 'monospace' }}>
                                    {currentSpot.toFixed(5)}
                                </span>
                            </div>
                        )}
                    </div>

                    <div>
                        <label style={{ fontSize: 11, color: '#888', fontWeight: 600, textTransform: 'uppercase', letterSpacing: 1 }}>
                            Contract Type
                        </label>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginTop: 8 }}>
                            {CONTRACT_TYPES.map(ct => (
                                <button
                                    key={ct.value}
                                    onClick={() => setContractType(ct.value)}
                                    style={{
                                        padding: '10px 8px',
                                        borderRadius: 8,
                                        border: contractType === ct.value
                                            ? `2px solid ${ct.color}`
                                            : '1px solid #3a3a50',
                                        background: contractType === ct.value
                                            ? `${ct.color}22`
                                            : '#1e1e2e',
                                        color: contractType === ct.value ? ct.color : '#aaa',
                                        fontWeight: contractType === ct.value ? 700 : 400,
                                        fontSize: 13,
                                        cursor: 'pointer',
                                        transition: 'all 0.15s',
                                    }}
                                >
                                    {ct.label}
                                </button>
                            ))}
                        </div>
                    </div>

                    <div>
                        <label style={{ fontSize: 11, color: '#888', fontWeight: 600, textTransform: 'uppercase', letterSpacing: 1 }}>
                            Duration
                        </label>
                        <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                            <input
                                type='number'
                                value={duration}
                                min={durUnitInfo.min}
                                max={durUnitInfo.max}
                                onChange={e => setDuration(Math.max(durUnitInfo.min, parseInt(e.target.value, 10) || durUnitInfo.min))}
                                style={{
                                    flex: 1,
                                    background: '#1e1e2e',
                                    border: '1px solid #3a3a50',
                                    borderRadius: 8,
                                    color: '#fff',
                                    padding: '10px 14px',
                                    fontSize: 14,
                                    outline: 'none',
                                    minWidth: 0,
                                }}
                            />
                            <select
                                value={durationUnit}
                                onChange={e => {
                                    const u = DURATION_UNITS.find(d => d.value === e.target.value);
                                    setDurationUnit(e.target.value);
                                    if (u) setDuration(Math.min(u.max, Math.max(u.min, duration)));
                                }}
                                style={{
                                    background: '#1e1e2e',
                                    border: '1px solid #3a3a50',
                                    borderRadius: 8,
                                    color: '#fff',
                                    padding: '10px 10px',
                                    fontSize: 13,
                                    outline: 'none',
                                    cursor: 'pointer',
                                }}
                            >
                                {DURATION_UNITS.map(u => (
                                    <option key={u.value} value={u.value} style={{ background: '#1e1e2e' }}>
                                        {u.label}
                                    </option>
                                ))}
                            </select>
                        </div>
                    </div>

                    <div>
                        <label style={{ fontSize: 11, color: '#888', fontWeight: 600, textTransform: 'uppercase', letterSpacing: 1 }}>
                            Stake ({currency})
                        </label>
                        <div style={{ display: 'flex', gap: 8, marginTop: 8, alignItems: 'center' }}>
                            <button
                                onClick={() => setAmount(a => Math.max(1, parseFloat((a - 1).toFixed(2))))}
                                style={{
                                    width: 36, height: 42, borderRadius: 8,
                                    border: '1px solid #3a3a50', background: '#1e1e2e',
                                    color: '#fff', fontSize: 18, cursor: 'pointer',
                                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                                    flexShrink: 0,
                                }}
                            >−</button>
                            <input
                                type='number'
                                value={amount}
                                min={1}
                                step={1}
                                onChange={e => setAmount(Math.max(1, parseFloat(e.target.value) || 1))}
                                style={{
                                    flex: 1,
                                    background: '#1e1e2e',
                                    border: '1px solid #3a3a50',
                                    borderRadius: 8,
                                    color: '#fff',
                                    padding: '10px 14px',
                                    fontSize: 14,
                                    outline: 'none',
                                    textAlign: 'center',
                                    minWidth: 0,
                                }}
                            />
                            <button
                                onClick={() => setAmount(a => parseFloat((a + 1).toFixed(2)))}
                                style={{
                                    width: 36, height: 42, borderRadius: 8,
                                    border: '1px solid #3a3a50', background: '#1e1e2e',
                                    color: '#fff', fontSize: 18, cursor: 'pointer',
                                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                                    flexShrink: 0,
                                }}
                            >+</button>
                        </div>
                    </div>

                    <div style={{
                        background: '#1a1a2a',
                        borderRadius: 12,
                        padding: '16px',
                        border: '1px solid #2e2e44',
                    }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 10 }}>
                            <span style={{ fontSize: 12, color: '#888' }}>Payout</span>
                            <span style={{ fontSize: 14, fontWeight: 700, color: '#00c4bb' }}>
                                {proposalLoading ? '...' : proposal
                                    ? `${proposal.payout.toFixed(2)} ${currency}`
                                    : '-'}
                            </span>
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 14 }}>
                            <span style={{ fontSize: 12, color: '#888' }}>Cost</span>
                            <span style={{ fontSize: 14, fontWeight: 700, color: '#fff' }}>
                                {proposalLoading ? '...' : proposal
                                    ? `${proposal.ask_price.toFixed(2)} ${currency}`
                                    : '-'}
                            </span>
                        </div>
                        {proposal?.longcode && (
                            <div style={{
                                fontSize: 11,
                                color: '#666',
                                fontStyle: 'italic',
                                marginBottom: 12,
                                lineHeight: 1.4,
                            }}>
                                {proposal.longcode}
                            </div>
                        )}

                        {error && (
                            <div style={{
                                background: '#ec3f3f22',
                                border: '1px solid #ec3f3f44',
                                borderRadius: 8,
                                padding: '8px 12px',
                                color: '#ec3f3f',
                                fontSize: 12,
                                marginBottom: 12,
                            }}>
                                {error}
                            </div>
                        )}

                        <button
                            onClick={handleBuy}
                            disabled={!proposal || buyStatus === 'placing' || !isConnected}
                            style={{
                                width: '100%',
                                padding: '13px',
                                borderRadius: 10,
                                border: 'none',
                                background: buyStatus === 'bought'
                                    ? '#00a79e'
                                    : buyStatus === 'placing'
                                        ? '#555'
                                        : ctInfo.color,
                                color: '#fff',
                                fontWeight: 700,
                                fontSize: 15,
                                cursor: proposal && buyStatus !== 'placing' && isConnected ? 'pointer' : 'not-allowed',
                                opacity: !proposal || !isConnected ? 0.5 : 1,
                                transition: 'all 0.2s',
                                letterSpacing: 0.5,
                            }}
                        >
                            {buyStatus === 'placing' ? 'Placing Trade...'
                                : buyStatus === 'bought' ? '✓ Trade Placed!'
                                    : !isConnected ? 'Not Connected'
                                        : `Buy ${ctInfo.label} — ${amount.toFixed(2)} ${currency}`}
                        </button>
                    </div>
                </div>

                {openTrades.length > 0 && (
                    <div style={{
                        flex: '1 1 280px',
                        padding: 20,
                        overflowY: 'auto',
                    }}>
                        <div style={{ fontSize: 11, color: '#888', fontWeight: 600, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 12 }}>
                            Open Trades
                        </div>
                        {openTrades.slice().reverse().map(t => (
                            <div key={t.contract_id} style={{
                                background: '#1a1a2a',
                                border: `1px solid ${t.status === 'won' ? '#00a79e44' : t.status === 'lost' ? '#ec3f3f44' : '#2e2e44'}`,
                                borderRadius: 10,
                                padding: '12px 14px',
                                marginBottom: 10,
                            }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                                    <span style={{ fontSize: 13, fontWeight: 700, color: t.contract_type === 'CALL' ? '#00c4bb' : '#ec3f3f' }}>
                                        {t.contract_type === 'CALL' ? '▲ Rise' : t.contract_type === 'PUT' ? '▼ Fall' : t.contract_type}
                                    </span>
                                    <span style={{
                                        fontSize: 11, fontWeight: 600,
                                        color: t.status === 'open' ? '#f79f26' : t.status === 'won' ? '#00c4bb' : '#ec3f3f',
                                    }}>
                                        {t.status.toUpperCase()}
                                    </span>
                                </div>
                                <div style={{ fontSize: 12, color: '#888' }}>
                                    {t.symbol} · Cost: {t.buy_price.toFixed(2)} {currency}
                                </div>
                                <div style={{ fontSize: 11, color: '#555', marginTop: 4, fontFamily: 'monospace' }}>
                                    ID: {t.contract_id}
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
});

export default DTraderTab;
