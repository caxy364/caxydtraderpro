
// --- NYANYUKI PRO COMPONENT (YOUR EXISTING CODE - PUT YOUR FULL CODE HERE) ---im
import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { observer } from 'mobx-react-lite';
import { useStore } from '@/hooks/useStore';
import { api_base } from '@/external/bot-skeleton';
import FloatingHelpTab from '@/components/FloatingHelpTab';
import { botNotification } from '@/components/bot-notification/bot-notification';

const NyanyukiPro = observer(() => {
    // ============================================
    // 1. ACCESS THE STORES AND OBSERVER
    // ============================================
    const { client, run_panel, transactions } = useStore();
    const { is_logged_in, currency } = client;

    // 2. SAFE ACCESS TO STORE PROPERTIES
    const transactionsStore = transactions || {};
    const runPanelStore = run_panel || {};

    // 3. GET THE BOT OBSERVER
    const botObserver = window.Bot?.observer || require('@/external/bot-skeleton').observer;
    // ─── DUAL-PATH TRADE ROUTING ──────────────────────────────────────────────────
    // Detect OAuth users (authToken in localStorage = new API, window.derivWS available)
    // Legacy users continue to use api_base.api.send as before.
    const isOAuthUser = useRef(!!localStorage.getItem('authToken'));

    // Re-evaluate on mount (localStorage could change between renders)
    useEffect(() => {
        isOAuthUser.current = !!localStorage.getItem('authToken');
    }, []);

    // Unified trade request helper — routes to OAuth WS or legacy api_base
    // Helper: translate old-API 'symbol' → new OAuth API 'underlying_symbol'.
    // Keep currency (required by new API). Remove subscribe (rejected by new API).
    const _oauthProposalRequest = (params) => {
        const { symbol, subscribe, ...rest } = params;
        return { ...rest, underlying_symbol: symbol };
    };

    const sendTradeRequest = useCallback(async (request) => {
        if (isOAuthUser.current && window.derivWS) {
            // ── PROPOSAL (warm-up) ───────────────────────────────────────────────
            // New derivws.com API uses 'underlying' not 'symbol', rejects 'currency'
            if (request.proposal === 1) {
                return window.derivWS.sendRequest(_oauthProposalRequest(request));
            }

            // ── BUY with parameters (no pre-warmed proposal) ────────────────────
            // Must do proposal → buy because new API rejects {buy:1, parameters:{}}
            if (request.buy === 1 && request.parameters) {
                const p = request.parameters;
                const propReq = _oauthProposalRequest({
                    proposal:      1,
                    amount:        Number(p.amount),
                    basis:         p.basis || 'stake',
                    contract_type: p.contract_type,
                    symbol:        p.symbol,          // _oauthProposalRequest maps to underlying_symbol
                    duration:      Number(p.duration) || 1,
                    duration_unit: p.duration_unit || 't',
                    ...(p.barrier !== undefined ? { barrier: String(p.barrier) } : {}),
                });
                const propRes = await window.derivWS.sendRequest(propReq);
                if (!propRes?.proposal?.id) {
                    const errMsg = propRes?.error?.message || 'No proposal received';
                    throw new Error(errMsg);
                }
                // bypass buyContract() — new API rejects subscribe:1
                return window.derivWS.sendRequest({ buy: propRes.proposal.id, price: propRes.proposal.ask_price });
            }

            // ── BUY with proposal ID (pre-warmed) ────────────────────────────────
            // bypass buyContract() because it adds subscribe:1 which new API rejects
            if (request.buy && request.buy !== 1) {
                return window.derivWS.sendRequest({ buy: request.buy, price: request.price });
            }

            // ── SELL ─────────────────────────────────────────────────────────────
            if (request.sell !== undefined) {
                const contractIdToSell = request.sell !== 1 ? String(request.sell) : String(request.contract_id);
                return window.derivWS.sellContract(contractIdToSell);
            }

            // ── Everything else (poc, contract status checks, etc.) ──────────────
            return window.derivWS.sendRequest(request);
        }
        return api_base.api.send(request);
    }, []);
    // ─────────────────────────────────────────────────────────────────────────────


    // ============================================
    // 3. ALL STATE VARIABLES
    // ============================================

    // --- MODE STATE ---
    const [mode, setMode] = useState('STABLE');

    // --- MARKET & CONTRACT ---
    const [symbol, setSymbol] = useState('1HZ100V');
    const [contractType, setContractType] = useState('DIGITOVER');

    // --- PREDICTIONS ---
    const [pred1, setPred1] = useState(1);
    const [pred2, setPred2] = useState(1);
    const [pred3, setPred3] = useState(1);
    const activePredIndex = useRef(0);
    const aggressivePredIndex = useRef(0);

    // --- TRADE SETTINGS ---
    const [stake, setStake] = useState(1.0);
    const [bulkNumber, setBulkNumber] = useState(1);
    const [ticks, setTicks] = useState(1);
    const [vLossLimit, setVLossLimit] = useState(1);
    const [triggers, setTriggers] = useState('8,9');
    const [sequence, setSequence] = useState('5,2,4');
    
    // Trigger mode state variables
    const [triggerMode, setTriggerMode] = useState('VLOSS');
    const [dualTriggerMode, setDualTriggerMode] = useState('TRIGGER');

    // Strike Mode State Variables
    const [strikeContract, setStrikeContract] = useState('DIGITOVER');
    const [strikePred, setStrikePred] = useState(5);
    const [strikeTriggerMode, setStrikeTriggerMode] = useState('TRIGGER');
    const [strikeTriggers, setStrikeTriggers] = useState('8,9');
    const [strikeVLoss, setStrikeVLoss] = useState(3);
    const [strikeRecoveryContract, setStrikeRecoveryContract] = useState('DIGITUNDER');
    const [strikeRecoveryPred, setStrikeRecoveryPred] = useState(4);

    const strikePhase = useRef('HUNT');
    const strikeVLossCounter = useRef(0);
    const strikeInRecovery = useRef(false);
    const strikeCurrentStake = useRef(parseFloat(stake));
    const strikeMartingaleCounter = useRef(0);
    const strikeBaseStake = useRef(parseFloat(stake));
    const strikeTradeLocked = useRef(false);

    // --- PARALLEL MODE STATE ---
    const [parallelCount, setParallelCount] = useState(3);
    const [parallelTrades, setParallelTrades] = useState([
        { contract: 'CALL', prediction: null },
        { contract: 'DIGITOVER', prediction: 5 },
        { contract: 'DIGITUNDER', prediction: 4 },
        { contract: 'DIGITEVEN', prediction: null },
        { contract: 'DIGITODD', prediction: null },
    ]);
    const parallelTradesRef = useRef(parallelTrades);
    const [parallelTriggers, setParallelTriggers] = useState('8,9');
    const [parallelTriggerMethod, setParallelTriggerMethod] = useState('TRIGGER');
    const [parallelRunMode, setParallelRunMode] = useState('SINGLE');
    const [parallelVLossLimit, setParallelVLossLimit] = useState(3);
    const [parallelStake, setParallelStake] = useState(1.0);
    const [parallelTicks, setParallelTicks] = useState(1);
    const [parallelMartingale, setParallelMartingale] = useState(2.0);
    const [parallelMartingaleLimit, setParallelMartingaleLimit] = useState(0);
    const [parallelMartingaleEnabled, setParallelMartingaleEnabled] = useState(true);
    const [parallelTakeProfit, setParallelTakeProfit] = useState(10.0);
    const [parallelStopLoss, setParallelStopLoss] = useState(20.0);

    const parallelBaseStake = useRef(parseFloat(parallelStake));
    const currentParallelStake = useRef(parseFloat(parallelStake));
    const parallelMartingaleCounter = useRef(0);
    const parallelPending = useRef(false);
    const parallelBatchId = useRef(null);
    const parallelRemainingCount = useRef(0);
    const parallelBatchProfits = useRef([]);
    const parallelAutoRunActive = useRef(false);
    const parallelVLossCounter = useRef(0);

    // ============================================
    // SCANNER MODE STATE
    // ============================================
    const [scannerStake, setScannerStake] = useState(1.0);
    const [scannerMartingale, setScannerMartingale] = useState(2.0);
    const [scannerMartingaleLimit, setScannerMartingaleLimit] = useState(0);
    const [scannerMartingaleEnabled, setScannerMartingaleEnabled] = useState(true);
    const [scannerStatus, setScannerStatus] = useState('IDLE'); // IDLE | SCANNING | TRADING
    const [scannerActiveSymbol, setScannerActiveSymbol] = useState(null);
    const [scannerContractType, setScannerContractType] = useState(null);
    const [scannerStats, setScannerStats] = useState({ wins: 0, losses: 0 });
    const [scannerSymbolDigits, setScannerSymbolDigits] = useState({});

    // ---- SCANNER SEQUENCE CONFIGURATION ----
    // Each entry: { contract: 'DIGITEVEN', runsPerType: 2 }
    const [scannerSequence, setScannerSequence] = useState([
        { contract: 'DIGITEVEN', runsPerType: 1 },
        { contract: 'DIGITODD', runsPerType: 1 },
    ]);
    const [scannerSeqIndex, setScannerSeqIndex] = useState(0); // which entry in sequence we are on
    const [scannerDetectionCount, setScannerDetectionCount] = useState(2); // consecutive same-parity digits needed to trigger
    const [scannerTakeProfit, setScannerTakeProfit] = useState(10.0); // scanner-specific TP
    const [scannerStopLoss, setScannerStopLoss] = useState(200.0);   // scanner-specific SL

    // Scanner internal refs
    const scannerWsMap = useRef({});
    const scannerDigitHistory = useRef({});
    const scannerTradeLocked = useRef(false);
    const scannerCurrentStake = useRef(1.0);
    const scannerBaseStake = useRef(1.0);
    const scannerMartingaleCounter = useRef(0);
    const scannerLastTradeWasLoss = useRef(false);
    const scannerCurrentContract = useRef(null);
    const scannerCurrentSymbol = useRef(null);
    const scannerIsTrading = useRef(false);
    const scannerPendingContractId = useRef(null);
    const scannerCheckInterval = useRef(null);
    const scannerCooldownUntil = useRef(0);       // timestamp until which new signals are suppressed (5-second hardcoded delay)

    // Pre-proposal fast-entry refs (reduces 1-tick entry lag across all modes)
    const preProposalId           = useRef(null);    // proposal_id from pre-warmed exchange proposal
    const preProposalCreatedAt    = useRef(0);       // ms timestamp when proposal was sent
    const preProposalInFlight     = useRef(false);   // prevents double-sending proposals
    const preProposalContractType = useRef(null);    // contract_type the pre-warmed proposal is for
    const preProposalAmount       = useRef(null);    // stake amount the pre-warmed proposal was created with

    // Sequence rotation refs (for use inside callbacks)
    const scannerSeqIndexRef = useRef(0);        // current sequence slot index
    const scannerSeqRunsRef = useRef(0);         // runs completed in current slot
    const scannerSequenceRef = useRef([          // mirror of scannerSequence state for callback access
        { contract: 'DIGITEVEN', runsPerType: 2 },
        { contract: 'DIGITODD', runsPerType: 2 },
    ]);
    const scannerDetectionCountRef = useRef(2);  // mirror of scannerDetectionCount for callback access
    const scannerTakeProfitRef = useRef(10.0);    // mirror of scannerTakeProfit for callback access
    const scannerStopLossRef = useRef(20.0);      // mirror of scannerStopLoss for callback access

    // --- MARTINGALE ---
    const [martingale, setMartingale] = useState(2.0);
    const [martingaleLimit, setMartingaleLimit] = useState(0);
    const [martingaleEnabled, setMartingaleEnabled] = useState(true);

    // --- TP/SL ---
    const [takeProfit, setTakeProfit] = useState(10.0);
    const [stopLoss, setStopLoss] = useState(20.0);
    const [tickLimit, setTickLimit] = useState(0);

    // --- BOT STATE ---
    const [isBotRunning, setIsBotRunning] = useState(false);
    const [isManualTradePending, setIsManualTradePending] = useState(false);

    // --- PAUSE STATE ---
    const [isPaused, setIsPaused] = useState(false);
    const isPausedRef = useRef(false);

    // --- PRICE & DIGIT DATA ---
    const [fullPrice, setFullPrice] = useState('0.0000');
    const [lastDigit, setLastDigit] = useState(null);
    const [vCounterDisplay, setVCounterDisplay] = useState(0);
    const [ticksProcessed, setTicksProcessed] = useState(0);

    // --- STATISTICS ---
    const [totalPL, setTotalPL] = useState(0.0);
    const [wins, setWins] = useState(0);
    const [losses, setLosses] = useState(0);

    // --- RISE/FALL SPECIFIC STATS ---
    const [riseTrades, setRiseTrades] = useState(0);
    const [fallTrades, setFallTrades] = useState(0);
    const [riseWins, setRiseWins] = useState(0);
    const [fallWins, setFallWins] = useState(0);

    // --- HISTORY & LOGS ---
    const [digitHistory, setDigitHistory] = useState([]);
    const [tradeLogs, setTradeLogs] = useState([]);
    
    // --- TRADE RESULT HISTORY ---
    const [tradeResults, setTradeResults] = useState([]);

    // --- RISE/FALL VISUAL STATES ---
    const [priceDirection, setPriceDirection] = useState('neutral');
    const [priceChange, setPriceChange] = useState(0);
    const [consecutiveUp, setConsecutiveUp] = useState(0);
    const [consecutiveDown, setConsecutiveDown] = useState(0);
    const [priceHistory, setPriceHistory] = useState([]);
    const [activeTradesList, setActiveTradesList] = useState([]);
    const MAX_PRICE_HISTORY = 20;

    // --- RESPONSIVE STATE ---
    const [isMobile, setIsMobile] = useState(window.innerWidth < 768);

    // ============================================
    // 4. SEQUENCE BOT STATE
    // ============================================
    const [seqType1Contract, setSeqType1Contract] = useState('DIGITEVEN');
    const [seqType1Triggers, setSeqType1Triggers] = useState('0,2,4');
    const [seqType1VLoss, setSeqType1VLoss] = useState(2);
    const [seqType1Prediction, setSeqType1Prediction] = useState(1);
    
    const [seqType2Contract, setSeqType2Contract] = useState('DIGITODD');
    const [seqType2Triggers, setSeqType2Triggers] = useState('1,3,5');
    const [seqType2VLoss, setSeqType2VLoss] = useState(2);
    const [seqType2Prediction, setSeqType2Prediction] = useState(1);
    
    const [runsPerType, setRunsPerType] = useState(2);
    const [currentSequenceType, setCurrentSequenceType] = useState(1);
    const [runsCompletedInCurrentType, setRunsCompletedInCurrentType] = useState(0);
    const [totalRunsCompleted, setTotalRunsCompleted] = useState(0);
    
    const seqType1VLossCounter = useRef(0);
    const seqType2VLossCounter = useRef(0);
    const seqTradeTriggered = useRef(false);
    
    const baseStake = useRef(parseFloat(stake));
    const currentStakeValue = useRef(parseFloat(stake));
    const martingaleCounterSeq = useRef(0);
    const lastTradeWasLoss = useRef(false);
    const lastTradeType = useRef(null);
    const lastTradeStake = useRef(0);
    const martingaleMultiplier = useRef(1.0);

    // ============================================
    // 5. DUAL SNIPER STATE
    // ============================================
    const [dualPred1, setDualPred1] = useState('DIGITEVEN');
    const [dualPred2, setDualPred2] = useState('DIGITODD');
    const [dualTarget1, setDualTarget1] = useState(1);
    const [dualTarget2, setDualTarget2] = useState(1);
    const [dualRecoveryMode, setDualRecoveryMode] = useState(false);
    const dualRecoveryModeRef = useRef(false);
    const [dualMartingaleEnabled, setDualMartingaleEnabled] = useState(true);

    const dualBaseStake = useRef(parseFloat(stake));
    const currentDualStake = useRef(parseFloat(stake));
    const dualMartingaleCounter = useRef(0);
    const dualLastLossStake = useRef(0);
    const dualTradeLocked = useRef(false);

    // ============================================
    // 6. OVER/UNDER HEDGE STATE
    // ============================================
    const [hedgeStake, setHedgeStake] = useState(1.0);
    const [hedgeTriggers, setHedgeTriggers] = useState('4,5');
    const [hedgeMartingale, setHedgeMartingale] = useState(2.0);
    const [hedgeMartingaleLimit, setHedgeMartingaleLimit] = useState(0);
    const [hedgeMartingaleEnabled, setHedgeMartingaleEnabled] = useState(true);

    const currentHedgeStake = useRef(1.0);
    const hedgeMartingaleCounter = useRef(0);
    const hedgeTradePending = useRef(false);
    const hedgeLastDigit = useRef(null);
    const hedgeDigitHistory = useRef([]);

    // ============================================
    // 7. SYSTEM REFS
    // ============================================
    const activeTradesCount = useRef(0);
    const processedTxIds = useRef(new Set());
    const virtualStreak = useRef(0);
    const tickCounter = useRef(0);
    const prevTickPrice = useRef(0);
    const publicWs = useRef(null);
    const isProcessingResult = useRef(false);
    const bulkTradesToExecute = useRef(0);
    const currentBulkCount = useRef(0);
    const localProfitTracker = useRef(0);
    const activeContracts = useRef(new Map());
    const runIdRef = useRef(Date.now());
    const botStopHandlerRef = useRef(null);
    const stopReasonRef = useRef(null);
    const tpSlTriggered = useRef(false);

    const tradeQueue = useRef([]);
    const isProcessingQueue = useRef(false);
    const isTradeTriggered = useRef(false);
    const manualTradePlaced = useRef(false);
    
    const pendingTriggeredTrades = useRef([]);
    const isProcessingTrigger = useRef(false);
    const lastTriggerTick = useRef(0);

    const isBotRunningRef = useRef(false);
    const isStoppingRef = useRef(false);
    const isStartingRef = useRef(false);

    const stableCurrentStake = useRef(parseFloat(stake));
    const stableMartingaleCounter = useRef(0);
    const stableLastTradeWasLoss = useRef(false);
    const stableBaseStake = useRef(parseFloat(stake));

    const triggerLocked = useRef(false);
    const stablePredIndex = useRef(0);

    const runsCompletedRef = useRef(0);
    const currentSequenceTypeRef = useRef(1);

    const touchStartY = useRef(0);
    const touchMoved = useRef(false);
    const touchStartTime = useRef(0);
    const scrollContainerRef = useRef(null);
    const digitStreamRef = useRef(null);

    const lastDigitRef = useRef(null);
    const lastPriceRef = useRef(0);

    // WebSocket reconnect variables
    const wsReconnectAttempts = useRef(0);
    const wsReconnectTimeout = useRef(null);
    const wsLastPongTime = useRef(Date.now());

    const dismissKeyboard = useCallback(() => {
        if (document.activeElement && document.activeElement.blur) {
            document.activeElement.blur();
        }
        const inputs = document.querySelectorAll('input, select, textarea');
        inputs.forEach(el => el.blur());
    }, []);

    // ============================================
    // 8. HELPER FUNCTIONS
    // ============================================

    const needsPrediction = (type) => ['DIGITOVER', 'DIGITUNDER', 'DIGITMATCH', 'DIGITDIFF'].includes(type);
    const isRiseFall = (type) => ['CALL', 'PUT'].includes(type);
    const isEvenOdd = (type) => ['DIGITEVEN', 'DIGITODD'].includes(type);

    const getContractEmoji = (type) => {
        if (type === 'CALL') return '📈';
        if (type === 'PUT') return '📉';
        if (type.includes('OVER')) return '⬆️';
        if (type.includes('UNDER')) return '⬇️';
        if (type.includes('EVEN')) return '🟰';
        if (type.includes('ODD')) return '🎲';
        if (type.includes('MATCH')) return '✓';
        if (type.includes('DIFF')) return '≠';
        return '💰';
    };

    const handlePredictionInput = (setter, value, allowEmpty = true) => {
        if (allowEmpty && (value === '' || value === '-')) {
            setter('');
            return;
        }
        const num = parseInt(value);
        if (!isNaN(num) && num >= 0 && num <= 9) {
            setter(num);
        }
    };

    const handleNumberInput = (setter, value, min = 0, max = Infinity, allowEmpty = true, defaultValue = 0) => {
        if (allowEmpty && (value === '' || value === '-')) {
            setter('');
            return;
        }
        const num = parseFloat(value);
        if (!isNaN(num)) {
            let clamped = num;
            if (min !== undefined) clamped = Math.max(min, clamped);
            if (max !== undefined) clamped = Math.min(max, clamped);
            setter(clamped);
        }
    };

    const handleParallelCountInput = (setter, value) => {
        if (value === '' || value === '-') {
            setter('');
            return;
        }
        const num = parseInt(value);
        if (!isNaN(num) && num >= 1 && num <= 9) {
            setter(num);
        }
    };

    const handleDigitInput = (setter, value) => {
        if (value === '') {
            setter('');
            return;
        }
        const parts = value.split(',');
        let isValid = true;
        for (let i = 0; i < parts.length; i++) {
            const part = parts[i].trim();
            if (part === '') continue;
            if (!/^\d*$/.test(part)) {
                isValid = false;
                break;
            }
            if (part.length === 1 && (parseInt(part) < 0 || parseInt(part) > 9)) {
                isValid = false;
                break;
            }
            if (part.length > 1) {
                isValid = false;
                break;
            }
        }
        if (isValid) {
            setter(value);
        }
    };

    useEffect(() => {
        const handleResize = () => {
            setIsMobile(window.innerWidth < 768);
        };
        window.addEventListener('resize', handleResize);
        
        const handleInputEnter = (e) => {
            if (e.key === 'Enter' || e.keyCode === 13) {
                e.target.blur();
            }
        };
        document.addEventListener('keydown', handleInputEnter);
        
        const style = document.createElement('style');
        style.textContent = `
            * {
                -webkit-tap-highlight-color: transparent;
                -webkit-overflow-scrolling: touch;
            }
            .smooth-scroll {
                scroll-behavior: smooth;
                -webkit-overflow-scrolling: touch;
            }
            button, .clickable {
                touch-action: manipulation;
                cursor: pointer;
                -webkit-tap-highlight-color: transparent;
            }
            ::-webkit-scrollbar {
                width: 6px;
                height: 6px;
                background: transparent;
            }
            ::-webkit-scrollbar-thumb {
                background: #3B82F6;
                border-radius: 10px;
                opacity: 0.8;
            }
            ::-webkit-scrollbar-thumb:hover {
                background: #2563EB;
            }
            ::-webkit-scrollbar-track {
                background: rgba(0,0,0,0.05);
                border-radius: 10px;
            }
            .always-show-scrollbar {
                overflow-y: scroll !important;
                -webkit-overflow-scrolling: touch;
            }
            .always-show-scrollbar::-webkit-scrollbar {
                width: 6px;
                background: transparent;
            }
            .always-show-scrollbar::-webkit-scrollbar-thumb {
                background: #3B82F6;
                border-radius: 10px;
            }
            input[type="number"], input[type="text"], input[type="decimal"] {
                -webkit-user-select: text;
                user-select: text;
            }
            input:focus {
                outline: none;
            }
            .inner-scroll-tab input {
                touch-action: manipulation;
            }
            
            @keyframes fadeIn {
                from { opacity: 0; }
                to { opacity: 1; }
            }
            
            @keyframes slideUp {
                from { transform: translateY(20px); opacity: 0; }
                to { transform: translateY(0); opacity: 1; }
            }
            
            @keyframes pulse {
                0%, 100% { opacity: 1; }
                50% { opacity: 0.7; }
            }
            
            @keyframes glow {
                0% { box-shadow: 0 0 5px rgba(59, 130, 246, 0.2); }
                50% { box-shadow: 0 0 20px rgba(59, 130, 246, 0.4); }
                100% { box-shadow: 0 0 5px rgba(59, 130, 246, 0.2); }
            }
            
            .hover-glow:hover {
                box-shadow: 0 0 15px rgba(59, 130, 246, 0.3);
                transition: box-shadow 0.3s ease;
            }
        `;
        document.head.appendChild(style);
        
        return () => {
            window.removeEventListener('resize', handleResize);
            document.removeEventListener('keydown', handleInputEnter);
            document.head.removeChild(style);
        };
    }, []);

    useEffect(() => {
        isBotRunningRef.current = isBotRunning;
    }, [isBotRunning]);

    useEffect(() => {
        dualBaseStake.current = parseFloat(stake);
        currentDualStake.current = parseFloat(stake);
    }, [stake]);

    useEffect(() => {
        currentHedgeStake.current = parseFloat(hedgeStake);
    }, [hedgeStake]);

    useEffect(() => {
        parallelBaseStake.current = parseFloat(parallelStake);
        currentParallelStake.current = parseFloat(parallelStake);
    }, [parallelStake]);

    useEffect(() => {
        parallelTradesRef.current = parallelTrades;
    }, [parallelTrades]);

    // Update parallelTrades array when parallelCount changes
    useEffect(() => {
        setParallelTrades(prev => {
            const newTrades = [...prev];
            
            // If we need more trades
            if (parallelCount > newTrades.length) {
                for (let i = newTrades.length; i < parallelCount; i++) {
                    // Default trade for new slots
                    newTrades.push({ 
                        contract: 'CALL', 
                        prediction: null 
                    });
                }
            } 
            // If we need fewer trades
            else if (parallelCount < newTrades.length) {
                newTrades.length = parallelCount;
            }
            
            // Update the ref as well
            parallelTradesRef.current = newTrades;
            
            return newTrades;
        });
    }, [parallelCount]);

    const handleTouchStart = (e) => {
        const target = e.target;
        if (target.tagName === 'BUTTON' || 
            target.closest('button') || 
            target.tagName === 'INPUT' || 
            target.tagName === 'SELECT' || 
            target.closest('input') ||
            target.closest('select')) {
            return;
        }
        touchStartY.current = e.touches[0].clientY;
        touchMoved.current = false;
        touchStartTime.current = Date.now();
    };

    const handleTouchMove = (e) => {
        const target = e.target;
        if (target.tagName === 'BUTTON' || 
            target.closest('button') || 
            target.tagName === 'INPUT' || 
            target.tagName === 'SELECT' || 
            target.closest('input') ||
            target.closest('select')) {
            return;
        }
        if (!scrollContainerRef.current) return;
        const touchY = e.touches[0].clientY;
        const diff = touchStartY.current - touchY;
        
        if (Math.abs(diff) > 5) {
            touchMoved.current = true;
        }
        
        scrollContainerRef.current.scrollTop += diff;
        touchStartY.current = touchY;
    };

    // ============================================
    // 9. JOURNAL LOGGING SYSTEM
    // ============================================
    const logToJournal = useCallback((message, type = 'info', pushToDeriv = false) => {
        const timestamp = new Date().toLocaleTimeString();
        const logMsg = `[${timestamp}] [Nyanyuki] ${message}`;

        const colors = {
            error: '#EF4444',
            success: '#10B981',
            warn: '#F59E0B',
            info: '#3B82F6'
        };
        console.log(`%c${logMsg}`, `color: ${colors[type] || '#3B82F6'}`);

        setTradeLogs(prev => [
            { id: Date.now(), message: logMsg, type, timestamp },
            ...prev.slice(0, 49)
        ]);

        if (pushToDeriv && botObserver) {
            try {
                botObserver.emit('bot.message', {
                    message: `[Nyanyuki] ${message}`,
                    className: type,
                    timestamp: Date.now(),
                    data: {
                        mode: mode,
                        pl: localProfitTracker.current,
                        activeTrades: activeTradesCount.current
                    }
                });
            } catch (err) {
                console.error('Failed to emit message event:', err);
            }
        }
    }, [botObserver, mode, localProfitTracker, activeTradesCount]);

    const clearLogs = useCallback(() => {
        setTradeLogs([]);
        logToJournal('Logs cleared', 'info', true);
    }, [logToJournal]);

    // ============================================
    // 10. DERIV TRANSACTION REGISTRATION
    // ============================================
    const registerTransactionInPanel = useCallback((contractInfo, isSell = false) => {
        if (!isSell) {
            return false;
        }

        const emoji = getContractEmoji(contractInfo.contract_type);
        const journalMsg = `${emoji} ${contractInfo.contract_type} | P/L: ${contractInfo.profit >= 0 ? '+' : ''}$${parseFloat(contractInfo.profit || 0).toFixed(2)}`;

        logToJournal(journalMsg, contractInfo.profit > 0 ? 'success' : 'error', true);

        if (!transactionsStore?.pushTransaction) return false;

        const transactionData = {
            contract_id:        contractInfo.contract_id,
            transaction_ids:    contractInfo.transaction_ids || { buy: contractInfo.contract_id, sell: contractInfo.contract_id },
            run_id:             runIdRef.current,
            contract_type:      contractInfo.contract_type,
            display_name:       contractInfo.display_name || symbol,
            underlying:         symbol,
            shortcode:          contractInfo.shortcode || `${contractInfo.contract_type}_${symbol}`,
            barrier:            contractInfo.barrier !== undefined ? String(contractInfo.barrier) : undefined,
            buy_price:          parseFloat(contractInfo.buy_price || contractInfo.stake || 0),
            sell_price:         parseFloat(contractInfo.sell_price || 0),
            payout:             parseFloat(contractInfo.payout || 0),
            profit:             parseFloat(contractInfo.profit || 0),
            currency:           currency || 'USD',
            status:             contractInfo.profit > 0 ? 'won' : 'lost',
            is_sold:            true,
            is_completed:       true,
            entry_tick_display_value: contractInfo.entry_tick_display_value || undefined,
            exit_tick_display_value:  contractInfo.exit_tick_display_value || undefined,
            entry_tick_time:          contractInfo.entry_tick_time || undefined,
            exit_tick_time:           contractInfo.exit_tick_time || undefined,
            date_start:    contractInfo.date_start || new Date().toISOString(),
            date_expiry:   contractInfo.date_expiry || undefined,
            purchase_time: contractInfo.purchase_time || Date.now(),
            isDual:        contractInfo.isDual,
            dualSlot:      contractInfo.dualSlot,
            is_manual:     contractInfo.is_manual,
            hedge_position: contractInfo.hedge_position,
            isSequence:    contractInfo.isSequence,
            sequenceType:  contractInfo.sequenceType,
            isTriggeredTrade: contractInfo.isTriggeredTrade || false,
            isStableAggressive: contractInfo.isStableAggressive || false,
            aggressiveMode: contractInfo.aggressiveMode || false,
            isStrike:      contractInfo.isStrike,
            strikeIsRecovery: contractInfo.strikeIsRecovery,
            isParallel:    contractInfo.isParallel,
            parallelBatchId: contractInfo.parallelBatchId,
            parallelSlot:  contractInfo.parallelSlot,
        };

        try {
            transactionsStore.pushTransaction(transactionData);
            
            if (runPanelStore?.updateContractCount) {
                runPanelStore.updateContractCount(activeTradesCount.current || 0);
            }
            
            return true;
        } catch (err) {
            console.error('[Nyanyuki] pushTransaction failed:', err);
            return false;
        }
    }, [logToJournal, transactionsStore, currency, symbol, runPanelStore, activeTradesCount]);

    // ============================================
    // 11. RUN PANEL SYNC
    // ============================================
    const updateRunPanelContractCount = useCallback((count) => {
        if (runPanelStore?.updateContractCount) {
            runPanelStore.updateContractCount(count);
        }
    }, [runPanelStore]);

    // ============================================
    // 12. SELL ALL ACTIVE CONTRACTS
    // ============================================
    const sellAllActiveContracts = useCallback(async () => {
        if (activeContracts.current.size === 0) {
            logToJournal('No active contracts to sell', 'info');
            return;
        }

        logToJournal('🛑 STOPPING BOT - Selling all active contracts...', 'warn', true);

        const contractsToSell = Array.from(activeContracts.current.keys());
        let soldCount = 0;
        let failedCount = 0;

        for (const contractId of contractsToSell) {
            try {
                const intervalId = activeContracts.current.get(contractId);
                if (intervalId) {
                    clearInterval(intervalId);
                    activeContracts.current.delete(contractId);
                }

                const res = await sendTradeRequest({
                    sell: 1,
                    contract_id: contractId
                });

                if (res.error) {
                    logToJournal(`Failed to sell contract ${contractId}: ${res.error.message}`, 'error');
                    failedCount++;
                } else {
                    logToJournal(`✅ Contract ${contractId} sold successfully`, 'success');
                    soldCount++;

                    setActiveTradesList(prev => prev.filter(t => t.id !== contractId));
                }
            } catch (err) {
                logToJournal(`Error selling contract ${contractId}: ${err.message}`, 'error');
                failedCount++;
            }

            await new Promise(resolve => setTimeout(resolve, 100));
        }

        activeTradesCount.current = 0;
        updateRunPanelContractCount(0);
        isTradeTriggered.current = false;
        dualTradeLocked.current = false;
        seqTradeTriggered.current = false;
        hedgeTradePending.current = false;
        parallelPending.current = false;
        tradeQueue.current = [];
        isProcessingQueue.current = false;
        manualTradePlaced.current = false;
        setIsManualTradePending(false);
        
        triggerLocked.current = false;
        scannerTradeLocked.current = false;
        scannerIsTrading.current = false;

        logToJournal(`✅ Stopped - Sold: ${soldCount}, Failed: ${failedCount}`, 'success', true);

        return { soldCount, failedCount };
    }, [logToJournal, updateRunPanelContractCount, sendTradeRequest]);
    

    // ============================================
    // 13. DIGIT STATISTICS
    // ============================================
    const digitStats = useMemo(() => {
        if (digitHistory.length === 0) return Array(10).fill("0.0");
        const counts = Array(10).fill(0);
        digitHistory.forEach(d => {
            if (d >= 0 && d <= 9) counts[d]++;
        });
        return counts.map(c => ((c / digitHistory.length) * 100).toFixed(1));
    }, [digitHistory]);

    const heatmapRange = useMemo(() => {
        const stats = digitStats.map(Number);
        const max = Math.max(...stats);
        const min = Math.min(...stats);
        return { max, min };
    }, [digitStats]);

    const getPercentColor = (valStr) => {
        const val = Number(valStr);
        if (val === 0) return '#94A3B8';
        if (val === heatmapRange.max && val !== heatmapRange.min) return '#10B981';
        if (val === heatmapRange.min && val !== heatmapRange.max) return '#EF4444';
        return '#64748B';
    };

    const getCurrentPred = useCallback(() => {
        const pList = [parseInt(pred1), parseInt(pred2), parseInt(pred3)];
        if (mode === 'AGGRESSIVE') {
            return pList[aggressivePredIndex.current];
        }
        if (mode === 'STABLE') {
            return pList[stablePredIndex.current];
        }
        return pList[activePredIndex.current];
    }, [pred1, pred2, pred3, mode]);

    // ============================================
    // 14. DIGIT CELL BORDER - STRICT EVEN/ODD COLORS
    // ============================================
    const getDigitCellBorder = (d) => {
        if (lastDigit !== d) return '1px solid #E2E8F0';
        const isEven = d % 2 === 0;
        return `2px solid ${isEven ? '#10B981' : '#EF4444'}`;
    };

    // ============================================
    // 15. RESET FUNCTION
    // ============================================
    const handleReset = useCallback(() => {
        activeContracts.current.forEach((intervalId) => {
            clearInterval(intervalId);
        });
        activeContracts.current.clear();

        processedTxIds.current.clear();
        setTotalPL(0.0);
        setWins(0);
        setLosses(0);
        setRiseTrades(0);
        setFallTrades(0);
        setRiseWins(0);
        setFallWins(0);
        setActiveTradesList([]);
        setTradeResults([]);
        tpSlTriggered.current = false;

        localProfitTracker.current = 0;
        
        setCurrentSequenceType(1);
        setRunsCompletedInCurrentType(0);
        setTotalRunsCompleted(0);
        seqType1VLossCounter.current = 0;
        seqType2VLossCounter.current = 0;
        seqTradeTriggered.current = false;
        
        baseStake.current = parseFloat(stake);
        currentStakeValue.current = parseFloat(stake);
        martingaleCounterSeq.current = 0;
        lastTradeWasLoss.current = false;
        lastTradeType.current = null;
        lastTradeStake.current = 0;
        martingaleMultiplier.current = 1.0;
        
        dualBaseStake.current = parseFloat(stake);
        currentDualStake.current = parseFloat(stake);
        dualMartingaleCounter.current = 0;
        setDualRecoveryMode(false);
        dualRecoveryModeRef.current = false;
        dualLastLossStake.current = 0;
        dualTradeLocked.current = false;

        currentHedgeStake.current = parseFloat(hedgeStake);
        hedgeMartingaleCounter.current = 0;
        hedgeTradePending.current = false;
        hedgeLastDigit.current = null;
        hedgeDigitHistory.current = [];

        parallelBaseStake.current = parseFloat(parallelStake);
        currentParallelStake.current = parseFloat(parallelStake);
        parallelMartingaleCounter.current = 0;
        parallelPending.current = false;
        parallelBatchId.current = null;
        parallelRemainingCount.current = 0;
        parallelBatchProfits.current = [];
        parallelAutoRunActive.current = false;
        parallelVLossCounter.current = 0;

        virtualStreak.current = 0;
        setVCounterDisplay(0);
        tickCounter.current = 0;
        setTicksProcessed(0);
        activeTradesCount.current = 0;
        updateRunPanelContractCount(0);
        isProcessingResult.current = false;
        bulkTradesToExecute.current = 0;
        currentBulkCount.current = 0;

        tradeQueue.current = [];
        isProcessingQueue.current = false;
        isTradeTriggered.current = false;
        manualTradePlaced.current = false;
        setIsManualTradePending(false);
        
        pendingTriggeredTrades.current = [];
        isProcessingTrigger.current = false;

        stableCurrentStake.current = parseFloat(stake);
        stableMartingaleCounter.current = 0;
        stableLastTradeWasLoss.current = false;
        stableBaseStake.current = parseFloat(stake);

        triggerLocked.current = false;

        strikePhase.current = 'HUNT';
        strikeVLossCounter.current = 0;
        strikeInRecovery.current = false;
        strikeCurrentStake.current = parseFloat(stake);
        strikeMartingaleCounter.current = 0;
        strikeBaseStake.current = parseFloat(stake);
        strikeTradeLocked.current = false;

        runsCompletedRef.current = 0;
        currentSequenceTypeRef.current = 1;

        activePredIndex.current = 0;
        aggressivePredIndex.current = 0;
        stablePredIndex.current = 0;

        // Scanner reset
        scannerTradeLocked.current = false;
        scannerCurrentStake.current = parseFloat(scannerStake);
        scannerBaseStake.current = parseFloat(scannerStake);
        scannerMartingaleCounter.current = 0;
        scannerLastTradeWasLoss.current = false;
        scannerCurrentContract.current = null;
        scannerCurrentSymbol.current = null;
        scannerIsTrading.current = false;
        scannerPendingContractId.current = null;
        scannerSeqIndexRef.current = 0;
        scannerSeqRunsRef.current = 0;
        setScannerSeqIndex(0);
        if (scannerCheckInterval.current) {
            clearInterval(scannerCheckInterval.current);
            scannerCheckInterval.current = null;
        }
        setScannerStatus('IDLE');
        setScannerActiveSymbol(null);
        setScannerContractType(null);
        setScannerStats({ wins: 0, losses: 0 });
        setScannerSymbolDigits({});
        scannerDigitHistory.current = {};

        setPriceDirection('neutral');
        setPriceChange(0);
        setConsecutiveUp(0);
        setConsecutiveDown(0);
        setPriceHistory([]);
        
        isPausedRef.current = false;
        setIsPaused(false);
        runIdRef.current = Date.now();
        logToJournal('🔄 Bot reset complete', 'info', true);
    }, [stake, hedgeStake, parallelStake, scannerStake, logToJournal, updateRunPanelContractCount]);

    // ============================================
    // 16. SYNC WITH RUN PANEL
    // ============================================
    const syncWithRunPanel = useCallback(async (isRunning) => {
        const currentlyRunning = isBotRunningRef.current;
        
        if (!isRunning && currentlyRunning) {
            if (isStoppingRef.current) return;
            isStoppingRef.current = true;
            
            if (botObserver) {
                botObserver.emit('bot.message', {
                    message: `[Nyanyuki Pro] ⏹️ Bot stopped | Mode: ${mode} | P/L: $${localProfitTracker.current.toFixed(2)}`,
                    className: localProfitTracker.current >= 0 ? 'success' : 'warn',
                    timestamp: Date.now()
                });
            }
            
            isBotRunningRef.current = false;
            setIsBotRunning(false);
            isPausedRef.current = false;
            setIsPaused(false);
            
            if (runPanelStore) {
                runPanelStore.is_running = false;
                runPanelStore.setHasOpenContract(false);
                botObserver.emit('bot.stop', {});
                
                if (runPanelStore.unregisterBotListeners) {
                    runPanelStore.unregisterBotListeners();
                }
            }
            
            await sellAllActiveContracts();
            
            activeContracts.current.forEach((intervalId) => {
                clearInterval(intervalId);
            });
            activeContracts.current.clear();
            
            isProcessingResult.current = false;
            bulkTradesToExecute.current = 0;
            currentBulkCount.current = 0;
            
            logToJournal('🟡 Bot Stopped - All trades closed', 'info', true);
            
            stopReasonRef.current = null;
            
            if (window.dbot?.stopAnimation) {
                window.dbot.stopAnimation();
            }
            
            isStoppingRef.current = false;
            
        } else if (isRunning && !currentlyRunning && mode !== 'MANUAL') {

            isBotRunningRef.current = true;
            setIsBotRunning(true);
            tpSlTriggered.current = false;
            
            if (runPanelStore) {
                runPanelStore.is_running = true;
                runPanelStore.toggleDrawer(true);
                runPanelStore.setActiveTabIndex(0);
                
                if (runPanelStore.registerBotListeners) {
                    runPanelStore.registerBotListeners();
                }
                
                botObserver.emit('bot.running', {});
            }
            
            logToJournal(`▶️ Nyanyuki Pro (${mode}) started`, 'info', true);
            
            if (window.dbot?.startAnimation) {
                window.dbot.startAnimation();
            }
        }
    }, [logToJournal, runPanelStore, mode, sellAllActiveContracts, botObserver, localProfitTracker]);

    // ============================================
    // 17. RUN PANEL LISTENER — FIXED (No random starts)
    // ============================================
    useEffect(() => {
        if (!runPanelStore) return;

        let originalValue = runPanelStore.is_running;
        
        try {
            Object.defineProperty(runPanelStore, 'is_running', {
                get: () => originalValue,
                set: (newValue) => {
                    const oldValue = originalValue;
                    originalValue = newValue;
                    
                    if (newValue === false && oldValue === true && isBotRunningRef.current && !isStoppingRef.current) {
                        console.log('[Nyanyuki] Run Panel STOP via property change');
                        syncWithRunPanel(false);
                    }
                },
                configurable: true,
                enumerable: true
            });
        } catch (e) {
            console.warn('[Nyanyuki] Could not override is_running property', e);
        }

        let lastKnownState = runPanelStore.is_running;
        const backupInterval = setInterval(() => {
            if (!runPanelStore) return;
            const currentState = runPanelStore.is_running;
            if (currentState !== lastKnownState) {
                lastKnownState = currentState;
                if (currentState === false && isBotRunningRef.current && !isStoppingRef.current) {
                    console.log('[Nyanyuki] Backup check: STOP detected');
                    syncWithRunPanel(false);
                }
            }
        }, 100);
        
        return () => {
            clearInterval(backupInterval);
        };

    }, [runPanelStore, syncWithRunPanel]);

    // ============================================
    // 18. HANDLE SEQUENCE TRADE COMPLETION
    // ============================================
    const handleSequenceTradeComplete = useCallback((type, profit) => {
        runsCompletedRef.current += 1;
        const newCount = runsCompletedRef.current;
        
        setTotalRunsCompleted(total => total + 1);
        setRunsCompletedInCurrentType(newCount);
        
        logToJournal(`📊 Type ${type} run ${newCount}/${runsPerType} complete: ${profit > 0 ? 'WIN ✅' : 'LOSS ❌'} ($${profit.toFixed(2)})`, profit > 0 ? 'success' : 'error', true);
        
        if (newCount >= runsPerType) {
            const nextType = type === 1 ? 2 : 1;
            currentSequenceTypeRef.current = nextType;
            setCurrentSequenceType(nextType);
            runsCompletedRef.current = 0;
            setRunsCompletedInCurrentType(0);
            logToJournal(`🔄 SEQUENCE: Switching to Type ${nextType} after ${runsPerType} runs in Type ${type}`, 'info', true);
        }
        
        if (profit < 0 && martingaleEnabled) {
            lastTradeWasLoss.current = true;
            martingaleCounterSeq.current += 1;
            const multiplier = Math.pow(parseFloat(martingale), martingaleCounterSeq.current);
            currentStakeValue.current = parseFloat((baseStake.current * multiplier).toFixed(2));
            logToJournal(`📉 Loss. Martingale next: ${baseStake.current} × ${martingale}^${martingaleCounterSeq.current} = $${currentStakeValue.current} (${martingaleCounterSeq.current}/${martingaleLimit === 0 ? '∞' : martingaleLimit})`, 'warn', true);
        } else if (profit > 0) {
            lastTradeWasLoss.current = false;
            martingaleCounterSeq.current = 0;
            currentStakeValue.current = baseStake.current;
            logToJournal(`✅ Win. Martingale reset to $${baseStake.current}.`, 'success', true);
        }
        
        seqTradeTriggered.current = false;
        triggerLocked.current = false;
        logToJournal(`🔓 Sequence unlocked - ready for next trigger`, 'info', true);
    }, [runsPerType, martingaleEnabled, martingale, martingaleLimit, logToJournal]);

    // ============================================
    // 19. TRADE MONITORING SYSTEM
    // ============================================
    const monitorTrade = useCallback((contractId, buyData) => {
        if (!isBotRunningRef.current && !buyData.is_manual) return;

        const checkInterval = setInterval(async () => {
            try {
                if (!isBotRunningRef.current && !buyData.is_manual) {
                    clearInterval(checkInterval);
                    activeContracts.current.delete(contractId);
                    setActiveTradesList(prev => prev.filter(t => t.id !== contractId));
                    activeTradesCount.current = Math.max(0, activeTradesCount.current - 1);
                    updateRunPanelContractCount(activeTradesCount.current);

                    if (activeTradesCount.current === 0) {
                        isTradeTriggered.current = false;
                        dualTradeLocked.current = false;
                        hedgeTradePending.current = false;
                        triggerLocked.current = false;
                        seqTradeTriggered.current = false;
                        strikeTradeLocked.current = false;
                        if (parallelPending.current && parallelBatchId.current) {
                            parallelPending.current = false;
                            parallelBatchId.current = null;
                            parallelRemainingCount.current = 0;
                            parallelBatchProfits.current = [];
                        }
                    }
                    return;
                }

                const res = await sendTradeRequest({
                    proposal_open_contract: 1,
                    contract_id: contractId
                });

                if (res.error) {
                    logToJournal(`Monitor error: ${res.error.message}`, 'error');
                    clearInterval(checkInterval);
                    activeContracts.current.delete(contractId);
                    activeTradesCount.current = Math.max(0, activeTradesCount.current - 1);
                    updateRunPanelContractCount(activeTradesCount.current);

                    setActiveTradesList(prev => prev.filter(t => t.id !== contractId));

                    if (activeTradesCount.current === 0) {
                        isTradeTriggered.current = false;
                        dualTradeLocked.current = false;
                        hedgeTradePending.current = false;
                        triggerLocked.current = false;
                        seqTradeTriggered.current = false;
                        strikeTradeLocked.current = false;
                        if (parallelPending.current && parallelBatchId.current) {
                            parallelPending.current = false;
                            parallelBatchId.current = null;
                            parallelRemainingCount.current = 0;
                            parallelBatchProfits.current = [];
                        }
                    }
                    return;
                }

                const contract = res.proposal_open_contract;

                if (contract && contract.is_sold) {
                    clearInterval(checkInterval);
                    activeContracts.current.delete(contractId);

                    const txId = contract.transaction_id || contractId;
                    if (processedTxIds.current.has(txId)) return;
                    processedTxIds.current.add(txId);

                    // Discard any pre-warmed proposal — stake may change after
                    // this result (martingale up on loss, reset on win).
                    // Keeping a stale proposal would cause the next buy to
                    // execute at the old amount instead of the correct stake.
                    preProposalId.current = null;
                    preProposalContractType.current = null;

                    const profit = parseFloat(contract.profit || 0);

                    botObserver.emit('contract.status', {
                        id: 'contract.sold',
                        data: 0,
                        contract: { ...contract, profit }
                    });

                    botObserver.emit('bot.contract', {
                        ...contract,
                        buy_price:     parseFloat(buyData.stake || 0),
                        sell_price:    parseFloat(contract.sell_price || 0),
                        profit:        profit,
                        contract_type: buyData.contract_type,
                        currency:      currency || 'USD',
                        is_sold:       true,
                        underlying:    symbol,
                        payout:        parseFloat(contract.payout || 0),
                        entry_tick:    contract.entry_tick,
                        exit_tick:     contract.exit_tick,
                        barrier:       buyData.barrier,
                        run_id:        runIdRef.current,
                    });

                    setActiveTradesList(prev => prev.filter(t => t.id !== contractId));
                    localProfitTracker.current = parseFloat((localProfitTracker.current + profit).toFixed(2));
                    setTotalPL(localProfitTracker.current);

                    const sellTransaction = {
                        contract_id:     contractId,
                        transaction_ids: {
                            buy:  contract.transaction_ids?.buy  || contractId,
                            sell: contract.transaction_ids?.sell || contract.transaction_id
                        },
                        run_id: runIdRef.current,
                        contract_type:  buyData.contract_type,
                        display_name:   symbol,
                        underlying:     symbol,
                        shortcode:      contract.shortcode || buyData.shortcode,
                        barrier:        buyData.barrier !== undefined ? String(buyData.barrier) : undefined,
                        buy_price:  parseFloat(buyData.buy_price || buyData.stake || 0),
                        sell_price: parseFloat(contract.sell_price || 0),
                        payout:     parseFloat(contract.payout || 0),
                        profit:     profit,
                        currency:   currency || 'USD',
                        status:       profit > 0 ? 'won' : 'lost',
                        is_sold:      true,
                        is_completed: true,
                        entry_tick_display_value: contract.entry_tick_display_value,
                        exit_tick_display_value:  contract.exit_tick_display_value,
                        entry_tick_time:          contract.entry_tick_time,
                        exit_tick_time:           contract.exit_tick_time,
                        date_start:    new Date(buyData.purchase_time || Date.now()).toISOString(),
                        date_expiry:   contract.date_expiry,
                        purchase_time: buyData.purchase_time,
                        isDual:        buyData.isDual,
                        dualSlot:      buyData.dualSlot,
                        is_manual:     buyData.is_manual,
                        hedge_position: buyData.hedge_position,
                        isSequence:    buyData.isSequence,
                        sequenceType:  buyData.sequenceType,
                        isTriggeredTrade: buyData.isTriggeredTrade || false,
                        isStableAggressive: buyData.isStableAggressive || false,
                        aggressiveMode: buyData.aggressiveMode || false,
                        isStrike:      buyData.isStrike,
                        strikeIsRecovery: buyData.strikeIsRecovery,
                        isParallel:    buyData.isParallel,
                        parallelBatchId: buyData.parallelBatchId,
                        parallelSlot:  buyData.parallelSlot,
                    };

                    registerTransactionInPanel(sellTransaction, true);

                    let exitDigit = null;
                    if (contract.exit_tick_display_value) {
                        const exitStr = contract.exit_tick_display_value.toString();
                        exitDigit = parseInt(exitStr.slice(-1));
                    } else if (contract.exit_tick) {
                        const exitStr = contract.exit_tick.toString();
                        exitDigit = parseInt(exitStr.slice(-1));
                    } else {
                        exitDigit = lastDigitRef.current;
                    }
                    
                    if (exitDigit !== null && !isNaN(exitDigit) && exitDigit >= 0 && exitDigit <= 9) {
                        const result = {
                            id: `trade_${contractId}_${Date.now()}`,
                            digit: exitDigit,
                            result: profit > 0 ? 'win' : 'loss',
                            profit: profit,
                            timestamp: Date.now(),
                            type: buyData.isSequence ? `Seq T${buyData.sequenceType}` : 
                                  buyData.isDual ? `Dual T${buyData.dualSlot}` :
                                  buyData.hedge_position ? 'Hedge' : 
                                  buyData.isStrike ? 'Strike' : 
                                  buyData.isParallel ? 'Parallel' : 'Norm'
                        };
                        
                        setTradeResults(prev => {
                            try {
                                const safePrev = Array.isArray(prev) ? prev : [];
                                const now = Date.now();
                                const filtered = safePrev.filter(r => r && (now - r.timestamp < 1000));
                                return [result, ...filtered].slice(0, 50);
                            } catch(e) {
                                return [result];
                            }
                        });
                    }

                    if (buyData.isSequence) {
                        handleSequenceTradeComplete(buyData.sequenceType, profit);
                    }

                    if (buyData.isStrike) {
                        strikeTradeLocked.current = false;

                        if (buyData.strikeIsRecovery) {
                            if (profit > 0) {
                                setWins(prev => prev + 1);
                                logToJournal(`✅ STRIKE: Recovery won $${profit.toFixed(2)} → continuing run`, 'success', true);
                                strikeInRecovery.current = false;
                                strikeMartingaleCounter.current = 0;
                                strikeCurrentStake.current = strikeBaseStake.current;
                            } else {
                                setLosses(prev => prev + 1);
                                logToJournal(`❌ STRIKE: Recovery lost $${profit.toFixed(2)} → martingale recovery`, 'warn', true);
                                if (martingaleEnabled) {
                                    strikeMartingaleCounter.current += 1;
                                    if (martingaleLimit !== 0 && strikeMartingaleCounter.current >= martingaleLimit) {
                                        strikeCurrentStake.current = strikeBaseStake.current;
                                        strikeMartingaleCounter.current = 0;
                                        logToJournal(`⚠️ STRIKE: Martingale limit reached, resetting`, 'warn', true);
                                    } else {
                                        const multiplier = Math.pow(parseFloat(martingale), strikeMartingaleCounter.current);
                                        strikeCurrentStake.current = parseFloat((strikeBaseStake.current * multiplier).toFixed(2));
                                        logToJournal(`📈 STRIKE: Recovery martingale → $${strikeCurrentStake.current}`, 'info', true);
                                    }
                                }
                            }
                        } else {
                            if (profit > 0) {
                                setWins(prev => prev + 1);
                                logToJournal(`✅ STRIKE: Main trade won $${profit.toFixed(2)}`, 'success', true);
                                strikeInRecovery.current = false;
                                strikeMartingaleCounter.current = 0;
                                strikeCurrentStake.current = strikeBaseStake.current;
                            } else {
                                setLosses(prev => prev + 1);
                                logToJournal(`❌ STRIKE: Main trade lost → entering recovery`, 'warn', true);
                                strikeInRecovery.current = true;
                                if (martingaleEnabled) {
                                    strikeMartingaleCounter.current = 1;
                                    const multiplier = Math.pow(parseFloat(martingale), 1);
                                    strikeCurrentStake.current = parseFloat((strikeBaseStake.current * multiplier).toFixed(2));
                                    logToJournal(`📈 STRIKE: Recovery stake → $${strikeCurrentStake.current}`, 'info', true);
                                }
                            }
                            if (strikePhase.current === 'HUNT') {
                                strikePhase.current = 'RUN';
                                logToJournal(`🚀 STRIKE: Entry confirmed → AUTO-RUN phase started`, 'success', true);
                            }
                        }
                        return;
                    }

                    if (buyData.isParallel && buyData.parallelBatchId) {
                        const batchId = buyData.parallelBatchId;
                        const slot = buyData.parallelSlot;
                        if (parallelBatchId.current === batchId) {
                            parallelBatchProfits.current[slot] = profit;
                            parallelRemainingCount.current--;
                            
                            logToJournal(`📊 PARALLEL slot ${slot+1}/${parallelCount} completed: ${profit > 0 ? 'WIN' : 'LOSS'} $${profit.toFixed(2)} (${parallelRemainingCount.current} remaining)`, profit > 0 ? 'success' : 'error', true);
                        }
                        
                        if (parallelRemainingCount.current === 0 && parallelBatchId.current === batchId) {
                            const totalBatchProfit = parallelBatchProfits.current.reduce((sum, p) => sum + (p || 0), 0);
                            logToJournal(`🏁 PARALLEL batch complete: total profit = $${totalBatchProfit.toFixed(2)}`, totalBatchProfit >= 0 ? 'success' : 'error', true);
                            
                            const batchWins = parallelBatchProfits.current.filter(p => p > 0).length;
                            const batchLosses = parallelBatchProfits.current.filter(p => p < 0).length;
                            setWins(prev => prev + batchWins);
                            setLosses(prev => prev + batchLosses);
                            
                            if (parallelMartingaleEnabled) {
                                if (totalBatchProfit < 0) {
                                    parallelMartingaleCounter.current++;
                                    if (parallelMartingaleLimit !== 0 && parallelMartingaleCounter.current >= parallelMartingaleLimit) {
                                        currentParallelStake.current = parallelBaseStake.current;
                                        parallelMartingaleCounter.current = 0;
                                        logToJournal(`📉 Batch loss – martingale limit reached, resetting stake to $${parallelBaseStake.current}`, 'warn', true);
                                    } else {
                                        const multiplier = Math.pow(parallelMartingale, parallelMartingaleCounter.current);
                                        currentParallelStake.current = parseFloat((parallelBaseStake.current * multiplier).toFixed(2));
                                        logToJournal(`📈 Batch loss – martingale: next stake = $${currentParallelStake.current} (${parallelMartingaleCounter.current}/${parallelMartingaleLimit === 0 ? '∞' : parallelMartingaleLimit})`, 'info', true);
                                    }
                                } else {
                                    parallelMartingaleCounter.current = 0;
                                    currentParallelStake.current = parallelBaseStake.current;
                                    logToJournal(`✅ Batch win – martingale reset to $${parallelBaseStake.current}`, 'success', true);
                                }
                            }
                            
                            parallelPending.current = false;
                            parallelBatchId.current = null;
                            parallelBatchProfits.current = [];
                            isTradeTriggered.current = false;
                            triggerLocked.current = false;
                            
                            const newTotalPL = localProfitTracker.current;
                            if (!tpSlTriggered.current && parseFloat(parallelTakeProfit) > 0 && newTotalPL >= parseFloat(parallelTakeProfit)) {
                                tpSlTriggered.current = true;
                                logToJournal(`🎯 Take Profit reached: $${newTotalPL.toFixed(2)}`, 'success', true);
                                botNotification(`🎯 Nyanyuki Pro — Take Profit Hit! P/L: +$${newTotalPL.toFixed(2)}`, undefined, { type: 'success', autoClose: 8000 });
                                parallelAutoRunActive.current = false;
                                syncWithRunPanel(false);
                            } else if (!tpSlTriggered.current && parseFloat(parallelStopLoss) > 0 && newTotalPL <= -parseFloat(parallelStopLoss)) {
                                tpSlTriggered.current = true;
                                logToJournal(`🛑 Stop Loss triggered: $${newTotalPL.toFixed(2)}`, 'error', true);
                                botNotification(`🛑 Nyanyuki Pro — Stop Loss Hit! P/L: $${newTotalPL.toFixed(2)}`, undefined, { type: 'error', autoClose: 8000 });
                                parallelAutoRunActive.current = false;
                                syncWithRunPanel(false);
                            } else if (parallelAutoRunActive.current && isBotRunningRef.current && !tpSlTriggered.current) {
                                logToJournal(`🔁 PARALLEL AUTO-RUN: Firing next batch immediately`, 'info', true);
                                setTimeout(() => {
                                    if (isBotRunningRef.current && parallelAutoRunActive.current && !tpSlTriggered.current) {
                                        executeParallelTrades();
                                    }
                                }, 500);
                            }
                        }
                        return;
                    }

                    if (buyData.isDual && buyData.dualSlot === 2) {
                        if (profit > 0) {
                            logToJournal(`✅ DUAL: Type 2 won ($${profit.toFixed(2)}) → Back to Type 1`, 'success', true);
                            dualRecoveryModeRef.current = false;
                            setDualRecoveryMode(false);
                            dualMartingaleCounter.current = 0;
                            currentDualStake.current = dualBaseStake.current;
                            triggerLocked.current = false;
                            dualTradeLocked.current = false;
                            logToJournal(`🔓 DUAL: Type 1 trigger unlocked — waiting for next trigger digit`, 'info', true);
                            setWins(prev => prev + 1);
                        } else if (profit < 0) {
                            logToJournal(`❌ DUAL: Type 2 lost ($${profit.toFixed(2)}) → Staying in recovery`, 'warn', true);
                            dualRecoveryModeRef.current = true;
                            if (dualMartingaleEnabled) {
                                dualMartingaleCounter.current += 1;
                                if (parseInt(martingaleLimit) !== 0 && dualMartingaleCounter.current >= parseInt(martingaleLimit)) {
                                    currentDualStake.current = dualBaseStake.current;
                                    dualMartingaleCounter.current = 0;
                                    logToJournal(`⚠️ Type 2 martingale limit reached, resetting stake to $${dualBaseStake.current}`, 'warn', true);
                                } else {
                                    const multiplier = Math.pow(parseFloat(martingale), dualMartingaleCounter.current);
                                    currentDualStake.current = parseFloat((dualBaseStake.current * multiplier).toFixed(2));
                                    logToJournal(`📈 Type 2 martingale: $${dualBaseStake.current} × ${martingale}^${dualMartingaleCounter.current} = $${currentDualStake.current}`, 'info', true);
                                }
                            }
                            dualTradeLocked.current = false;
                            setLosses(prev => prev + 1);
                        }
                    }

                    if (buyData.isDual && buyData.dualSlot === 1) {
                        if (profit > 0) {
                            logToJournal(`✅ DUAL: Type 1 won ($${profit.toFixed(2)}) → Continuing Type 1`, 'success', true);
                            dualRecoveryModeRef.current = false;
                            setDualRecoveryMode(false);
                            triggerLocked.current = false;
                            dualMartingaleCounter.current = 0;
                            currentDualStake.current = dualBaseStake.current;
                            setWins(prev => prev + 1);
                        } else if (profit < 0) {
                            dualLastLossStake.current = Math.abs(profit);
                            logToJournal(`❌ DUAL: Type 1 lost ($${profit.toFixed(2)}) → Switching to Type 2 recovery`, 'warn', true);
                            dualRecoveryModeRef.current = true;
                            setDualRecoveryMode(true);
                            dualTradeLocked.current = false;
                            if (dualMartingaleEnabled) {
                                dualMartingaleCounter.current = 1;
                                const multiplier = Math.pow(parseFloat(martingale), dualMartingaleCounter.current);
                                currentDualStake.current = parseFloat((dualBaseStake.current * multiplier).toFixed(2));
                                logToJournal(`📈 Type 2 first recovery stake: $${dualBaseStake.current} × ${martingale}^1 = $${currentDualStake.current}`, 'info', true);
                            }
                            setLosses(prev => prev + 1);
                        }
                    }

                    if (!buyData.isDual && !buyData.hedge_position && !buyData.isSequence && !buyData.isStrike && !buyData.isParallel) {
                        if (profit > 0) {
                            setWins(prev => prev + 1);
                            if (buyData.isStableAggressive) {
                                stableLastTradeWasLoss.current = false;
                                stableCurrentStake.current = stableBaseStake.current;
                                stableMartingaleCounter.current = 0;
                                logToJournal(`✅ Win - Martingale reset. Next stake: $${stableBaseStake.current}`, 'success', true);
                            }
                            if (buyData.contract_type === 'CALL') {
                                setRiseWins(prev => prev + 1);
                            } else if (buyData.contract_type === 'PUT') {
                                setFallWins(prev => prev + 1);
                            }
                        } else if (profit < 0) {
                            setLosses(prev => prev + 1);
                            if (buyData.isStableAggressive) {
                                stableLastTradeWasLoss.current = true;
                                if (martingaleEnabled) {
                                    stableMartingaleCounter.current += 1;
                                    if (martingaleLimit !== 0 && stableMartingaleCounter.current >= martingaleLimit) {
                                        stableCurrentStake.current = stableBaseStake.current;
                                        stableMartingaleCounter.current = 0;
                                        logToJournal(`⚠️ Martingale limit of ${martingaleLimit} reached. Resetting stake to ${stableBaseStake.current}`, 'warn', true);
                                    } else {
                                        const multiplier = Math.pow(parseFloat(martingale), stableMartingaleCounter.current);
                                        stableCurrentStake.current = parseFloat((stableBaseStake.current * multiplier).toFixed(2));
                                        logToJournal(`📉 Loss - Martingale next: ${stableBaseStake.current} × ${martingale}^${stableMartingaleCounter.current} = ${stableCurrentStake.current} (${stableMartingaleCounter.current}/${martingaleLimit === 0 ? '∞' : martingaleLimit})`, 'warn', true);
                                    }
                                } else {
                                    logToJournal(`📉 Loss - Martingale disabled, stake stays at ${stableBaseStake.current}`, 'warn', true);
                                }
                            }
                        }

                        if (buyData.contract_type === 'CALL') {
                            setRiseTrades(prev => prev + 1);
                        } else if (buyData.contract_type === 'PUT') {
                            setFallTrades(prev => prev + 1);
                        }

                        if (buyData.isStableAggressive && !buyData.aggressiveMode) {
                            const pList = [parseInt(pred1), parseInt(pred2), parseInt(pred3)];
                            const currentPredIdx = stablePredIndex.current;

                            if (profit > 0) {
                                if (currentPredIdx !== 0) {
                                    stablePredIndex.current = 0;
                                    activePredIndex.current = 0;
                                    logToJournal(`✅ Win on Pred ${currentPredIdx + 1} (${pList[currentPredIdx]}) → Returning to Pred 1 (${pList[0]})`, 'success', true);
                                }
                            } else if (profit < 0) {
                                if (currentPredIdx === 0) {
                                    stablePredIndex.current = 1;
                                    activePredIndex.current = 1;
                                    logToJournal(`📉 Loss on Pred 1 (${pList[0]}) → Recovery: switching to Pred 2 (${pList[1]})`, 'warn', true);
                                } else if (currentPredIdx === 1) {
                                    stablePredIndex.current = 2;
                                    activePredIndex.current = 2;
                                    logToJournal(`📉 Loss on Pred 2 (${pList[1]}) → Deep Recovery: switching to Pred 3 (${pList[2]})`, 'warn', true);
                                } else if (currentPredIdx === 2) {
                                    logToJournal(`📉 Loss on Pred 3 (${pList[2]}) → Staying on Pred 3 until win`, 'warn', true);
                                }
                            }
                        }

                        if (buyData.isStableAggressive && buyData.aggressiveMode) {
                            const nextIndex = (aggressivePredIndex.current + 1) % 3;
                            aggressivePredIndex.current = nextIndex;
                            activePredIndex.current = nextIndex;
                            const pList = [parseInt(pred1), parseInt(pred2), parseInt(pred3)];
                            logToJournal(`🔄 AGGRESSIVE: Rotating to Pred ${nextIndex + 1} (${pList[nextIndex]}) next trade`, 'info', true);
                        }
                    }

                    if (buyData.hedge_position) {
                        const position = buyData.hedge_position;
                        
                        if (profit > 0) {
                            logToJournal(`Hedge ${position} WIN: +$${profit.toFixed(2)}`, 'success', true);
                            if (position === 'OVER') {
                                setRiseWins(prev => prev + 1);
                            } else {
                                setFallWins(prev => prev + 1);
                            }
                        } else if (profit < 0) {
                            logToJournal(`Hedge ${position} LOSS: $${profit.toFixed(2)}`, 'warn', true);
                            if (position === 'OVER') {
                                setFallWins(prev => prev + 1);
                            } else {
                                setRiseWins(prev => prev + 1);
                            }
                        }

                        if (position === 'OVER') {
                            setRiseTrades(prev => prev + 1);
                        } else {
                            setFallTrades(prev => prev + 1);
                        }

                        if (buyData.hedge_pair_id) {
                            const hasActivePair = Array.from(activeContracts.current.keys()).some(id => {
                                const contract = activeContracts.current.get(id);
                                return contract && contract.hedge_pair_id === buyData.hedge_pair_id;
                            });
                            
                            if (!hasActivePair) {
                                hedgeTradePending.current = false;
                                logToJournal(`🛡️ Hedge pair complete - ready for next trigger`, 'info', true);
                                
                                if (hedgeMartingaleEnabled && profit < 0) {
                                    hedgeMartingaleCounter.current += 1;
                                    if (hedgeMartingaleLimit !== 0 && hedgeMartingaleCounter.current >= hedgeMartingaleLimit) {
                                        currentHedgeStake.current = parseFloat(hedgeStake);
                                        hedgeMartingaleCounter.current = 0;
                                        logToJournal(`Hedge martingale limit reached, resetting stake to $${hedgeStake}`, 'warn', true);
                                    } else {
                                        const multiplier = Math.pow(parseFloat(hedgeMartingale), hedgeMartingaleCounter.current);
                                        currentHedgeStake.current = parseFloat((parseFloat(hedgeStake) * multiplier).toFixed(2));
                                        logToJournal(`Hedge martingale: $${hedgeStake} × ${hedgeMartingale}^${hedgeMartingaleCounter.current} = $${currentHedgeStake.current}`, 'info', true);
                                    }
                                } else if (profit > 0) {
                                    hedgeMartingaleCounter.current = 0;
                                    currentHedgeStake.current = parseFloat(hedgeStake);
                                }
                            }
                        }
                    }

                    virtualStreak.current = 0;
                    setVCounterDisplay(0);

                    activeTradesCount.current = Math.max(0, activeTradesCount.current - 1);
                    updateRunPanelContractCount(activeTradesCount.current);

                    if (activeTradesCount.current === 0) {
                        isTradeTriggered.current = false;
                        triggerLocked.current = false;
                        seqTradeTriggered.current = false;
                        dualTradeLocked.current = false;
                        hedgeTradePending.current = false;
                        strikeTradeLocked.current = false;
                    }

                    if (buyData.is_manual) {
                        logToJournal('✅ Manual trade completed, stopping bot', 'success', true);
                        setTimeout(() => {
                            isBotRunningRef.current = false;
                            setIsBotRunning(false);
                            setIsManualTradePending(false);
                            manualTradePlaced.current = false;
                        }, 500);
                    }

                    if (!buyData.is_manual && !tpSlTriggered.current && parseFloat(takeProfit) > 0 && localProfitTracker.current >= parseFloat(takeProfit)) {
                        tpSlTriggered.current = true;
                        logToJournal(`🎯 Take Profit reached: $${localProfitTracker.current.toFixed(2)}`, 'success', true);
                        botNotification(`🎯 Nyanyuki Pro — Take Profit Hit! P/L: +$${localProfitTracker.current.toFixed(2)}`, undefined, { type: 'success', autoClose: 8000 });
                        tradeQueue.current = [];
                        isProcessingQueue.current = false;
                        dualTradeLocked.current = false;
                        triggerLocked.current = false;
                        strikeTradeLocked.current = false;
                        stopReasonRef.current = 'TAKE_PROFIT';
                        syncWithRunPanel(false);
                    } else if (!buyData.is_manual && !tpSlTriggered.current && parseFloat(stopLoss) > 0 && localProfitTracker.current <= -parseFloat(stopLoss)) {
                        tpSlTriggered.current = true;
                        logToJournal(`🛑 Stop Loss triggered: $${localProfitTracker.current.toFixed(2)}`, 'error', true);
                        botNotification(`🛑 Nyanyuki Pro — Stop Loss Hit! P/L: $${localProfitTracker.current.toFixed(2)}`, undefined, { type: 'error', autoClose: 8000 });
                        tradeQueue.current = [];
                        isProcessingQueue.current = false;
                        dualTradeLocked.current = false;
                        triggerLocked.current = false;
                        strikeTradeLocked.current = false;
                        stopReasonRef.current = 'STOP_LOSS';
                        syncWithRunPanel(false);
                    }
                }
            } catch (error) {
                console.error('Monitor error:', error);
                clearInterval(checkInterval);
                activeContracts.current.delete(contractId);
                setActiveTradesList(prev => prev.filter(t => t.id !== contractId));
                activeTradesCount.current = Math.max(0, activeTradesCount.current - 1);
                updateRunPanelContractCount(activeTradesCount.current);

                if (activeTradesCount.current === 0) {
                    isTradeTriggered.current = false;
                    dualTradeLocked.current = false;
                    hedgeTradePending.current = false;
                    triggerLocked.current = false;
                    seqTradeTriggered.current = false;
                    strikeTradeLocked.current = false;
                    if (parallelPending.current && parallelBatchId.current) {
                        parallelPending.current = false;
                        parallelBatchId.current = null;
                        parallelRemainingCount.current = 0;
                        parallelBatchProfits.current = [];
                    }
                }
            }
        }, 1000);

        activeContracts.current.set(contractId, checkInterval);
    }, [logToJournal, registerTransactionInPanel, currency, symbol, mode, martingaleEnabled, martingaleLimit, martingale, takeProfit, stopLoss, syncWithRunPanel, updateRunPanelContractCount, runPanelStore, handleSequenceTradeComplete, hedgeStake, hedgeMartingale, hedgeMartingaleEnabled, hedgeMartingaleLimit, botObserver, pred1, pred2, pred3, parallelCount, parallelMartingale, parallelMartingaleEnabled, parallelMartingaleLimit, parallelTakeProfit, parallelStopLoss, parallelBaseStake, sendTradeRequest]);

    // ── PRE-PROPOSAL FAST-ENTRY ────────────────────────────────────────────────
    // Called one digit BEFORE the trigger fires. Sends a proposal to the exchange
    // so the contract price is pre-computed. When the trigger digit arrives we
    // call buy:proposalId which is near-instant — no extra roundtrip needed.
    // Without this, buy:1+parameters costs one full network roundtrip (~100-300ms)
    // which lets one tick slip past and shifts the exit digit by +1.
    const warmProposal = useCallback(async (proposalParams) => {
        if (preProposalInFlight.current || preProposalId.current) return;
        preProposalInFlight.current = true;
        try {
            const res = await sendTradeRequest({ proposal: 1, ...proposalParams });
            if (res?.proposal?.id) {
                preProposalId.current           = res.proposal.id;
                preProposalCreatedAt.current    = Date.now();
                preProposalContractType.current = proposalParams.contract_type || null;
                preProposalAmount.current       = proposalParams.amount || null; // for stake validation
            }
        } catch (e) { /* silent — buy will fallback to full parameters path */ }
        finally { preProposalInFlight.current = false; }
    }, []);
    // ────────────────────────────────────────────────────────────────────────────

    // ============================================
    // 20. FAST TRIGGER EXECUTION
    // ============================================
    const executeTriggeredTradeImmediate = useCallback(async (tradeParams) => {
        if ((!is_logged_in && !isOAuthUser.current) || !isBotRunningRef.current) return false;
        if (tpSlTriggered.current) return false;
        
        try {
            botObserver.emit('contract.status', { 
                id: 'contract.purchase_sent', 
                data: 0 
            });

            // Use pre-warmed proposal if available and fresh (< 25 s).
            // If the proposal buy fails (expired / price drift), fall back to
            // full buy:1+parameters so timing never fully breaks.
            let res;
            const _proposalAge = Date.now() - preProposalCreatedAt.current;
            const _requestedType = tradeParams.params?.contract_type || tradeParams.contract_type;
            const _proposalTypeMatch = preProposalContractType.current === _requestedType;
            // Validate that the pre-warmed proposal matches the current stake amount.
            // If martingale changed the stake since the proposal was created, discard it
            // and fall through to the full buy (avoids a Deriv rejection + extra round-trip).
            const _proposalAmountMatch = preProposalAmount.current === null
                || Math.abs(preProposalAmount.current - tradeParams.stake) < 0.01;

            if (preProposalId.current && _proposalAge < 25000 && _proposalTypeMatch && _proposalAmountMatch) {
                const _pid = preProposalId.current;
                preProposalId.current = null; // consume immediately
                preProposalContractType.current = null;
                preProposalAmount.current = null;
                res = await sendTradeRequest({ buy: _pid, price: tradeParams.stake });
                // Retry with full params if proposal was rejected
                if (res?.error) {
                    res = await sendTradeRequest({
                        buy: 1,
                        price: tradeParams.stake,
                        parameters: tradeParams.params
                    });
                }
            } else {
                preProposalId.current = null; // discard stale or wrong contract type
                preProposalContractType.current = null;
                res = await sendTradeRequest({
                    buy: 1,
                    price: tradeParams.stake,
                    parameters: tradeParams.params
                });
            }

            if (res.error) {
                logToJournal(`Triggered trade error: ${res.error.message}`, 'error');
                if (res.error.code === 'InvalidContractProposal' || 
                    res.error.message?.toLowerCase().includes('insufficient') ||
                    res.error.message?.toLowerCase().includes('balance')) {
                    stopReasonRef.current = 'LOW_FUNDS';
                    syncWithRunPanel(false);
                }
                return false;
            }

            if (res.buy) {
                const contractId = res.buy.contract_id;

                // Rolling refresh: queue next proposal immediately after buy confirmation.
                // This gives the exchange maximum time to prepare the next proposal
                // (entire contract duration) so timing stays sharp on every trade.
                warmProposal({
                    amount: tradeParams.stake,
                    basis: 'stake',
                    contract_type: tradeParams.params?.contract_type || tradeParams.contract_type,
                    currency: tradeParams.params?.currency || 'USD',
                    duration: parseInt(tradeParams.params?.duration) || 1,
                    duration_unit: 't',
                    symbol: tradeParams.params?.symbol || symbol,
                    ...(tradeParams.barrier != null ? { barrier: tradeParams.barrier } : {})
                });

                botObserver.emit('bot.running', {});
                botObserver.emit('contract.status', { 
                    id: 'contract.purchase_received',
                    data: 0,
                    buy: { buy_price: parseFloat(tradeParams.stake) }
                });

                activeTradesCount.current += 1;
                updateRunPanelContractCount(activeTradesCount.current);

                setActiveTradesList(prev => [...prev, {
                    id: contractId,
                    type: tradeParams.contract_type,
                    stake: tradeParams.stake,
                    direction: tradeParams.contract_type === 'CALL' ? 'RISE' :
                        tradeParams.contract_type === 'PUT' ? 'FALL' : null,
                    barrier: tradeParams.barrier,
                    time: new Date().toLocaleTimeString(),
                    isManual: false,
                    isDual: tradeParams.isDual || false,
                    dualSlot: tradeParams.dualSlot,
                    hedge_position: tradeParams.hedge_position,
                    hedge_pair_id: tradeParams.hedge_pair_id,
                    isSequence: tradeParams.isSequence || false,
                    sequenceType: tradeParams.sequenceType,
                    isTriggeredTrade: true,
                    isStrike: tradeParams.isStrike || false,
                    strikeIsRecovery: tradeParams.strikeIsRecovery || false,
                    isParallel: tradeParams.isParallel || false,
                    parallelBatchId: tradeParams.parallelBatchId,
                    parallelSlot: tradeParams.parallelSlot,
                }]);

                logToJournal(`⚡ TRIGGERED: ${tradeParams.display}`, 'success', true);

                const buyTransaction = {
                    contract_id: contractId,
                    buy_price: tradeParams.stake,
                    stake: tradeParams.stake,
                    currency: currency || 'USD',
                    date_start: new Date().toISOString(),
                    purchase_time: Date.now(),
                    is_completed: false,
                    is_sold: false,
                    profit: 0,
                    barrier: tradeParams.barrier,
                    transaction_ids: { buy: contractId },
                    run_id: runIdRef.current,
                    display_name: symbol,
                    contract_type: tradeParams.contract_type,
                    status: 'open',
                    shortcode: `${tradeParams.contract_type}_${symbol}`,
                    isDual: tradeParams.isDual,
                    dualSlot: tradeParams.dualSlot,
                    is_manual: false,
                    hedge_position: tradeParams.hedge_position,
                    hedge_pair_id: tradeParams.hedge_pair_id,
                    isSequence: tradeParams.isSequence,
                    sequenceType: tradeParams.sequenceType,
                    isTriggeredTrade: true,
                    isStableAggressive: tradeParams.isStableAggressive || false,
                    aggressiveMode: tradeParams.aggressiveMode || false,
                    isStrike: tradeParams.isStrike || false,
                    strikeIsRecovery: tradeParams.strikeIsRecovery || false,
                    isParallel: tradeParams.isParallel || false,
                    parallelBatchId: tradeParams.parallelBatchId,
                    parallelSlot: tradeParams.parallelSlot,
                };

                monitorTrade(contractId, buyTransaction);
                
                return true;
            }
        } catch (err) {
            logToJournal(`Triggered trade failed: ${err.message}`, 'error');
        }
        
        return false;
    }, [is_logged_in, currency, symbol, logToJournal, monitorTrade, updateRunPanelContractCount, syncWithRunPanel, botObserver, warmProposal, sendTradeRequest]);

    // ============================================
    // 21. FAST BUY
    // ============================================
    const fastBuy = useCallback(async (contractParams, buyMeta) => {
        if ((!is_logged_in && !isOAuthUser.current) || !isBotRunningRef.current) return;
        if (tpSlTriggered.current) return;

        try {
            botObserver.emit('contract.status', { 
                id: 'contract.purchase_sent', 
                data: 0 
            });

            // Use pre-warmed proposal if available and fresh (< 25 s).
            // Retry with full params if proposal is rejected (expired / price drift).
            let res;
            const _fAge = Date.now() - preProposalCreatedAt.current;
            const _fRequestedType = contractParams.params?.contract_type || contractParams.contract_type;
            const _fProposalTypeMatch = preProposalContractType.current === _fRequestedType;
            if (preProposalId.current && _fAge < 25000 && _fProposalTypeMatch) {
                const _pid = preProposalId.current;
                preProposalId.current = null;
                preProposalContractType.current = null;
                res = await sendTradeRequest({ buy: _pid, price: contractParams.stake });
                if (res?.error) {
                    res = await sendTradeRequest({
                        buy: 1,
                        price: contractParams.stake,
                        parameters: contractParams.params
                    });
                }
            } else {
                preProposalId.current = null;
                preProposalContractType.current = null;
                res = await sendTradeRequest({
                    buy: 1,
                    price: contractParams.stake,
                    parameters: contractParams.params
                });
            }

            if (res.error) {
                logToJournal(`⚡ FastBuy error: ${res.error.message}`, 'error');
                if (res.error.code === 'InvalidContractProposal' || 
                    res.error.message?.toLowerCase().includes('insufficient') ||
                    res.error.message?.toLowerCase().includes('balance')) {
                    stopReasonRef.current = 'LOW_FUNDS';
                    syncWithRunPanel(false);
                }
                return;
            }

            if (res.buy) {
                const contractId = res.buy.contract_id;

                // Rolling refresh: keep a proposal warm for the next trade
                warmProposal({
                    amount: contractParams.stake,
                    basis: 'stake',
                    contract_type: contractParams.contract_type,
                    currency: contractParams.params?.currency || 'USD',
                    duration: parseInt(contractParams.params?.duration) || 1,
                    duration_unit: 't',
                    symbol: contractParams.params?.symbol || symbol,
                    ...(contractParams.barrier != null ? { barrier: contractParams.barrier } : {})
                });

                botObserver.emit('bot.running', {});
                botObserver.emit('contract.status', { 
                    id: 'contract.purchase_received',
                    data: 0,
                    buy: { buy_price: parseFloat(contractParams.stake) }
                });

                activeTradesCount.current += 1;
                updateRunPanelContractCount(activeTradesCount.current);

                setActiveTradesList(prev => [...prev, {
                    id: contractId,
                    type: contractParams.contract_type,
                    stake: contractParams.stake,
                    barrier: contractParams.barrier,
                    time: new Date().toLocaleTimeString(),
                    isManual: false,
                    isDual: buyMeta.isDual || false,
                    dualSlot: buyMeta.dualSlot,
                    isSequence: buyMeta.isSequence || false,
                    sequenceType: buyMeta.sequenceType,
                    hedge_position: buyMeta.hedge_position,
                    hedge_pair_id: buyMeta.hedge_pair_id,
                }]);

                logToJournal(`⚡ FAST FIRE: ${contractParams.display} @ $${contractParams.stake}`, 'success', true);

                const buyTransaction = {
                    contract_id: contractId,
                    buy_price: contractParams.stake,
                    stake: contractParams.stake,
                    currency: currency || 'USD',
                    date_start: new Date().toISOString(),
                    purchase_time: Date.now(),
                    is_completed: false,
                    is_sold: false,
                    profit: 0,
                    barrier: contractParams.barrier,
                    transaction_ids: { buy: contractId },
                    run_id: runIdRef.current,
                    display_name: symbol,
                    contract_type: contractParams.contract_type,
                    status: 'open',
                    shortcode: `${contractParams.contract_type}_${symbol}`,
                    isDual: buyMeta.isDual,
                    dualSlot: buyMeta.dualSlot,
                    is_manual: false,
                    hedge_position: buyMeta.hedge_position,
                    hedge_pair_id: buyMeta.hedge_pair_id,
                    isSequence: buyMeta.isSequence,
                    sequenceType: buyMeta.sequenceType,
                    isStableAggressive: buyMeta.isStableAggressive || false,
                    aggressiveMode: buyMeta.aggressiveMode || false
                };

                monitorTrade(contractId, buyTransaction);
            }
        } catch (err) {
            logToJournal(`⚡ FastBuy failed: ${err.message}`, 'error');
        }
    }, [is_logged_in, currency, symbol, logToJournal, monitorTrade, updateRunPanelContractCount, syncWithRunPanel, botObserver, warmProposal, sendTradeRequest]);

    // ============================================
    // 22. PROCESS TRIGGERED TRADES
    // ============================================
    const processTriggeredTrades = useCallback(async () => {
        if (isProcessingTrigger.current || pendingTriggeredTrades.current.length === 0) return;
        if (tpSlTriggered.current) return;
        
        isProcessingTrigger.current = true;
        const countBefore = activeTradesCount.current;
        
        try {
            while (pendingTriggeredTrades.current.length > 0 && isBotRunningRef.current && !tpSlTriggered.current) {
                const tradeParams = pendingTriggeredTrades.current.shift();
                await executeTriggeredTradeImmediate(tradeParams);
            }
        } finally {
            isProcessingTrigger.current = false;
            
            // Bug fix: if no new trade was actually opened (e.g. API/network error),
            // release all trigger locks so the bot can accept the next signal.
            // Without this, a single failed trade permanently locks the bot.
            if (activeTradesCount.current === countBefore) {
                triggerLocked.current = false;
                seqTradeTriggered.current = false;
                dualTradeLocked.current = false;
                hedgeTradePending.current = false;
                strikeTradeLocked.current = false;
                isTradeTriggered.current = false;
            }
        }
    }, [executeTriggeredTradeImmediate]);

    // ============================================
    // 23. SEQUENCE BOT TRIGGER CHECK
    // ============================================
    const checkSequenceBotTriggers = useCallback((digit, price) => {
        if (!isBotRunningRef.current || mode !== 'SEQUENCE') return false;
        if (tpSlTriggered.current) return false;
        
        if (triggerLocked.current) {
            logToJournal(`🔒 Trigger locked - waiting for trade result before accepting new trigger`, 'info', true);
            return false;
        }
        
        const currentType = currentSequenceTypeRef.current;
        let shouldTrigger = false;
        let triggerReason = '';
        
        const typeContract = currentType === 1 ? seqType1Contract : seqType2Contract;
        const typeVLoss = currentType === 1 ? seqType1VLoss : seqType2VLoss;
        
        if (isRiseFall(typeContract)) {
            const isVLoss = typeContract === 'CALL' ? priceDirection === 'down' : priceDirection === 'up';
            
            if (isVLoss) {
                if (currentType === 1) {
                    seqType1VLossCounter.current += 1;
                } else {
                    seqType2VLossCounter.current += 1;
                }
                
                logToJournal(`📉 Type ${currentType} V-Loss: ${currentType === 1 ? seqType1VLossCounter.current : seqType2VLossCounter.current}/${typeVLoss}`, 'warn', true);

                // ── PRE-WARM: one digit before trigger ──
                const _rfCount = currentType === 1 ? seqType1VLossCounter.current : seqType2VLossCounter.current;
                const _rfLimit = parseInt(typeVLoss);
                if (_rfLimit > 1 && _rfCount === _rfLimit - 1
                    && !preProposalId.current && !preProposalInFlight.current) {
                    const _rfStake = lastTradeWasLoss.current && martingaleEnabled
                        ? currentStakeValue.current
                        : baseStake.current;
                    warmProposal({
                        amount: _rfStake,
                        basis: 'stake',
                        contract_type: typeContract,
                        currency: currency || 'USD',
                        duration: 1,
                        duration_unit: 't',
                        symbol: symbol
                    });
                }

                if (_rfCount >= _rfLimit) {
                    shouldTrigger = true;
                    triggerReason = `V-Loss limit ${typeVLoss} reached`;
                    
                    if (currentType === 1) {
                        seqType1VLossCounter.current = 0;
                    } else {
                        seqType2VLossCounter.current = 0;
                    }
                }
            } else {
                if (currentType === 1) {
                    seqType1VLossCounter.current = 0;
                } else {
                    seqType2VLossCounter.current = 0;
                }
            }
        } else if (isEvenOdd(typeContract)) {
            let isVLoss = false;
            if (typeContract === 'DIGITEVEN') {
                isVLoss = (digit % 2 === 0);
            } else if (typeContract === 'DIGITODD') {
                isVLoss = (digit % 2 !== 0);
            }
            
            if (isVLoss) {
                if (currentType === 1) {
                    seqType1VLossCounter.current += 1;
                } else {
                    seqType2VLossCounter.current += 1;
                }
                
                logToJournal(`📉 Type ${currentType} V-Loss: ${currentType === 1 ? seqType1VLossCounter.current : seqType2VLossCounter.current}/${typeVLoss}`, 'warn', true);

                // ── PRE-WARM: one digit before trigger ──
                const _seqCount = currentType === 1 ? seqType1VLossCounter.current : seqType2VLossCounter.current;
                const _seqLimit = parseInt(typeVLoss);
                if (_seqLimit > 1 && _seqCount === _seqLimit - 1
                    && !preProposalId.current && !preProposalInFlight.current) {
                    const _seqNBP = ['DIGITOVER','DIGITUNDER','DIGITMATCH','DIGITDIFF'].includes(typeContract);
                    const _seqPred = currentType === 1 ? seqType1Prediction : seqType2Prediction;
                    const _seqStake = lastTradeWasLoss.current && martingaleEnabled
                        ? currentStakeValue.current
                        : baseStake.current;
                    warmProposal({
                        amount: _seqStake,
                        basis: 'stake',
                        contract_type: typeContract,
                        currency: currency || 'USD',
                        duration: 1,
                        duration_unit: 't',
                        symbol: symbol,
                        ...(_seqNBP && _seqPred != null ? { barrier: _seqPred } : {})
                    });
                }

                if (_seqCount >= _seqLimit) {
                    shouldTrigger = true;
                    triggerReason = `V-Loss limit ${typeVLoss} reached`;
                    
                    if (currentType === 1) {
                        seqType1VLossCounter.current = 0;
                    } else {
                        seqType2VLossCounter.current = 0;
                    }
                }
            } else {
                if (currentType === 1) {
                    seqType1VLossCounter.current = 0;
                } else {
                    seqType2VLossCounter.current = 0;
                }
            }
        } else {
            const typeTriggers = currentType === 1 ? seqType1Triggers : seqType2Triggers;
            const triggerList = typeTriggers.split(',').map(t => parseInt(t.trim())).filter(t => !isNaN(t));
            
            if (triggerList.includes(digit)) {
                shouldTrigger = true;
                triggerReason = `Digit ${digit} matched trigger`;
            }
        }
        
        if (shouldTrigger && !tpSlTriggered.current) {
            logToJournal(`🎯 SEQUENCE Type ${currentType} TRIGGER: ${triggerReason}`, 'success', true);
            
            const contractType = currentType === 1 ? seqType1Contract : seqType2Contract;
            
            let stakeToUse;
            if (lastTradeWasLoss.current && martingaleEnabled) {
                stakeToUse = currentStakeValue.current;
                logToJournal(`📈 Sequence martingale applied: $${stakeToUse} (counter: ${martingaleCounterSeq.current}/${martingaleLimit === 0 ? '∞' : martingaleLimit})`, 'info', true);
            } else {
                stakeToUse = baseStake.current;
                currentStakeValue.current = baseStake.current;
                martingaleCounterSeq.current = 0;
            }
            
            const prediction = currentType === 1 ? seqType1Prediction : seqType2Prediction;
            const needsBarrier = ['DIGITOVER', 'DIGITUNDER', 'DIGITMATCH', 'DIGITDIFF'].includes(contractType);
            
            const contractDisplay = isRiseFall(contractType)
                ? (contractType === 'CALL' ? 'RISE 📈' : 'FALL 📉')
                : isEvenOdd(contractType)
                    ? (contractType === 'DIGITEVEN' ? 'EVEN 🟰' : 'ODD 🎲')
                    : `${contractType}${needsBarrier ? ` (Prediction: ${prediction})` : ''}`;
            
            const params = {
                amount: stakeToUse,
                basis: 'stake',
                contract_type: contractType,
                currency: currency || 'USD',
                duration: '1',
                duration_unit: 't',
                symbol: symbol
            };
            
            if (needsBarrier) {
                params.barrier = prediction;
            }
            
            lastTradeType.current = currentType;
            lastTradeStake.current = stakeToUse;
            
            pendingTriggeredTrades.current.push({
                stake: stakeToUse,
                params: params,
                contract_type: contractType,
                barrier: needsBarrier ? prediction : undefined,
                display: `Type ${currentType}: ${contractDisplay}`,
                isSequence: true,
                sequenceType: currentType
            });
            
            processTriggeredTrades();
            
            seqTradeTriggered.current = true;
            triggerLocked.current = true;
            return true;
        }
        
        return false;
    }, [mode, seqType1Contract, seqType2Contract, seqType1VLoss, seqType2VLoss, seqType1Triggers, seqType2Triggers, priceDirection, is_logged_in, currency, symbol, martingaleEnabled, martingale, martingaleLimit, baseStake, lastTradeWasLoss, currentStakeValue, martingaleCounterSeq, seqType1Prediction, seqType2Prediction, processTriggeredTrades, logToJournal, warmProposal]);

    // ============================================
    // 24. PROCESS TRADE QUEUE
    // ============================================
    const processTradeQueue = useCallback(async () => {
        if (!isBotRunningRef.current && tradeQueue.current[0]?.is_manual !== true) return;
        if (isProcessingQueue.current || tradeQueue.current.length === 0) return;
        if (tpSlTriggered.current && !tradeQueue.current[0]?.is_manual) return;

        isProcessingQueue.current = true;

        while (tradeQueue.current.length > 0 && (isBotRunningRef.current || tradeQueue.current[0]?.is_manual) && !tpSlTriggered.current) {
            
            const batchTrades = [];
            const firstTrade = tradeQueue.current[0];
            
            if (firstTrade?.is_manual) {
                batchTrades.push(tradeQueue.current.shift());
            } else {
                while (tradeQueue.current.length > 0) {
                    batchTrades.push(tradeQueue.current.shift());
                }
            }

            if (batchTrades.length === 0) break;

            logToJournal(`⚡ BULK: Firing ${batchTrades.length} trade(s) simultaneously`, 'info', true);

            await Promise.all(batchTrades.map(async (tradeParams) => {
                try {
                    botObserver.emit('contract.status', { 
                        id: 'contract.purchase_sent', 
                        data: 0 
                    });

                    const res = await sendTradeRequest({
                        buy: 1,
                        price: tradeParams.stake,
                        parameters: tradeParams.params
                    });

                    if (!isBotRunningRef.current && !tradeParams.is_manual) return;
                    if (tpSlTriggered.current && !tradeParams.is_manual) return;

                    if (res.error) {
                        logToJournal(`Trade error: ${res.error.message}`, 'error');
                        if (res.error.code === 'InvalidContractProposal' || 
                            res.error.message?.toLowerCase().includes('insufficient') ||
                            res.error.message?.toLowerCase().includes('balance')) {
                            stopReasonRef.current = 'LOW_FUNDS';
                            syncWithRunPanel(false);
                        }
                        return;
                    }

                    if (res.buy) {
                        const contractId = res.buy.contract_id;

                        botObserver.emit('bot.running', {});
                        botObserver.emit('contract.status', { 
                            id: 'contract.purchase_received',
                            data: 0,
                            buy: { buy_price: parseFloat(tradeParams.stake) }
                        });

                        activeTradesCount.current += 1;
                        updateRunPanelContractCount(activeTradesCount.current);

                        setActiveTradesList(prev => [...prev, {
                            id: contractId,
                            type: tradeParams.contract_type,
                            stake: tradeParams.stake,
                            direction: tradeParams.contract_type === 'CALL' ? 'RISE' :
                                tradeParams.contract_type === 'PUT' ? 'FALL' : null,
                            barrier: tradeParams.barrier,
                            time: new Date().toLocaleTimeString(),
                            isManual: tradeParams.is_manual || false,
                            isDual: tradeParams.isDual || false,
                            dualSlot: tradeParams.dualSlot,
                            hedge_position: tradeParams.hedge_position,
                            hedge_pair_id: tradeParams.hedge_pair_id,
                            isSequence: tradeParams.isSequence || false,
                            sequenceType: tradeParams.sequenceType,
                            isStrike: tradeParams.isStrike || false,
                            strikeIsRecovery: tradeParams.strikeIsRecovery || false,
                            isParallel: tradeParams.isParallel || false,
                            parallelBatchId: tradeParams.parallelBatchId,
                            parallelSlot: tradeParams.parallelSlot,
                        }]);

                        logToJournal(`✅ ${tradeParams.isSequence ? `SEQUENCE Type ${tradeParams.sequenceType}` : tradeParams.isDual ? `DUAL Type ${tradeParams.dualSlot}` : tradeParams.hedge_position ? `HEDGE ${tradeParams.hedge_position}` : tradeParams.is_manual ? 'MANUAL' : tradeParams.isStrike ? 'STRIKE' : tradeParams.isParallel ? 'PARALLEL' : 'BULK TRADE'}: ${tradeParams.display}`, 'success', true);

                        const buyTransaction = {
                            contract_id: contractId,
                            buy_price: tradeParams.stake,
                            stake: tradeParams.stake,
                            currency: currency || 'USD',
                            date_start: new Date().toISOString(),
                            purchase_time: Date.now(),
                            is_completed: false,
                            is_sold: false,
                            profit: 0,
                            barrier: tradeParams.barrier,
                            transaction_ids: { buy: contractId },
                            run_id: runIdRef.current,
                            display_name: symbol,
                            contract_type: tradeParams.contract_type,
                            status: 'open',
                            shortcode: `${tradeParams.contract_type}_${symbol}`,
                            isDual: tradeParams.isDual,
                            dualSlot: tradeParams.dualSlot,
                            is_manual: tradeParams.is_manual,
                            hedge_position: tradeParams.hedge_position,
                            hedge_pair_id: tradeParams.hedge_pair_id,
                            isSequence: tradeParams.isSequence,
                            sequenceType: tradeParams.sequenceType,
                            isStableAggressive: tradeParams.isStableAggressive || false,
                            aggressiveMode: tradeParams.aggressiveMode || false,
                            isStrike: tradeParams.isStrike || false,
                            strikeIsRecovery: tradeParams.strikeIsRecovery || false,
                            isParallel: tradeParams.isParallel || false,
                            parallelBatchId: tradeParams.parallelBatchId,
                            parallelSlot: tradeParams.parallelSlot,
                        };

                        monitorTrade(contractId, buyTransaction);

                        if (tradeParams.is_manual) {
                            tradeQueue.current = [];
                        }
                    }
                } catch (err) {
                    logToJournal(`Trade failed: ${err.message}`, 'error');
                    if (tradeParams.is_manual) {
                        setIsManualTradePending(false);
                    }
                }
            }));
        }

        isProcessingQueue.current = false;
    }, [currency, symbol, logToJournal, monitorTrade, updateRunPanelContractCount, syncWithRunPanel, botObserver, sendTradeRequest]);

    // ============================================
    // 25. INSTANT TRADE EXECUTION
    // ============================================
    const executeInstantTrade = useCallback((tradeNumber = 1, isManual = false) => {
        if (!is_logged_in && !isOAuthUser.current) {
            logToJournal('Please login first', 'error');
            return;
        }
        if (!isBotRunningRef.current && !isManual) return;
        if (tpSlTriggered.current && !isManual) return;

        let reqStake;
        if (isManual) {
            reqStake = parseFloat(stake);
        } else if (mode === 'STABLE' || mode === 'AGGRESSIVE') {
            // Stake and counter are managed entirely in the result handler.
            // Execution just reads the pre-computed stableCurrentStake.current.
            reqStake = stableCurrentStake.current;
        } else {
            reqStake = parseFloat(stake);
        }

        const predIndex = mode === 'AGGRESSIVE' 
            ? aggressivePredIndex.current 
            : mode === 'STABLE' 
                ? stablePredIndex.current 
                : activePredIndex.current;
        const currentPred = [parseInt(pred1), parseInt(pred2), parseInt(pred3)][predIndex];
        const actualDuration = parseInt(ticks);

        const contractDisplay = isRiseFall(contractType)
            ? (contractType === 'CALL' ? 'RISE 📈' : 'FALL 📉')
            : `${contractType}${needsPrediction(contractType) ? ` (Prediction: ${currentPred})` : ''}`;

        const tradeDetails = `${contractDisplay} @ $${reqStake} for ${actualDuration} ticks`;

        const params = {
            amount: reqStake,
            basis: 'stake',
            contract_type: contractType,
            currency: currency || 'USD',
            duration: actualDuration.toString(),
            duration_unit: 't',
            symbol: symbol
        };

        if (needsPrediction(contractType)) {
            params.barrier = currentPred;
        }

        tradeQueue.current.push({
            stake: reqStake,
            params: params,
            contract_type: contractType,
            barrier: needsPrediction(contractType) ? currentPred : undefined,
            display: tradeDetails,
            is_manual: isManual,
            isStableAggressive: !isManual && (mode === 'STABLE' || mode === 'AGGRESSIVE'),
            aggressiveMode: !isManual && mode === 'AGGRESSIVE'
        });

        processTradeQueue();

    }, [is_logged_in, contractType, stake, ticks, needsPrediction, isRiseFall, currency, symbol, mode, pred1, pred2, pred3, processTradeQueue, martingaleEnabled, martingale, martingaleLimit, logToJournal]);

    // ============================================
    // 26. STANDARD TRADE EXECUTION
    // ============================================
    const executeTrade = useCallback(() => {
        if (!is_logged_in && !isOAuthUser.current) {
            logToJournal('Please login first', 'error');
            return;
        }
        if (!isBotRunningRef.current) return;
        if (mode === 'MANUAL') return;
        if (tpSlTriggered.current) return;

        const tradesToExecute = mode === 'AGGRESSIVE' ? 1 : parseInt(bulkNumber) || 1;

        // Stake and counter are managed entirely in the result handler.
        // Execution just reads the pre-computed stableCurrentStake.current.
        const reqStake = (mode === 'STABLE' || mode === 'AGGRESSIVE')
            ? stableCurrentStake.current
            : parseFloat(stake);

        const predIndex = mode === 'AGGRESSIVE'
            ? aggressivePredIndex.current
            : mode === 'STABLE'
                ? stablePredIndex.current
                : activePredIndex.current;
        const currentPred = [parseInt(pred1), parseInt(pred2), parseInt(pred3)][predIndex];
        
        const actualDuration = parseInt(ticks) || 1;

        const params = {
            amount: reqStake,
            basis: 'stake',
            contract_type: contractType,
            currency: currency || 'USD',
            duration: actualDuration.toString(),
            duration_unit: 't',
            symbol: symbol
        };

        if (needsPrediction(contractType)) {
            params.barrier = currentPred;
        }

        const display = `${contractType}${needsPrediction(contractType) ? ` P:${currentPred}` : ''} $${reqStake} x${tradesToExecute}`;
        logToJournal(`⚡ BURST FIRE: ${tradesToExecute} trade(s) — ${display}`, 'info', true);

        for (let i = 0; i < tradesToExecute; i++) {
            fastBuy(
                { stake: reqStake, params, contract_type: contractType, barrier: needsPrediction(contractType) ? currentPred : undefined, display },
                { isStableAggressive: true, aggressiveMode: mode === 'AGGRESSIVE' }
            );
        }

    }, [is_logged_in, mode, bulkNumber, stake, contractType, ticks, pred1, pred2, pred3,
        currency, symbol, needsPrediction, martingaleEnabled, martingale, martingaleLimit,
        logToJournal, fastBuy]);

    // ============================================
    // 27. DUAL TRADE EXECUTION
    // ============================================
    const executeDualTrade = useCallback(() => {
        if (!is_logged_in && !isOAuthUser.current) {
            logToJournal('Please login first', 'error');
            return;
        }
        if (!isBotRunningRef.current) return;
        if (tpSlTriggered.current) return;

        const inRecovery = dualRecoveryModeRef.current;

        if (inRecovery) {
            if (dualTradeLocked.current) {
                return;
            }

            logToJournal(`🔄 DUAL: Type 2 recovery trade @ $${currentDualStake.current.toFixed(2)}`, 'info', true);

            const needsBarrier = ['DIGITOVER', 'DIGITUNDER', 'DIGITMATCH', 'DIGITDIFF'].includes(dualPred2);
            const params = {
                amount: parseFloat(currentDualStake.current),
                basis: 'stake',
                contract_type: dualPred2,
                currency: currency || 'USD',
                duration: parseInt(ticks),
                duration_unit: 't',
                symbol: symbol
            };
            if (needsBarrier) params.barrier = parseInt(dualTarget2);

            pendingTriggeredTrades.current.push({
                stake: parseFloat(currentDualStake.current),
                params: params,
                contract_type: dualPred2,
                barrier: needsBarrier ? parseInt(dualTarget2) : undefined,
                display: `Type 2 (Recovery): ${dualPred2} @ $${currentDualStake.current.toFixed(2)}`,
                isDual: true,
                dualSlot: 2,
                is_manual: false,
                isTriggeredTrade: true
            });

            processTriggeredTrades();
            dualTradeLocked.current = true;
            isTradeTriggered.current = true;

        } else {
            if (triggerLocked.current) {
                return;
            }

            if (dualTriggerMode === 'TRIGGER') {
                const triggerList = triggers.split(',').map(t => parseInt(t.trim())).filter(t => !isNaN(t));
                if (!triggerList.includes(lastDigitRef.current)) return;
                logToJournal(`🎯 DUAL Type 1 DIGIT TRIGGER: Digit ${lastDigitRef.current} matched`, 'info', true);
            } else {
                const pred = dualPred1;
                let isVLoss = false;
                if (pred === 'CALL') isVLoss = (lastPriceRef.current <= prevTickPrice.current);
                else if (pred === 'PUT') isVLoss = (lastPriceRef.current >= prevTickPrice.current);
                else if (pred === 'DIGITEVEN') {
                    isVLoss = (lastDigitRef.current % 2 === 0);
                } else if (pred === 'DIGITODD') {
                    isVLoss = (lastDigitRef.current % 2 !== 0);
                } else if (pred === 'DIGITOVER') isVLoss = (lastDigitRef.current <= parseInt(dualTarget1));
                else if (pred === 'DIGITUNDER')isVLoss = (lastDigitRef.current >= parseInt(dualTarget1));
                else if (pred === 'DIGITMATCH')isVLoss = (lastDigitRef.current !== parseInt(dualTarget1));
                else if (pred === 'DIGITDIFF') isVLoss = (lastDigitRef.current === parseInt(dualTarget1));

                if (isVLoss) {
                    virtualStreak.current += 1;
                    logToJournal(`📉 DUAL Type 1 V-Loss: ${virtualStreak.current}/${vLossLimit}`, 'warn', true);
                    setVCounterDisplay(virtualStreak.current);
                    if (virtualStreak.current < parseInt(vLossLimit)) return;
                    logToJournal(`⚡ DUAL Type 1 V-Loss limit reached - TRIGGERING`, 'success', true);
                    virtualStreak.current = 0;
                    setVCounterDisplay(0);
                } else {
                    virtualStreak.current = 0;
                    setVCounterDisplay(0);
                    return;
                }
            }

            const needsBarrier = ['DIGITOVER', 'DIGITUNDER', 'DIGITMATCH', 'DIGITDIFF'].includes(dualPred1);
            const params = {
                amount: parseFloat(currentDualStake.current),
                basis: 'stake',
                contract_type: dualPred1,
                currency: currency || 'USD',
                duration: parseInt(ticks),
                duration_unit: 't',
                symbol: symbol
            };
            if (needsBarrier) params.barrier = parseInt(dualTarget1);

            pendingTriggeredTrades.current.push({
                stake: parseFloat(currentDualStake.current),
                params: params,
                contract_type: dualPred1,
                barrier: needsBarrier ? parseInt(dualTarget1) : undefined,
                display: `Type 1 (Triggered): ${dualPred1} @ $${currentDualStake.current.toFixed(2)}`,
                isDual: true,
                dualSlot: 1,
                is_manual: false,
                isTriggeredTrade: true
            });

            processTriggeredTrades();
            triggerLocked.current = true;
            isTradeTriggered.current = true;
        }
    }, [is_logged_in, logToJournal, dualPred1, dualTarget1, dualPred2, dualTarget2, currency, symbol, triggers, ticks, currentDualStake, processTriggeredTrades, dualTriggerMode, vLossLimit]);

    // ============================================
    // 28. HEDGE TRADE EXECUTION
    // ============================================
    const executeHedgeTrade = useCallback(() => {
        if (!is_logged_in && !isOAuthUser.current) {
            logToJournal('Please login first', 'error');
            return;
        }
        if (!isBotRunningRef.current) return;
        if (hedgeTradePending.current) return;
        if (tpSlTriggered.current) return;

        const stakeToUse = currentHedgeStake.current;
        const hedgePairId = Date.now().toString();

        logToJournal(`🛡️ HEDGE TRIGGER: Digit ${lastDigitRef.current} - Executing OVER 5 and UNDER 4 simultaneously`, 'success', true);

        const paramsOver = {
            amount: stakeToUse,
            basis: 'stake',
            contract_type: 'DIGITOVER',
            currency: currency || 'USD',
            duration: parseInt(ticks),
            duration_unit: 't',
            symbol: symbol,
            barrier: 5
        };

        const paramsUnder = {
            amount: stakeToUse,
            basis: 'stake',
            contract_type: 'DIGITUNDER',
            currency: currency || 'USD',
            duration: parseInt(ticks),
            duration_unit: 't',
            symbol: symbol,
            barrier: 4
        };

        hedgeTradePending.current = true;
        isTradeTriggered.current = true;

        Promise.all([
            executeTriggeredTradeImmediate({
                stake: stakeToUse,
                params: paramsOver,
                contract_type: 'DIGITOVER',
                barrier: 5,
                display: `OVER 5 @ $${stakeToUse.toFixed(2)}`,
                hedge_position: 'OVER',
                hedge_pair_id: hedgePairId,
                is_manual: false,
                isTriggeredTrade: true
            }),
            executeTriggeredTradeImmediate({
                stake: stakeToUse,
                params: paramsUnder,
                contract_type: 'DIGITUNDER',
                barrier: 4,
                display: `UNDER 4 @ $${stakeToUse.toFixed(2)}`,
                hedge_position: 'UNDER',
                hedge_pair_id: hedgePairId,
                is_manual: false,
                isTriggeredTrade: true
            })
        ]).then(() => {
            logToJournal(`🛡️ Both hedge contracts confirmed open`, 'info', true);
        }).catch(err => {
            logToJournal(`❌ Hedge pair failed: ${err.message}`, 'error', true);
            hedgeTradePending.current = false;
        });

    }, [is_logged_in, logToJournal, currency, symbol, ticks, currentHedgeStake, executeTriggeredTradeImmediate]);

    // ============================================
    // 29. STRIKE MODE EXECUTION
    // ============================================
    const executeStrikeTrade = useCallback((isRecovery = false) => {
        if (!isBotRunningRef.current) return;
        if (strikeTradeLocked.current) return;
        if (tpSlTriggered.current) return;

        const contractToUse = isRecovery ? strikeRecoveryContract : strikeContract;
        const predToUse = isRecovery ? parseInt(strikeRecoveryPred) : parseInt(strikePred);
        const needsBarrier = ['DIGITOVER','DIGITUNDER','DIGITMATCH','DIGITDIFF'].includes(contractToUse);
        const stakeToUse = strikeCurrentStake.current;

        const params = {
            amount: stakeToUse,
            basis: 'stake',
            contract_type: contractToUse,
            currency: currency || 'USD',
            duration: parseInt(ticks),
            duration_unit: 't',
            symbol: symbol,
        };
        if (needsBarrier) params.barrier = predToUse;

        const label = isRecovery ? 'Recovery' : (strikePhase.current === 'HUNT' ? 'Entry' : 'Run');
        logToJournal(`⚡ STRIKE ${label}: ${contractToUse}${needsBarrier ? ` P:${predToUse}` : ''} @ $${stakeToUse}`, 'success', true);

        pendingTriggeredTrades.current.push({
            stake: stakeToUse,
            params,
            contract_type: contractToUse,
            barrier: needsBarrier ? predToUse : undefined,
            display: `STRIKE ${label}: ${contractToUse} @ $${stakeToUse}`,
            isStrike: true,
            strikeIsRecovery: isRecovery,
            isTriggeredTrade: true,
        });

        processTriggeredTrades();
        strikeTradeLocked.current = true;
    }, [strikeContract, strikeRecoveryContract, strikePred, strikeRecoveryPred,
        currency, symbol, ticks, logToJournal, processTriggeredTrades, martingaleEnabled]);

    // ============================================
    // 30. PARALLEL MODE EXECUTION
    // ============================================
    const executeParallelTrades = useCallback(async () => {
        if ((!is_logged_in && !isOAuthUser.current) || !isBotRunningRef.current) return;
        if (parallelPending.current) return;
        if (tpSlTriggered.current) return;

        const stakeToUse = currentParallelStake.current;
        const tickDuration = parallelTicks;
        const batchId = Date.now();

        parallelBatchId.current = batchId;
        parallelRemainingCount.current = parallelCount;
        parallelBatchProfits.current = new Array(parallelCount).fill(null);
        parallelPending.current = true;

        const currentTrades = parallelTradesRef.current;
        
        const allTradeParams = [];
        for (let i = 0; i < parallelCount; i++) {
            const trade = currentTrades[i];
            const ct = trade.contract;
            const prediction = trade.prediction;
            const needsBarrier = ['DIGITOVER','DIGITUNDER','DIGITMATCH','DIGITDIFF'].includes(ct);

            const params = {
                amount: stakeToUse,
                basis: 'stake',
                contract_type: ct,
                currency: currency || 'USD',
                duration: tickDuration.toString(),
                duration_unit: 't',
                symbol: symbol,
            };
            if (needsBarrier && prediction !== null) {
                params.barrier = prediction;
            }

            allTradeParams.push({
                stake: stakeToUse,
                params,
                contract_type: ct,
                barrier: needsBarrier ? prediction : undefined,
                display: `${ct}${needsBarrier ? ` P:${prediction}` : ''}`,
                is_manual: false,
                isTriggeredTrade: true,
                isParallel: true,
                parallelBatchId: batchId,
                parallelSlot: i,
            });
        }

        logToJournal(`🔀 PARALLEL: Firing ${parallelCount} trades simultaneously (Batch ${batchId})`, 'info', true);
        logToJournal(`📊 Trade types: ${allTradeParams.map(t => t.contract_type).join(', ')}`, 'info', true);

        Promise.all(
            allTradeParams.map(tradeParam => executeTriggeredTradeImmediate(tradeParam))
        ).then(results => {
            const placed = results.filter(r => r === true).length;
            logToJournal(
                `🚀 PARALLEL: ${placed}/${parallelCount} trades confirmed open (Batch ${batchId})`,
                'success',
                true
            );
            if (placed === 0) {
                parallelPending.current = false;
                parallelBatchId.current = null;
                parallelBatchProfits.current = [];
                isTradeTriggered.current = false;
                triggerLocked.current = false;
                logToJournal('⚠️ PARALLEL: All trades failed, batch aborted', 'warn', true);
            }
        }).catch(err => {
            logToJournal(`❌ PARALLEL batch error: ${err.message}`, 'error', true);
            parallelPending.current = false;
            parallelBatchId.current = null;
            parallelBatchProfits.current = [];
            isTradeTriggered.current = false;
            triggerLocked.current = false;
        });

    }, [is_logged_in, parallelCount, parallelTicks, currency, symbol,
        executeTriggeredTradeImmediate, currentParallelStake, logToJournal]);

    // ============================================
    // 31. HEDGE TRIGGER DETECTION
    // ============================================
    const checkHedgeTriggers = useCallback((digit) => {
        if (!isBotRunningRef.current) return false;
        if (hedgeTradePending.current) return false;
        if (tpSlTriggered.current) return false;
        
        const triggerList = hedgeTriggers.split(',').map(t => parseInt(t.trim())).filter(t => !isNaN(t));
        
        if (triggerList.includes(digit)) {
            hedgeDigitHistory.current = [digit, ...hedgeDigitHistory.current.slice(0, 4)];
            hedgeLastDigit.current = digit;
            return true;
        }
        
        return false;
        
    }, [hedgeTradePending, hedgeTriggers]);

    // ============================================
    // 32. MANUAL TRADE EXECUTION
    // ============================================
    const executeManualTrade = useCallback(() => {
        if (!is_logged_in && !isOAuthUser.current) {
            logToJournal('Please login first', 'error');
            return;
        }

        if (manualTradePlaced.current || isManualTradePending) {
            logToJournal('Manual trade already in progress', 'warn');
            return;
        }

        const reqStake = parseFloat(stake);
        const currentPred = getCurrentPred();

        const contractDisplay = isRiseFall(contractType)
            ? (contractType === 'CALL' ? 'RISE 📈' : 'FALL 📉')
            : `${contractType}${needsPrediction(contractType) ? ` (Prediction: ${currentPred})` : ''}`;

        logToJournal(`🚀 MANUAL TRADE: Executing ${contractDisplay} @ $${reqStake} for ${ticks} ticks`, 'info', true);

        const params = {
            amount: reqStake,
            basis: 'stake',
            contract_type: contractType,
            currency: currency || 'USD',
            duration: parseInt(ticks).toString(),
            duration_unit: 't',
            symbol: symbol
        };

        if (needsPrediction(contractType)) {
            params.barrier = currentPred;
        }

        manualTradePlaced.current = true;
        setIsManualTradePending(true);

        tradeQueue.current.push({
            stake: reqStake,
            params: params,
            contract_type: contractType,
            barrier: needsPrediction(contractType) ? currentPred : undefined,
            display: contractDisplay,
            is_manual: true
        });

        processTradeQueue();

    }, [is_logged_in, stake, contractType, isRiseFall, needsPrediction, ticks, currency, symbol, getCurrentPred, logToJournal, processTradeQueue, isManualTradePending]);

    // ============================================
    // 33. SNIPER LOGIC
    // ============================================
    const checkSniperLogic = useCallback((price, digit, currentHistory) => {
        if (!isBotRunningRef.current) return;
        if (tpSlTriggered.current) return;
        if (isPausedRef.current) return;
        if (mode === 'MANUAL') return;
        if (mode === 'SCANNER') return;

        const currentP = localProfitTracker.current;
        const targetTP = parseFloat(takeProfit);
        const targetSL = parseFloat(stopLoss);

        if (!tpSlTriggered.current && currentP >= targetTP && targetTP > 0) {
            tpSlTriggered.current = true;
            logToJournal(`🎯 Take Profit reached: $${currentP.toFixed(2)}`, 'success', true);
            botNotification(`🎯 Nyanyuki Pro — Take Profit Hit! P/L: +$${currentP.toFixed(2)}`, undefined, { type: 'success', autoClose: 8000 });
            tradeQueue.current = [];
            isProcessingQueue.current = false;
            dualTradeLocked.current = false;
            seqTradeTriggered.current = false;
            hedgeTradePending.current = false;
            triggerLocked.current = false;
            strikeTradeLocked.current = false;
            stopReasonRef.current = 'TAKE_PROFIT';
            syncWithRunPanel(false);
            return;
        }
        if (!tpSlTriggered.current && currentP <= -targetSL && targetSL > 0) {
            tpSlTriggered.current = true;
            logToJournal(`🛑 Stop Loss triggered: $${currentP.toFixed(2)}`, 'error', true);
            botNotification(`🛑 Nyanyuki Pro — Stop Loss Hit! P/L: $${currentP.toFixed(2)}`, undefined, { type: 'error', autoClose: 8000 });
            tradeQueue.current = [];
            isProcessingQueue.current = false;
            dualTradeLocked.current = false;
            seqTradeTriggered.current = false;
            hedgeTradePending.current = false;
            triggerLocked.current = false;
            strikeTradeLocked.current = false;
            stopReasonRef.current = 'STOP_LOSS';
            syncWithRunPanel(false);
            return;
        }

        if (isTradeTriggered.current && activeTradesCount.current > 0 && parseInt(vLossLimit) > 0) {
            if (mode !== 'SEQUENCE' && mode !== 'DUAL' && mode !== 'OVER_UNDER_HEDGE' && mode !== 'STRIKE' && mode !== 'PARALLEL') {
                return;
            }
        }

        if (mode === 'SEQUENCE') {
            checkSequenceBotTriggers(digit, price);
            return;
        }

        if (mode === 'OVER_UNDER_HEDGE') {
            if (checkHedgeTriggers(digit)) {
                executeHedgeTrade();
                isTradeTriggered.current = true;
            }
            return;
        }

        if (mode === 'STRIKE') {
            if (strikeTradeLocked.current) return;

            if (strikeInRecovery.current) {
                executeStrikeTrade(true);
                return;
            }

            if (strikePhase.current === 'RUN') {
                executeStrikeTrade(false);
                return;
            }

            if (strikeTriggerMode === 'TRIGGER') {
                const triggerList = strikeTriggers.split(',')
                    .map(t => parseInt(t.trim()))
                    .filter(t => !isNaN(t));
                if (triggerList.includes(digit)) {
                    logToJournal(`🎯 STRIKE: Entry trigger digit ${digit} — LAUNCHING`, 'success', true);
                    executeStrikeTrade(false);
                }
            } else {
                const pred = strikeContract;
                let isVLoss = false;
                if (pred === 'CALL') isVLoss = (price <= prevTickPrice.current);
                else if (pred === 'PUT') isVLoss = (price >= prevTickPrice.current);
                else if (pred === 'DIGITEVEN') {
                    isVLoss = (digit % 2 === 0);
                } else if (pred === 'DIGITODD') {
                    isVLoss = (digit % 2 !== 0);
                } else if (pred === 'DIGITOVER') isVLoss = (digit <= parseInt(strikePred));
                else if (pred === 'DIGITUNDER')isVLoss = (digit >= parseInt(strikePred));
                else if (pred === 'DIGITMATCH')isVLoss = (digit !== parseInt(strikePred));
                else if (pred === 'DIGITDIFF') isVLoss = (digit === parseInt(strikePred));

                if (isVLoss) {
                    strikeVLossCounter.current += 1;
                    logToJournal(`📉 STRIKE hunt V-Loss: ${strikeVLossCounter.current}/${strikeVLoss}`, 'warn', true);
                    if (strikeVLossCounter.current >= parseInt(strikeVLoss)) {
                        strikeVLossCounter.current = 0;
                        logToJournal(`⚡ STRIKE: V-Loss entry triggered — LAUNCHING`, 'success', true);
                        executeStrikeTrade(false);
                    }
                } else {
                    strikeVLossCounter.current = 0;
                }
            }
            return;
        }

        if (mode === 'DUAL') {
            executeDualTrade();
            return;
        }

        if (mode === 'PARALLEL') {
            if (parallelRunMode === 'AUTO_RUN') {
                if (parallelAutoRunActive.current) {
                    if (!parallelPending.current && !isTradeTriggered.current && activeTradesCount.current === 0 && !tpSlTriggered.current) {
                        logToJournal(`🔁 PARALLEL AUTO-RUN: Firing next batch`, 'info', true);
                        executeParallelTrades();
                        isTradeTriggered.current = true;
                    }
                    return;
                }
            }

            if (!parallelAutoRunActive.current && !parallelPending.current && !isTradeTriggered.current && activeTradesCount.current === 0 && !tpSlTriggered.current) {
                let shouldTrigger = false;
                
                if (parallelTriggerMethod === 'TRIGGER') {
                    const triggerList = parallelTriggers.split(',').map(t => parseInt(t.trim())).filter(t => !isNaN(t));
                    if (triggerList.includes(digit)) {
                        shouldTrigger = true;
                        logToJournal(`🎯 PARALLEL: Digit ${digit} matched triggers [${parallelTriggers}]`, 'success', true);
                    }
                } else {
                    const firstTrade = parallelTradesRef.current[0];
                    let isVLoss = false;
                    
                    if (firstTrade.contract === 'CALL') {
                        isVLoss = (price <= prevTickPrice.current);
                    } else if (firstTrade.contract === 'PUT') {
                        isVLoss = (price >= prevTickPrice.current);
                    } else if (firstTrade.contract === 'DIGITEVEN') {
                        isVLoss = (digit % 2 === 0);
                    } else if (firstTrade.contract === 'DIGITODD') {
                        isVLoss = (digit % 2 !== 0);
                    } else if (firstTrade.contract === 'DIGITOVER') {
                        isVLoss = (digit <= (firstTrade.prediction || 5));
                    } else if (firstTrade.contract === 'DIGITUNDER') {
                        isVLoss = (digit >= (firstTrade.prediction || 4));
                    } else if (firstTrade.contract === 'DIGITMATCH') {
                        isVLoss = (digit !== (firstTrade.prediction || 5));
                    } else if (firstTrade.contract === 'DIGITDIFF') {
                        isVLoss = (digit === (firstTrade.prediction || 5));
                    }
                    
                    if (isVLoss) {
                        parallelVLossCounter.current += 1;
                        logToJournal(`📉 PARALLEL V-Loss: ${parallelVLossCounter.current}/${parallelVLossLimit}`, 'warn', true);
                        if (parallelVLossCounter.current >= parallelVLossLimit) {
                            shouldTrigger = true;
                            parallelVLossCounter.current = 0;
                            logToJournal(`⚡ PARALLEL V-Loss limit reached - TRIGGERING ${parallelCount} trades`, 'success', true);
                        }
                    } else {
                        parallelVLossCounter.current = 0;
                    }
                }
                
                if (shouldTrigger && !tpSlTriggered.current) {
                    logToJournal(`🎯 PARALLEL: Launching ${parallelCount} trades`, 'success', true);
                    
                    if (parallelRunMode === 'AUTO_RUN') {
                        parallelAutoRunActive.current = true;
                        logToJournal(`🚀 PARALLEL AUTO-RUN: First trigger hit — will fire continuously until stopped`, 'success', true);
                    }
                    
                    executeParallelTrades();
                    isTradeTriggered.current = true;
                }
            }
            return;
        }

        // Trigger mode for STABLE/AGGRESSIVE
        if (triggerMode === 'TRIGGER') {
            const triggerList = triggers.split(',').map(t => parseInt(t.trim())).filter(t => !isNaN(t));
            if (triggerList.includes(digit) && !isTradeTriggered.current && !tpSlTriggered.current) {
                logToJournal(`🎯 DIGIT TRIGGER: Digit ${digit} matched [${triggers}] - EXECUTING`, 'success', true);
                isTradeTriggered.current = true;
                executeTrade();
            }
        } else {
            let isVLoss = false;

            if (isRiseFall(contractType)) {
                if (contractType === 'CALL') {
                    isVLoss = (price <= prevTickPrice.current);
                } else if (contractType === 'PUT') {
                    isVLoss = (price >= prevTickPrice.current);
                }
            } else {
                const pred = getCurrentPred();
                switch (contractType) {
                    case 'DIGITEVEN':
                        isVLoss = (digit % 2 === 0);
                        break;
                    case 'DIGITODD':
                        isVLoss = (digit % 2 !== 0);
                        break;
                    case 'DIGITOVER': 
                        isVLoss = (digit <= pred);
                        break;
                    case 'DIGITUNDER':
                        isVLoss = (digit >= pred);
                        break;
                    case 'DIGITMATCH':
                        isVLoss = (digit !== pred);
                        break;
                    case 'DIGITDIFF': 
                        isVLoss = (digit === pred);
                        break;
                    default: isVLoss = false;
                }
            }

            if (isVLoss) {
                virtualStreak.current += 1;
                if (isRiseFall(contractType)) {
                    const direction = contractType === 'CALL' ? 'DOWN' : 'UP';
                    logToJournal(`📉 V-Loss: Price went ${direction} (${virtualStreak.current}/${vLossLimit})`, 'warn', true);
                } else {
                    logToJournal(`🎲 V-Loss Streak: ${virtualStreak.current} (Digit: ${digit}, Target: ${getCurrentPred()})`, 'warn', true);
                }
            } else {
                virtualStreak.current = 0;
            }
            setVCounterDisplay(virtualStreak.current);

            // ── PRE-WARM: send a fresh proposal on EVERY tick ──────────────────────────
            // Warming on every tick (not just one tick before the limit) eliminates the race
            // where the warm request hasn't returned by the time the trigger fires.
            // Cost is minimal — just a proposal request, no buy. The server reuses the stream.
            // If martingale changes the stake, preProposalAmount validation (in
            // executeTriggeredTradeImmediate) will discard the stale proposal automatically.
            const _vLimit = parseInt(vLossLimit);
            if (!preProposalId.current && !preProposalInFlight.current
                && !isTradeTriggered.current && !tpSlTriggered.current) {
                const _nbp = needsPrediction(contractType);
                const _pred = getCurrentPred();
                const _preStake = stableLastTradeWasLoss.current && martingaleEnabled
                    ? stableCurrentStake.current
                    : stableBaseStake.current || parseFloat(stake) || 1;
                warmProposal({
                    amount: _preStake,
                    basis: 'stake',
                    contract_type: contractType,
                    currency: currency || 'USD',
                    duration: parseInt(ticks) || 1,
                    duration_unit: 't',
                    symbol: symbol,
                    ...(_nbp && _pred != null ? { barrier: _pred } : {})
                });
            }

            if (_vLimit === 0) {
                logToJournal(`⚡ EVERY TICK MODE: Executing trade on tick ${digit}`, 'info', true);
                isTradeTriggered.current = true;
                executeTrade();
                isTradeTriggered.current = false;
            } else if (virtualStreak.current >= _vLimit && !isTradeTriggered.current && !tpSlTriggered.current) {
                logToJournal(`⚡ V-LOSS LIMIT REACHED: ${vLossLimit} - EXECUTING INSTANTLY`, 'warn', true);
                virtualStreak.current = 0;
                isTradeTriggered.current = true;
                executeTrade();
            }
        }

        if (isBotRunningRef.current && mode === 'AGGRESSIVE' && !tpSlTriggered.current) {
            const limit = parseInt(tickLimit);
            if (limit > 0) {
                tickCounter.current += 1;
                setTicksProcessed(tickCounter.current);
                if (tickCounter.current >= limit) {
                    logToJournal(`⏱️ Burst limit reached (${limit} ticks)`, 'info', true);
                    syncWithRunPanel(false);
                }
            }
        }
    }, [mode, localProfitTracker, takeProfit, stopLoss, logToJournal, isRiseFall, contractType, getCurrentPred, vLossLimit, tickLimit, executeHedgeTrade, checkHedgeTriggers, executeDualTrade, executeTrade, syncWithRunPanel, checkSequenceBotTriggers, triggerMode, triggers, strikeContract, strikePred, strikeTriggerMode, strikeTriggers, strikeVLoss, strikePhase, strikeInRecovery, strikeVLossCounter, strikeTradeLocked, executeStrikeTrade, parallelCount, parallelTriggers, parallelTriggerMethod, parallelRunMode, parallelVLossLimit, parallelVLossCounter, executeParallelTrades, parallelPending, isTradeTriggered, activeTradesCount,
        warmProposal, stake, ticks, symbol, currency, needsPrediction, martingaleEnabled]);

    // ============================================
    // 33.5 SCANNER MODE - MULTI-SYMBOL WEBSOCKET SCANNER
    // ============================================

    const SCANNER_SYMBOLS = [
        'R_10', 'R_25', 'R_50', 'R_75', 'R_100',
        '1HZ10V', '1HZ25V', '1HZ50V', '1HZ75V', '1HZ100V',
        '1HZ15V', '1HZ30V', '1HZ90V'
    ];

    const scannerLogToJournal = useCallback((message, type = 'info') => {
        const timestamp = new Date().toLocaleTimeString();
        const logMsg = `[${timestamp}] [SCANNER] ${message}`;
        const colors = { error: '#EF4444', success: '#10B981', warn: '#F59E0B', info: '#3B82F6' };
        console.log(`%c${logMsg}`, `color: ${colors[type] || '#3B82F6'}`);
        setTradeLogs(prev => [
            { id: Date.now() + Math.random(), message: logMsg, type, timestamp },
            ...prev.slice(0, 49)
        ]);
    }, []);

    const executeScannerTrade = useCallback(async (symToTrade, contractToTrade) => {
        if ((!is_logged_in && !isOAuthUser.current) || !isBotRunningRef.current) return;
        if (tpSlTriggered.current) return;
        if (scannerTradeLocked.current) return;

        scannerTradeLocked.current = true;
        scannerIsTrading.current = true;
        scannerCurrentSymbol.current = symToTrade;
        scannerCurrentContract.current = contractToTrade;
        setScannerStatus('TRADING');
        setScannerActiveSymbol(symToTrade);
        setScannerContractType(contractToTrade);

        // ---- MARTINGALE STAKE ----
        // Stake and counter are managed in the result handler after each trade.
        // Execution just reads the pre-computed scannerCurrentStake.current.
        if (!scannerLastTradeWasLoss.current) {
            scannerCurrentStake.current = scannerBaseStake.current;
            scannerMartingaleCounter.current = 0;
        }

        const stakeToUse = scannerCurrentStake.current;
        scannerLogToJournal(`🚀 SCANNER: ${contractToTrade} on ${symToTrade} @ $${stakeToUse}${scannerLastTradeWasLoss.current ? ` (M×${scannerMartingaleCounter.current})` : ''}`, 'success');

        try {
            botObserver.emit('contract.status', { id: 'contract.purchase_sent', data: 0 });

            const res = await sendTradeRequest({
                buy: 1,
                price: stakeToUse,
                parameters: {
                    amount: stakeToUse,
                    basis: 'stake',
                    contract_type: contractToTrade,
                    currency: currency || 'USD',
                    duration: 1,
                    duration_unit: 't',
                    symbol: symToTrade
                }
            });

            if (res.error) {
                scannerLogToJournal(`❌ Scanner trade error: ${res.error.message}`, 'error');
                if (res.error.message?.toLowerCase().includes('insufficient') ||
                    res.error.message?.toLowerCase().includes('balance')) {
                    stopReasonRef.current = 'LOW_FUNDS';
                    syncWithRunPanel(false);
                }
                scannerTradeLocked.current = false;
                scannerIsTrading.current = false;
                setScannerStatus('SCANNING');
                return;
            }

            if (res.buy) {
                const contractId = res.buy.contract_id;
                scannerPendingContractId.current = contractId;

                botObserver.emit('bot.running', {});
                botObserver.emit('contract.status', {
                    id: 'contract.purchase_received',
                    data: 0,
                    buy: { buy_price: stakeToUse }
                });

                activeTradesCount.current += 1;
                updateRunPanelContractCount(activeTradesCount.current);

                setActiveTradesList(prev => [...prev, {
                    id: contractId,
                    type: contractToTrade,
                    stake: stakeToUse,
                    time: new Date().toLocaleTimeString(),
                    isManual: false,
                    isScanner: true,
                }]);

                // Clear digit history immediately after buy so the old streak cannot
                // re-trigger while this trade is still open. Fresh digits are needed.
                scannerDigitHistory.current = {};
                setScannerSymbolDigits({});

                // Poll at 200ms so we detect the settled result fast and unlock quickly.
                // A 1-tick contract on 1HZ markets settles in ~1 s; 200ms ensures we
                // detect it within one extra tick at most.
                const checkInterval = setInterval(async () => {
                    try {
                        if (!isBotRunningRef.current) {
                            clearInterval(checkInterval);
                            activeContracts.current.delete(contractId);
                            activeTradesCount.current = Math.max(0, activeTradesCount.current - 1);
                            updateRunPanelContractCount(activeTradesCount.current);
                            setActiveTradesList(prev => prev.filter(t => t.id !== contractId));
                            scannerTradeLocked.current = false;
                            scannerIsTrading.current = false;
                            setScannerStatus('IDLE');
                            return;
                        }

                        const monRes = await sendTradeRequest({
                            proposal_open_contract: 1,
                            contract_id: contractId
                        });

                        if (monRes.error) {
                            clearInterval(checkInterval);
                            activeContracts.current.delete(contractId);
                            activeTradesCount.current = Math.max(0, activeTradesCount.current - 1);
                            updateRunPanelContractCount(activeTradesCount.current);
                            setActiveTradesList(prev => prev.filter(t => t.id !== contractId));
                            scannerTradeLocked.current = false;
                            scannerIsTrading.current = false;
                            setScannerStatus('SCANNING');
                            return;
                        }

                        const contract = monRes.proposal_open_contract;
                        if (contract && contract.is_sold) {
                            clearInterval(checkInterval);
                            activeContracts.current.delete(contractId);

                            const txId = contract.transaction_id || contractId;
                            if (processedTxIds.current.has(txId)) return;
                            processedTxIds.current.add(txId);

                            // Discard any stale pre-warmed proposal so the next
                            // scanner buy uses the correct (possibly martingale) stake.
                            preProposalId.current = null;
                            preProposalContractType.current = null;

                            const profit = parseFloat(contract.profit || 0);

                            botObserver.emit('contract.status', {
                                id: 'contract.sold',
                                data: 0,
                                contract: { ...contract, profit }
                            });

                            botObserver.emit('bot.contract', {
                                ...contract,
                                buy_price: stakeToUse,
                                sell_price: parseFloat(contract.sell_price || 0),
                                profit,
                                contract_type: contractToTrade,
                                currency: currency || 'USD',
                                is_sold: true,
                                underlying: symToTrade,
                                payout: parseFloat(contract.payout || 0),
                                run_id: runIdRef.current,
                            });

                            setActiveTradesList(prev => prev.filter(t => t.id !== contractId));
                            localProfitTracker.current = parseFloat((localProfitTracker.current + profit).toFixed(2));
                            setTotalPL(localProfitTracker.current);

                            const sellTx = {
                                contract_id: contractId,
                                transaction_ids: {
                                    buy: contract.transaction_ids?.buy || contractId,
                                    sell: contract.transaction_ids?.sell || contract.transaction_id
                                },
                                run_id: runIdRef.current,
                                contract_type: contractToTrade,
                                display_name: symToTrade,
                                underlying: symToTrade,
                                shortcode: contract.shortcode || `${contractToTrade}_${symToTrade}`,
                                buy_price: stakeToUse,
                                sell_price: parseFloat(contract.sell_price || 0),
                                payout: parseFloat(contract.payout || 0),
                                profit,
                                currency: currency || 'USD',
                                status: profit > 0 ? 'won' : 'lost',
                                is_sold: true,
                                is_completed: true,
                                entry_tick_display_value: contract.entry_tick_display_value,
                                exit_tick_display_value: contract.exit_tick_display_value,
                                entry_tick_time: contract.entry_tick_time,
                                exit_tick_time: contract.exit_tick_time,
                                date_start: new Date().toISOString(),
                                purchase_time: Date.now(),
                                isScanner: true,
                            };
                            registerTransactionInPanel(sellTx, true);

                            activeTradesCount.current = Math.max(0, activeTradesCount.current - 1);
                            updateRunPanelContractCount(activeTradesCount.current);

                            // ---- WIN / LOSS + MARTINGALE STATE ----
                            if (profit > 0) {
                                setWins(prev => prev + 1);
                                setScannerStats(prev => ({ ...prev, wins: prev.wins + 1 }));
                                scannerLastTradeWasLoss.current = false;
                                scannerMartingaleCounter.current = 0;
                                scannerCurrentStake.current = scannerBaseStake.current;
                                scannerLogToJournal(`✅ WIN on ${symToTrade} (${contractToTrade}): +$${profit.toFixed(2)} | Stake reset → $${scannerBaseStake.current}`, 'success');
                            } else {
                                setLosses(prev => prev + 1);
                                setScannerStats(prev => ({ ...prev, losses: prev.losses + 1 }));
                                scannerLastTradeWasLoss.current = true;
                                if (scannerMartingaleEnabled) {
                                    const nextCnt = scannerMartingaleCounter.current + 1;
                                    const lim = parseInt(scannerMartingaleLimit);
                                    const willReset = lim !== 0 && nextCnt > lim;
                                    if (willReset) {
                                        scannerMartingaleCounter.current = 0;
                                        scannerCurrentStake.current = scannerBaseStake.current;
                                        scannerLogToJournal(`❌ LOSS on ${symToTrade} (${contractToTrade}): ${profit.toFixed(2)} | Martingale limit reached — stake reset to ${scannerBaseStake.current}`, 'error');
                                    } else {
                                        scannerMartingaleCounter.current = nextCnt;
                                        const multiplier = Math.pow(parseFloat(scannerMartingale), nextCnt);
                                        scannerCurrentStake.current = parseFloat((scannerBaseStake.current * multiplier).toFixed(2));
                                        scannerLogToJournal(`❌ LOSS on ${symToTrade} (${contractToTrade}): ${profit.toFixed(2)} | Next stake → ${scannerCurrentStake.current} (${nextCnt}/${lim === 0 ? '∞' : lim})`, 'error');
                                    }
                                } else {
                                    scannerLogToJournal(`❌ LOSS on ${symToTrade} (${contractToTrade}): ${profit.toFixed(2)} | Martingale disabled`, 'error');
                                }
                            }

                            // ---- SEQUENCE ROTATION ----
                            scannerSeqRunsRef.current += 1;
                            const seqArr = scannerSequenceRef.current;
                            const curSlot = seqArr[scannerSeqIndexRef.current] || seqArr[0];
                            const runsNeeded = parseInt(curSlot.runsPerType) || 1;
                            if (scannerSeqRunsRef.current >= runsNeeded) {
                                const nextIdx = (scannerSeqIndexRef.current + 1) % seqArr.length;
                                scannerSeqIndexRef.current = nextIdx;
                                scannerSeqRunsRef.current = 0;
                                setScannerSeqIndex(nextIdx);
                                const nextSlot = seqArr[nextIdx];
                                scannerCurrentContract.current = nextSlot.contract;
                                setScannerContractType(nextSlot.contract);
                                scannerLogToJournal(`🔄 SEQUENCE: → ${nextSlot.contract} (slot ${nextIdx + 1}/${seqArr.length})`, 'info');
                            } else {
                                scannerLogToJournal(`🔁 Slot ${scannerSeqIndexRef.current + 1}/${seqArr.length} (${curSlot.contract}): run ${scannerSeqRunsRef.current}/${runsNeeded}`, 'info');
                            }

                            // ---- SCANNER-SPECIFIC TP/SL ----
                            const scanTP = parseFloat(scannerTakeProfitRef.current) || 0;
                            const scanSL = parseFloat(scannerStopLossRef.current) || 0;
                            if (scanTP > 0 && localProfitTracker.current >= scanTP) {
                                scannerLogToJournal(`🎉 SCANNER TAKE PROFIT: +$${localProfitTracker.current.toFixed(2)} >= $${scanTP}`, 'success');
                                botNotification(`🎯 Scanner Bot — Take Profit Hit! P/L: +$${localProfitTracker.current.toFixed(2)}`, undefined, { type: 'success', autoClose: 8000 });
                                tpSlTriggered.current = true;
                                scannerTradeLocked.current = false;
                                scannerIsTrading.current = false;
                                stopReasonRef.current = 'TAKE_PROFIT';
                                stopScannerWebSockets();
                                syncWithRunPanel(false);
                                return;
                            } else if (scanSL > 0 && localProfitTracker.current <= -scanSL) {
                                scannerLogToJournal(`🛑 SCANNER STOP LOSS: $${localProfitTracker.current.toFixed(2)} <= -$${scanSL}`, 'error');
                                botNotification(`🛑 Scanner Bot — Stop Loss Hit! P/L: $${localProfitTracker.current.toFixed(2)}`, undefined, { type: 'error', autoClose: 8000 });
                                tpSlTriggered.current = true;
                                scannerTradeLocked.current = false;
                                scannerIsTrading.current = false;
                                stopReasonRef.current = 'STOP_LOSS';
                                stopScannerWebSockets();
                                syncWithRunPanel(false);
                                return;
                            }

                            // ---- GLOBAL TP/SL — only applies when scanner-specific TP/SL are disabled (set to 0) ----
                            if (scanTP === 0 && scanSL === 0) {
                                if (!tpSlTriggered.current && parseFloat(takeProfit) > 0 && localProfitTracker.current >= parseFloat(takeProfit)) {
                                    tpSlTriggered.current = true;
                                    scannerLogToJournal(`🎯 Global Take Profit: ${localProfitTracker.current.toFixed(2)}`, 'success');
                                    botNotification(`🎯 Nyanyuki Pro — Take Profit Hit! P/L: +${localProfitTracker.current.toFixed(2)}`, undefined, { type: 'success', autoClose: 8000 });
                                    scannerTradeLocked.current = false;
                                    scannerIsTrading.current = false;
                                    stopReasonRef.current = 'TAKE_PROFIT';
                                    stopScannerWebSockets();
                                    syncWithRunPanel(false);
                                    return;
                                } else if (!tpSlTriggered.current && parseFloat(stopLoss) > 0 && localProfitTracker.current <= -parseFloat(stopLoss)) {
                                    tpSlTriggered.current = true;
                                    scannerLogToJournal(`🛑 Global Stop Loss: ${localProfitTracker.current.toFixed(2)}`, 'error');
                                    botNotification(`🛑 Nyanyuki Pro — Stop Loss Hit! P/L: ${localProfitTracker.current.toFixed(2)}`, undefined, { type: 'error', autoClose: 8000 });
                                    scannerTradeLocked.current = false;
                                    scannerIsTrading.current = false;
                                    stopReasonRef.current = 'STOP_LOSS';
                                    stopScannerWebSockets();
                                    syncWithRunPanel(false);
                                    return;
                                }
                            }

                            // ---- UNLOCK — 5-second hardcoded cooldown before next signal ----
                            scannerIsTrading.current = false;
                            scannerPendingContractId.current = null;
                            setScannerStatus('SCANNING');
                            // Hardcoded 5-second reset: gives markets time to settle between signals
                            scannerCooldownUntil.current = Date.now() + 5000;
                            scannerLogToJournal('⏱️ 5s reset — scanner will pick up fresh digits', 'info');
                            scannerTradeLocked.current = false;
                        }
                    } catch (err) {
                        clearInterval(checkInterval);
                        activeContracts.current.delete(contractId);
                        activeTradesCount.current = Math.max(0, activeTradesCount.current - 1);
                        updateRunPanelContractCount(activeTradesCount.current);
                        setActiveTradesList(prev => prev.filter(t => t.id !== contractId));
                        scannerTradeLocked.current = false;
                        scannerIsTrading.current = false;
                        setScannerStatus('SCANNING');
                    }
                }, 200);

                activeContracts.current.set(contractId, checkInterval);
            }
        } catch (err) {
            scannerLogToJournal(`❌ Scanner trade failed: ${err.message}`, 'error');
            scannerTradeLocked.current = false;
            scannerIsTrading.current = false;
            setScannerStatus('SCANNING');
        }
    }, [is_logged_in, currency, botObserver, syncWithRunPanel, logToJournal, scannerLogToJournal,
        registerTransactionInPanel, updateRunPanelContractCount, scannerMartingale, scannerMartingaleLimit,
        takeProfit, stopLoss, scannerMartingaleEnabled, sendTradeRequest]);
    const checkScannerPattern = useCallback((sym, digit) => {
        if (!isBotRunningRef.current || mode !== 'SCANNER') return;
        if (scannerTradeLocked.current) return;
        if (tpSlTriggered.current) return;
        if (isPausedRef.current) return;
        // Cooldown: suppress new signals for a configured delay after each trade
        if (Date.now() < scannerCooldownUntil.current) return;

        // Update digit history for this symbol
        const history = scannerDigitHistory.current[sym] || [];
        const newHistory = [digit, ...history].slice(0, 20);
        scannerDigitHistory.current[sym] = newHistory;

        // Update display
        setScannerSymbolDigits(prev => ({ ...prev, [sym]: newHistory.slice(0, 5) }));

        // Need at least N digits to detect a pattern (N = user-configured detection count)
        const detN = scannerDetectionCountRef.current || 2;
        if (newHistory.length < detN) return;

        // Check that all of the last detN digits share the same parity
        const recent = newHistory.slice(0, detN);
        const allEven = recent.every(d => d % 2 === 0);
        const allOdd  = recent.every(d => d % 2 !== 0);

        if (allEven || allOdd) {
            // Get the contract type from the CURRENT sequence slot
            const seqArr = scannerSequenceRef.current;
            const curSlot = seqArr[scannerSeqIndexRef.current] || seqArr[0];
            const contractToTrade = scannerCurrentContract.current || curSlot.contract;

            // Sync current contract tracking
            scannerCurrentContract.current = contractToTrade;

            // ---- PICK BEST MARKET: same parity, longest current streak ----
            // Multiple markets may show the same pattern at the same time.
            // We scan all 13 markets and pick the one whose leading streak of
            // the DETECTED parity (even or odd) is the longest — that market
            // gives the strongest signal for the next tick outcome.
            const detectedParity = allEven ? 0 : 1; // 0 = even, 1 = odd
            let bestSym = sym;      // default to triggering symbol
            let bestStreak = 0;

            Object.entries(scannerDigitHistory.current).forEach(([mSym, mHistory]) => {
                if (!mHistory || mHistory.length === 0) return;
                // Count how many leading digits match the detected parity
                let streak = 0;
                for (const d of mHistory) {
                    if (d % 2 === detectedParity) {
                        streak++;
                    } else {
                        break;
                    }
                }
                if (streak > bestStreak) {
                    bestStreak = streak;
                    bestSym = mSym;
                }
            });

            const patternType = allEven ? 'ALL-EVEN' : 'ALL-ODD';
            scannerLogToJournal(
                `🔍 ${sym}: [${recent.slice().reverse().join(',')}] = ${patternType} | 🏆 Best: ${bestSym} (${bestStreak}-digit streak) → Trading ${contractToTrade} immediately`,
                'info'
            );
            executeScannerTrade(bestSym, contractToTrade);
        }
    }, [mode, scannerLogToJournal, executeScannerTrade]);

    const startScannerWebSockets = useCallback(() => {
        // Close any existing scanner WS connections
        Object.values(scannerWsMap.current).forEach(ws => {
            try { ws.close(); } catch (e) {}
        });
        scannerWsMap.current = {};
        scannerDigitHistory.current = {};

        SCANNER_SYMBOLS.forEach(sym => {
            try {
                const ws = new WebSocket('wss://ws.binaryws.com/websockets/v3?app_id=101761');
                scannerWsMap.current[sym] = ws;

                ws.onopen = () => {
                    ws.send(JSON.stringify({ ticks: sym, subscribe: 1 }));
                };

                ws.onmessage = (msg) => {
                    try {
                        const data = JSON.parse(msg.data);
                        if (data.tick) {
                            const price = data.tick.quote;
                            const pStr = price.toFixed(data.tick.pip_size || 2);
                            const digit = parseInt(pStr.slice(-1));
                            checkScannerPattern(sym, digit);
                        }
                    } catch (e) {}
                };

                ws.onerror = () => {};
                ws.onclose = () => {
                    // Auto-reconnect if bot still running in scanner mode
                    if (isBotRunningRef.current && modeRef.current === 'SCANNER') {
                        setTimeout(() => {
                            if (isBotRunningRef.current && modeRef.current === 'SCANNER') {
                                const newWs = new WebSocket('wss://ws.binaryws.com/websockets/v3?app_id=101761');
                                scannerWsMap.current[sym] = newWs;
                                newWs.onopen = () => newWs.send(JSON.stringify({ ticks: sym, subscribe: 1 }));
                                newWs.onmessage = ws.onmessage;
                                newWs.onerror = () => {};
                                newWs.onclose = () => {};
                            }
                        }, 3000);
                    }
                };
            } catch (e) {
                scannerLogToJournal(`Failed to connect scanner WS for ${sym}`, 'error');
            }
        });

        scannerLogToJournal(`📡 Scanner started — monitoring ${SCANNER_SYMBOLS.length} volatility markets`, 'success');
        setScannerStatus('SCANNING');
    }, [checkScannerPattern, scannerLogToJournal]);

    const stopScannerWebSockets = useCallback(() => {
        Object.values(scannerWsMap.current).forEach(ws => {
            try { ws.close(); } catch (e) {}
        });
        scannerWsMap.current = {};
        scannerLogToJournal('🛑 Scanner WebSockets closed', 'info');
        setScannerStatus('IDLE');
    }, [scannerLogToJournal]);

    // Start/stop scanner WS when bot starts/stops in SCANNER mode
    useEffect(() => {
        if (isBotRunning && mode === 'SCANNER') {
            scannerBaseStake.current = parseFloat(scannerStake);
            scannerCurrentStake.current = parseFloat(scannerStake);
            scannerMartingaleCounter.current = 0;
            scannerLastTradeWasLoss.current = false;
            // Sync TP/SL/DetectionCount refs to latest state values at start time
            scannerTakeProfitRef.current = parseFloat(scannerTakeProfit) || 0;
            scannerStopLossRef.current = parseFloat(scannerStopLoss) || 0;
            scannerDetectionCountRef.current = parseInt(scannerDetectionCount) || 2;
            // Set initial contract from first sequence slot
            const firstSlot = scannerSequenceRef.current[0] || { contract: 'DIGITEVEN', runsPerType: 2 };
            scannerCurrentContract.current = firstSlot.contract;
            scannerSeqIndexRef.current = 0;
            scannerSeqRunsRef.current = 0;
            setScannerSeqIndex(0);
            setScannerContractType(firstSlot.contract);
            scannerTradeLocked.current = false;
            scannerIsTrading.current = false;
            startScannerWebSockets();
        } else if (!isBotRunning && mode === 'SCANNER') {
            stopScannerWebSockets();
        }
    }, [isBotRunning, mode]);

    // ============================================
    // 34. WEB SOCKET DATA STREAM - WITH AUTO-RECONNECT
    // ============================================
    const isBotRunningForWs = useRef(isBotRunning);
    const modeRef = useRef(mode);
    const checkSniperLogicRef = useRef(checkSniperLogic);

    useEffect(() => { isBotRunningForWs.current = isBotRunning; }, [isBotRunning]);
    useEffect(() => { modeRef.current = mode; }, [mode]);
    useEffect(() => { checkSniperLogicRef.current = checkSniperLogic; }, [checkSniperLogic]);
    useEffect(() => { scannerSequenceRef.current = scannerSequence; }, [scannerSequence]);
    useEffect(() => { scannerDetectionCountRef.current = scannerDetectionCount; }, [scannerDetectionCount]);
    useEffect(() => { scannerTakeProfitRef.current = scannerTakeProfit; }, [scannerTakeProfit]);
    useEffect(() => { scannerStopLossRef.current = scannerStopLoss; }, [scannerStopLoss]);

    const connectWebSocket = useCallback(() => {
        if (publicWs.current && publicWs.current.readyState === WebSocket.OPEN) {
            return;
        }
        
        if (publicWs.current) {
            try {
                publicWs.current.close();
            } catch (e) {
                console.error('Error closing WebSocket:', e);
            }
        }

        const ws = new WebSocket('wss://ws.binaryws.com/websockets/v3?app_id=101761');
        publicWs.current = ws;
        
        let heartbeatInterval = null;
        wsLastPongTime.current = Date.now();
        
        ws.onopen = () => {
            console.log('[Nyanyuki] WebSocket connected for', symbol);
            wsReconnectAttempts.current = 0;
            
            ws.send(JSON.stringify({
                ticks_history: symbol,
                adjust_start_time: 1,
                count: 1000,
                end: "latest",
                style: "ticks"
            }));
            
            heartbeatInterval = setInterval(() => {
                if (ws.readyState === WebSocket.OPEN) {
                    ws.send(JSON.stringify({ ping: 1 }));
                    if (Date.now() - wsLastPongTime.current > 30000) {
                        console.log('[Nyanyuki] WebSocket heartbeat timeout, reconnecting...');
                        ws.close();
                    }
                }
            }, 15000);
        };

        ws.onmessage = (msg) => {
            try {
                const data = JSON.parse(msg.data);
                wsLastPongTime.current = Date.now();
                
                if (data.pong) {
                    return;
                }

                if (data.history) {
                    const prices = data.history.prices;
                    if (prices && prices.length > 0) {
                        const maxDecimals = prices.reduce((max, p) => {
                            const str = String(p);
                            const count = str.includes('.') ? str.split('.')[1].length : 0;
                            return count > max ? count : max;
                        }, 0);

                        const historyDigits = prices.map(p => {
                            const fixedPrice = p.toFixed(maxDecimals);
                            return parseInt(fixedPrice.slice(-1));
                        }).reverse();

                        setDigitHistory(historyDigits);
                        ws.send(JSON.stringify({ ticks: symbol, subscribe: 1 }));
                    }
                }

                if (data.tick) {
                    const price = data.tick.quote;
                    const pStr = price.toFixed(data.tick.pip_size || 2);
                    const digit = parseInt(pStr.slice(-1));

                    // Update refs immediately so checkSniperLogic reads the latest values.
                    lastDigitRef.current = digit;
                    lastPriceRef.current = price;

                    // Fire trade logic FIRST — before any setState calls — so the API buy
                    // request goes out at the earliest possible moment after the tick arrives.
                    // This ensures the entry consistently lands on the very next tick after
                    // a digit trigger or V-Loss trigger fires.
                    if (isBotRunningForWs.current && modeRef.current !== 'MANUAL' && !tpSlTriggered.current) {
                        checkSniperLogicRef.current(price, digit, [digit, ...[]]); 
                    }

                    if (prevTickPrice.current > 0) {
                        const change = price - prevTickPrice.current;
                        setPriceChange(change);

                        if (change > 0) {
                            setPriceDirection('up');
                            setConsecutiveUp(prev => prev + 1);
                            setConsecutiveDown(0);
                        } else if (change < 0) {
                            setPriceDirection('down');
                            setConsecutiveDown(prev => prev + 1);
                            setConsecutiveUp(0);
                        } else {
                            setPriceDirection('neutral');
                        }
                    }

                    setPriceHistory(prev => {
                        const newHistory = [...prev, price];
                        if (newHistory.length > MAX_PRICE_HISTORY) {
                            return newHistory.slice(-MAX_PRICE_HISTORY);
                        }
                        return newHistory;
                    });

                    setFullPrice(pStr);
                    setLastDigit(digit);

                    setDigitHistory(prev => {
                        const newHistory = [digit, ...prev.slice(0, 999)];
                        return newHistory;
                    });

                    prevTickPrice.current = price;
                }
            } catch (error) {
                console.error('Error processing WebSocket message:', error);
            }
        };

        ws.onerror = (error) => {
            console.error('WebSocket error:', error);
        };

        ws.onclose = (event) => {
            console.log(`WebSocket connection closed. Code: ${event.code}, Reason: ${event.reason}`);
            
            if (heartbeatInterval) {
                clearInterval(heartbeatInterval);
                heartbeatInterval = null;
            }
            
            if (wsReconnectTimeout.current) {
                clearTimeout(wsReconnectTimeout.current);
            }
            
            const maxAttempts = 10;
            const baseDelay = 2000;
            const delay = Math.min(baseDelay * Math.pow(1.5, wsReconnectAttempts.current), 30000);
            
            if (wsReconnectAttempts.current < maxAttempts) {
                wsReconnectAttempts.current++;
                console.log(`[Nyanyuki] Attempting to reconnect WebSocket in ${delay}ms (attempt ${wsReconnectAttempts.current}/${maxAttempts})`);
                
                wsReconnectTimeout.current = setTimeout(() => {
                    connectWebSocket();
                }, delay);
            } else {
                console.error('[Nyanyuki] Max WebSocket reconnection attempts reached');
                logToJournal('⚠️ WebSocket connection lost, please refresh page', 'warn', true);
            }
        };
        
    }, [symbol, logToJournal]);

    useEffect(() => {
        connectWebSocket();
        
        return () => {
            if (wsReconnectTimeout.current) {
                clearTimeout(wsReconnectTimeout.current);
            }
            if (publicWs.current) {
                try {
                    publicWs.current.close();
                } catch (e) {
                    console.error('Error closing WebSocket on cleanup:', e);
                }
            }
        };
    }, [symbol, connectWebSocket]);

    // ============================================
    // 35. SYNC WITH DERIV UI
    // ============================================
    useEffect(() => {
        if (runPanelStore) {
            if (runPanelStore.updateContractCount) {
                runPanelStore.updateContractCount(activeTradesCount.current);
            }
        }

        if (isBotRunning) {
            if (runPanelStore) {
                runIdRef.current = Date.now();
                if (runPanelStore.updateContractCount) {
                    runPanelStore.updateContractCount(0);
                }
            }

            logToJournal(`🤖 Nyanyuki Pro - ${mode} MODE`, 'success', true);
            logToJournal(`📊 ${symbol} | ${isRiseFall(contractType) ? (contractType === 'CALL' ? 'RISE 📈' : 'FALL 📉') : contractType}`, 'info', true);

            if (mode === 'MANUAL') {
                logToJournal('🖐️ MANUAL MODE: Click START to place ONE trade', 'info', true);
            } else if (mode === 'DUAL') {
                logToJournal(`🎯 DUAL Mode: Type 1 (${dualTriggerMode === 'TRIGGER' ? `Triggers [${triggers}]` : `V-Loss ${vLossLimit}`}) / Type 2 (Recovery) | Base Stake: $${dualBaseStake.current}`, 'info', true);
                logToJournal(`Current Stake: $${currentDualStake.current} | Martingale Counter: ${dualMartingaleCounter.current}/${martingaleLimit === 0 ? '∞' : martingaleLimit}`, 'info', true);
                if (dualRecoveryMode) {
                    logToJournal(`🔄 RECOVERY MODE ACTIVE - Type 2 trading until win`, 'info', true);
                }
            } else if (mode === 'OVER_UNDER_HEDGE') {
                logToJournal(`🛡️ HEDGE Mode: OVER 5 & UNDER 4 | Triggers: [${hedgeTriggers}] | Stake: $${hedgeStake} each`, 'info', true);
                if (hedgeMartingaleEnabled) {
                    logToJournal(`Martingale: ${hedgeMartingale}x | Limit: ${hedgeMartingaleLimit === 0 ? '∞' : hedgeMartingaleLimit}`, 'info', true);
                }
            } else if (mode === 'SEQUENCE') {
                logToJournal(`🔄 SEQUENCE Mode: Type 1 (${seqType1Contract}) / Type 2 (${seqType2Contract}) | Runs: ${runsPerType} each`, 'info', true);
                logToJournal(`Current: Type ${currentSequenceType} | Runs completed: ${runsCompletedInCurrentType}/${runsPerType}`, 'info', true);
                logToJournal(`Martingale: ${lastTradeWasLoss.current ? 'ACTIVE' : 'Inactive'} | Counter: ${martingaleCounterSeq.current}/${martingaleLimit === 0 ? '∞' : martingaleLimit}`, 'info', true);
                logToJournal(`Current stake: $${currentStakeValue.current.toFixed(2)} (Base: $${baseStake.current})`, 'info', true);
            } else if (mode === 'STRIKE') {
                logToJournal(`⚡ STRIKE Mode: Main: ${strikeContract} | Recovery: ${strikeRecoveryContract} | Entry: ${strikeTriggerMode === 'TRIGGER' ? `Triggers [${strikeTriggers}]` : `V-Loss ${strikeVLoss}`}`, 'info', true);
            } else if (mode === 'PARALLEL') {
                logToJournal(`🔀 PARALLEL Mode: ${parallelCount} trades | Trigger: ${parallelTriggerMethod === 'TRIGGER' ? `Digits [${parallelTriggers}]` : `V-Loss (${parallelVLossLimit})`} | Run: ${parallelRunMode === 'SINGLE' ? 'Single Run' : 'Auto-Run'} | Base Stake: $${parallelBaseStake.current}`, 'info', true);
                logToJournal(`Current Stake: $${currentParallelStake.current} | Martingale Counter: ${parallelMartingaleCounter.current}/${parallelMartingaleLimit === 0 ? '∞' : parallelMartingaleLimit}`, 'info', true);
            } else if (parseInt(vLossLimit) === 0) {
                logToJournal(`⚡ EVERY TICK MODE: Trading on EVERY tick`, 'info', true);
            }

            if (window.dbot?.events?.onStart) {
                window.dbot.events.onStart();
            }
        } else {
            logToJournal('🟡 Bot Stopped', 'info', true);
            setIsManualTradePending(false);
            parallelAutoRunActive.current = false;

            if (window.dbot?.events?.onStop) {
                window.dbot.events.onStop();
            }
        }
    }, [isBotRunning, logToJournal, mode, symbol, contractType, isRiseFall, triggers, hedgeStake, hedgeTriggers, hedgeMartingale, hedgeMartingaleEnabled, hedgeMartingaleLimit, seqType1Contract, seqType2Contract, runsPerType, currentSequenceType, runsCompletedInCurrentType, vLossLimit, runPanelStore, lastTradeWasLoss, martingaleCounterSeq, martingaleLimit, currentStakeValue, baseStake, dualBaseStake, currentDualStake, dualMartingaleCounter, dualRecoveryMode, strikeContract, strikeRecoveryContract, strikeTriggerMode, strikeTriggers, strikeVLoss, parallelCount, parallelTriggers, parallelTriggerMethod, parallelRunMode, parallelVLossLimit, parallelBaseStake, currentParallelStake, parallelMartingaleCounter, parallelMartingaleLimit]);

    // ============================================
    // 36. TOGGLE BOT - FIXED (No scroll trigger)
    // ============================================
    const toggleBot = useCallback((e) => {
        if (touchMoved.current) {
            touchMoved.current = false;
            return;
        }
        
        e?.preventDefault();
        e?.stopPropagation();
        
        if (document.activeElement && document.activeElement.blur) {
            document.activeElement.blur();
        }
        const inputs = document.querySelectorAll('input, select, textarea');
        inputs.forEach(el => el.blur());
        
        if (!is_logged_in && !isOAuthUser.current) {
            logToJournal('Please login first', 'error');
            return;
        }

        if (isStartingRef.current || isStoppingRef.current) {
            logToJournal('Bot is already starting or stopping', 'warn');
            return;
        }
        
        isStartingRef.current = true;

        const button = e?.currentTarget;
        if (button) {
            button.style.opacity = '0.8';
            button.style.transform = 'scale(0.97)';
        }

        if (mode === 'MANUAL') {
            if (!isBotRunningRef.current) {
                manualTradePlaced.current = false;
                setIsManualTradePending(false);
                handleReset();
                isBotRunningRef.current = true;
                setIsBotRunning(true);
                logToJournal('🖐️ MANUAL MODE: Placing trade...', 'info', true);
                executeManualTrade();
            } else {
                if (manualTradePlaced.current || isManualTradePending) {
                    logToJournal('Cancelling manual trade...', 'warn', true);
                    sellAllActiveContracts().then(() => {
                        isBotRunningRef.current = false;
                        setIsBotRunning(false);
                        setIsManualTradePending(false);
                        manualTradePlaced.current = false;
                        logToJournal('🖐️ MANUAL MODE: Cancelled', 'info', true);
                    });
                } else {
                    isBotRunningRef.current = false;
                    setIsBotRunning(false);
                    logToJournal('🖐️ MANUAL MODE: Stopped', 'info', true);
                }
            }
        } else {
            if (!isBotRunningRef.current) {
                handleReset();
                syncWithRunPanel(true);
            } else {
                syncWithRunPanel(false);
            }
        }
        
        setTimeout(() => {
            isStartingRef.current = false;
            if (button && !isStoppingRef.current) {
                button.style.opacity = '1';
                button.style.transform = 'scale(1)';
            }
        }, 200);
    }, [mode, is_logged_in, handleReset, logToJournal, syncWithRunPanel, executeManualTrade, sellAllActiveContracts, isManualTradePending]);

    // ============================================
    // PAUSE / RESUME HANDLERS
    // ============================================
    const handlePause = useCallback(() => {
        if (!isBotRunningRef.current || isPausedRef.current) return;
        isPausedRef.current = true;
        setIsPaused(true);
        logToJournal('⏸️ Bot PAUSED — market conditions unfavorable. Active trades will complete normally. No new trades will be triggered.', 'warn', true);
    }, [logToJournal]);

    const handleResume = useCallback(() => {
        if (!isBotRunningRef.current || !isPausedRef.current) return;
        isPausedRef.current = false;
        setIsPaused(false);
        logToJournal('▶️ Bot RESUMED — new trades will be triggered again.', 'success', true);
    }, [logToJournal]);

    // ============================================
    // 37. HANDLE STAKE CHANGE
    // ============================================
    const handleStakeChange = useCallback((newStake) => {
        setStake(newStake);
        const parsed = parseFloat(newStake);
        if (!isNaN(parsed) && parsed > 0) {
            stableBaseStake.current = parsed;
            stableCurrentStake.current = parsed;
            dualBaseStake.current = parsed;
            currentDualStake.current = parsed;
            strikeBaseStake.current = parsed;
            strikeCurrentStake.current = parsed;
            parallelBaseStake.current = parsed;
            currentParallelStake.current = parsed;
        }
    }, []);

    // ============================================
    // 38. UPDATE PARALLEL TRADE
    // ============================================
    const updateParallelTrade = useCallback((index, field, value) => {
        setParallelTrades(prev => {
            const updated = [...prev];
            updated[index] = { ...updated[index], [field]: value };
            if (field === 'contract' && !needsPrediction(value)) {
                updated[index].prediction = null;
            }
            parallelTradesRef.current = updated;
            return updated;
        });
    }, []);

    // ============================================
    // 39. FLOATING HELP TAB
    // ============================================
    const FloatingHelpTab = () => {
        const [isHovered, setIsHovered] = useState(false);
        
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
                    background: isHovered 
                        ? 'linear-gradient(145deg, #3B82F6 0%, #2563EB 100%)' 
                        : 'linear-gradient(145deg, #1F2937 0%, #111827 100%)',
                    boxShadow: isHovered 
                        ? '0 8px 25px rgba(59, 130, 246, 0.4), 0 4px 10px rgba(0, 0, 0, 0.2)' 
                        : '0 4px 15px rgba(0, 0, 0, 0.2), 0 2px 5px rgba(0, 0, 0, 0.1)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    cursor: 'pointer',
                    transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
                    zIndex: 9999,
                    border: '2px solid rgba(255, 255, 255, 0.1)',
                    backdropFilter: 'blur(5px)',
                    transform: isHovered ? 'scale(1.1) rotate(5deg)' : 'scale(1) rotate(0deg)',
                    textDecoration: 'none',
                    color: 'white',
                    fontSize: isMobile ? '28px' : '32px',
                    fontWeight: 'bold',
                    animation: 'float 3s ease-in-out infinite',
                    touchAction: 'manipulation',
                    WebkitTapHighlightColor: 'transparent',
                }}
                onMouseEnter={() => setIsHovered(true)}
                onMouseLeave={() => setIsHovered(false)}
                onTouchStart={() => setIsHovered(true)}
                onTouchEnd={() => {
                    setIsHovered(false);
                    setTimeout(() => setIsHovered(false), 200);
                }}
                title="Click to view Nyanyuki Bot Guide"
            >
                <span style={{
                    transform: isHovered ? 'scale(1.1)' : 'scale(1)',
                    transition: 'transform 0.2s ease',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    width: '100%',
                    height: '100%',
                    textShadow: '0 2px 5px rgba(0, 0, 0, 0.3)',
                }}>
                    ?
                </span>
                
                <div style={{
                    position: 'absolute',
                    width: '100%',
                    height: '100%',
                    borderRadius: '50%',
                    border: '2px solid #3B82F6',
                    opacity: isHovered ? 0.8 : 0.4,
                    animation: 'ripple 2s infinite',
                    pointerEvents: 'none',
                }} />
                
                <div style={{
                    position: 'absolute',
                    bottom: '100%',
                    left: '50%',
                    transform: 'translateX(-50%) translateY(-10px)',
                    background: '#1F2937',
                    color: 'white',
                    padding: isMobile ? '8px 12px' : '10px 15px',
                    borderRadius: '20px',
                    fontSize: isMobile ? '12px' : '14px',
                    whiteSpace: 'nowrap',
                    opacity: isHovered ? 1 : 0,
                    visibility: isHovered ? 'visible' : 'hidden',
                    transition: 'all 0.3s ease',
                    boxShadow: '0 4px 15px rgba(0, 0, 0, 0.3)',
                    border: '1px solid #374151',
                    pointerEvents: 'none',
                    zIndex: 10000,
                    fontWeight: '500',
                    letterSpacing: '0.3px',
                }}>
                    📚 Bot Guide
                    <div style={{
                        position: 'absolute',
                        top: '100%',
                        left: '50%',
                        transform: 'translateX(-50%)',
                        width: 0,
                        height: 0,
                        borderLeft: '8px solid transparent',
                        borderRight: '8px solid transparent',
                        borderTop: '8px solid #1F2937',
                    }} />
                </div>
            </a>
        );
    };

    // ============================================
    // 40. RESPONSIVE STYLES
    // ============================================
    const professionalColors = {
        primary: '#3B82F6',
        primaryDark: '#2563EB',
        success: '#10B981',
        successDark: '#059669',
        warning: '#F59E0B',
        warningDark: '#D97706',
        danger: '#EF4444',
        dangerDark: '#DC2626',
        purple: '#8B5CF6',
        purpleDark: '#7C3AED',
        gray: '#64748B',
        grayLight: '#94A3B8',
        background: '#F9FAFB',
        surface: '#FFFFFF',
        border: '#E2E8F0',
        text: '#1F2937',
        textLight: '#64748B'
    };

    const getInputStyle = (isLocked = false) => ({
        width: '100%',
        padding: isMobile ? '14px' : '10px',
        borderRadius: '10px',
        border: `1.5px solid ${isLocked ? professionalColors.grayLight : professionalColors.primary}`,
        fontSize: isMobile ? '15px' : '13px',
        outline: 'none',
        color: professionalColors.text,
        transition: 'all 0.2s ease',
        boxSizing: 'border-box',
        background: isLocked ? professionalColors.background : professionalColors.surface,
        WebkitAppearance: 'none',
        touchAction: 'manipulation',
        boxShadow: '0 2px 4px rgba(0,0,0,0.02)',
    });

    const styles = useMemo(() => ({
        masterWrapper: {
            width: '100%',
            height: isMobile ? '100vh' : '78vh',
            minHeight: isMobile ? '100vh' : '78vh',
            overflow: 'hidden',
            backgroundColor: professionalColors.background,
            border: isMobile ? 'none' : `1px solid ${professionalColors.border}`,
            borderRadius: isMobile ? '0' : '20px',
            display: 'flex',
            flexDirection: isMobile ? 'column' : 'row',
            justifyContent: 'center',
            alignItems: 'center',
            boxShadow: '0 10px 40px rgba(0, 0, 0, 0.05)',
            padding: 0,
            margin: 0,
            maxWidth: '100%',
            touchAction: 'pan-y',
        },
        digitStreamContainer: {
            width: isMobile ? '100%' : '100px',
            height: isMobile ? '90px' : '70vh',
            background: professionalColors.surface,
            borderRadius: isMobile ? '12px' : '16px',
            marginRight: isMobile ? '0' : '12px',
            marginBottom: isMobile ? '12px' : '0',
            border: `1px solid ${professionalColors.border}`,
            display: 'flex',
            flexDirection: isMobile ? 'row' : 'column',
            overflow: 'hidden',
            boxShadow: 'inset 0 2px 10px rgba(0,0,0,0.02)',
            touchAction: 'pan-y',
        },
        streamLabel: {
            fontSize: isMobile ? '12px' : '10px',
            fontWeight: '600',
            textAlign: 'center',
            padding: isMobile ? '8px 12px' : '10px 0',
            background: `linear-gradient(145deg, ${professionalColors.primary} 0%, ${professionalColors.primaryDark} 100%)`,
            color: '#FFFFFF',
            textTransform: 'uppercase',
            letterSpacing: '0.5px',
            writingMode: isMobile ? 'horizontal-tb' : 'horizontal-tb',
            transform: 'none',
            width: isMobile ? 'auto' : '100%',
            height: isMobile ? '100%' : 'auto',
            minWidth: isMobile ? '70px' : 'auto',
            minHeight: isMobile ? 'auto' : '28px',
        },
        streamBox: {
            flex: 1,
            overflowX: isMobile ? 'auto' : 'hidden',
            overflowY: isMobile ? 'hidden' : 'auto',
            display: 'flex',
            flexDirection: isMobile ? 'row' : 'column',
            padding: isMobile ? '8px' : '8px 0',
            background: professionalColors.surface,
            WebkitOverflowScrolling: 'touch',
            scrollBehavior: 'smooth',
        },
        streamDigit: {
            fontSize: isMobile ? '14px' : '13px',
            padding: isMobile ? '6px 10px' : '10px 4px',
            minWidth: isMobile ? '70px' : '100%',
            minHeight: isMobile ? '50px' : '35px',
            textAlign: 'center',
            borderRight: isMobile ? `1px solid ${professionalColors.border}` : 'none',
            borderBottom: isMobile ? 'none' : `1px solid ${professionalColors.border}`,
            fontFamily: 'monospace',
            fontWeight: '600',
            display: 'flex',
            flexDirection: isMobile ? 'row' : 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: isMobile ? '6px' : '8px',
            transition: 'all 0.2s ease',
            touchAction: 'pan-y',
            position: 'relative',
        },
        streamDigitValue: {
            fontSize: isMobile ? '18px' : '15px',
            fontWeight: '600',
        },
        streamDigitResult: {
            fontSize: isMobile ? '10px' : '9px',
            fontWeight: '600',
            padding: '3px 6px',
            borderRadius: '6px',
            whiteSpace: 'nowrap',
        },
        innerScrollTab: {
            width: '100%',
            maxWidth: isMobile ? '100%' : '550px',
            padding: isMobile ? '16px' : '20px',
            overflowY: 'auto',
            height: isMobile ? 'calc(100vh - 130px)' : '70vh',
            background: professionalColors.surface,
            boxSizing: 'border-box',
            WebkitOverflowScrolling: 'touch',
            scrollBehavior: 'smooth',
        },
        pricePanel: {
            textAlign: 'center',
            marginBottom: isMobile ? '16px' : '20px',
            padding: isMobile ? '16px' : '20px',
            background: `linear-gradient(145deg, ${professionalColors.primary} 0%, ${professionalColors.primaryDark} 100%)`,
            borderRadius: '16px',
            color: '#FFFFFF',
            boxShadow: '0 8px 30px rgba(59, 130, 246, 0.2)',
        },
        priceValue: {
            fontSize: isMobile ? '28px' : '32px',
            fontWeight: '600',
            fontFamily: 'monospace',
            marginBottom: '5px',
        },
        subText: {
            fontSize: isMobile ? '12px' : '11px',
            color: 'rgba(255,255,255,0.8)',
            marginTop: '8px',
            letterSpacing: '0.3px',
        },
        digitBoard: {
            display: 'grid',
            gridTemplateColumns: 'repeat(5, 1fr)',
            gap: isMobile ? '6px' : '8px',
            marginBottom: isMobile ? '16px' : '20px',
        },
        digitCell: {
            height: isMobile ? '55px' : '65px',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            borderRadius: '12px',
            background: professionalColors.background,
            border: `1px solid ${professionalColors.border}`,
            boxShadow: '0 2px 8px rgba(0, 0, 0, 0.02)',
            transition: 'all 0.2s ease',
            touchAction: 'manipulation',
        },
        inputArea: {
            background: professionalColors.surface,
            padding: isMobile ? '12px' : '16px',
            borderRadius: '16px',
            border: `1px solid ${professionalColors.border}`,
        },
        row: {
            display: 'flex',
            flexDirection: isMobile ? 'column' : 'row',
            gap: isMobile ? '10px' : '12px',
            marginBottom: isMobile ? '10px' : '12px',
        },
        label: {
            display: 'block',
            fontSize: isMobile ? '11px' : '10px',
            fontWeight: '600',
            color: professionalColors.textLight,
            marginBottom: '5px',
            textTransform: 'uppercase',
            letterSpacing: '0.5px',
        },
        input: {
            width: '100%',
            padding: isMobile ? '12px' : '12px',
            borderRadius: '10px',
            border: `1.5px solid ${professionalColors.border}`,
            fontSize: isMobile ? '14px' : '13px',
            outline: 'none',
            color: professionalColors.text,
            transition: 'all 0.2s ease',
            boxSizing: 'border-box',
            touchAction: 'manipulation',
            WebkitAppearance: 'none',
        },
        select: {
            width: '100%',
            padding: isMobile ? '12px' : '12px',
            borderRadius: '10px',
            border: `1.5px solid ${professionalColors.border}`,
            fontSize: isMobile ? '14px' : '13px',
            outline: 'none',
            background: professionalColors.surface,
            color: professionalColors.text,
            transition: 'all 0.2s ease',
            boxSizing: 'border-box',
            touchAction: 'manipulation',
            WebkitAppearance: 'none',
        },
        startBtn: {
            flex: 2,
            padding: isMobile ? '16px' : '16px',
            background: `linear-gradient(145deg, ${professionalColors.success} 0%, ${professionalColors.successDark} 100%)`,
            color: '#FFFFFF',
            border: 'none',
            borderRadius: '14px',
            fontWeight: '600',
            cursor: 'pointer',
            fontSize: isMobile ? '16px' : '14px',
            transition: 'all 0.2s ease',
            boxShadow: `0 4px 15px ${professionalColors.success}40`,
            touchAction: 'manipulation',
            WebkitTapHighlightColor: 'transparent',
            minHeight: isMobile ? '56px' : 'auto',
        },
        stopBtn: {
            flex: 2,
            padding: isMobile ? '16px' : '16px',
            background: `linear-gradient(145deg, ${professionalColors.danger} 0%, ${professionalColors.dangerDark} 100%)`,
            color: '#FFFFFF',
            border: 'none',
            borderRadius: '14px',
            fontWeight: '600',
            cursor: 'pointer',
            fontSize: isMobile ? '16px' : '14px',
            transition: 'all 0.2s ease',
            boxShadow: `0 4px 15px ${professionalColors.danger}40`,
            touchAction: 'manipulation',
            WebkitTapHighlightColor: 'transparent',
            minHeight: isMobile ? '56px' : 'auto',
        },
        resetBtn: {
            flex: 1,
            padding: isMobile ? '16px' : '16px',
            background: `linear-gradient(145deg, ${professionalColors.gray} 0%, ${professionalColors.textLight} 100%)`,
            color: '#FFFFFF',
            border: 'none',
            borderRadius: '14px',
            fontWeight: '600',
            cursor: 'pointer',
            fontSize: isMobile ? '16px' : '14px',
            transition: 'all 0.2s ease',
            touchAction: 'manipulation',
            WebkitTapHighlightColor: 'transparent',
            minHeight: isMobile ? '56px' : 'auto',
        }
    }), [isMobile]);

    // ============================================
    // 41. MARKET OPTIONS
    // ============================================
    const marketOptions = [
        { text: 'Volatility 10 Index', value: 'R_10' },
        { text: 'Volatility 25 Index', value: 'R_25' },
        { text: 'Volatility 50 Index', value: 'R_50' },
        { text: 'Volatility 75 Index', value: 'R_75' },
        { text: 'Volatility 100 Index', value: 'R_100' },
        { text: 'Volatility 10 (1s) Index', value: '1HZ10V' },
        { text: 'Volatility 25 (1s) Index', value: '1HZ25V' },
        { text: 'Volatility 50 (1s) Index', value: '1HZ50V' },
        { text: 'Volatility 75 (1s) Index', value: '1HZ75V' },
        { text: 'Volatility 100 (1s) Index', value: '1HZ100V' },
        { text: 'Volatility 15 (1s) Index', value: '1HZ15V' },
        { text: 'Volatility 30 (1s) Index', value: '1HZ30V' },
        { text: 'Volatility 90 (1s) Index', value: '1HZ90V' }
    ];

    // ============================================
    // 42. RENDER UI - DIGIT STREAM WITH STRICT COLORS AND NO RESULT DISPLAY
    // ============================================
    return (
        <div 
            style={styles.masterWrapper}
            onTouchStart={handleTouchStart}
            onTouchMove={handleTouchMove}
            ref={scrollContainerRef}
        >
            {/* LEFT - DIGIT STREAM */}
            <div style={styles.digitStreamContainer}>
                <div style={styles.streamLabel}>
                    {isMobile ? 'TICKS' : 'TICK STREAM'}
                </div>
                <div 
                    ref={digitStreamRef}
                    style={styles.streamBox}
                    className="always-show-scrollbar"
                >
                    {digitHistory.slice(0, isMobile ? 15 : 30).map((d, index) => {
                        const triggerList = hedgeTriggers.split(',').map(t => parseInt(t.trim())).filter(t => !isNaN(t));
                        const isEvenDigit = d % 2 === 0;
                        const digitColor = isEvenDigit ? '#10B981' : '#EF4444';
                        const bgColor = isEvenDigit ? 'rgba(16,185,129,0.18)' : 'rgba(239,68,68,0.18)';
                        const borderColor = isEvenDigit ? 'rgba(16,185,129,0.55)' : 'rgba(239,68,68,0.55)';
                        
                        return (
                            <div key={index} style={{
                                ...styles.streamDigit,
                                flexDirection: 'row',
                                alignItems: 'stretch',
                                padding: '0',
                                overflow: 'hidden',
                                border: index === 0 ? `2px solid ${digitColor}` : `1px solid ${borderColor}`,
                                borderRadius: '8px',
                                margin: '2px 0',
                                gap: '0',
                                position: 'relative',
                                minHeight: isMobile ? '44px' : '34px',
                            }}>
                                <div style={{
                                    flex: 1,
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    background: bgColor,
                                    color: digitColor,
                                    fontWeight: index === 0 ? '800' : '700',
                                    fontSize: isMobile ? '18px' : '15px',
                                    fontFamily: 'monospace',
                                    borderRight: `1px solid ${borderColor}`,
                                }}>
                                    {d}
                                </div>
                                <div style={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    background: digitColor,
                                    color: '#FFFFFF',
                                    fontWeight: '800',
                                    fontSize: isMobile ? '13px' : '11px',
                                    minWidth: isMobile ? '28px' : '24px',
                                    letterSpacing: '0.5px',
                                }}>
                                    {isEvenDigit ? 'E' : 'O'}
                                </div>
                                {triggerList.includes(d) && mode === 'OVER_UNDER_HEDGE' && (
                                    <div style={{
                                        position: 'absolute',
                                        top: '2px',
                                        right: '2px',
                                        width: '8px',
                                        height: '8px',
                                        background: '#8B5CF6',
                                        borderRadius: '50%',
                                    }} />
                                )}
                            </div>
                        );
                    })}
                </div>
            </div>

            {/* RIGHT - MAIN CONTROL PANEL */}
            <div style={styles.innerScrollTab}>
                {/* MODE SELECTION DROPDOWN */}
                <div style={{ marginBottom: isMobile ? '16px' : '16px' }}>
                    <label style={{
                        display: 'block',
                        fontSize: isMobile ? '12px' : '10px',
                        fontWeight: '600',
                        color: professionalColors.textLight,
                        marginBottom: '6px',
                        textTransform: 'uppercase',
                        letterSpacing: '0.5px'
                    }}>
                        SELECT BOT MODE
                    </label>
                    <select
                        value={mode}
                        onChange={e => setMode(e.target.value)}
                        disabled={isBotRunning}
                        style={{
                            width: '100%',
                            padding: isMobile ? '16px' : '12px',
                            borderRadius: '12px',
                            border: `2px solid ${
                                mode === 'STABLE' ? professionalColors.primary :
                                mode === 'AGGRESSIVE' ? professionalColors.danger :
                                mode === 'SEQUENCE' ? professionalColors.warning :
                                mode === 'DUAL' ? professionalColors.success :
                                mode === 'OVER_UNDER_HEDGE' ? professionalColors.purple :
                                mode === 'STRIKE' ? professionalColors.dangerDark :
                                mode === 'PARALLEL' ? professionalColors.purple :
                                mode === 'SCANNER' ? '#06B6D4' :
                                professionalColors.warningDark
                            }`,
                            fontSize: isMobile ? '15px' : '13px',
                            fontWeight: '600',
                            outline: 'none',
                            background: professionalColors.surface,
                            color: professionalColors.text,
                            cursor: isBotRunning ? 'not-allowed' : 'pointer',
                            opacity: isBotRunning ? 0.7 : 1,
                            WebkitAppearance: 'none',
                            backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 12 12'%3E%3Cpath fill='%2364748B' d='M6 8L1 3h10z'/%3E%3C/svg%3E")`,
                            backgroundRepeat: 'no-repeat',
                            backgroundPosition: 'right 12px center',
                            paddingRight: '36px',
                        }}
                    >
                        <option value="STABLE">📊 STABLE — V-Loss or Trigger based trading</option>
                        <option value="AGGRESSIVE">🔥 AGGRESSIVE — Burst fire mode</option>
                        <option value="SEQUENCE">🔄 SEQUENCE — Type 1 ↔ Type 2 rotation</option>
                        <option value="DUAL">🎯 DUAL — Trade + Recovery mode</option>
                        <option value="OVER_UNDER_HEDGE">🛡️ HEDGE — Over 5 + Under 4 simultaneously</option>
                        <option value="STRIKE">⚡ STRIKE — Sniper entry → Auto run</option>
                        <option value="PARALLEL">🔀 PARALLEL — Multiple trades one trigger</option>
                        <option value="SCANNER">📡 SCANNER — Auto-scan all markets Even/Odd</option>
                        <option value="MANUAL">🖐️ MANUAL — One click one trade</option>
                    </select>
                </div>

                {/* PRICE PANEL */}
                <div style={styles.pricePanel}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '10px', flexWrap: 'wrap' }}>
                        <div style={styles.priceValue}>
                            {fullPrice.slice(0, -1)}
                            <span style={{ color: '#FFFFFF', opacity: 0.9 }}>{lastDigit !== null ? lastDigit : '0'}</span>
                        </div>

                        {isRiseFall(contractType) && (
                            <div style={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: '5px',
                                padding: '5px 10px',
                                borderRadius: '20px',
                                background: priceDirection === 'up' ? 'rgba(16, 185, 129, 0.2)' :
                                    priceDirection === 'down' ? 'rgba(239, 68, 68, 0.2)' :
                                        'rgba(255, 255, 255, 0.2)',
                                border: `1px solid ${priceDirection === 'up' ? professionalColors.success :
                                    priceDirection === 'down' ? professionalColors.danger :
                                        '#FFFFFF'}`
                            }}>
                                {priceDirection === 'up' && '▲'}
                                {priceDirection === 'down' && '▼'}
                                {priceDirection === 'neutral' && '◆'}
                                <span style={{
                                    color: '#FFFFFF',
                                    fontWeight: '600'
                                }}>
                                    {priceChange > 0 ? '+' : ''}{priceChange.toFixed(4)}
                                </span>
                            </div>
                        )}
                    </div>

                    {isRiseFall(contractType) && (
                        <div style={{
                            display: 'flex',
                            justifyContent: 'center',
                            gap: '15px',
                            marginTop: '10px'
                        }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
                                <span style={{ color: professionalColors.success, fontSize: '16px' }}>▲</span>
                                <span style={{ color: 'rgba(255,255,255,0.7)', fontSize: '12px' }}>UP:</span>
                                <span style={{ color: '#FFFFFF', fontWeight: '600' }}>{consecutiveUp}</span>
                            </div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
                                <span style={{ color: professionalColors.danger, fontSize: '16px' }}>▼</span>
                                <span style={{ color: 'rgba(255,255,255,0.7)', fontSize: '12px' }}>DOWN:</span>
                                <span style={{ color: '#FFFFFF', fontWeight: '600' }}>{consecutiveDown}</span>
                            </div>
                        </div>
                    )}

                    {/* PAUSED BANNER */}
                    {isPaused && (
                        <div style={{
                            marginTop: '10px',
                            padding: '10px 16px',
                            background: 'rgba(245, 158, 11, 0.25)',
                            border: '2px solid #F59E0B',
                            borderRadius: '10px',
                            textAlign: 'center',
                            fontWeight: '700',
                            fontSize: isMobile ? '14px' : '13px',
                            color: '#FCD34D',
                            letterSpacing: '0.5px',
                            animation: 'pulse 2s ease-in-out infinite',
                        }}>
                            ⏸️ BOT PAUSED — NO NEW TRADES BEING TRIGGERED
                        </div>
                    )}

                    <div style={styles.subText}>
                        {mode === 'MANUAL' ? (
                            <span style={{ color: '#FFFFFF', fontWeight: '600' }}>
                                {isManualTradePending ? '🔴 TRADE IN PROGRESS...' : '🖐️ MANUAL MODE - Click START to place ONE trade'}
                            </span>
                        ) : mode === 'SEQUENCE' ? (
                            <span style={{ color: '#FFFFFF', fontWeight: '600' }}>
                                🔄 SEQUENCE: Type {currentSequenceType} | Runs: {runsCompletedInCurrentType}/{runsPerType}
                                {lastTradeWasLoss.current && martingaleEnabled ? ` | 📈 Martingale: ${martingaleCounterSeq.current}/${martingaleLimit === 0 ? '∞' : martingaleLimit}` : ''}
                                {seqTradeTriggered.current && ' ⏳'}
                            </span>
                        ) : mode === 'OVER_UNDER_HEDGE' ? (
                            <span style={{ color: '#FFFFFF', fontWeight: '600' }}>
                                🛡️ HEDGE: Triggers [{hedgeTriggers}] → OVER 5 + UNDER 4 | Stake: ${currentHedgeStake.current.toFixed(2)} each
                                {hedgeMartingaleEnabled && ` | M:${hedgeMartingale}x`}
                                {hedgeTradePending.current && ' ⏳'}
                            </span>
                        ) : mode === 'DUAL' ? (
                            <span style={{ color: '#FFFFFF', fontWeight: '600' }}>
                                🎯 DUAL: {dualRecoveryMode ? 'Type 2 (Recovery)' : `Type 1 (${dualTriggerMode === 'TRIGGER' ? 'Triggers' : 'V-Loss'}: ${dualTriggerMode === 'TRIGGER' ? '['+triggers+']' : vLossLimit})`}
                                {dualTradeLocked.current && ' ⏳'} | Stake: ${currentDualStake.current.toFixed(2)}
                                {dualMartingaleCounter.current > 0 && ` (M:${dualMartingaleCounter.current}/${martingaleLimit === 0 ? '∞' : martingaleLimit})`}
                                {dualRecoveryMode && ' 🔄'}
                            </span>
                        ) : mode === 'STRIKE' ? (
                            <span style={{ color: '#FFFFFF', fontWeight: '600' }}>
                                ⚡ STRIKE: {strikeInRecovery.current ? '🔄 Recovery' : strikePhase.current === 'RUN' ? '🚀 Auto-Running' : '🎯 Hunting Entry...'}
                                {strikeTradeLocked.current && ' ⏳'} | Stake: ${strikeCurrentStake.current.toFixed(2)}
                                {strikeMartingaleCounter.current > 0 && ` | M:${strikeMartingaleCounter.current}`}
                            </span>
                        ) : mode === 'PARALLEL' ? (
                            <span style={{ color: '#FFFFFF', fontWeight: '600' }}>
                                🔀 PARALLEL: {parallelCount} trades | Trigger: {parallelTriggerMethod === 'TRIGGER' ? `Digits [${parallelTriggers}]` : `V-Loss (${parallelVLossCounter.current}/${parallelVLossLimit})`} | Run: {parallelRunMode === 'SINGLE' ? 'Single' : 'Auto-Run'}
                                {parallelPending.current && ' ⏳'} | Stake: ${currentParallelStake.current.toFixed(2)}
                                {parallelMartingaleCounter.current > 0 && ` | M:${parallelMartingaleCounter.current}/${parallelMartingaleLimit === 0 ? '∞' : parallelMartingaleLimit}`}
                            </span>
                        ) : mode === 'SCANNER' ? (
                            <span style={{ color: '#FFFFFF', fontWeight: '600' }}>
                                📡 SCANNER: {scannerStatus} {scannerActiveSymbol ? `| Market: ${scannerActiveSymbol}` : '| Watching all markets'}
                                {scannerContractType ? ` | ${scannerContractType}` : ''}
                                {` | Stake: $${scannerCurrentStake.current.toFixed(2)}`}
                                {scannerMartingaleCounter.current > 0 && ` | M:${scannerMartingaleCounter.current}/${parseInt(scannerMartingaleLimit) === 0 ? '∞' : scannerMartingaleLimit}`}
                                {` | W:${scannerStats.wins} L:${scannerStats.losses}`}
                            </span>
                        ) : triggerMode === 'TRIGGER' && mode !== 'DUAL' ? (
                            <span>🎯 TRIGGER MODE: [{triggers}] | Active: {isTradeTriggered.current ? '⏳' : '✅'}</span>
                        ) : parseInt(vLossLimit) === 0 ? (
                            `⚡ EVERY TICK MODE`
                        ) : (
                            `📊 V-STREAK: ${vCounterDisplay}/${vLossLimit}`
                        )}

                        {mode === 'AGGRESSIVE' && (
                            <span> | ⏱️ BURST: {parseInt(tickLimit) === 0 ? '∞' : (parseInt(tickLimit) - ticksProcessed)} LEFT</span>
                        )}

                        {mode !== 'DUAL' && mode !== 'OVER_UNDER_HEDGE' && mode !== 'MANUAL' && mode !== 'SEQUENCE' && mode !== 'STRIKE' && mode !== 'PARALLEL' && mode !== 'SCANNER' && !isRiseFall(contractType) && (
                            <span> | 🎯 ACTIVE PRED: {getCurrentPred()}</span>
                        )}

                        {isRiseFall(contractType) && mode !== 'MANUAL' && mode !== 'OVER_UNDER_HEDGE' && mode !== 'SEQUENCE' && mode !== 'STRIKE' && mode !== 'PARALLEL' && mode !== 'SCANNER' && (
                            <span> | {contractType === 'CALL' ? '📈 RISE' : '📉 FALL'}</span>
                        )}

                        <span> | 🟢 ACTIVE: {activeTradesCount.current}</span>

                        {parseInt(vLossLimit) === 1 && triggerMode === 'VLOSS' && (
                            <span style={{ color: '#FFFFFF', fontWeight: '600' }}> | ⚡ NEXT TICK EXIT</span>
                        )}

                        {isTradeTriggered.current && parseInt(vLossLimit) > 0 && mode !== 'SEQUENCE' && mode !== 'DUAL' && mode !== 'OVER_UNDER_HEDGE' && mode !== 'STRIKE' && mode !== 'PARALLEL' && mode !== 'SCANNER' && (
                            <span style={{ color: '#FFFFFF', fontWeight: '600' }}> | ⏳ WAITING FOR TRADE</span>
                        )}

                        {mode === 'OVER_UNDER_HEDGE' && hedgeLastDigit.current && (
                            <span style={{ color: '#FFFFFF' }}> | Last: {hedgeLastDigit.current}</span>
                        )}
                    </div>
                </div>

                {/* DIGIT BOARD WITH STRICT COLORS */}
                <div style={styles.digitBoard}>
                    {[0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map(d => {
                        const triggerList = hedgeTriggers.split(',').map(t => parseInt(t.trim())).filter(t => !isNaN(t));
                        const isEvenDigit = d % 2 === 0;
                        const digitColor = isEvenDigit ? '#10B981' : '#EF4444';
                        
                        return (
                            <div key={d} style={{
                                ...styles.digitCell,
                                border: getDigitCellBorder(d),
                                background: triggerList.includes(d) && mode === 'OVER_UNDER_HEDGE' ?
                                    `${professionalColors.purple}20` : professionalColors.background,
                                borderColor: triggerList.includes(d) && mode === 'OVER_UNDER_HEDGE' ?
                                    professionalColors.purple : professionalColors.border,
                                position: 'relative'
                            }}>
                                <span style={{
                                    fontSize: isMobile ? '20px' : '18px',
                                    fontWeight: '700',
                                    color: digitColor,
                                    textShadow: `0 0 5px ${digitColor}40`,
                                }}>
                                    {d}
                                </span>
                                <span style={{
                                    fontSize: isMobile ? '11px' : '11px',
                                    fontWeight: '600',
                                    color: getPercentColor(digitStats[d])
                                }}>
                                    {digitStats[d]}%
                                </span>
                                <div style={{
                                    position: 'absolute',
                                    bottom: '3px',
                                    right: '5px',
                                    fontSize: '9px',
                                    color: digitColor,
                                    opacity: 0.6,
                                    fontWeight: '600',
                                }}>
                                    {isEvenDigit ? 'E' : 'O'}
                                </div>
                            </div>
                        );
                    })}
                </div>

                {/* STATS GRID */}
                <div style={{
                    display: 'grid',
                    gridTemplateColumns: isMobile ? 'repeat(3, 1fr)' : 'repeat(3, 1fr)',
                    gap: isMobile ? '10px' : '12px',
                    marginBottom: isMobile ? '16px' : '20px'
                }}>
                    <div style={{ 
                        padding: isMobile ? '12px' : '16px', 
                        borderRadius: '12px', 
                        background: `${professionalColors.success}10`, 
                        textAlign: 'center',
                        border: `1px solid ${professionalColors.success}30`
                    }}>
                        <span style={{ fontSize: isMobile ? '11px' : '11px', fontWeight: '600', color: professionalColors.success, display: 'block', marginBottom: '5px' }}>TOTAL P/L</span>
                        <span style={{ fontSize: isMobile ? '20px' : '20px', fontWeight: '600', color: parseFloat(totalPL) >= 0 ? professionalColors.success : professionalColors.danger }}>
                            ${totalPL}
                        </span>
                    </div>
                    <div style={{ 
                        padding: isMobile ? '12px' : '16px', 
                        borderRadius: '12px', 
                        background: `${professionalColors.primary}10`, 
                        textAlign: 'center',
                        border: `1px solid ${professionalColors.primary}30`
                    }}>
                        <span style={{ fontSize: isMobile ? '11px' : '11px', fontWeight: '600', color: professionalColors.primary, display: 'block', marginBottom: '5px' }}>WINS</span>
                        <span style={{ fontSize: isMobile ? '20px' : '20px', fontWeight: '600', color: professionalColors.primary }}>{wins}</span>
                    </div>
                    <div style={{ 
                        padding: isMobile ? '12px' : '16px', 
                        borderRadius: '12px', 
                        background: `${professionalColors.danger}10`, 
                        textAlign: 'center',
                        border: `1px solid ${professionalColors.danger}30`
                    }}>
                        <span style={{ fontSize: isMobile ? '11px' : '11px', fontWeight: '600', color: professionalColors.danger, display: 'block', marginBottom: '5px' }}>LOSSES</span>
                        <span style={{ fontSize: isMobile ? '20px' : '20px', fontWeight: '600', color: professionalColors.danger }}>{losses}</span>
                    </div>
                </div>

                {/* RISE/FALL STATS */}
                {(riseTrades > 0 || fallTrades > 0) && (
                    <div style={{
                        display: 'grid',
                        gridTemplateColumns: 'repeat(2, 1fr)',
                        gap: '12px',
                        marginBottom: '15px'
                    }}>
                        <div style={{
                            background: `${professionalColors.success}10`,
                            padding: '12px',
                            borderRadius: '12px',
                            border: `1px solid ${professionalColors.success}30`
                        }}>
                            <div style={{ fontSize: '12px', color: professionalColors.success, marginBottom: '8px', display: 'flex', alignItems: 'center', gap: '5px' }}>
                                📈 RISE (CALL)
                            </div>
                            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '5px' }}>
                                <span style={{ fontSize: '11px', color: professionalColors.gray }}>Trades:</span>
                                <span style={{ fontSize: '13px', fontWeight: '600', color: professionalColors.success }}>{riseTrades}</span>
                            </div>
                            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '5px' }}>
                                <span style={{ fontSize: '11px', color: professionalColors.gray }}>Wins:</span>
                                <span style={{ fontSize: '13px', fontWeight: '600', color: professionalColors.success }}>{riseWins}</span>
                            </div>
                            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                                <span style={{ fontSize: '11px', color: professionalColors.gray }}>Win Rate:</span>
                                <span style={{ fontSize: '13px', fontWeight: '600', color: professionalColors.success }}>
                                    {riseTrades > 0 ? ((riseWins / riseTrades) * 100).toFixed(0) : 0}%
                                </span>
                            </div>
                        </div>

                        <div style={{
                            background: `${professionalColors.danger}10`,
                            padding: '12px',
                            borderRadius: '12px',
                            border: `1px solid ${professionalColors.danger}30`
                        }}>
                            <div style={{ fontSize: '12px', color: professionalColors.danger, marginBottom: '8px', display: 'flex', alignItems: 'center', gap: '5px' }}>
                                📉 FALL (PUT)
                            </div>
                            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '5px' }}>
                                <span style={{ fontSize: '11px', color: professionalColors.gray }}>Trades:</span>
                                <span style={{ fontSize: '13px', fontWeight: '600', color: professionalColors.danger }}>{fallTrades}</span>
                            </div>
                            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '5px' }}>
                                <span style={{ fontSize: '11px', color: professionalColors.gray }}>Wins:</span>
                                <span style={{ fontSize: '13px', fontWeight: '600', color: professionalColors.danger }}>{fallWins}</span>
                            </div>
                            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                                <span style={{ fontSize: '11px', color: professionalColors.gray }}>Win Rate:</span>
                                <span style={{ fontSize: '13px', fontWeight: '600', color: professionalColors.danger }}>
                                    {fallTrades > 0 ? ((fallWins / fallTrades) * 100).toFixed(0) : 0}%
                                </span>
                            </div>
                        </div>
                    </div>
                )}

                {/* ACTIVE TRADES LIST */}
                <div style={{
                    background: professionalColors.surface,
                    borderRadius: '12px',
                    border: `1px solid ${professionalColors.border}`,
                    marginBottom: '15px',
                    overflow: 'hidden'
                }}>
                    <div style={{
                        padding: '12px 15px',
                        background: professionalColors.background,
                        borderBottom: `1px solid ${professionalColors.border}`,
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center'
                    }}>
                        <span style={{ fontSize: '13px', fontWeight: '600', color: professionalColors.text }}>
                            🟢 ACTIVE TRADES ({activeTradesList.length})
                        </span>
                        {mode === 'SEQUENCE' && (
                            <span style={{ fontSize: '12px', color: professionalColors.warning }}>
                                Type {currentSequenceType} | Run {runsCompletedInCurrentType + 1}/{runsPerType}
                                {lastTradeWasLoss.current && martingaleEnabled ? ` (M:${martingaleCounterSeq.current}/${martingaleLimit === 0 ? '∞' : martingaleLimit})` : ''}
                                {seqTradeTriggered.current && ' ⏳'}
                            </span>
                        )}
                        {mode === 'DUAL' && (
                            <span style={{ fontSize: '12px', color: dualRecoveryMode ? professionalColors.warning : professionalColors.success }}>
                                {dualRecoveryMode ? 'Type 2 Active' : 'Type 1 Active'} | ${currentDualStake.current.toFixed(2)}
                                {dualMartingaleCounter.current > 0 && ` (M:${dualMartingaleCounter.current}/${martingaleLimit === 0 ? '∞' : martingaleLimit})`}
                                {dualTradeLocked.current && ' ⏳'}
                                {dualRecoveryMode && ' 🔄'}
                            </span>
                        )}
                        {mode === 'OVER_UNDER_HEDGE' && (
                            <span style={{ fontSize: '12px', color: professionalColors.purple }}>
                                Hedge Pairs: {Math.ceil(activeTradesList.filter(t => t.hedge_position).length / 2)}
                                {hedgeTradePending.current && ' ⏳'}
                            </span>
                        )}
                        {mode === 'STRIKE' && (
                            <span style={{ fontSize: '12px', color: professionalColors.danger }}>
                                {strikeInRecovery.current ? '🔄 Recovery' : strikePhase.current === 'RUN' ? '🚀 Running' : '🎯 Hunting'}
                                {strikeTradeLocked.current && ' ⏳'}
                            </span>
                        )}
                        {mode === 'PARALLEL' && (
                            <span style={{ fontSize: '12px', color: professionalColors.purple }}>
                                Batch: {parallelPending.current ? 'Active' : 'Idle'}
                                {parallelRemainingCount.current > 0 && ` (${parallelRemainingCount.current} left)`}
                                {parallelBatchId.current && ` #${parallelBatchId.current?.toString().slice(-4)}`}
                                {parallelAutoRunActive.current && ' 🔁 Auto-Run'}
                            </span>
                        )}
                    </div>
                    <div style={{ padding: '12px' }}>
                        {activeTradesList.length === 0 ? (
                            <div style={{ textAlign: 'center', padding: '15px', color: professionalColors.gray, fontSize: '13px' }}>
                                No active trades
                            </div>
                        ) : (
                            activeTradesList.slice(0, 5).map(trade => (
                                <div key={trade.id} style={{
                                    display: 'flex',
                                    justifyContent: 'space-between',
                                    alignItems: 'center',
                                    padding: '10px',
                                    background: trade.isScanner ? 'rgba(6,182,212,0.10)' :
                                        trade.type === 'CALL' ? `${professionalColors.success}10` :
                                        trade.type === 'PUT' ? `${professionalColors.danger}10` :
                                            trade.isSequence ? `${professionalColors.warning}10` :
                                            trade.isDual ? (trade.dualSlot === 1 ? `${professionalColors.success}10` : `${professionalColors.warning}10`) :
                                                trade.hedge_position ? `${professionalColors.purple}10` :
                                                trade.isStrike ? `${professionalColors.danger}10` :
                                                trade.isParallel ? `${professionalColors.purple}10` :
                                                    professionalColors.background,
                                    borderRadius: '8px',
                                    marginBottom: '5px',
                                    border: `1px solid ${professionalColors.border}`
                                }}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                                        <span style={{
                                            fontSize: '18px',
                                            color: trade.type === 'CALL' ? professionalColors.success :
                                                trade.type === 'PUT' ? professionalColors.danger :
                                                    trade.isSequence ? professionalColors.warning :
                                                    trade.isDual ? (trade.dualSlot === 1 ? professionalColors.success : professionalColors.warning) :
                                                        trade.hedge_position ? professionalColors.purple :
                                                        trade.isStrike ? professionalColors.danger :
                                                        trade.isParallel ? professionalColors.purple :
                                                            professionalColors.gray
                                        }}>
                                            {trade.isScanner ? '📡' :
                                             trade.type === 'CALL' ? '📈' :
                                                trade.type === 'PUT' ? '📉' :
                                                    trade.isSequence ? '🔄' :
                                                    trade.isDual ? (trade.dualSlot === 1 ? '1️⃣' : '2️⃣') :
                                                        trade.hedge_position ? (trade.hedge_position === 'OVER' ? '⬆️' : '⬇️') :
                                                        trade.isStrike ? '⚡' :
                                                        trade.isParallel ? '🔀' :
                                                            getContractEmoji(trade.type)}
                                        </span>
                                        <div>
                                            <div style={{ fontSize: '13px', fontWeight: '600', color: professionalColors.text }}>
                                                {trade.isScanner ? `SCANNER: ${trade.type}` :
                                                 trade.isSequence ? `Seq Type ${trade.sequenceType}` :
                                                 trade.isStrike ? `STRIKE ${trade.strikeIsRecovery ? '(Recovery)' : ''}` :
                                                 trade.isParallel ? `Parallel Slot ${trade.parallelSlot+1}` :
                                                 trade.type === 'CALL' ? 'RISE' :
                                                 trade.type === 'PUT' ? 'FALL' :
                                                 trade.type}
                                                {trade.barrier !== undefined && ` ${trade.barrier}`}
                                                {trade.isManual && ' 🖐️'}
                                                {trade.isDual && ` (Type ${trade.dualSlot})`}
                                                {trade.hedge_position && ` (${trade.hedge_position})`}
                                                {!trade.isParallel ? '' : ` Batch:${trade.parallelBatchId?.toString().slice(-4)}`}
                                            </div>
                                            <div style={{ fontSize: '11px', color: professionalColors.gray }}>
                                                {trade.time}
                                            </div>
                                        </div>
                                    </div>
                                    <div style={{
                                        fontSize: '14px',
                                        fontWeight: '600',
                                        color: professionalColors.text
                                    }}>
                                        ${typeof trade.stake === 'number' ? trade.stake.toFixed(2) : trade.stake}
                                    </div>
                                </div>
                            ))
                        )}
                        {activeTradesList.length > 5 && (
                            <div style={{ textAlign: 'center', marginTop: '8px', fontSize: '12px', color: professionalColors.gray }}>
                                +{activeTradesList.length - 5} more...
                            </div>
                        )}
                    </div>
                </div>

                {/* INPUT AREA */}
                <div style={styles.inputArea}>
                    {/* MARKET SELECTION */}
                    {mode !== 'SCANNER' && (
                    <div style={styles.row}>
                        <div style={{ flex: 1 }}>
                            <label style={styles.label}>MARKET</label>
                            <select value={symbol} onChange={e => setSymbol(e.target.value)} style={styles.select}>
                                {marketOptions.map(v => (
                                    <option key={v.value} value={v.value}>{v.text}</option>
                                ))}
                            </select>
                        </div>

                        {mode !== 'DUAL' && mode !== 'OVER_UNDER_HEDGE' && mode !== 'SEQUENCE' && mode !== 'STRIKE' && mode !== 'PARALLEL' && mode !== 'SCANNER' && (
                            <div style={{ flex: 1 }}>
                                <label style={styles.label}>TYPE</label>
                                <select value={contractType} onChange={e => setContractType(e.target.value)} style={styles.select}>
                                    <option value="CALL">📈 RISE</option>
                                    <option value="PUT">📉 FALL</option>
                                    <option value="DIGITOVER">⬆️ OVER</option>
                                    <option value="DIGITUNDER">⬇️ UNDER</option>
                                    <option value="DIGITEVEN">🟰 EVEN</option>
                                    <option value="DIGITODD">🎲 ODD</option>
                                    <option value="DIGITMATCH">✓ MATCH</option>
                                    <option value="DIGITDIFF">≠ DIFF</option>
                                </select>
                            </div>
                        )}
                    </div>
                    )}

                    {/* SEQUENCE MODE UI */}
                    {mode === 'SEQUENCE' && (
                        <div style={{
                            background: `${professionalColors.warning}10`,
                            padding: '16px',
                            borderRadius: '12px',
                            border: `2px solid ${professionalColors.warning}`,
                            marginBottom: '16px'
                        }}>
                            <div style={{
                                fontSize: '16px',
                                fontWeight: '600',
                                color: professionalColors.warningDark,
                                marginBottom: '16px',
                                textAlign: 'center',
                                textTransform: 'uppercase'
                            }}>
                                🔄 SEQUENCE BOT - TYPE 1 ⟷ TYPE 2 ROTATION
                            </div>

                            <div style={styles.row}>
                                <div style={{ flex: 1 }}>
                                    <label style={{ fontSize: '12px', fontWeight: '600', color: professionalColors.warningDark }}>STAKE (BOTH TYPES)</label>
                                    <input
                                        type="text"
                                        inputMode="decimal"
                                        value={stake}
                                        onChange={(e) => {
                                            const val = e.target.value;
                                            if (val === '' || val === '-') {
                                                setStake('');
                                                return;
                                            }
                                            if (val === '.') {
                                                setStake('0.');
                                                return;
                                            }
                                            const newStake = parseFloat(val);
                                            if (!isNaN(newStake) && newStake > 0) {
                                                setStake(newStake);
                                                baseStake.current = newStake;
                                                currentStakeValue.current = newStake;
                                            }
                                        }}
                                        onBlur={() => {
                                            if (stake === '' || stake === undefined || stake === null || stake <= 0) {
                                                setStake(1);
                                                baseStake.current = 1;
                                                currentStakeValue.current = 1;
                                            } else {
                                                const num = parseFloat(stake);
                                                if (!isNaN(num) && num > 0) {
                                                    setStake(num);
                                                    baseStake.current = num;
                                                    currentStakeValue.current = num;
                                                }
                                            }
                                        }}
                                        style={{ ...styles.input, borderColor: professionalColors.warning }}
                                        placeholder="0.00"
                                    />
                                </div>
                                <div style={{ flex: 1 }}>
                                    <label style={{ fontSize: '12px', fontWeight: '600', color: professionalColors.warningDark }}>TICKS</label>
                                    <input
                                        type="text"
                                        inputMode="numeric"
                                        value={ticks}
                                        onChange={e => handleNumberInput(setTicks, e.target.value, 1, undefined, true, 1)}
                                        onBlur={() => {
                                            if (ticks === '' || ticks === undefined || ticks === null || ticks <= 0) {
                                                setTicks(1);
                                            }
                                        }}
                                        style={{ ...styles.input, borderColor: professionalColors.warning }}
                                        placeholder="1"
                                    />
                                </div>
                            </div>

                            <div style={styles.row}>
                                <div style={{ flex: 1 }}>
                                    <label style={{ fontSize: '12px', fontWeight: '600', color: professionalColors.warningDark }}>RUNS PER TYPE</label>
                                    <input
                                        type="text"
                                        inputMode="numeric"
                                        value={runsPerType}
                                        onChange={e => handleNumberInput(setRunsPerType, e.target.value, 1, 10, true, 1)}
                                        onBlur={() => {
                                            if (runsPerType === '' || runsPerType === undefined || runsPerType === null || runsPerType < 1) {
                                                setRunsPerType(1);
                                            }
                                        }}
                                        style={{ ...styles.input, borderColor: professionalColors.warning }}
                                        placeholder="1"
                                    />
                                </div>
                                <div style={{ flex: 1 }}>
                                    <label style={{ fontSize: '12px', fontWeight: '600', color: professionalColors.warningDark }}>CURRENT TYPE</label>
                                    <div style={{
                                        ...styles.input,
                                        background: currentSequenceType === 1 ? professionalColors.success : professionalColors.warning,
                                        color: 'white',
                                        fontWeight: '600',
                                        textAlign: 'center',
                                        border: 'none',
                                        padding: isMobile ? '16px' : '12px',
                                    }}>
                                        Type {currentSequenceType} ({runsCompletedInCurrentType}/{runsPerType})
                                    </div>
                                </div>
                            </div>

                            <div style={{
                                ...styles.row,
                                background: `${professionalColors.success}10`,
                                padding: '12px',
                                borderRadius: '8px',
                                marginBottom: '10px'
                            }}>
                                <div style={{ flex: 1 }}>
                                    <label style={{ fontSize: '12px', fontWeight: '600', color: professionalColors.success }}>TYPE 1 CONTRACT</label>
                                    <select
                                        value={seqType1Contract}
                                        onChange={e => setSeqType1Contract(e.target.value)}
                                        style={{ ...styles.select, borderColor: professionalColors.success }}
                                    >
                                        <option value="CALL">📈 RISE</option>
                                        <option value="PUT">📉 FALL</option>
                                        <option value="DIGITEVEN">🟰 EVEN</option>
                                        <option value="DIGITODD">🎲 ODD</option>
                                        <option value="DIGITOVER">⬆️ OVER</option>
                                        <option value="DIGITUNDER">⬇️ UNDER</option>
                                        <option value="DIGITMATCH">✓ MATCH</option>
                                        <option value="DIGITDIFF">≠ DIFF</option>
                                    </select>
                                </div>
                                <div style={{ flex: 1 }}>
                                    <label style={{ fontSize: '12px', fontWeight: '600', color: professionalColors.success }}>
                                        {!isRiseFall(seqType1Contract) && !isEvenOdd(seqType1Contract) ? 'TRIGGERS' : 'V-LOSS LIMIT'}
                                    </label>
                                    {!isRiseFall(seqType1Contract) && !isEvenOdd(seqType1Contract) ? (
                                        <input
                                            type="text"
                                            value={seqType1Triggers}
                                            onChange={e => handleDigitInput(setSeqType1Triggers, e.target.value)}
                                            style={{ ...styles.input, borderColor: professionalColors.success }}
                                            placeholder="e.g., 0,2,4,6,8"
                                        />
                                    ) : (
                                        <input
                                            type="text"
                                            inputMode="numeric"
                                            value={seqType1VLoss}
                                            onChange={e => handleNumberInput(setSeqType1VLoss, e.target.value, 1, undefined, true, 1)}
                                            onBlur={() => {
                                                if (seqType1VLoss === '' || seqType1VLoss === undefined || seqType1VLoss === null || seqType1VLoss < 1) {
                                                    setSeqType1VLoss(1);
                                                }
                                            }}
                                            style={{ ...styles.input, borderColor: professionalColors.success }}
                                            placeholder="1"
                                        />
                                    )}
                                </div>
                            </div>

                            <div style={styles.row}>
                                {needsPrediction(seqType1Contract) && (
                                    <div style={{ flex: 1 }}>
                                        <label style={{ fontSize: '12px', fontWeight: '600', color: professionalColors.success }}>PREDICTION (0-9)</label>
                                        <input
                                            type="text"
                                            inputMode="numeric"
                                            value={seqType1Prediction === undefined || seqType1Prediction === null ? '' : seqType1Prediction}
                                            onChange={e => handlePredictionInput(setSeqType1Prediction, e.target.value)}
                                            onBlur={() => {
                                                if (seqType1Prediction === '' || seqType1Prediction === undefined || seqType1Prediction === null) {
                                                    setSeqType1Prediction(0);
                                                }
                                            }}
                                            style={{ ...styles.input, borderColor: professionalColors.success }}
                                            placeholder="0-9"
                                        />
                                    </div>
                                )}
                                <div style={{ flex: 1 }}>
                                    <label style={{ fontSize: '12px', fontWeight: '600', color: professionalColors.success }}>V-LOSS</label>
                                    <div style={{
                                        ...styles.input,
                                        background: seqType1VLossCounter.current > 0 ? professionalColors.danger : professionalColors.success,
                                        color: 'white',
                                        fontWeight: '600',
                                        textAlign: 'center',
                                        border: 'none',
                                        padding: isMobile ? '16px' : '12px',
                                    }}>
                                        {seqType1VLossCounter.current}/{seqType1VLoss}
                                    </div>
                                </div>
                            </div>

                            <div style={{
                                ...styles.row,
                                background: `${professionalColors.warning}10`,
                                padding: '12px',
                                borderRadius: '8px',
                                marginTop: '10px',
                                marginBottom: '10px'
                            }}>
                                <div style={{ flex: 1 }}>
                                    <label style={{ fontSize: '12px', fontWeight: '600', color: professionalColors.warning }}>TYPE 2 CONTRACT</label>
                                    <select
                                        value={seqType2Contract}
                                        onChange={e => setSeqType2Contract(e.target.value)}
                                        style={{ ...styles.select, borderColor: professionalColors.warning }}
                                    >
                                        <option value="CALL">📈 RISE</option>
                                        <option value="PUT">📉 FALL</option>
                                        <option value="DIGITEVEN">🟰 EVEN</option>
                                        <option value="DIGITODD">🎲 ODD</option>
                                        <option value="DIGITOVER">⬆️ OVER</option>
                                        <option value="DIGITUNDER">⬇️ UNDER</option>
                                        <option value="DIGITMATCH">✓ MATCH</option>
                                        <option value="DIGITDIFF">≠ DIFF</option>
                                    </select>
                                </div>
                                <div style={{ flex: 1 }}>
                                    <label style={{ fontSize: '12px', fontWeight: '600', color: professionalColors.warning }}>
                                        {!isRiseFall(seqType2Contract) && !isEvenOdd(seqType2Contract) ? 'TRIGGERS' : 'V-LOSS LIMIT'}
                                    </label>
                                    {!isRiseFall(seqType2Contract) && !isEvenOdd(seqType2Contract) ? (
                                        <input
                                            type="text"
                                            value={seqType2Triggers}
                                            onChange={e => handleDigitInput(setSeqType2Triggers, e.target.value)}
                                            style={{ ...styles.input, borderColor: professionalColors.warning }}
                                            placeholder="e.g., 1,3,5,7,9"
                                        />
                                    ) : (
                                        <input
                                            type="text"
                                            inputMode="numeric"
                                            value={seqType2VLoss}
                                            onChange={e => handleNumberInput(setSeqType2VLoss, e.target.value, 1, undefined, true, 1)}
                                            onBlur={() => {
                                                if (seqType2VLoss === '' || seqType2VLoss === undefined || seqType2VLoss === null || seqType2VLoss < 1) {
                                                    setSeqType2VLoss(1);
                                                }
                                            }}
                                            style={{ ...styles.input, borderColor: professionalColors.warning }}
                                            placeholder="1"
                                        />
                                    )}
                                </div>
                            </div>

                            <div style={styles.row}>
                                {needsPrediction(seqType2Contract) && (
                                    <div style={{ flex: 1 }}>
                                        <label style={{ fontSize: '12px', fontWeight: '600', color: professionalColors.warning }}>PREDICTION (0-9)</label>
                                        <input
                                            type="text"
                                            inputMode="numeric"
                                            value={seqType2Prediction === undefined || seqType2Prediction === null ? '' : seqType2Prediction}
                                            onChange={e => handlePredictionInput(setSeqType2Prediction, e.target.value)}
                                            onBlur={() => {
                                                if (seqType2Prediction === '' || seqType2Prediction === undefined || seqType2Prediction === null) {
                                                    setSeqType2Prediction(0);
                                                }
                                            }}
                                            style={{ ...styles.input, borderColor: professionalColors.warning }}
                                            placeholder="0-9"
                                        />
                                    </div>
                                )}
                                <div style={{ flex: 1 }}>
                                    <label style={{ fontSize: '12px', fontWeight: '600', color: professionalColors.warning }}>V-LOSS</label>
                                    <div style={{
                                        ...styles.input,
                                        background: seqType2VLossCounter.current > 0 ? professionalColors.danger : professionalColors.warning,
                                        color: 'white',
                                        fontWeight: '600',
                                        textAlign: 'center',
                                        border: 'none',
                                        padding: isMobile ? '16px' : '12px',
                                    }}>
                                        {seqType2VLossCounter.current}/{seqType2VLoss}
                                    </div>
                                </div>
                            </div>

                            <div style={styles.row}>
                                <div style={{ flex: 1.2 }}>
                                    <label style={{ fontSize: '12px', fontWeight: '600', color: professionalColors.warningDark }}>MARTINGALE</label>
                                    <input
                                        type="text"
                                        inputMode="decimal"
                                        value={martingale}
                                        onChange={e => handleNumberInput(setMartingale, e.target.value, 1, undefined, true, 1)}
                                        onBlur={() => {
                                            if (martingale === '' || martingale === undefined || martingale === null || martingale < 1) {
                                                setMartingale(1);
                                            }
                                        }}
                                        style={{ ...styles.input, borderColor: professionalColors.warning }}
                                        placeholder="1.0"
                                    />
                                </div>
                                <div style={{ flex: 0.8 }}>
                                    <label style={{ fontSize: '12px', fontWeight: '600', color: professionalColors.warningDark }}>LIMIT</label>
                                    <input
                                        type="text"
                                        inputMode="numeric"
                                        value={martingaleLimit}
                                        onChange={e => handleNumberInput(setMartingaleLimit, e.target.value, 0, undefined, true, 0)}
                                        onBlur={() => {
                                            if (martingaleLimit === '' || martingaleLimit === undefined || martingaleLimit === null) {
                                                setMartingaleLimit(0);
                                            }
                                        }}
                                        style={{ ...styles.input, borderColor: professionalColors.warning }}
                                        placeholder="0"
                                    />
                                </div>
                                <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: '5px', justifyContent: 'flex-end' }}>
                                    <label style={{ fontSize: '12px', fontWeight: '600', color: professionalColors.warningDark }}>ENABLE</label>
                                    <div onClick={() => setMartingaleEnabled(!martingaleEnabled)} style={{
                                        width: '52px', height: '28px', background: martingaleEnabled ? professionalColors.success : professionalColors.danger,
                                        borderRadius: '14px', position: 'relative', cursor: 'pointer',
                                        touchAction: 'manipulation',
                                    }}>
                                        <div style={{
                                            width: '24px', height: '24px', background: '#fff', borderRadius: '50%',
                                            position: 'absolute', top: '2px', left: martingaleEnabled ? '26px' : '2px',
                                            transition: 'left 0.2s'
                                        }}></div>
                                    </div>
                                    <span style={{ fontSize: '14px', color: martingaleEnabled ? professionalColors.success : professionalColors.danger }}>
                                        {martingaleEnabled ? 'ON' : 'OFF'}
                                    </span>
                                </div>
                            </div>

                            <div style={styles.row}>
                                <div style={{ flex: 1 }}>
                                    <label style={{ fontSize: '12px', fontWeight: '600', color: professionalColors.warningDark }}>TAKE PROFIT</label>
                                    <input
                                        type="text"
                                        inputMode="decimal"
                                        value={takeProfit}
                                        onChange={e => handleNumberInput(setTakeProfit, e.target.value, 0, undefined, true, 0)}
                                        onBlur={() => {
                                            if (takeProfit === '' || takeProfit === undefined || takeProfit === null) {
                                                setTakeProfit(0);
                                            }
                                        }}
                                        style={{ ...styles.input, borderColor: professionalColors.warning }}
                                        placeholder="0"
                                    />
                                </div>
                                <div style={{ flex: 1 }}>
                                    <label style={{ fontSize: '12px', fontWeight: '600', color: professionalColors.warningDark }}>STOP LOSS</label>
                                    <input
                                        type="text"
                                        inputMode="decimal"
                                        value={stopLoss}
                                        onChange={e => handleNumberInput(setStopLoss, e.target.value, 0, undefined, true, 0)}
                                        onBlur={() => {
                                            if (stopLoss === '' || stopLoss === undefined || stopLoss === null) {
                                                setStopLoss(0);
                                            }
                                        }}
                                        style={{ ...styles.input, borderColor: professionalColors.warning }}
                                        placeholder="0"
                                    />
                                </div>
                            </div>

                            <div style={{
                                display: 'flex',
                                justifyContent: 'space-between',
                                marginTop: '12px',
                                padding: '12px',
                                background: `${professionalColors.warning}10`,
                                borderRadius: '8px',
                                fontSize: '13px'
                            }}>
                                <span style={{ color: professionalColors.warning, fontWeight: '600' }}>
                                    🔄 Current: Type {currentSequenceType} | Runs: {runsCompletedInCurrentType}/{runsPerType}
                                </span>
                                <span style={{ color: professionalColors.text }}>
                                    ${currentStakeValue.current.toFixed(2)} {lastTradeWasLoss.current && martingaleEnabled ? `(M:${martingaleCounterSeq.current}/${martingaleLimit === 0 ? '∞' : martingaleLimit})` : ''}
                                </span>
                            </div>
                            <div style={{
                                display: 'flex',
                                justifyContent: 'space-between',
                                marginTop: '5px',
                                fontSize: '12px',
                                color: professionalColors.gray
                            }}>
                                <span>Next: {runsCompletedInCurrentType + 1 > runsPerType ? `Type ${currentSequenceType === 1 ? 2 : 1}` : `Type ${currentSequenceType}`}</span>
                                <span>Total runs: {totalRunsCompleted}</span>
                            </div>
                        </div>
                    )}

                    {/* STRIKE MODE UI */}
                    {mode === 'STRIKE' && (
                        <div style={{
                            background: `${professionalColors.danger}10`,
                            padding: '16px',
                            borderRadius: '12px',
                            border: `2px solid ${professionalColors.danger}`,
                            marginBottom: '16px'
                        }}>
                            <div style={{ fontSize: '16px', fontWeight: '600', color: professionalColors.dangerDark, marginBottom: '12px', textAlign: 'center' }}>
                                ⚡ STRIKE MODE — SNIPER ENTRY → AUTO RUN
                            </div>

                            <div style={{
                                display: 'flex',
                                gap: '8px',
                                padding: '8px',
                                background: `${professionalColors.danger}20`,
                                borderRadius: '8px',
                                marginBottom: '12px',
                                fontSize: '12px',
                                color: professionalColors.dangerDark,
                                fontWeight: '600',
                                textAlign: 'center'
                            }}>
                                <span style={{ flex: 1, padding: '6px', background: strikePhase.current === 'HUNT' ? professionalColors.danger : professionalColors.background, color: strikePhase.current === 'HUNT' ? 'white' : professionalColors.gray, borderRadius: '6px' }}>
                                    🎯 PHASE 1: HUNT
                                </span>
                                <span style={{ flex: 1, padding: '6px', background: strikePhase.current === 'RUN' ? professionalColors.danger : professionalColors.background, color: strikePhase.current === 'RUN' ? 'white' : professionalColors.gray, borderRadius: '6px' }}>
                                    🚀 PHASE 2: RUN
                                </span>
                            </div>

                            {/* TRIGGER METHOD SELECTION - DROPDOWN */}
                            <div style={{
                                marginTop: '12px',
                                marginBottom: '12px',
                                padding: '12px',
                                background: `${professionalColors.danger}20`,
                                borderRadius: '8px'
                            }}>
                                <label style={{ fontSize: '12px', fontWeight: '600', color: professionalColors.dangerDark, marginBottom: '8px', display: 'block' }}>
                                    ⚡ SELECT ENTRY TRIGGER METHOD
                                </label>
                                <select
                                    value={strikeTriggerMode}
                                    onChange={e => setStrikeTriggerMode(e.target.value)}
                                    disabled={isBotRunning}
                                    style={{
                                        width: '100%',
                                        padding: isMobile ? '14px' : '12px',
                                        borderRadius: '10px',
                                        border: `2px solid ${professionalColors.danger}`,
                                        fontSize: isMobile ? '14px' : '13px',
                                        fontWeight: '600',
                                        outline: 'none',
                                        background: professionalColors.surface,
                                        color: professionalColors.text,
                                        cursor: isBotRunning ? 'not-allowed' : 'pointer',
                                        opacity: isBotRunning ? 0.6 : 1,
                                        WebkitAppearance: 'none',
                                        backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 12 12'%3E%3Cpath fill='%2364748B' d='M6 8L1 3h10z'/%3E%3C/svg%3E")`,
                                        backgroundRepeat: 'no-repeat',
                                        backgroundPosition: 'right 12px center',
                                        paddingRight: '36px',
                                        marginBottom: '12px'
                                    }}
                                >
                                    <option value="TRIGGER">🎯 DIGIT TRIGGER (Trigger on specific digits)</option>
                                    <option value="VLOSS">📉 V-LOSS (Trigger after streak)</option>
                                </select>

                                {strikeTriggerMode === 'TRIGGER' ? (
                                    <div>
                                        <label style={{ fontSize: '11px', fontWeight: '600', color: professionalColors.dangerDark, marginBottom: '5px', display: 'block' }}>
                                            ENTRY TRIGGER DIGITS (0-9, comma-separated)
                                        </label>
                                        <input
                                            type="text"
                                            value={strikeTriggers}
                                            onChange={e => handleDigitInput(setStrikeTriggers, e.target.value)}
                                            style={{
                                                width: '100%',
                                                padding: isMobile ? '12px' : '10px',
                                                borderRadius: '8px',
                                                border: `1.5px solid ${professionalColors.danger}`,
                                                fontSize: isMobile ? '14px' : '13px',
                                                outline: 'none',
                                                background: professionalColors.surface,
                                                color: professionalColors.text,
                                            }}
                                            placeholder="e.g., 8,9"
                                            disabled={isBotRunning}
                                        />
                                        <div style={{ fontSize: '10px', color: professionalColors.gray, marginTop: '4px' }}>
                                            Bot enters RUN phase when digit matches any of these values (0-9 only)
                                        </div>
                                    </div>
                                ) : (
                                    <div>
                                        <div style={styles.row}>
                                            <div style={{ flex: 1 }}>
                                                <label style={{ fontSize: '11px', fontWeight: '600', color: professionalColors.dangerDark, marginBottom: '5px', display: 'block' }}>
                                                    V-LOSS ENTRY LIMIT
                                                </label>
                                                <input
                                                    type="text"
                                                    inputMode="numeric"
                                                    value={strikeVLoss}
                                                    onChange={e => handleNumberInput(setStrikeVLoss, e.target.value, 1, undefined, true, 1)}
                                                    onBlur={() => {
                                                        if (strikeVLoss === '' || strikeVLoss === undefined || strikeVLoss === null || strikeVLoss < 1) {
                                                            setStrikeVLoss(1);
                                                        }
                                                    }}
                                                    style={{
                                                        width: '100%',
                                                        padding: isMobile ? '12px' : '10px',
                                                        borderRadius: '8px',
                                                        border: `1.5px solid ${professionalColors.danger}`,
                                                        fontSize: isMobile ? '14px' : '13px',
                                                        outline: 'none',
                                                        background: professionalColors.surface,
                                                        color: professionalColors.text,
                                                    }}
                                                    disabled={isBotRunning}
                                                />
                                            </div>
                                            <div style={{ flex: 1 }}>
                                                <label style={{ fontSize: '11px', fontWeight: '600', color: professionalColors.dangerDark, marginBottom: '5px', display: 'block' }}>
                                                    CURRENT V-LOSS
                                                </label>
                                                <div style={{
                                                    width: '100%',
                                                    padding: isMobile ? '12px' : '10px',
                                                    borderRadius: '8px',
                                                    background: strikeVLossCounter.current > 0 ? professionalColors.warning : professionalColors.danger,
                                                    color: 'white',
                                                    fontWeight: '600',
                                                    textAlign: 'center',
                                                    border: 'none',
                                                }}>
                                                    {strikeVLossCounter.current}/{strikeVLoss}
                                                </div>
                                            </div>
                                        </div>
                                        <div style={{ fontSize: '10px', color: professionalColors.gray, marginTop: '4px' }}>
                                            Bot enters RUN phase after V-Loss streak reaches limit
                                        </div>
                                    </div>
                                )}
                            </div>

                            {/* MAIN CONTRACT */}
                            <div style={styles.row}>
                                <div style={{ flex: 1 }}>
                                    <label style={styles.label}>MAIN CONTRACT</label>
                                    <select value={strikeContract} onChange={e => setStrikeContract(e.target.value)}
                                        style={{ ...styles.select, borderColor: professionalColors.danger }}>
                                        <option value="CALL">📈 RISE (CALL)</option>
                                        <option value="PUT">📉 FALL (PUT)</option>
                                        <option value="DIGITEVEN">🟰 EVEN</option>
                                        <option value="DIGITODD">🎲 ODD</option>
                                        <option value="DIGITOVER">⬆️ OVER</option>
                                        <option value="DIGITUNDER">⬇️ UNDER</option>
                                        <option value="DIGITMATCH">✓ MATCH</option>
                                        <option value="DIGITDIFF">≠ DIFF</option>
                                    </select>
                                </div>
                                {['DIGITOVER','DIGITUNDER','DIGITMATCH','DIGITDIFF'].includes(strikeContract) && (
                                    <div style={{ flex: 0.6 }}>
                                        <label style={styles.label}>PREDICTION (0-9)</label>
                                        <input 
                                            type="text" 
                                            inputMode="numeric"
                                            value={strikePred === undefined || strikePred === null ? '' : strikePred}
                                            onChange={e => handlePredictionInput(setStrikePred, e.target.value)}
                                            onBlur={() => {
                                                if (strikePred === '' || strikePred === undefined || strikePred === null) {
                                                    setStrikePred(0);
                                                }
                                            }}
                                            style={{ ...styles.input, borderColor: professionalColors.danger }}
                                            placeholder="0-9"
                                        />
                                    </div>
                                )}
                            </div>

                            {/* RECOVERY CONTRACT */}
                            <div style={{
                                background: `${professionalColors.danger}10`, padding: '12px',
                                borderRadius: '8px', marginBottom: '10px', marginTop: '5px'
                            }}>
                                <div style={{ fontSize: '13px', fontWeight: '600', color: professionalColors.dangerDark, marginBottom: '8px' }}>
                                    🔄 TYPE 2 — RECOVERY CONTRACT
                                </div>
                                <div style={styles.row}>
                                    <div style={{ flex: 1 }}>
                                        <label style={styles.label}>RECOVERY CONTRACT</label>
                                        <select value={strikeRecoveryContract}
                                            onChange={e => setStrikeRecoveryContract(e.target.value)}
                                            style={{ ...styles.select, borderColor: professionalColors.danger }}>
                                            <option value="CALL">📈 RISE (CALL)</option>
                                            <option value="PUT">📉 FALL (PUT)</option>
                                            <option value="DIGITEVEN">🟰 EVEN</option>
                                            <option value="DIGITODD">🎲 ODD</option>
                                            <option value="DIGITOVER">⬆️ OVER</option>
                                            <option value="DIGITUNDER">⬇️ UNDER</option>
                                            <option value="DIGITMATCH">✓ MATCH</option>
                                            <option value="DIGITDIFF">≠ DIFF</option>
                                        </select>
                                    </div>
                                    {['DIGITOVER','DIGITUNDER','DIGITMATCH','DIGITDIFF'].includes(strikeRecoveryContract) && (
                                        <div style={{ flex: 0.6 }}>
                                            <label style={styles.label}>PREDICTION (0-9)</label>
                                            <input 
                                                type="text" 
                                                inputMode="numeric"
                                                value={strikeRecoveryPred === undefined || strikeRecoveryPred === null ? '' : strikeRecoveryPred}
                                                onChange={e => handlePredictionInput(setStrikeRecoveryPred, e.target.value)}
                                                onBlur={() => {
                                                    if (strikeRecoveryPred === '' || strikeRecoveryPred === undefined || strikeRecoveryPred === null) {
                                                        setStrikeRecoveryPred(0);
                                                    }
                                                }}
                                                style={{ ...styles.input, borderColor: professionalColors.danger }} 
                                                placeholder="0-9"
                                            />
                                        </div>
                                    )}
                                </div>
                            </div>

                            {/* STAKE & TICKS */}
                            <div style={styles.row}>
                                <div style={{ flex: 1 }}>
                                    <label style={styles.label}>STAKE</label>
                                    <input type="text" inputMode="decimal" value={stake}
                                        onChange={e => handleStakeChange(e.target.value)}
                                        onBlur={() => {
                                            if (stake === '' || stake === undefined || stake === null || stake <= 0) {
                                                setStake(1);
                                            }
                                        }}
                                        style={{ ...styles.input, borderColor: professionalColors.danger }}
                                        readOnly={isBotRunning}
                                    />
                                </div>
                                <div style={{ flex: 1 }}>
                                    <label style={styles.label}>TICKS</label>
                                    <input type="text" inputMode="numeric" value={ticks}
                                        onChange={e => handleNumberInput(setTicks, e.target.value, 1, undefined, true, 1)}
                                        onBlur={() => {
                                            if (ticks === '' || ticks === undefined || ticks === null || ticks <= 0) {
                                                setTicks(1);
                                            }
                                        }}
                                        style={{ ...styles.input, borderColor: professionalColors.danger }}
                                        readOnly={isBotRunning}
                                    />
                                </div>
                            </div>

                            {/* MARTINGALE */}
                            <div style={styles.row}>
                                <div style={{ flex: 1.2 }}>
                                    <label style={styles.label}>MARTINGALE MULTIPLIER</label>
                                    <input type="text" inputMode="decimal" value={martingale}
                                        onChange={e => handleNumberInput(setMartingale, e.target.value, 1, undefined, true, 1)}
                                        onBlur={() => {
                                            if (martingale === '' || martingale === undefined || martingale === null || martingale < 1) {
                                                setMartingale(1);
                                            }
                                        }}
                                        style={{ ...styles.input, borderColor: professionalColors.danger }}
                                        readOnly={isBotRunning}
                                    />
                                </div>
                                <div style={{ flex: 0.8 }}>
                                    <label style={styles.label}>LIMIT</label>
                                    <input type="text" inputMode="numeric" value={martingaleLimit}
                                        onChange={e => handleNumberInput(setMartingaleLimit, e.target.value, 0, undefined, true, 0)}
                                        onBlur={() => {
                                            if (martingaleLimit === '' || martingaleLimit === undefined || martingaleLimit === null) {
                                                setMartingaleLimit(0);
                                            }
                                        }}
                                        style={{ ...styles.input, borderColor: professionalColors.danger }}
                                        readOnly={isBotRunning}
                                    />
                                </div>
                                <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: '5px', justifyContent: 'flex-end' }}>
                                    <label style={styles.label}>ENABLE</label>
                                    <div onClick={() => setMartingaleEnabled(!martingaleEnabled)} style={{
                                        width: '52px', height: '28px', background: martingaleEnabled ? professionalColors.success : professionalColors.danger,
                                        borderRadius: '14px', position: 'relative', cursor: 'pointer', touchAction: 'manipulation',
                                    }}>
                                        <div style={{
                                            width: '24px', height: '24px', background: '#fff', borderRadius: '50%',
                                            position: 'absolute', top: '2px', left: martingaleEnabled ? '26px' : '2px',
                                            transition: 'left 0.2s'
                                        }} />
                                    </div>
                                    <span style={{ fontSize: '14px', color: martingaleEnabled ? professionalColors.success : professionalColors.danger }}>
                                        {martingaleEnabled ? 'ON' : 'OFF'}
                                    </span>
                                </div>
                            </div>

                            {/* TP/SL */}
                            <div style={styles.row}>
                                <div style={{ flex: 1 }}>
                                    <label style={styles.label}>TAKE PROFIT</label>
                                    <input type="text" inputMode="decimal" value={takeProfit}
                                        onChange={e => handleNumberInput(setTakeProfit, e.target.value, 0, undefined, true, 0)}
                                        onBlur={() => {
                                            if (takeProfit === '' || takeProfit === undefined || takeProfit === null) {
                                                setTakeProfit(0);
                                            }
                                        }}
                                        style={{ ...styles.input, borderColor: professionalColors.danger }}
                                        readOnly={isBotRunning}
                                    />
                                </div>
                                <div style={{ flex: 1 }}>
                                    <label style={styles.label}>STOP LOSS</label>
                                    <input type="text" inputMode="decimal" value={stopLoss}
                                        onChange={e => handleNumberInput(setStopLoss, e.target.value, 0, undefined, true, 0)}
                                        onBlur={() => {
                                            if (stopLoss === '' || stopLoss === undefined || stopLoss === null) {
                                                setStopLoss(0);
                                            }
                                        }}
                                        style={{ ...styles.input, borderColor: professionalColors.danger }}
                                        readOnly={isBotRunning}
                                    />
                                </div>
                            </div>

                            {/* STATUS DISPLAY */}
                            <div style={{
                                padding: '12px', marginTop: '10px', borderRadius: '8px', fontSize: '13px', fontWeight: '600',
                                background: strikeInRecovery.current ? `${professionalColors.warning}20` :
                                            strikePhase.current === 'RUN' ? `${professionalColors.success}20` : `${professionalColors.danger}20`,
                                color: strikeInRecovery.current ? professionalColors.warningDark :
                                       strikePhase.current === 'RUN' ? professionalColors.successDark : professionalColors.dangerDark,
                                display: 'flex', justifyContent: 'space-between'
                            }}>
                                <span>
                                    {strikeInRecovery.current ? '🔄 RECOVERY ACTIVE' :
                                     strikePhase.current === 'RUN' ? '🚀 AUTO-RUNNING' : '🎯 HUNTING ENTRY...'}
                                </span>
                                <span>
                                    Stake: ${strikeCurrentStake.current.toFixed(2)}
                                    {strikeMartingaleCounter.current > 0 && ` (M:${strikeMartingaleCounter.current}/${martingaleLimit === 0 ? '∞' : martingaleLimit})`}
                                </span>
                            </div>
                        </div>
                    )}

                    {/* PARALLEL MODE UI */}
                    {mode === 'PARALLEL' && (
                        <div style={{
                            background: `${professionalColors.purple}10`,
                            padding: '16px',
                            borderRadius: '12px',
                            border: `2px solid ${professionalColors.purple}`,
                            marginBottom: '16px'
                        }}>
                            <div style={{
                                fontSize: '16px',
                                fontWeight: '600',
                                color: professionalColors.purpleDark,
                                marginBottom: '12px',
                                textAlign: 'center'
                            }}>
                                🔀 PARALLEL MODE — {parallelCount} TRADES IN ONE TRIGGER
                            </div>

                            {/* Basic Settings */}
                            <div style={styles.row}>
                                <div style={{ flex: 1 }}>
                                    <label style={styles.label}>NUMBER OF TRADES (1-9)</label>
                                    <input
                                        type="text"
                                        inputMode="numeric"
                                        value={parallelCount === 0 ? '' : parallelCount}
                                        onChange={e => {
                                            const val = e.target.value;
                                            if (val === '' || val === '-') {
                                                setParallelCount('');
                                                return;
                                            }
                                            const num = parseInt(val);
                                            if (!isNaN(num) && num >= 1 && num <= 9) {
                                                setParallelCount(num);
                                            }
                                        }}
                                        onBlur={() => {
                                            if (parallelCount === '' || parallelCount === undefined || parallelCount === null || parallelCount < 1) {
                                                setParallelCount(1);
                                            }
                                            if (parallelCount > 9) setParallelCount(9);
                                        }}
                                        style={getInputStyle(isBotRunning)}
                                        disabled={isBotRunning}
                                        placeholder="1-9"
                                    />
                                </div>
                                <div style={{ flex: 1 }}>
                                    <label style={styles.label}>TICKS</label>
                                    <input
                                        type="text"
                                        inputMode="numeric"
                                        value={parallelTicks}
                                        onChange={e => handleNumberInput(setParallelTicks, e.target.value, 1, undefined, true, 1)}
                                        onBlur={() => {
                                            if (parallelTicks === '' || parallelTicks === undefined || parallelTicks === null || parallelTicks < 1) {
                                                setParallelTicks(1);
                                            }
                                        }}
                                        style={getInputStyle(isBotRunning)}
                                        disabled={isBotRunning}
                                    />
                                </div>
                                <div style={{ flex: 1 }}>
                                    <label style={styles.label}>BASE STAKE (each)</label>
                                    <input
                                        type="text"
                                        inputMode="decimal"
                                        value={parallelStake}
                                        onChange={e => {
                                            const val = e.target.value;
                                            if (val === '' || val === '-') {
                                                setParallelStake('');
                                                return;
                                            }
                                            if (val === '.') {
                                                setParallelStake('0.');
                                                return;
                                            }
                                            const num = parseFloat(val);
                                            if (!isNaN(num) && num > 0) {
                                                setParallelStake(num);
                                                parallelBaseStake.current = num;
                                                currentParallelStake.current = num;
                                            }
                                        }}
                                        onBlur={() => {
                                            if (parallelStake === '' || parallelStake === undefined || parallelStake === null || parallelStake <= 0) {
                                                setParallelStake(1);
                                                parallelBaseStake.current = 1;
                                                currentParallelStake.current = 1;
                                            } else {
                                                const num = parseFloat(parallelStake);
                                                if (!isNaN(num) && num > 0) {
                                                    setParallelStake(num);
                                                    parallelBaseStake.current = num;
                                                    currentParallelStake.current = num;
                                                }
                                            }
                                        }}
                                        style={getInputStyle(isBotRunning)}
                                        disabled={isBotRunning}
                                    />
                                </div>
                            </div>

                            {/* TRIGGER METHOD SELECTION - DROPDOWN */}
                            <div style={{
                                marginTop: '12px',
                                marginBottom: '12px',
                                padding: '12px',
                                background: `${professionalColors.purple}20`,
                                borderRadius: '8px'
                            }}>
                                <label style={{ fontSize: '12px', fontWeight: '600', color: professionalColors.purpleDark, marginBottom: '8px', display: 'block' }}>
                                    ⚡ SELECT TRIGGER METHOD
                                </label>
                                <select
                                    value={parallelTriggerMethod}
                                    onChange={e => setParallelTriggerMethod(e.target.value)}
                                    disabled={isBotRunning}
                                    style={{
                                        width: '100%',
                                        padding: isMobile ? '14px' : '12px',
                                        borderRadius: '10px',
                                        border: `2px solid ${professionalColors.purple}`,
                                        fontSize: isMobile ? '14px' : '13px',
                                        fontWeight: '600',
                                        outline: 'none',
                                        background: professionalColors.surface,
                                        color: professionalColors.text,
                                        cursor: isBotRunning ? 'not-allowed' : 'pointer',
                                        opacity: isBotRunning ? 0.6 : 1,
                                        WebkitAppearance: 'none',
                                        backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 12 12'%3E%3Cpath fill='%2364748B' d='M6 8L1 3h10z'/%3E%3C/svg%3E")`,
                                        backgroundRepeat: 'no-repeat',
                                        backgroundPosition: 'right 12px center',
                                        paddingRight: '36px',
                                        marginBottom: '12px'
                                    }}
                                >
                                    <option value="TRIGGER">🎯 DIGIT TRIGGER (Trigger on specific digits)</option>
                                    <option value="VLOSS">📉 V-LOSS (Continuation - trigger after streak)</option>
                                </select>

                                {parallelTriggerMethod === 'TRIGGER' ? (
                                    <div>
                                        <label style={{ fontSize: '11px', fontWeight: '600', color: professionalColors.purpleDark, marginBottom: '5px', display: 'block' }}>
                                            TRIGGER DIGITS (0-9, comma-separated)
                                        </label>
                                        <input
                                            type="text"
                                            value={parallelTriggers}
                                            onChange={e => handleDigitInput(setParallelTriggers, e.target.value)}
                                            style={{
                                                width: '100%',
                                                padding: isMobile ? '12px' : '10px',
                                                borderRadius: '8px',
                                                border: `1.5px solid ${professionalColors.purple}`,
                                                fontSize: isMobile ? '14px' : '13px',
                                                outline: 'none',
                                                background: professionalColors.surface,
                                                color: professionalColors.text,
                                            }}
                                            placeholder="e.g., 8,9"
                                            disabled={isBotRunning}
                                        />
                                        <div style={{ fontSize: '10px', color: professionalColors.gray, marginTop: '4px' }}>
                                            Bot triggers when digit matches any of these values (0-9 only)
                                        </div>
                                    </div>
                                ) : (
                                    <div>
                                        <div style={styles.row}>
                                            <div style={{ flex: 1 }}>
                                                <label style={{ fontSize: '11px', fontWeight: '600', color: professionalColors.purpleDark, marginBottom: '5px', display: 'block' }}>
                                                    V-LOSS LIMIT
                                                </label>
                                                <input
                                                    type="text"
                                                    inputMode="numeric"
                                                    value={parallelVLossLimit}
                                                    onChange={e => handleNumberInput(setParallelVLossLimit, e.target.value, 1, undefined, true, 1)}
                                                    onBlur={() => {
                                                        if (parallelVLossLimit === '' || parallelVLossLimit === undefined || parallelVLossLimit === null || parallelVLossLimit < 1) {
                                                            setParallelVLossLimit(1);
                                                        }
                                                    }}
                                                    style={{
                                                        width: '100%',
                                                        padding: isMobile ? '12px' : '10px',
                                                        borderRadius: '8px',
                                                        border: `1.5px solid ${professionalColors.purple}`,
                                                        fontSize: isMobile ? '14px' : '13px',
                                                        outline: 'none',
                                                        background: professionalColors.surface,
                                                        color: professionalColors.text,
                                                    }}
                                                    disabled={isBotRunning}
                                                />
                                            </div>
                                            <div style={{ flex: 1 }}>
                                                <label style={{ fontSize: '11px', fontWeight: '600', color: professionalColors.purpleDark, marginBottom: '5px', display: 'block' }}>
                                                    CURRENT V-LOSS STREAK
                                                </label>
                                                <div style={{
                                                    width: '100%',
                                                    padding: isMobile ? '12px' : '10px',
                                                    borderRadius: '8px',
                                                    background: parallelVLossCounter.current > 0 ? professionalColors.warning : professionalColors.success,
                                                    color: 'white',
                                                    fontWeight: '600',
                                                    textAlign: 'center',
                                                    border: 'none',
                                                }}>
                                                    {parallelVLossCounter.current}/{parallelVLossLimit}
                                                </div>
                                            </div>
                                        </div>
                                        <div style={{ fontSize: '10px', color: professionalColors.gray, marginTop: '4px' }}>
                                            V-Loss tracks continuation streaks based on your first trade type
                                        </div>
                                    </div>
                                )}
                            </div>

                            {/* RUN MODE - DROPDOWN */}
                            <div style={{
                                marginTop: '12px',
                                marginBottom: '12px',
                                padding: '12px',
                                background: `${professionalColors.purple}20`,
                                borderRadius: '8px'
                            }}>
                                <label style={{ fontSize: '12px', fontWeight: '600', color: professionalColors.purpleDark, marginBottom: '8px', display: 'block' }}>
                                    🚀 SELECT RUN MODE
                                </label>
                                <select
                                    value={parallelRunMode}
                                    onChange={e => setParallelRunMode(e.target.value)}
                                    disabled={isBotRunning}
                                    style={{
                                        width: '100%',
                                        padding: isMobile ? '14px' : '12px',
                                        borderRadius: '10px',
                                        border: `2px solid ${professionalColors.purple}`,
                                        fontSize: isMobile ? '14px' : '13px',
                                        fontWeight: '600',
                                        outline: 'none',
                                        background: professionalColors.surface,
                                        color: professionalColors.text,
                                        cursor: isBotRunning ? 'not-allowed' : 'pointer',
                                        opacity: isBotRunning ? 0.6 : 1,
                                        WebkitAppearance: 'none',
                                        backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 12 12'%3E%3Cpath fill='%2364748B' d='M6 8L1 3h10z'/%3E%3C/svg%3E")`,
                                        backgroundRepeat: 'no-repeat',
                                        backgroundPosition: 'right 12px center',
                                        paddingRight: '36px',
                                    }}
                                >
                                    <option value="SINGLE">🎯 SINGLE RUN - Wait for trigger for EACH batch</option>
                                    <option value="AUTO_RUN">🚀 AUTO-RUN - Only first trigger needed, then continuous</option>
                                </select>
                                <div style={{ fontSize: '11px', color: professionalColors.gray, marginTop: '8px', textAlign: 'center' }}>
                                    {parallelRunMode === 'SINGLE' 
                                        ? '✓ Each batch requires a new trigger condition (digit match or V-Loss streak)'
                                        : '✓ Only the FIRST batch needs a trigger. After that, runs continuously until stopped'}
                                </div>
                            </div>

                            {/* TRADE TYPES - STRICTLY FOLLOWED */}
                            <div style={{
                                marginTop: '12px',
                                marginBottom: '12px',
                                padding: '12px',
                                background: `${professionalColors.purple}20`,
                                borderRadius: '8px'
                            }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                                    <label style={{ fontSize: '12px', fontWeight: '600', color: professionalColors.purpleDark }}>
                                        📊 TRADE CONFIGURATION
                                    </label>
                                    <span style={{ fontSize: '10px', color: professionalColors.gray, background: professionalColors.surface, padding: '4px 8px', borderRadius: '4px' }}>
                                        Strictly follows your selections
                                    </span>
                                </div>
                                
                                {parallelTrades.map((trade, idx) => (
                                    <div key={idx} style={{
                                        marginBottom: '10px',
                                        padding: '10px',
                                        background: `${professionalColors.purple}10`,
                                        borderRadius: '8px',
                                        border: `1px solid ${professionalColors.purple}30`
                                    }}>
                                        <div style={styles.row}>
                                            <div style={{ flex: 1 }}>
                                                <label style={{ fontSize: '10px', fontWeight: '600', color: professionalColors.purpleDark }}>Trade {idx+1}</label>
                                                <select
                                                    value={trade.contract}
                                                    onChange={e => updateParallelTrade(idx, 'contract', e.target.value)}
                                                    style={getInputStyle(isBotRunning)}
                                                    disabled={isBotRunning}
                                                >
                                                    <option value="CALL">📈 RISE (CALL)</option>
                                                    <option value="PUT">📉 FALL (PUT)</option>
                                                    <option value="DIGITEVEN">🟰 EVEN</option>
                                                    <option value="DIGITODD">🎲 ODD</option>
                                                    <option value="DIGITOVER">⬆️ OVER</option>
                                                    <option value="DIGITUNDER">⬇️ UNDER</option>
                                                    <option value="DIGITMATCH">✓ MATCH</option>
                                                    <option value="DIGITDIFF">≠ DIFF</option>
                                                </select>
                                            </div>
                                            {needsPrediction(trade.contract) && (
                                                <div style={{ flex: 0.6 }}>
                                                    <label style={{ fontSize: '10px', fontWeight: '600', color: professionalColors.purpleDark }}>Prediction (0-9)</label>
                                                    <input
                                                        type="text"
                                                        inputMode="numeric"
                                                        value={trade.prediction === undefined || trade.prediction === null ? '' : trade.prediction}
                                                        onChange={e => {
                                                            const val = e.target.value;
                                                            if (val === '' || val === '-') {
                                                                updateParallelTrade(idx, 'prediction', null);
                                                            } else {
                                                                const num = parseInt(val);
                                                                if (!isNaN(num) && num >= 0 && num <= 9) {
                                                                    updateParallelTrade(idx, 'prediction', num);
                                                                }
                                                            }
                                                        }}
                                                        onBlur={() => {
                                                            if (trade.prediction === '' || trade.prediction === undefined || trade.prediction === null) {
                                                                updateParallelTrade(idx, 'prediction', 0);
                                                            }
                                                        }}
                                                        style={getInputStyle(isBotRunning)}
                                                        disabled={isBotRunning}
                                                        placeholder="0-9"
                                                    />
                                                </div>
                                            )}
                                            {!needsPrediction(trade.contract) && (
                                                <div style={{ flex: 0.6 }}>
                                                    <div style={{
                                                        fontSize: '10px',
                                                        color: professionalColors.gray,
                                                        padding: isMobile ? '12px' : '10px',
                                                        textAlign: 'center',
                                                        background: `${professionalColors.purple}20`,
                                                        borderRadius: '6px'
                                                    }}>
                                                        No prediction needed
                                                    </div>
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                ))}
                                
                                <div style={{ fontSize: '11px', color: professionalColors.gray, marginTop: '8px', textAlign: 'center', background: `${professionalColors.purple}10`, padding: '6px', borderRadius: '6px' }}>
                                    ⚡ ALL {parallelCount} TRADES FIRE SIMULTANEOUSLY (Promise.all)<br/>
                                    🎯 ALL TRADES EXIT AT THE SAME TICK
                                </div>
                            </div>

                            {/* MARTINGALE */}
                            <div style={styles.row}>
                                <div style={{ flex: 1.2 }}>
                                    <label style={styles.label}>MARTINGALE MULTIPLIER</label>
                                    <input
                                        type="text"
                                        inputMode="decimal"
                                        value={parallelMartingale}
                                        onChange={e => handleNumberInput(setParallelMartingale, e.target.value, 1, undefined, true, 1)}
                                        onBlur={() => {
                                            if (parallelMartingale === '' || parallelMartingale === undefined || parallelMartingale === null || parallelMartingale < 1) {
                                                setParallelMartingale(1);
                                            }
                                        }}
                                        style={getInputStyle(isBotRunning)}
                                        disabled={isBotRunning}
                                    />
                                </div>
                                <div style={{ flex: 0.8 }}>
                                    <label style={styles.label}>LIMIT</label>
                                    <input
                                        type="text"
                                        inputMode="numeric"
                                        value={parallelMartingaleLimit}
                                        onChange={e => handleNumberInput(setParallelMartingaleLimit, e.target.value, 0, undefined, true, 0)}
                                        onBlur={() => {
                                            if (parallelMartingaleLimit === '' || parallelMartingaleLimit === undefined || parallelMartingaleLimit === null) {
                                                setParallelMartingaleLimit(0);
                                            }
                                        }}
                                        style={getInputStyle(isBotRunning)}
                                        disabled={isBotRunning}
                                    />
                                </div>
                                <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: '5px', justifyContent: 'flex-end' }}>
                                    <label style={styles.label}>ENABLE</label>
                                    <div onClick={() => setParallelMartingaleEnabled(!parallelMartingaleEnabled)} style={{
                                        width: '52px', height: '28px', background: parallelMartingaleEnabled ? professionalColors.success : professionalColors.danger,
                                        borderRadius: '14px', position: 'relative', cursor: 'pointer',
                                        touchAction: 'manipulation',
                                    }}>
                                        <div style={{
                                            width: '24px', height: '24px', background: '#fff', borderRadius: '50%',
                                            position: 'absolute', top: '2px', left: parallelMartingaleEnabled ? '26px' : '2px',
                                            transition: 'left 0.2s'
                                        }}></div>
                                    </div>
                                    <span style={{ fontSize: '14px', color: parallelMartingaleEnabled ? professionalColors.success : professionalColors.danger }}>
                                        {parallelMartingaleEnabled ? 'ON' : 'OFF'}
                                    </span>
                                </div>
                            </div>

                            {/* TP/SL */}
                            <div style={styles.row}>
                                <div style={{ flex: 1 }}>
                                    <label style={styles.label}>TAKE PROFIT</label>
                                    <input
                                        type="text"
                                        inputMode="decimal"
                                        value={parallelTakeProfit}
                                        onChange={e => handleNumberInput(setParallelTakeProfit, e.target.value, 0, undefined, true, 0)}
                                        onBlur={() => {
                                            if (parallelTakeProfit === '' || parallelTakeProfit === undefined || parallelTakeProfit === null) {
                                                setParallelTakeProfit(0);
                                            }
                                        }}
                                        style={getInputStyle(isBotRunning)}
                                        disabled={isBotRunning}
                                    />
                                </div>
                                <div style={{ flex: 1 }}>
                                    <label style={styles.label}>STOP LOSS</label>
                                    <input
                                        type="text"
                                        inputMode="decimal"
                                        value={parallelStopLoss}
                                        onChange={e => handleNumberInput(setParallelStopLoss, e.target.value, 0, undefined, true, 0)}
                                        onBlur={() => {
                                            if (parallelStopLoss === '' || parallelStopLoss === undefined || parallelStopLoss === null) {
                                                setParallelStopLoss(0);
                                            }
                                        }}
                                        style={getInputStyle(isBotRunning)}
                                        disabled={isBotRunning}
                                    />
                                </div>
                            </div>

                            {/* STATUS DISPLAY */}
                            <div style={{
                                padding: '12px',
                                marginTop: '10px',
                                borderRadius: '8px',
                                fontSize: '13px',
                                fontWeight: '600',
                                background: parallelPending.current ? `${professionalColors.warning}20` : `${professionalColors.purple}20`,
                                color: parallelPending.current ? professionalColors.warningDark : professionalColors.purpleDark,
                                display: 'flex',
                                justifyContent: 'space-between',
                                flexWrap: 'wrap',
                                gap: '8px'
                            }}>
                                <span>
                                    {parallelPending.current ? '⏳ BATCH IN PROGRESS' : '✅ READY'}
                                    {parallelPending.current && ` (${parallelRemainingCount.current} trades left)`}
                                    {parallelAutoRunActive.current && ' 🔁 AUTO-RUN ACTIVE'}
                                    {parallelRunMode === 'SINGLE' && !parallelAutoRunActive.current && !parallelPending.current && ' 🎯 WAITING FOR TRIGGER'}
                                </span>
                                <span>
                                    Stake: ${currentParallelStake.current.toFixed(2)}
                                    {parallelMartingaleCounter.current > 0 && ` | M:${parallelMartingaleCounter.current}/${parallelMartingaleLimit === 0 ? '∞' : parallelMartingaleLimit}`}
                                    {parallelTriggerMethod === 'VLOSS' && parallelVLossCounter.current > 0 && ` | 📊 V:${parallelVLossCounter.current}/${parallelVLossLimit}`}
                                </span>
                            </div>
                        </div>
                    )}

                    {/* SCANNER MODE UI */}
                    {mode === 'SCANNER' && (
                        <div style={{
                            background: 'rgba(6, 182, 212, 0.08)',
                            padding: '20px',
                            borderRadius: '16px',
                            border: '2px solid #06B6D4',
                            marginBottom: '15px'
                        }}>
                            <div style={{
                                fontSize: '16px',
                                fontWeight: '600',
                                color: '#0891B2',
                                marginBottom: '16px',
                                textAlign: 'center',
                                textTransform: 'uppercase'
                            }}>
                                📡 SCANNER BOT — CONFIGURABLE SEQUENCE SCANNER
                            </div>

                            {/* HOW IT WORKS */}
                            <div style={{
                                background: 'rgba(6, 182, 212, 0.12)',
                                padding: '12px',
                                borderRadius: '10px',
                                marginBottom: '16px',
                                fontSize: '12px',
                                color: '#0E7490',
                                lineHeight: '1.6'
                            }}>
                                <strong>🔍 HOW IT WORKS:</strong><br/>
                                The bot scans ALL {SCANNER_SYMBOLS.length} volatility markets simultaneously.<br/>
                                When it detects <strong>{scannerDetectionCount} consecutive digits of the same parity</strong> on any market, it selects the <strong>market with the longest current streak</strong> and trades the <strong>current sequence slot's contract</strong>.<br/>
                                After <strong>N trades</strong> in a slot (win <em>or</em> loss), it advances to the next slot — wrapping back to the start.<br/>
                                Martingale applies on losses <em>within</em> each slot. Slot rotation is <strong>always</strong> based on trade count, not outcome.
                            </div>

                            {/* SEQUENCE CONFIGURATION */}
                            <div style={{
                                background: 'rgba(6,182,212,0.07)',
                                border: '1.5px solid rgba(6,182,212,0.3)',
                                borderRadius: '12px',
                                padding: '14px',
                                marginBottom: '16px'
                            }}>
                                <div style={{ fontSize: '13px', fontWeight: '700', color: '#0891B2', marginBottom: '12px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                    <span>🔄 CONTRACT SEQUENCE ({scannerSequence.length} slot{scannerSequence.length !== 1 ? 's' : ''})</span>
                                    <span style={{ fontSize: '11px', color: '#64748B' }}>Active: slot {scannerSeqIndex + 1}/{scannerSequence.length}</span>
                                </div>

                                {/* DETECTION COUNT */}
                                <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '12px', padding: '8px 12px', background: 'rgba(6,182,212,0.08)', borderRadius: '8px', border: '1px solid rgba(6,182,212,0.2)' }}>
                                    <label style={{ fontSize: '12px', fontWeight: '600', color: '#0891B2', flex: 1 }}>
                                        🔢 CONSECUTIVE DIGITS TO DETECT
                                        <span style={{ fontSize: '10px', color: '#64748B', fontWeight: '400', display: 'block' }}>How many same-parity digits in a row trigger a trade</span>
                                    </label>
                                    <input
                                        type="text"
                                        inputMode="numeric"
                                        value={scannerDetectionCount}
                                        onChange={e => {
                                            const raw = e.target.value;
                                            if (raw === '') { setScannerDetectionCount(raw); return; }
                                            const n = parseInt(raw);
                                            if (!isNaN(n) && n >= 1 && n <= 10) {
                                                setScannerDetectionCount(n);
                                                scannerDetectionCountRef.current = n;
                                            }
                                        }}
                                        onBlur={() => {
                                            const n = parseInt(scannerDetectionCount);
                                            const val = isNaN(n) || n < 1 ? 2 : n;
                                            setScannerDetectionCount(val);
                                            scannerDetectionCountRef.current = val;
                                        }}
                                        disabled={isBotRunning}
                                        style={{ width: '60px', padding: '8px', borderRadius: '6px', border: '1.5px solid #06B6D4', fontSize: '14px', textAlign: 'center', fontWeight: '700', color: '#0891B2' }}
                                    />
                                </div>

                                {scannerSequence.map((slot, idx) => (
                                    <div key={idx} style={{
                                        display: 'flex',
                                        alignItems: 'center',
                                        gap: '8px',
                                        marginBottom: '8px',
                                        padding: '10px',
                                        borderRadius: '8px',
                                        background: scannerSeqIndex === idx && isBotRunning ? 'rgba(16,185,129,0.15)' : 'rgba(255,255,255,0.6)',
                                        border: `1.5px solid ${scannerSeqIndex === idx && isBotRunning ? '#10B981' : 'rgba(6,182,212,0.2)'}`
                                    }}>
                                        <div style={{ fontSize: '12px', fontWeight: '700', color: '#0891B2', minWidth: '24px' }}>#{idx + 1}</div>
                                        <select
                                            value={slot.contract}
                                            onChange={e => {
                                                const updated = scannerSequence.map((s, i) => i === idx ? { ...s, contract: e.target.value } : s);
                                                setScannerSequence(updated);
                                            }}
                                            disabled={isBotRunning}
                                            style={{ flex: 1, padding: '8px', borderRadius: '6px', border: '1.5px solid #06B6D4', fontSize: '13px', background: 'white', color: '#1F2937' }}
                                        >
                                            <option value="DIGITEVEN">🟠 EVEN</option>
                                            <option value="DIGITODD">🎲 ODD</option>
                                        </select>
                                        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', minWidth: '70px' }}>
                                            <label style={{ fontSize: '10px', color: '#64748B', marginBottom: '2px' }}>RUNS</label>
                                            <input
                                                type="text"
                                                inputMode="numeric"
                                                value={slot.runsPerType}
                                                onChange={e => {
                                                    const raw = e.target.value;
                                                    if (raw === '' || raw === '0') {
                                                        const updated = scannerSequence.map((s, i) => i === idx ? { ...s, runsPerType: raw } : s);
                                                        setScannerSequence(updated);
                                                        return;
                                                    }
                                                    const val = parseInt(raw);
                                                    if (!isNaN(val) && val >= 1) {
                                                        const updated = scannerSequence.map((s, i) => i === idx ? { ...s, runsPerType: val } : s);
                                                        setScannerSequence(updated);
                                                    }
                                                }}
                                                onBlur={e => {
                                                    const val = parseInt(e.target.value);
                                                    if (isNaN(val) || val < 1) {
                                                        const updated = scannerSequence.map((s, i) => i === idx ? { ...s, runsPerType: 1 } : s);
                                                        setScannerSequence(updated);
                                                    }
                                                }}
                                                disabled={isBotRunning}
                                                style={{ width: '60px', padding: '6px', borderRadius: '6px', border: '1.5px solid #06B6D4', fontSize: '13px', textAlign: 'center' }}
                                            />
                                        </div>
                                        {scannerSequence.length > 1 && (
                                            <button
                                                onClick={() => {
                                                    const updated = scannerSequence.filter((_, i) => i !== idx);
                                                    setScannerSequence(updated);
                                                }}
                                                disabled={isBotRunning}
                                                style={{ padding: '6px 10px', background: '#EF4444', color: 'white', border: 'none', borderRadius: '6px', cursor: 'pointer', fontSize: '14px', fontWeight: '700' }}
                                            >×</button>
                                        )}
                                    </div>
                                ))}

                                {scannerSequence.length < 8 && (
                                    <button
                                        onClick={() => setScannerSequence(prev => [...prev, { contract: 'DIGITEVEN', runsPerType: 2 }])}
                                        disabled={isBotRunning}
                                        style={{ width: '100%', marginTop: '6px', padding: '8px', background: 'rgba(6,182,212,0.15)', color: '#0891B2', border: '1.5px dashed #06B6D4', borderRadius: '8px', cursor: 'pointer', fontSize: '13px', fontWeight: '600' }}
                                    >
                                        + Add Slot
                                    </button>
                                )}
                            </div>

                            {/* STAKE & MARTINGALE */}
                            <div style={styles.row}>
                                <div style={{ flex: 1 }}>
                                    <label style={{ fontSize: '12px', fontWeight: '600', color: '#0891B2', marginBottom: '5px', display: 'block', textTransform: 'uppercase', letterSpacing: '0.5px' }}>STAKE ($)</label>
                                    <input
                                        type="text"
                                        inputMode="decimal"
                                        value={scannerStake}
                                        onChange={e => {
                                            const val = e.target.value;
                                            if (val === '' || val === '.') { setScannerStake(val); return; }
                                            const n = parseFloat(val);
                                            if (!isNaN(n) && n > 0) {
                                                setScannerStake(n);
                                                scannerBaseStake.current = n;
                                                scannerCurrentStake.current = n;
                                            }
                                        }}
                                        onBlur={() => {
                                            if (!scannerStake || parseFloat(scannerStake) <= 0) {
                                                setScannerStake(1);
                                                scannerBaseStake.current = 1;
                                                scannerCurrentStake.current = 1;
                                            }
                                        }}
                                        disabled={isBotRunning}
                                        style={{ ...styles.input, borderColor: '#06B6D4' }}
                                        placeholder="1.00"
                                    />
                                </div>
                                <div style={{ flex: 1 }}>
                                    <label style={{ fontSize: '12px', fontWeight: '600', color: '#0891B2', marginBottom: '5px', display: 'block', textTransform: 'uppercase', letterSpacing: '0.5px' }}>MARTINGALE MULTIPLIER</label>
                                    <input
                                        type="text"
                                        inputMode="decimal"
                                        value={scannerMartingale}
                                        onChange={e => {
                                            const val = e.target.value;
                                            if (val === '' || val === '.') { setScannerMartingale(val); return; }
                                            const n = parseFloat(val);
                                            if (!isNaN(n) && n >= 1) setScannerMartingale(n);
                                        }}
                                        onBlur={() => {
                                            if (!scannerMartingale || parseFloat(scannerMartingale) < 1) setScannerMartingale(2);
                                        }}
                                        disabled={isBotRunning}
                                        style={{ ...styles.input, borderColor: '#06B6D4' }}
                                        placeholder="2.0"
                                    />
                                </div>
                                <div style={{ flex: 0.8 }}>
                                    <label style={{ fontSize: '12px', fontWeight: '600', color: '#0891B2', marginBottom: '5px', display: 'block', textTransform: 'uppercase', letterSpacing: '0.5px' }}>M. LIMIT</label>
                                    <input
                                        type="text"
                                        inputMode="numeric"
                                        value={scannerMartingaleLimit}
                                        onChange={e => {
                                            const val = e.target.value;
                                            if (val === '') { setScannerMartingaleLimit(0); return; }
                                            const n = parseInt(val);
                                            if (!isNaN(n) && n >= 0) setScannerMartingaleLimit(n);
                                        }}
                                        onBlur={() => {
                                            if (scannerMartingaleLimit === '' || scannerMartingaleLimit === undefined) setScannerMartingaleLimit(0);
                                        }}
                                        disabled={isBotRunning}
                                        style={{ ...styles.input, borderColor: '#06B6D4' }}
                                        placeholder="0=∞"
                                    />
                                </div>
                            </div>

                            {/* MARTINGALE ENABLE TOGGLE (5-second scan reset is hardcoded) */}
                            <div style={styles.row}>
                                <div style={{ flex: 1 }}>
                                    <label style={{ fontSize: '12px', fontWeight: '600', color: '#0891B2', marginBottom: '5px', display: 'block', textTransform: 'uppercase', letterSpacing: '0.5px' }}>MARTINGALE</label>
                                    <button
                                        onClick={() => setScannerMartingaleEnabled(v => !v)}
                                        disabled={isBotRunning}
                                        style={{
                                            ...styles.input,
                                            background: scannerMartingaleEnabled ? '#065F46' : '#374151',
                                            color: scannerMartingaleEnabled ? '#34D399' : '#9CA3AF',
                                            border: scannerMartingaleEnabled ? '1.5px solid #34D399' : '1.5px solid #4B5563',
                                            cursor: isBotRunning ? 'not-allowed' : 'pointer',
                                            fontWeight: '700',
                                            letterSpacing: '1px',
                                            textAlign: 'center',
                                        }}
                                    >
                                        {scannerMartingaleEnabled ? '✅ ON' : '❌ OFF'}
                                    </button>
                                </div>
                                <div style={{ flex: 1 }}>
                                    <label style={{ fontSize: '12px', fontWeight: '600', color: '#0891B2', marginBottom: '5px', display: 'block', textTransform: 'uppercase', letterSpacing: '0.5px' }}>SCAN RESET</label>
                                    <div style={{ ...styles.input, background: '#1F2937', color: '#6B7280', border: '1.5px solid #374151', textAlign: 'center', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: '700' }}>
                                        ⏱️ 5s (fixed)
                                    </div>
                                </div>
                            </div>

                            {/* TAKE PROFIT & STOP LOSS */}
                            <div style={styles.row}>
                                <div style={{ flex: 1 }}>
                                    <label style={{ fontSize: '12px', fontWeight: '600', color: '#0891B2', marginBottom: '5px', display: 'block', textTransform: 'uppercase', letterSpacing: '0.5px' }}>TAKE PROFIT ($)</label>
                                    <input
                                        type="text"
                                        inputMode="decimal"
                                        value={scannerTakeProfit}
                                        onChange={e => {
                                            const raw = e.target.value;
                                            if (raw === '' || raw === '.') { setScannerTakeProfit(raw); return; }
                                            const n = parseFloat(raw);
                                            if (!isNaN(n) && n >= 0) {
                                                setScannerTakeProfit(n);
                                                scannerTakeProfitRef.current = n;
                                            }
                                        }}
                                        onBlur={() => {
                                            const n = parseFloat(scannerTakeProfit);
                                            const val = isNaN(n) || n < 0 ? 0 : n;
                                            setScannerTakeProfit(val);
                                            scannerTakeProfitRef.current = val;
                                        }}
                                        disabled={isBotRunning}
                                        style={{ ...styles.input, borderColor: '#10B981' }}
                                        placeholder="0 = off"
                                    />
                                </div>
                                <div style={{ flex: 1 }}>
                                    <label style={{ fontSize: '12px', fontWeight: '600', color: '#0891B2', marginBottom: '5px', display: 'block', textTransform: 'uppercase', letterSpacing: '0.5px' }}>STOP LOSS ($)</label>
                                    <input
                                        type="text"
                                        inputMode="decimal"
                                        value={scannerStopLoss}
                                        onChange={e => {
                                            const raw = e.target.value;
                                            if (raw === '' || raw === '.') { setScannerStopLoss(raw); return; }
                                            const n = parseFloat(raw);
                                            if (!isNaN(n) && n >= 0) {
                                                setScannerStopLoss(n);
                                                scannerStopLossRef.current = n;
                                            }
                                        }}
                                        onBlur={() => {
                                            const n = parseFloat(scannerStopLoss);
                                            const val = isNaN(n) || n < 0 ? 0 : n;
                                            setScannerStopLoss(val);
                                            scannerStopLossRef.current = val;
                                        }}
                                        disabled={isBotRunning}
                                        style={{ ...styles.input, borderColor: '#EF4444' }}
                                        placeholder="0 = off"
                                    />
                                </div>
                            </div>

                            {/* SCANNER STATUS DISPLAY */}
                            <div style={{
                                padding: '14px',
                                borderRadius: '10px',
                                background: scannerStatus === 'TRADING' ? 'rgba(16,185,129,0.12)' :
                                            scannerStatus === 'SCANNING' ? 'rgba(6,182,212,0.12)' :
                                            'rgba(100,116,139,0.10)',
                                border: `1.5px solid ${scannerStatus === 'TRADING' ? '#10B981' : scannerStatus === 'SCANNING' ? '#06B6D4' : '#94A3B8'}`,
                                marginBottom: '14px'
                            }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px' }}>
                                    <div>
                                        <div style={{ fontSize: '13px', fontWeight: '700', color: scannerStatus === 'TRADING' ? '#059669' : scannerStatus === 'SCANNING' ? '#0891B2' : '#64748B' }}>
                                            {scannerStatus === 'IDLE' && '⏸️ IDLE — Press START to begin scanning'}
                                            {scannerStatus === 'SCANNING' && '📡 SCANNING ALL MARKETS...'}
                                            {scannerStatus === 'TRADING' && `🚀 TRADING: ${scannerContractType} on ${scannerActiveSymbol}`}
                                        </div>
                                        {scannerStatus !== 'IDLE' && (
                                            <div style={{ fontSize: '11px', color: '#64748B', marginTop: '4px' }}>
                                                Stake: $${scannerCurrentStake.current.toFixed(2)}
                                                {`${scannerMartingaleCounter.current > 0 ? ` | Martingale: x${scannerMartingaleCounter.current}` : ''}`}
                                                {` | Slot ${scannerSeqIndex + 1}/${scannerSequence.length}: ${scannerSequence[scannerSeqIndex]?.contract || ''}`}
                                            </div>
                                        )}
                                    </div>
                                    <div style={{ display: 'flex', gap: '16px' }}>
                                        <div style={{ textAlign: 'center' }}>
                                            <div style={{ fontSize: '18px', fontWeight: '700', color: '#10B981' }}>{scannerStats.wins}</div>
                                            <div style={{ fontSize: '10px', color: '#64748B' }}>WINS</div>
                                        </div>
                                        <div style={{ textAlign: 'center' }}>
                                            <div style={{ fontSize: '18px', fontWeight: '700', color: '#EF4444' }}>{scannerStats.losses}</div>
                                            <div style={{ fontSize: '10px', color: '#64748B' }}>LOSSES</div>
                                        </div>
                                    </div>
                                </div>
                            </div>

                            {/* LIVE MARKET DIGIT FEED */}
                            {scannerStatus !== 'IDLE' && Object.keys(scannerSymbolDigits).length > 0 && (
                                <div style={{
                                    padding: '12px',
                                    borderRadius: '10px',
                                    background: 'rgba(6,182,212,0.06)',
                                    border: '1px solid rgba(6,182,212,0.2)',
                                    marginBottom: '14px'
                                }}>
                                    <div style={{ fontSize: '11px', fontWeight: '600', color: '#0891B2', marginBottom: '8px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                                        📊 Live Market Digits
                                    </div>
                                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '6px' }}>
                                        {Object.entries(scannerSymbolDigits).slice(0, 8).map(([sym, digits]) => (
                                            <div key={sym} style={{
                                                display: 'flex',
                                                alignItems: 'center',
                                                gap: '6px',
                                                padding: '6px 8px',
                                                borderRadius: '6px',
                                                background: sym === scannerActiveSymbol ? 'rgba(16,185,129,0.15)' : 'rgba(6,182,212,0.08)',
                                                border: `1px solid ${sym === scannerActiveSymbol ? '#10B981' : 'rgba(6,182,212,0.2)'}`
                                            }}>
                                                <span style={{ fontSize: '10px', color: '#0891B2', fontWeight: '600', minWidth: '60px' }}>{sym}</span>
                                                <div style={{ display: 'flex', gap: '3px' }}>
                                                    {(digits || []).slice(0, 5).map((d, i) => (
                                                        <span key={i} style={{
                                                            fontSize: '12px',
                                                            fontWeight: i === 0 ? '700' : '500',
                                                            color: d % 2 === 0 ? '#10B981' : '#EF4444',
                                                            opacity: i === 0 ? 1 : 0.6 - i * 0.1
                                                        }}>{d}</span>
                                                    ))}
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}

                            {/* INFO NOTE */}
                            <div style={{ fontSize: '11px', color: '#64748B', textAlign: 'center', padding: '8px', background: 'rgba(6,182,212,0.05)', borderRadius: '8px' }}>
                                ⚡ No market selection needed — the bot scans all {SCANNER_SYMBOLS.length} volatility markets automatically.<br/>
                                📊 Uses 1-tick contracts for fastest possible entry on detected patterns.
                            </div>
                        </div>
                    )}

                    {/* MANUAL MODE UI */}
                    {mode === 'MANUAL' && (
                        <div style={{
                            background: `${professionalColors.warning}10`,
                            padding: '20px',
                            borderRadius: '16px',
                            border: `2px solid ${professionalColors.warningDark}`,
                            marginBottom: '15px'
                        }}>
                            <div style={{
                                fontSize: '16px',
                                fontWeight: '600',
                                color: professionalColors.warningDark,
                                marginBottom: '15px',
                                textAlign: 'center',
                                textTransform: 'uppercase'
                            }}>
                                {isManualTradePending ? '🔴 TRADE IN PROGRESS...' : '🖐️ MANUAL TRADER - ONE CLICK = ONE TRADE'}
                            </div>

                            <div style={styles.row}>
                                <div style={{ flex: 1 }}>
                                    <label style={styles.label}>STAKE</label>
                                    <input
                                        type="text"
                                        inputMode="decimal"
                                        value={stake}
                                        onChange={e => handleStakeChange(e.target.value)}
                                        onBlur={() => {
                                            if (stake === '' || stake === undefined || stake === null || stake <= 0) {
                                                setStake(1);
                                            }
                                        }}
                                        style={{ ...styles.input, borderColor: professionalColors.warningDark }}
                                        placeholder="0.00"
                                        disabled={isManualTradePending}
                                        readOnly={isManualTradePending}
                                    />
                                </div>
                                <div style={{ flex: 1 }}>
                                    <label style={styles.label}>TICKS</label>
                                    <input
                                        type="text"
                                        inputMode="numeric"
                                        value={ticks}
                                        onChange={e => handleNumberInput(setTicks, e.target.value, 1, undefined, true, 1)}
                                        onBlur={() => {
                                            if (ticks === '' || ticks === undefined || ticks === null || ticks <= 0) {
                                                setTicks(1);
                                            }
                                        }}
                                        style={{ ...styles.input, borderColor: professionalColors.warningDark }}
                                        disabled={isManualTradePending}
                                        readOnly={isManualTradePending}
                                    />
                                </div>
                                <div style={{ flex: 1 }}>
                                    <label style={styles.label}>TYPE</label>
                                    <select
                                        value={contractType}
                                        onChange={e => setContractType(e.target.value)}
                                        style={{ ...styles.select, borderColor: professionalColors.warningDark }}
                                        disabled={isManualTradePending}
                                    >
                                        <option value="CALL">📈 RISE</option>
                                        <option value="PUT">📉 FALL</option>
                                        <option value="DIGITOVER">⬆️ OVER</option>
                                        <option value="DIGITUNDER">⬇️ UNDER</option>
                                        <option value="DIGITEVEN">🟰 EVEN</option>
                                        <option value="DIGITODD">🎲 ODD</option>
                                        <option value="DIGITMATCH">✓ MATCH</option>
                                        <option value="DIGITDIFF">≠ DIFF</option>
                                    </select>
                                </div>
                            </div>

                            {needsPrediction(contractType) && (
                                <div style={styles.row}>
                                    <div style={{ flex: 1 }}>
                                        <label style={styles.label}>PREDICTION (0-9)</label>
                                        <input
                                            type="text"
                                            inputMode="numeric"
                                            value={pred1 === undefined || pred1 === null ? '' : pred1}
                                            onChange={e => handlePredictionInput(setPred1, e.target.value)}
                                            onBlur={() => {
                                                if (pred1 === '' || pred1 === undefined || pred1 === null) {
                                                    setPred1(0);
                                                }
                                            }}
                                            style={{ ...styles.input, borderColor: professionalColors.warningDark }}
                                            disabled={isManualTradePending}
                                            readOnly={isManualTradePending}
                                            placeholder="0-9"
                                        />
                                    </div>
                                    <div style={{ flex: 1 }}>
                                        <label style={styles.label}>MARKET</label>
                                        <select
                                            value={symbol}
                                            onChange={e => setSymbol(e.target.value)}
                                            style={{ ...styles.select, borderColor: professionalColors.warningDark }}
                                            disabled={isManualTradePending}
                                        >
                                            {marketOptions.map(v => (
                                                <option key={v.value} value={v.value}>{v.text}</option>
                                            ))}
                                        </select>
                                    </div>
                                </div>
                            )}

                            <div style={{ textAlign: 'center', marginTop: '15px' }}>
                                <button
                                    onClick={(e) => {
                                        if (!('ontouchstart' in window)) {
                                            toggleBot(e);
                                        }
                                    }}
                                    onTouchStart={(e) => {
                                        e.currentTarget.style.opacity = '0.8';
                                        e.currentTarget.style.transform = 'scale(0.97)';
                                        touchMoved.current = false;
                                    }}
                                    onTouchMove={(e) => {
                                        touchMoved.current = true;
                                    }}
                                    onTouchEnd={(e) => {
                                        e.preventDefault();
                                        e.currentTarget.style.opacity = '1';
                                        e.currentTarget.style.transform = 'scale(1)';
                                        if (!touchMoved.current) {
                                            toggleBot(e);
                                        }
                                        touchMoved.current = false;
                                    }}
                                    onTouchCancel={(e) => {
                                        e.currentTarget.style.opacity = '1';
                                        e.currentTarget.style.transform = 'scale(1)';
                                        touchMoved.current = false;
                                    }}
                                    disabled={!is_logged_in || isManualTradePending}
                                    style={{
                                        ...styles.startBtn,
                                        background: !is_logged_in ? professionalColors.gray : 
                                                    (isManualTradePending ? professionalColors.danger : 
                                                     (isBotRunning ? professionalColors.danger : professionalColors.warningDark)),
                                        width: '100%',
                                        opacity: isManualTradePending ? 1 : 1,
                                        transform: isManualTradePending ? 'scale(0.98)' : 'scale(1)',
                                        animation: isManualTradePending ? 'pulse 1.5s infinite' : 'none',
                                        cursor: (!is_logged_in || isManualTradePending) ? 'not-allowed' : 'pointer',
                                    }}
                                >
                                    {!is_logged_in ? '🔒 LOGIN REQUIRED' : 
                                     isManualTradePending ? '🔴 PROCESSING TRADE...' : 
                                     (isBotRunning ? '❌ CANCEL TRADE' : '🚀 PLACE TRADE NOW')}
                                </button>
                                <div style={{
                                    fontSize: '12px',
                                    color: professionalColors.gray,
                                    marginTop: '8px'
                                }}>
                                    {!is_logged_in ? 'Please login to Deriv first' : 
                                     isManualTradePending ? 'Trade is being processed...' : 
                                     (isBotRunning ? 'Processing your trade...' : 'Click to execute one trade instantly')}
                                </div>
                            </div>
                        </div>
                    )}

                    {/* DUAL MODE UI */}
                    {mode === 'DUAL' && (
                        <>
                            <div style={styles.row}>
                                <div style={{ flex: 0.5 }}>
                                    <label style={styles.label}>TICKS</label>
                                    <input
                                        type="text"
                                        inputMode="numeric"
                                        value={ticks}
                                        onChange={e => handleNumberInput(setTicks, e.target.value, 1, undefined, true, 1)}
                                        onBlur={() => {
                                            if (ticks === '' || ticks === undefined || ticks === null || ticks <= 0) {
                                                setTicks(1);
                                            }
                                        }}
                                        style={{ ...styles.input, borderColor: professionalColors.success }}
                                    />
                                </div>
                            </div>

                            {/* DUAL TYPE 1 TRIGGER METHOD - DROPDOWN */}
                            <div style={{
                                marginTop: '12px',
                                marginBottom: '12px',
                                padding: '12px',
                                background: `${professionalColors.success}20`,
                                borderRadius: '8px'
                            }}>
                                <label style={{ fontSize: '12px', fontWeight: '600', color: professionalColors.successDark, marginBottom: '8px', display: 'block' }}>
                                    ⚡ TYPE 1 TRIGGER METHOD
                                </label>
                                <select
                                    value={dualTriggerMode}
                                    onChange={e => setDualTriggerMode(e.target.value)}
                                    disabled={isBotRunning}
                                    style={{
                                        width: '100%',
                                        padding: isMobile ? '14px' : '12px',
                                        borderRadius: '10px',
                                        border: `2px solid ${professionalColors.success}`,
                                        fontSize: isMobile ? '14px' : '13px',
                                        fontWeight: '600',
                                        outline: 'none',
                                        background: professionalColors.surface,
                                        color: professionalColors.text,
                                        cursor: isBotRunning ? 'not-allowed' : 'pointer',
                                        opacity: isBotRunning ? 0.6 : 1,
                                        WebkitAppearance: 'none',
                                        backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 12 12'%3E%3Cpath fill='%2364748B' d='M6 8L1 3h10z'/%3E%3C/svg%3E")`,
                                        backgroundRepeat: 'no-repeat',
                                        backgroundPosition: 'right 12px center',
                                        paddingRight: '36px',
                                        marginBottom: '12px'
                                    }}
                                >
                                    <option value="TRIGGER">🎯 DIGIT TRIGGER (Trigger on specific digits)</option>
                                    <option value="VLOSS">📉 V-LOSS (Trigger after streak)</option>
                                </select>

                                {dualTriggerMode === 'TRIGGER' ? (
                                    <div>
                                        <label style={{ fontSize: '11px', fontWeight: '600', color: professionalColors.successDark, marginBottom: '5px', display: 'block' }}>
                                            TRIGGER DIGITS (0-9, comma-separated)
                                        </label>
                                        <input
                                            type="text"
                                            value={triggers}
                                            onChange={e => handleDigitInput(setTriggers, e.target.value)}
                                            style={{
                                                width: '100%',
                                                padding: isMobile ? '12px' : '10px',
                                                borderRadius: '8px',
                                                border: `1.5px solid ${professionalColors.success}`,
                                                fontSize: isMobile ? '14px' : '13px',
                                                outline: 'none',
                                                background: professionalColors.surface,
                                                color: professionalColors.text,
                                            }}
                                            placeholder="e.g., 8,9"
                                            disabled={isBotRunning}
                                        />
                                        <div style={{ fontSize: '10px', color: professionalColors.gray, marginTop: '4px' }}>
                                            Bot triggers Type 1 when digit matches any of these values (0-9 only)
                                        </div>
                                    </div>
                                ) : (
                                    <div>
                                        <div style={styles.row}>
                                            <div style={{ flex: 1 }}>
                                                <label style={{ fontSize: '11px', fontWeight: '600', color: professionalColors.successDark, marginBottom: '5px', display: 'block' }}>
                                                    V-LOSS LIMIT (Type 1)
                                                </label>
                                                <input
                                                    type="text"
                                                    inputMode="numeric"
                                                    value={vLossLimit}
                                                    onChange={e => handleNumberInput(setVLossLimit, e.target.value, 1, undefined, true, 1)}
                                                    onBlur={() => {
                                                        if (vLossLimit === '' || vLossLimit === undefined || vLossLimit === null || vLossLimit < 1) {
                                                            setVLossLimit(1);
                                                        }
                                                    }}
                                                    style={{
                                                        width: '100%',
                                                        padding: isMobile ? '12px' : '10px',
                                                        borderRadius: '8px',
                                                        border: `1.5px solid ${professionalColors.success}`,
                                                        fontSize: isMobile ? '14px' : '13px',
                                                        outline: 'none',
                                                        background: professionalColors.surface,
                                                        color: professionalColors.text,
                                                    }}
                                                    disabled={isBotRunning}
                                                />
                                            </div>
                                            <div style={{ flex: 1 }}>
                                                <label style={{ fontSize: '11px', fontWeight: '600', color: professionalColors.successDark, marginBottom: '5px', display: 'block' }}>
                                                    CURRENT V-LOSS
                                                </label>
                                                <div style={{
                                                    width: '100%',
                                                    padding: isMobile ? '12px' : '10px',
                                                    borderRadius: '8px',
                                                    background: vCounterDisplay > 0 ? professionalColors.warning : professionalColors.success,
                                                    color: 'white',
                                                    fontWeight: '600',
                                                    textAlign: 'center',
                                                    border: 'none',
                                                }}>
                                                    {vCounterDisplay}/{vLossLimit}
                                                </div>
                                            </div>
                                        </div>
                                        <div style={{ fontSize: '10px', color: professionalColors.gray, marginTop: '4px' }}>
                                            V-Loss tracks consecutive losses based on Type 1 contract
                                        </div>
                                    </div>
                                )}
                            </div>

                            {/* COMMON STAKE */}
                            <div style={{
                                background: `${professionalColors.success}10`,
                                padding: '16px',
                                borderRadius: '12px',
                                marginBottom: '10px',
                                border: `2px solid ${professionalColors.success}`
                            }}>
                                <div style={{ fontSize: '14px', fontWeight: '600', color: professionalColors.successDark, marginBottom: '10px', textAlign: 'center' }}>
                                    COMMON STAKE FOR BOTH TYPES
                                </div>
                                <div style={styles.row}>
                                    <div style={{ flex: 1 }}>
                                        <label style={{ fontSize: '12px', fontWeight: '600', color: professionalColors.successDark }}>BASE STAKE</label>
                                        <input
                                            type="text"
                                            inputMode="decimal"
                                            value={stake}
                                            onChange={e => handleStakeChange(e.target.value)}
                                            onBlur={() => {
                                                if (stake === '' || stake === undefined || stake === null || stake <= 0) {
                                                    setStake(1);
                                                }
                                            }}
                                            style={{ ...styles.input, borderColor: professionalColors.success }}
                                            placeholder="0.00"
                                            readOnly={isBotRunning}
                                        />
                                    </div>
                                    <div style={{ flex: 1 }}>
                                        <label style={{ fontSize: '12px', fontWeight: '600', color: professionalColors.successDark }}>CURRENT STAKE</label>
                                        <div style={{
                                            ...styles.input,
                                            background: currentDualStake.current > parseFloat(stake) ? professionalColors.warning : professionalColors.success,
                                            color: 'white',
                                            fontWeight: '600',
                                            textAlign: 'center',
                                            border: 'none',
                                            padding: isMobile ? '16px' : '12px',
                                        }}>
                                            ${currentDualStake.current.toFixed(2)}
                                            {dualMartingaleCounter.current > 0 && ` (M:${dualMartingaleCounter.current})`}
                                        </div>
                                    </div>
                                </div>
                            </div>

                            {/* TYPE 1 CONTRACT */}
                            <div style={styles.row}>
                                <div style={{ flex: 1 }}>
                                    <label style={styles.label}>TYPE 1 CONTRACT</label>
                                    <select
                                        value={dualPred1}
                                        onChange={e => setDualPred1(e.target.value)}
                                        style={{ ...styles.select, borderColor: professionalColors.success }}
                                    >
                                        <option value="CALL">📈 RISE (CALL)</option>
                                        <option value="PUT">📉 FALL (PUT)</option>
                                        <option value="DIGITEVEN">🟰 EVEN</option>
                                        <option value="DIGITODD">🎲 ODD</option>
                                        <option value="DIGITOVER">⬆️ OVER</option>
                                        <option value="DIGITUNDER">⬇️ UNDER</option>
                                        <option value="DIGITMATCH">✓ MATCH</option>
                                        <option value="DIGITDIFF">≠ DIFF</option>
                                    </select>
                                </div>
                                {['DIGITOVER', 'DIGITUNDER', 'DIGITDIFF', 'DIGITMATCH'].includes(dualPred1) && (
                                    <div style={{ flex: 0.5 }}>
                                        <label style={styles.label}>PREDICTION (0-9)</label>
                                        <input
                                            type="text"
                                            inputMode="numeric"
                                            value={dualTarget1 === undefined || dualTarget1 === null ? '' : dualTarget1}
                                            onChange={e => handlePredictionInput(setDualTarget1, e.target.value)}
                                            onBlur={() => {
                                                if (dualTarget1 === '' || dualTarget1 === undefined || dualTarget1 === null) {
                                                    setDualTarget1(0);
                                                }
                                            }}
                                            style={{ ...styles.input, borderColor: professionalColors.success }}
                                            readOnly={isBotRunning}
                                            placeholder="0-9"
                                        />
                                    </div>
                                )}
                            </div>

                            {/* TYPE 2 CONTRACT (RECOVERY) */}
                            <div style={{
                                ...styles.row,
                                background: `${professionalColors.warning}10`,
                                padding: '10px',
                                borderRadius: '8px',
                                marginTop: '5px'
                            }}>
                                <div style={{ flex: 1 }}>
                                    <label style={{ ...styles.label, color: professionalColors.warning }}>TYPE 2 CONTRACT (RECOVERY)</label>
                                    <select
                                        value={dualPred2}
                                        onChange={e => setDualPred2(e.target.value)}
                                        style={{ ...styles.select, borderColor: professionalColors.warning }}
                                    >
                                        <option value="CALL">📈 RISE (CALL)</option>
                                        <option value="PUT">📉 FALL (PUT)</option>
                                        <option value="DIGITEVEN">🟰 EVEN</option>
                                        <option value="DIGITODD">🎲 ODD</option>
                                        <option value="DIGITOVER">⬆️ OVER</option>
                                        <option value="DIGITUNDER">⬇️ UNDER</option>
                                        <option value="DIGITMATCH">✓ MATCH</option>
                                        <option value="DIGITDIFF">≠ DIFF</option>
                                    </select>
                                </div>
                                {['DIGITOVER', 'DIGITUNDER', 'DIGITDIFF', 'DIGITMATCH'].includes(dualPred2) && (
                                    <div style={{ flex: 0.5 }}>
                                        <label style={{ ...styles.label, color: professionalColors.warning }}>PREDICTION (0-9)</label>
                                        <input
                                            type="text"
                                            inputMode="numeric"
                                            value={dualTarget2 === undefined || dualTarget2 === null ? '' : dualTarget2}
                                            onChange={e => handlePredictionInput(setDualTarget2, e.target.value)}
                                            onBlur={() => {
                                                if (dualTarget2 === '' || dualTarget2 === undefined || dualTarget2 === null) {
                                                    setDualTarget2(0);
                                                }
                                            }}
                                            style={{ ...styles.input, borderColor: professionalColors.warning }}
                                            readOnly={isBotRunning}
                                            placeholder="0-9"
                                        />
                                    </div>
                                )}
                            </div>

                            {/* MARTINGALE & RISK */}
                            <div style={styles.row}>
                                <div style={{ flex: 1.2 }}>
                                    <label style={styles.label}>MARTINGALE MULTIPLIER</label>
                                    <input 
                                        type="text"
                                        inputMode="decimal"
                                        value={martingale} 
                                        onChange={e => handleNumberInput(setMartingale, e.target.value, 1, undefined, true, 1)}
                                        onBlur={() => {
                                            if (martingale === '' || martingale === undefined || martingale === null || martingale < 1) {
                                                setMartingale(1);
                                            }
                                        }}
                                        style={getInputStyle(false)} 
                                        readOnly={isBotRunning}
                                    />
                                </div>
                                <div style={{ flex: 0.8 }}>
                                    <label style={styles.label}>LIMIT</label>
                                    <input 
                                        type="text"
                                        inputMode="numeric"
                                        value={martingaleLimit} 
                                        onChange={e => handleNumberInput(setMartingaleLimit, e.target.value, 0, undefined, true, 0)}
                                        onBlur={() => {
                                            if (martingaleLimit === '' || martingaleLimit === undefined || martingaleLimit === null) {
                                                setMartingaleLimit(0);
                                            }
                                        }}
                                        style={getInputStyle(false)} 
                                        readOnly={isBotRunning}
                                    />
                                </div>
                                <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: '5px', justifyContent: 'flex-end' }}>
                                    <label style={styles.label}>ENABLE</label>
                                    <div onClick={() => setDualMartingaleEnabled(!dualMartingaleEnabled)} style={{
                                        width: '52px', height: '28px', background: dualMartingaleEnabled ? professionalColors.success : professionalColors.danger,
                                        borderRadius: '14px', position: 'relative', cursor: 'pointer',
                                        touchAction: 'manipulation',
                                    }}>
                                        <div style={{
                                            width: '24px', height: '24px', background: '#fff', borderRadius: '50%',
                                            position: 'absolute', top: '2px', left: dualMartingaleEnabled ? '26px' : '2px',
                                            transition: 'left 0.2s'
                                        }}></div>
                                    </div>
                                    <span style={{ fontSize: '14px', color: dualMartingaleEnabled ? professionalColors.success : professionalColors.danger }}>
                                        {dualMartingaleEnabled ? 'ON' : 'OFF'}
                                    </span>
                                </div>
                            </div>

                            {/* TAKE PROFIT / STOP LOSS */}
                            <div style={styles.row}>
                                <div style={{ flex: 1 }}>
                                    <label style={styles.label}>TAKE PROFIT</label>
                                    <input 
                                        type="text"
                                        inputMode="decimal"
                                        value={takeProfit} 
                                        onChange={e => handleNumberInput(setTakeProfit, e.target.value, 0, undefined, true, 0)}
                                        onBlur={() => {
                                            if (takeProfit === '' || takeProfit === undefined || takeProfit === null) {
                                                setTakeProfit(0);
                                            }
                                        }}
                                        style={getInputStyle(false)} 
                                        readOnly={isBotRunning}
                                    />
                                </div>
                                <div style={{ flex: 1 }}>
                                    <label style={styles.label}>STOP LOSS</label>
                                    <input 
                                        type="text"
                                        inputMode="decimal"
                                        value={stopLoss} 
                                        onChange={e => handleNumberInput(setStopLoss, e.target.value, 0, undefined, true, 0)}
                                        onBlur={() => {
                                            if (stopLoss === '' || stopLoss === undefined || stopLoss === null) {
                                                setStopLoss(0);
                                            }
                                        }}
                                        style={getInputStyle(false)} 
                                        readOnly={isBotRunning}
                                    />
                                </div>
                            </div>

                            {/* STATUS DISPLAY */}
                            <div style={{
                                display: 'flex',
                                justifyContent: 'space-between',
                                marginTop: '10px',
                                padding: '8px',
                                background: dualRecoveryMode ? `${professionalColors.warning}10` : `${professionalColors.success}10`,
                                borderRadius: '8px',
                                fontSize: '12px'
                            }}>
                                <span style={{ color: dualRecoveryMode ? professionalColors.warning : professionalColors.success }}>
                                    {dualRecoveryMode ? '🔄 RECOVERY MODE ACTIVE' : '✅ NORMAL MODE'}
                                    {dualTradeLocked.current && ' ⏳ Waiting for result'}
                                </span>
                                <span>Current Stake: ${currentDualStake.current.toFixed(2)} {dualMartingaleCounter.current > 0 ? `(M:${dualMartingaleCounter.current}/${martingaleLimit === 0 ? '∞' : martingaleLimit})` : ''}</span>
                            </div>
                        </>
                    )}

                    {/* OVER/UNDER HEDGE MODE UI */}
                    {mode === 'OVER_UNDER_HEDGE' && (
                        <div style={{
                            background: `${professionalColors.purple}10`,
                            padding: '16px',
                            borderRadius: '12px',
                            border: `2px solid ${professionalColors.purple}`,
                            marginBottom: '15px'
                        }}>
                            <div style={{
                                fontSize: '16px',
                                fontWeight: '600',
                                color: professionalColors.purpleDark,
                                marginBottom: '15px',
                                textAlign: 'center',
                                textTransform: 'uppercase'
                            }}>
                                🛡️ HEDGE BOT - CONFIGURABLE TRIGGERS
                            </div>

                            <div style={styles.row}>
                                <div style={{ flex: 1 }}>
                                    <label style={{ fontSize: '12px', fontWeight: '600', color: professionalColors.purpleDark }}>TRIGGER DIGITS (0-9, comma-separated)</label>
                                    <input
                                        type="text"
                                        value={hedgeTriggers}
                                        onChange={e => handleDigitInput(setHedgeTriggers, e.target.value)}
                                        style={{ ...styles.input, borderColor: professionalColors.purple }}
                                        placeholder="e.g., 4,5"
                                        readOnly={isBotRunning}
                                    />
                                    <div style={{ fontSize: '10px', color: professionalColors.gray, marginTop: '2px' }}>
                                        Bot triggers when digit matches any of these values (0-9 only)
                                    </div>
                                </div>
                                <div style={{ flex: 1, display: 'flex', alignItems: 'flex-end', paddingBottom: '2px' }}>
                                    <div style={{
                                        background: `${professionalColors.purple}10`,
                                        border: `1px solid ${professionalColors.purple}`,
                                        borderRadius: '8px',
                                        padding: '8px',
                                        fontSize: '12px',
                                        color: professionalColors.purpleDark,
                                        width: '100%',
                                        textAlign: 'center'
                                    }}>
                                        When triggered:<br/>
                                        ⬆️ OVER 5 + ⬇️ UNDER 4
                                    </div>
                                </div>
                            </div>

                            <div style={styles.row}>
                                <div style={{ flex: 1 }}>
                                    <label style={{ fontSize: '12px', fontWeight: '600', color: professionalColors.purpleDark }}>HEDGE STAKE (BOTH TRADES)</label>
                                    <input 
                                        type="text"
                                        inputMode="decimal"
                                        value={hedgeStake} 
                                        onChange={e => {
                                            const val = e.target.value;
                                            if (val === '' || val === '-') {
                                                setHedgeStake('');
                                                return;
                                            }
                                            if (val === '.') {
                                                setHedgeStake('0.');
                                                return;
                                            }
                                            const num = parseFloat(val);
                                            if (!isNaN(num) && num > 0) {
                                                setHedgeStake(num);
                                                currentHedgeStake.current = num;
                                            }
                                        }}
                                        onBlur={() => {
                                            if (hedgeStake === '' || hedgeStake === undefined || hedgeStake === null || hedgeStake <= 0) {
                                                setHedgeStake(1);
                                                currentHedgeStake.current = 1;
                                            } else {
                                                const num = parseFloat(hedgeStake);
                                                if (!isNaN(num) && num > 0) {
                                                    setHedgeStake(num);
                                                    currentHedgeStake.current = num;
                                                }
                                            }
                                        }}
                                        style={{ ...styles.input, borderColor: professionalColors.purple }} 
                                        placeholder="0.00"
                                        readOnly={isBotRunning} 
                                    />
                                </div>
                                <div style={{ flex: 1 }}>
                                    <label style={{ fontSize: '12px', fontWeight: '600', color: professionalColors.purpleDark }}>TICKS</label>
                                    <input 
                                        type="text"
                                        inputMode="numeric"
                                        value={ticks} 
                                        onChange={e => handleNumberInput(setTicks, e.target.value, 1, undefined, true, 1)}
                                        onBlur={() => {
                                            if (ticks === '' || ticks === undefined || ticks === null || ticks <= 0) {
                                                setTicks(1);
                                            }
                                        }}
                                        style={{ ...styles.input, borderColor: professionalColors.purple }} 
                                        readOnly={isBotRunning} 
                                    />
                                </div>
                            </div>

                            <div style={styles.row}>
                                <div style={{ flex: 1.2 }}>
                                    <label style={{ fontSize: '12px', fontWeight: '600', color: professionalColors.purpleDark }}>MARTINGALE</label>
                                    <input 
                                        type="text"
                                        inputMode="decimal"
                                        value={hedgeMartingale} 
                                        onChange={e => handleNumberInput(setHedgeMartingale, e.target.value, 1, undefined, true, 1)}
                                        onBlur={() => {
                                            if (hedgeMartingale === '' || hedgeMartingale === undefined || hedgeMartingale === null || hedgeMartingale < 1) {
                                                setHedgeMartingale(1);
                                            }
                                        }}
                                        style={{ ...styles.input, borderColor: professionalColors.purple }} 
                                        placeholder="1.0"
                                        readOnly={isBotRunning} 
                                    />
                                </div>
                                <div style={{ flex: 0.8 }}>
                                    <label style={{ fontSize: '12px', fontWeight: '600', color: professionalColors.purpleDark }}>LIMIT</label>
                                    <input 
                                        type="text"
                                        inputMode="numeric"
                                        value={hedgeMartingaleLimit} 
                                        onChange={e => handleNumberInput(setHedgeMartingaleLimit, e.target.value, 0, undefined, true, 0)}
                                        onBlur={() => {
                                            if (hedgeMartingaleLimit === '' || hedgeMartingaleLimit === undefined || hedgeMartingaleLimit === null) {
                                                setHedgeMartingaleLimit(0);
                                            }
                                        }}
                                        style={{ ...styles.input, borderColor: professionalColors.purple }} 
                                        readOnly={isBotRunning} 
                                    />
                                </div>
                            </div>

                            <div style={styles.row}>
                                <div style={{ flex: 1 }}>
                                    <label style={{ fontSize: '12px', fontWeight: '600', color: professionalColors.purpleDark }}>TAKE PROFIT</label>
                                    <input 
                                        type="text"
                                        inputMode="decimal"
                                        value={takeProfit} 
                                        onChange={e => handleNumberInput(setTakeProfit, e.target.value, 0, undefined, true, 0)}
                                        onBlur={() => {
                                            if (takeProfit === '' || takeProfit === undefined || takeProfit === null) {
                                                setTakeProfit(0);
                                            }
                                        }}
                                        style={{ ...styles.input, borderColor: professionalColors.purple }} 
                                        readOnly={isBotRunning} 
                                    />
                                </div>
                                <div style={{ flex: 1 }}>
                                    <label style={{ fontSize: '12px', fontWeight: '600', color: professionalColors.purpleDark }}>STOP LOSS</label>
                                    <input 
                                        type="text"
                                        inputMode="decimal"
                                        value={stopLoss} 
                                        onChange={e => handleNumberInput(setStopLoss, e.target.value, 0, undefined, true, 0)}
                                        onBlur={() => {
                                            if (stopLoss === '' || stopLoss === undefined || stopLoss === null) {
                                                setStopLoss(0);
                                            }
                                        }}
                                        style={{ ...styles.input, borderColor: professionalColors.purple }} 
                                        readOnly={isBotRunning} 
                                    />
                                </div>
                            </div>

                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: '10px' }}>
                                <label style={{ fontSize: '12px', fontWeight: '600', color: professionalColors.purpleDark }}>ENABLE MARTINGALE</label>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                                    <div onClick={() => setHedgeMartingaleEnabled(!hedgeMartingaleEnabled)} style={{
                                        width: '52px', height: '28px', background: hedgeMartingaleEnabled ? professionalColors.success : professionalColors.danger,
                                        borderRadius: '14px', position: 'relative', cursor: 'pointer',
                                        touchAction: 'manipulation',
                                    }}>
                                        <div style={{
                                            width: '24px', height: '24px', background: '#fff', borderRadius: '50%',
                                            position: 'absolute', top: '2px', left: hedgeMartingaleEnabled ? '26px' : '2px',
                                            transition: 'left 0.3s ease'
                                        }}></div>
                                    </div>
                                    <span style={{ fontSize: '14px', color: hedgeMartingaleEnabled ? professionalColors.success : professionalColors.danger, fontWeight: '600' }}>
                                        {hedgeMartingaleEnabled ? 'ON' : 'OFF'}
                                    </span>
                                </div>
                            </div>

                            <div style={{
                                display: 'flex',
                                justifyContent: 'space-between',
                                marginTop: '15px',
                                padding: '12px',
                                background: `${professionalColors.purple}10`,
                                borderRadius: '8px',
                                fontSize: '13px',
                                fontWeight: '600'
                            }}>
                                <span style={{ color: professionalColors.purpleDark }}>Current Stake: ${currentHedgeStake.current.toFixed(2)} each</span>
                                {hedgeMartingaleEnabled && hedgeMartingaleCounter.current > 0 && (
                                    <span style={{ color: professionalColors.warning }}>M: {hedgeMartingaleCounter.current}/{hedgeMartingaleLimit === 0 ? '∞' : hedgeMartingaleLimit}</span>
                                )}
                                {hedgeTradePending.current && <span style={{ color: professionalColors.purple }}>⏳ Pending</span>}
                            </div>
                        </div>
                    )}

                    {/* STABLE/AGGRESSIVE MODES UI */}
                    {(mode === 'STABLE' || mode === 'AGGRESSIVE') && (
                        <>
                            <div style={styles.row}>
                                <div style={{ flex: 1.5 }}>
                                    <label style={styles.label}>STAKE</label>
                                    <input
                                        type="text"
                                        inputMode="decimal"
                                        value={stake}
                                        onChange={e => handleStakeChange(e.target.value)}
                                        onBlur={() => {
                                            if (stake === '' || stake === undefined || stake === null || stake <= 0) {
                                                setStake(1);
                                            }
                                        }}
                                        style={getInputStyle(false)}
                                        placeholder="0.00"
                                        readOnly={isBotRunning}
                                    />
                                </div>
                                <div style={{ flex: 1 }}>
                                    <label style={styles.label}>BULK</label>
                                    <input
                                        type="text"
                                        inputMode="numeric"
                                        value={mode === 'AGGRESSIVE' ? "1 (LOCKED)" : bulkNumber}
                                        disabled={mode === 'AGGRESSIVE'}
                                        onChange={e => {
                                            if (mode !== 'AGGRESSIVE') {
                                                const val = e.target.value;
                                                if (val === '' || val === '-') {
                                                    setBulkNumber('');
                                                    return;
                                                }
                                                const num = parseInt(val);
                                                if (!isNaN(num) && num >= 1) {
                                                    setBulkNumber(num);
                                                }
                                            }
                                        }}
                                        onBlur={() => {
                                            if (mode !== 'AGGRESSIVE' && (bulkNumber === '' || bulkNumber === undefined || bulkNumber === null || bulkNumber < 1)) {
                                                setBulkNumber(1);
                                            }
                                        }}
                                        style={getInputStyle(mode === 'AGGRESSIVE')}
                                        placeholder="1"
                                        readOnly={isBotRunning}
                                    />
                                </div>
                                <div style={{ flex: 1 }}>
                                    <label style={styles.label}>TICKS</label>
                                    <input 
                                        type="text"
                                        inputMode="numeric"
                                        value={ticks} 
                                        onChange={e => handleNumberInput(setTicks, e.target.value, 1, undefined, true, 1)}
                                        onBlur={() => {
                                            if (ticks === '' || ticks === undefined || ticks === null || ticks <= 0) {
                                                setTicks(1);
                                            }
                                        }}
                                        style={getInputStyle(false)} 
                                        readOnly={isBotRunning}
                                    />
                                </div>
                            </div>

                            {/* TRIGGER METHOD SELECTION - DROPDOWN */}
                            <div style={{
                                marginTop: '12px',
                                marginBottom: '12px',
                                padding: '12px',
                                background: `${mode === 'AGGRESSIVE' ? professionalColors.danger : professionalColors.primary}20`,
                                borderRadius: '8px'
                            }}>
                                <label style={{ fontSize: '12px', fontWeight: '600', color: mode === 'AGGRESSIVE' ? professionalColors.danger : professionalColors.primary, marginBottom: '8px', display: 'block' }}>
                                    ⚡ SELECT TRIGGER METHOD
                                </label>
                                <select
                                    value={triggerMode}
                                    onChange={e => setTriggerMode(e.target.value)}
                                    disabled={isBotRunning}
                                    style={{
                                        width: '100%',
                                        padding: isMobile ? '14px' : '12px',
                                        borderRadius: '10px',
                                        border: `2px solid ${mode === 'AGGRESSIVE' ? professionalColors.danger : professionalColors.primary}`,
                                        fontSize: isMobile ? '14px' : '13px',
                                        fontWeight: '600',
                                        outline: 'none',
                                        background: professionalColors.surface,
                                        color: professionalColors.text,
                                        cursor: isBotRunning ? 'not-allowed' : 'pointer',
                                        opacity: isBotRunning ? 0.6 : 1,
                                        WebkitAppearance: 'none',
                                        backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 12 12'%3E%3Cpath fill='%2364748B' d='M6 8L1 3h10z'/%3E%3C/svg%3E")`,
                                        backgroundRepeat: 'no-repeat',
                                        backgroundPosition: 'right 12px center',
                                        paddingRight: '36px',
                                        marginBottom: '12px'
                                    }}
                                >
                                    <option value="VLOSS">📉 V-LOSS (Trigger after streak)</option>
                                    <option value="TRIGGER">🎯 DIGIT TRIGGER (Trigger on specific digits)</option>
                                </select>

                                {triggerMode === 'TRIGGER' ? (
                                    <div>
                                        <label style={{ fontSize: '11px', fontWeight: '600', color: mode === 'AGGRESSIVE' ? professionalColors.danger : professionalColors.primary, marginBottom: '5px', display: 'block' }}>
                                            TRIGGER DIGITS (0-9, comma-separated)
                                        </label>
                                        <input
                                            type="text"
                                            value={triggers}
                                            onChange={e => handleDigitInput(setTriggers, e.target.value)}
                                            style={{
                                                width: '100%',
                                                padding: isMobile ? '12px' : '10px',
                                                borderRadius: '8px',
                                                border: `1.5px solid ${mode === 'AGGRESSIVE' ? professionalColors.danger : professionalColors.primary}`,
                                                fontSize: isMobile ? '14px' : '13px',
                                                outline: 'none',
                                                background: professionalColors.surface,
                                                color: professionalColors.text,
                                            }}
                                            placeholder="e.g., 8,9"
                                            disabled={isBotRunning}
                                        />
                                        <div style={{ fontSize: '10px', color: professionalColors.gray, marginTop: '4px' }}>
                                            Bot triggers when digit matches any of these values (0-9 only)
                                        </div>
                                    </div>
                                ) : (
                                    <div>
                                        <div style={styles.row}>
                                            <div style={{ flex: 1 }}>
                                                <label style={{ fontSize: '11px', fontWeight: '600', color: mode === 'AGGRESSIVE' ? professionalColors.danger : professionalColors.primary, marginBottom: '5px', display: 'block' }}>
                                                    V-LOSS LIMIT
                                                </label>
                                                <input
                                                    type="text"
                                                    inputMode="numeric"
                                                    value={vLossLimit}
                                                    onChange={e => handleNumberInput(setVLossLimit, e.target.value, 1, undefined, true, 1)}
                                                    onBlur={() => {
                                                        if (vLossLimit === '' || vLossLimit === undefined || vLossLimit === null || vLossLimit < 1) {
                                                            setVLossLimit(1);
                                                        }
                                                    }}
                                                    style={{
                                                        width: '100%',
                                                        padding: isMobile ? '12px' : '10px',
                                                        borderRadius: '8px',
                                                        border: `1.5px solid ${mode === 'AGGRESSIVE' ? professionalColors.danger : professionalColors.primary}`,
                                                        fontSize: isMobile ? '14px' : '13px',
                                                        outline: 'none',
                                                        background: professionalColors.surface,
                                                        color: professionalColors.text,
                                                    }}
                                                    disabled={isBotRunning}
                                                />
                                            </div>
                                            <div style={{ flex: 1 }}>
                                                <label style={{ fontSize: '11px', fontWeight: '600', color: mode === 'AGGRESSIVE' ? professionalColors.danger : professionalColors.primary, marginBottom: '5px', display: 'block' }}>
                                                    CURRENT V-LOSS STREAK
                                                </label>
                                                <div style={{
                                                    width: '100%',
                                                    padding: isMobile ? '12px' : '10px',
                                                    borderRadius: '8px',
                                                    background: vCounterDisplay > 0 ? professionalColors.warning : professionalColors.success,
                                                    color: 'white',
                                                    fontWeight: '600',
                                                    textAlign: 'center',
                                                    border: 'none',
                                                }}>
                                                    {vCounterDisplay}/{vLossLimit}
                                                </div>
                                            </div>
                                        </div>
                                        <div style={{ fontSize: '10px', color: professionalColors.gray, marginTop: '4px' }}>
                                            V-Loss tracks consecutive losses based on your contract type
                                        </div>
                                    </div>
                                )}
                            </div>

                            {/* BURST LIMIT */}
                            <div style={styles.row}>
                                <div style={{ flex: 1 }}>
                                    <label style={styles.label}>BURST LIMIT (ticks)</label>
                                    <input
                                        type="text"
                                        inputMode="numeric"
                                        value={tickLimit}
                                        onChange={e => handleNumberInput(setTickLimit, e.target.value, 0, undefined, true, 0)}
                                        onBlur={() => {
                                            if (tickLimit === '' || tickLimit === undefined || tickLimit === null) {
                                                setTickLimit(0);
                                            }
                                        }}
                                        style={getInputStyle(mode !== 'AGGRESSIVE')}
                                        readOnly={isBotRunning}
                                        placeholder="0 = unlimited"
                                    />
                                    <div style={{ fontSize: '10px', color: professionalColors.gray, marginTop: '2px' }}>
                                        Stops after N ticks (0 = run forever)
                                    </div>
                                </div>
                            </div>

                            {/* PREDICTIONS SECTION */}
                            {needsPrediction(contractType) && (
                                <div style={{
                                    marginTop: '12px',
                                    marginBottom: '12px',
                                    padding: '12px',
                                    background: `${mode === 'AGGRESSIVE' ? professionalColors.danger : professionalColors.primary}10`,
                                    borderRadius: '8px'
                                }}>
                                    <label style={{ fontSize: '12px', fontWeight: '600', color: mode === 'AGGRESSIVE' ? professionalColors.danger : professionalColors.primary, marginBottom: '8px', display: 'block' }}>
                                        📊 PREDICTIONS (0-9)
                                    </label>
                                    <div style={styles.row}>
                                        <div style={{ flex: 1 }}>
                                            <label style={{ fontSize: '10px', fontWeight: '600', color: professionalColors.textLight }}>PRED 1</label>
                                            <input 
                                                type="text"
                                                inputMode="numeric"
                                                value={pred1 === undefined || pred1 === null ? '' : pred1}
                                                onChange={e => handlePredictionInput(setPred1, e.target.value)}
                                                onBlur={() => {
                                                    if (pred1 === '' || pred1 === undefined || pred1 === null) {
                                                        setPred1(0);
                                                    }
                                                }}
                                                style={getInputStyle(false)} 
                                                readOnly={isBotRunning}
                                                placeholder="0-9"
                                            />
                                        </div>
                                        <div style={{ flex: 1 }}>
                                            <label style={{ fontSize: '10px', fontWeight: '600', color: professionalColors.textLight }}>PRED 2</label>
                                            <input 
                                                type="text"
                                                inputMode="numeric"
                                                value={pred2 === undefined || pred2 === null ? '' : pred2}
                                                onChange={e => handlePredictionInput(setPred2, e.target.value)}
                                                onBlur={() => {
                                                    if (pred2 === '' || pred2 === undefined || pred2 === null) {
                                                        setPred2(0);
                                                    }
                                                }}
                                                style={getInputStyle(false)} 
                                                readOnly={isBotRunning}
                                                placeholder="0-9"
                                            />
                                        </div>
                                        <div style={{ flex: 1 }}>
                                            <label style={{ fontSize: '10px', fontWeight: '600', color: professionalColors.textLight }}>PRED 3</label>
                                            <input 
                                                type="text"
                                                inputMode="numeric"
                                                value={pred3 === undefined || pred3 === null ? '' : pred3}
                                                onChange={e => handlePredictionInput(setPred3, e.target.value)}
                                                onBlur={() => {
                                                    if (pred3 === '' || pred3 === undefined || pred3 === null) {
                                                        setPred3(0);
                                                    }
                                                }}
                                                style={getInputStyle(false)} 
                                                readOnly={isBotRunning}
                                                placeholder="0-9"
                                            />
                                        </div>
                                    </div>
                                    <div style={{ fontSize: '10px', color: professionalColors.gray, marginTop: '4px', textAlign: 'center' }}>
                                        Predictions rotate on wins/losses in STABLE mode | Rotate on each trade in AGGRESSIVE mode
                                    </div>
                                </div>
                            )}

                            {/* TAKE PROFIT / STOP LOSS */}
                            <div style={styles.row}>
                                <div style={{ flex: 1 }}>
                                    <label style={styles.label}>TAKE PROFIT</label>
                                    <input 
                                        type="text"
                                        inputMode="decimal"
                                        value={takeProfit} 
                                        onChange={e => handleNumberInput(setTakeProfit, e.target.value, 0, undefined, true, 0)}
                                        onBlur={() => {
                                            if (takeProfit === '' || takeProfit === undefined || takeProfit === null) {
                                                setTakeProfit(0);
                                            }
                                        }}
                                        style={getInputStyle(false)} 
                                        readOnly={isBotRunning}
                                    />
                                </div>
                                <div style={{ flex: 1 }}>
                                    <label style={styles.label}>STOP LOSS</label>
                                    <input 
                                        type="text"
                                        inputMode="decimal"
                                        value={stopLoss} 
                                        onChange={e => handleNumberInput(setStopLoss, e.target.value, 0, undefined, true, 0)}
                                        onBlur={() => {
                                            if (stopLoss === '' || stopLoss === undefined || stopLoss === null) {
                                                setStopLoss(0);
                                            }
                                        }}
                                        style={getInputStyle(false)} 
                                        readOnly={isBotRunning}
                                    />
                                </div>
                            </div>

                            {/* MARTINGALE */}
                            <div style={styles.row}>
                                <div style={{ flex: 1.2 }}>
                                    <label style={styles.label}>MARTINGALE MULTIPLIER</label>
                                    <input 
                                        type="text"
                                        inputMode="decimal"
                                        value={martingale} 
                                        onChange={e => handleNumberInput(setMartingale, e.target.value, 1, undefined, true, 1)}
                                        onBlur={() => {
                                            if (martingale === '' || martingale === undefined || martingale === null || martingale < 1) {
                                                setMartingale(1);
                                            }
                                        }}
                                        style={getInputStyle(false)} 
                                        readOnly={isBotRunning}
                                    />
                                </div>
                                <div style={{ flex: 0.8 }}>
                                    <label style={styles.label}>LIMIT</label>
                                    <input 
                                        type="text"
                                        inputMode="numeric"
                                        value={martingaleLimit} 
                                        onChange={e => handleNumberInput(setMartingaleLimit, e.target.value, 0, undefined, true, 0)}
                                        onBlur={() => {
                                            if (martingaleLimit === '' || martingaleLimit === undefined || martingaleLimit === null) {
                                                setMartingaleLimit(0);
                                            }
                                        }}
                                        style={getInputStyle(false)} 
                                        readOnly={isBotRunning}
                                    />
                                </div>
                                <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: '5px', justifyContent: 'flex-end' }}>
                                    <label style={styles.label}>ENABLE</label>
                                    <div onClick={() => setMartingaleEnabled(!martingaleEnabled)} style={{
                                        width: '52px', height: '28px', background: martingaleEnabled ? professionalColors.success : professionalColors.danger,
                                        borderRadius: '14px', position: 'relative', cursor: 'pointer',
                                        touchAction: 'manipulation',
                                    }}>
                                        <div style={{
                                            width: '24px', height: '24px', background: '#fff', borderRadius: '50%',
                                            position: 'absolute', top: '2px', left: martingaleEnabled ? '26px' : '2px',
                                            transition: 'left 0.2s'
                                        }}></div>
                                    </div>
                                    <span style={{ fontSize: '14px', color: martingaleEnabled ? professionalColors.success : professionalColors.danger }}>
                                        {martingaleEnabled ? 'ON' : 'OFF'}
                                    </span>
                                </div>
                            </div>
                        </>
                    )}

                    {/* ACTION BUTTONS - with fixed touch handlers */}
                    <div style={{ display: 'flex', flexDirection: isMobile ? 'column' : 'row', gap: isMobile ? '12px' : '12px', marginTop: '16px' }}>
                        {/* PAUSE / RESUME BUTTON — visible only when bot is running and mode is not MANUAL */}
                        {isBotRunning && mode !== 'MANUAL' && (
                            <button
                                onClick={isPaused ? handleResume : handlePause}
                                style={{
                                    flex: 1,
                                    padding: isMobile ? '16px' : '16px',
                                    background: isPaused
                                        ? `linear-gradient(145deg, #10B981 0%, #059669 100%)`
                                        : `linear-gradient(145deg, #F59E0B 0%, #D97706 100%)`,
                                    color: '#FFFFFF',
                                    border: 'none',
                                    borderRadius: '14px',
                                    fontWeight: '700',
                                    cursor: 'pointer',
                                    fontSize: isMobile ? '15px' : '14px',
                                    transition: 'all 0.2s ease',
                                    boxShadow: isPaused
                                        ? '0 4px 15px rgba(16,185,129,0.4)'
                                        : '0 4px 15px rgba(245,158,11,0.4)',
                                    touchAction: 'manipulation',
                                    WebkitTapHighlightColor: 'transparent',
                                    minHeight: isMobile ? '56px' : 'auto',
                                    letterSpacing: '0.5px',
                                }}
                            >
                                {isPaused ? '▶️ RESUME' : '⏸️ PAUSE'}
                            </button>
                        )}

                        <button 
                            onClick={(e) => {
                                if (!('ontouchstart' in window)) {
                                    toggleBot(e);
                                }
                            }}
                            onTouchStart={(e) => {
                                e.currentTarget.style.opacity = '0.8';
                                e.currentTarget.style.transform = 'scale(0.97)';
                                touchMoved.current = false;
                            }}
                            onTouchMove={(e) => {
                                touchMoved.current = true;
                            }}
                            onTouchEnd={(e) => {
                                e.preventDefault();
                                e.currentTarget.style.opacity = '1';
                                e.currentTarget.style.transform = 'scale(1)';
                                if (!touchMoved.current) {
                                    toggleBot(e);
                                }
                                touchMoved.current = false;
                            }}
                            onTouchCancel={(e) => {
                                e.currentTarget.style.opacity = '1';
                                e.currentTarget.style.transform = 'scale(1)';
                                touchMoved.current = false;
                            }}
                            style={{
                                ...(isBotRunning ? styles.stopBtn : styles.startBtn),
                                ...(mode === 'MANUAL' && isManualTradePending ? {
                                    background: `linear-gradient(145deg, ${professionalColors.danger} 0%, ${professionalColors.dangerDark} 100%)`,
                                    boxShadow: `0 4px 15px ${professionalColors.danger}40`,
                                    animation: 'pulse 1.5s infinite'
                                } : {}),
                                opacity: (!is_logged_in || (mode === 'MANUAL' && isManualTradePending)) ? 0.5 : 1,
                                cursor: (!is_logged_in || (mode === 'MANUAL' && isManualTradePending)) ? 'not-allowed' : 'pointer',
                                transform: mode === 'MANUAL' && isManualTradePending ? 'scale(0.98)' : 'scale(1)',
                                transition: 'all 0.1s ease',
                                WebkitTapHighlightColor: 'transparent',
                                touchAction: 'manipulation',
                            }}
                            disabled={!is_logged_in || (mode === 'MANUAL' && isManualTradePending)}
                        >
                            {!is_logged_in ? '🔒 LOGIN REQUIRED' : 
                             isBotRunning ? "⏹️ STOP BOT" : 
                             mode === 'MANUAL' ? (isManualTradePending ? "🔴 PROCESSING..." : "🚀 PLACE TRADE") : 
                             mode === 'SCANNER' ? "📡 START SCANNER" :
                             "▶️ START SNIPER"}
                        </button>

                        <button onClick={() => {
                            handleReset();
                            if (runPanelStore?.onClearStatClick) {
                                runPanelStore.onClearStatClick();
                            }
                        }} style={styles.resetBtn}>
                            🔄 RESET
                        </button>
                    </div>

                    <style>{`
                        @keyframes pulse {
                            0% { opacity: 1; transform: scale(1); }
                            50% { opacity: 0.8; transform: scale(0.98); }
                            100% { opacity: 1; transform: scale(1); }
                        }
                        
                        @keyframes float {
                            0% { transform: translateY(0px) scale(1); }
                            50% { transform: translateY(-8px) scale(1.05); }
                            100% { transform: translateY(0px) scale(1); }
                        }
                        
                        @keyframes ripple {
                            0% { transform: scale(1); opacity: 0.4; }
                            100% { transform: scale(1.5); opacity: 0; }
                        }
                        
                        * {
                            -webkit-tap-highlight-color: transparent;
                        }
                        
                        input:focus, select:focus, button:focus {
                            outline: none;
                            box-shadow: 0 0 0 3px ${professionalColors.primary}30;
                        }
                        
                        button:hover {
                            filter: brightness(1.05);
                            transform: translateY(-1px);
                        }
                        
                        button:active {
                            transform: translateY(1px);
                            filter: brightness(0.95);
                        }
                    `}</style>

                    {/* LOGS SECTION */}
                    <div style={{
                        marginTop: isMobile ? '20px' : '20px',
                        background: professionalColors.surface,
                        borderRadius: '12px',
                        border: `1px solid ${professionalColors.border}`,
                        overflow: 'hidden'
                    }}>
                        <div style={{
                            display: 'flex',
                            justifyContent: 'space-between',
                            alignItems: 'center',
                            padding: isMobile ? '12px 15px' : '12px 15px',
                            background: professionalColors.background,
                            borderBottom: `1px solid ${professionalColors.border}`
                        }}>
                            <div style={{ fontSize: isMobile ? '13px' : '11px', fontWeight: '600', color: professionalColors.text, textTransform: 'uppercase' }}>
                                📋 RECENT LOGS
                            </div>
                            <button onClick={clearLogs} style={{
                                padding: isMobile ? '8px 12px' : '6px 12px',
                                fontSize: isMobile ? '13px' : '11px',
                                background: professionalColors.danger,
                                color: '#FFFFFF',
                                border: 'none',
                                borderRadius: '8px',
                                cursor: 'pointer',
                                fontWeight: '600',
                                touchAction: 'manipulation',
                            }}>
                                CLEAR
                            </button>
                        </div>
                        <div style={{ maxHeight: '200px', overflowY: 'auto', padding: isMobile ? '12px' : '12px', WebkitOverflowScrolling: 'touch' }}>
                            {tradeLogs.length === 0 ? (
                                <div style={{ padding: isMobile ? '20px' : '20px', textAlign: 'center', color: professionalColors.gray, fontSize: isMobile ? '14px' : '13px' }}>
                                    No logs yet. Start the bot to see activity.
                                </div>
                            ) : (
                                tradeLogs.map(log => (
                                    <div key={log.id} style={{
                                        padding: isMobile ? '10px' : '8px',
                                        fontSize: isMobile ? '14px' : '12px',
                                        borderBottom: `1px solid ${professionalColors.border}`,
                                        fontFamily: 'monospace',
                                        color: log.type === 'error' ? professionalColors.danger :
                                            log.type === 'success' ? professionalColors.success :
                                                log.type === 'warn' ? professionalColors.warning : professionalColors.gray
                                    }}>
                                        {log.message}
                                    </div>
                                ))
                            )}
                        </div>
                    </div>

                    <div style={{
                        marginTop: isMobile ? '12px' : '12px',
                        padding: isMobile ? '12px' : '12px',
                        background: professionalColors.background,
                        borderRadius: '8px',
                        fontSize: isMobile ? '13px' : '11px',
                        color: professionalColors.textLight,
                        display: 'flex',
                        justifyContent: 'space-between',
                        flexWrap: 'wrap',
                        gap: '8px'
                    }}>
                        <div>Bot: {isBotRunning ? (isPaused ? '🟡 PAUSED' : '🟢 RUNNING') : '🔴 STOPPED'}</div>
                        <div>Mode: {mode}</div>
                        <div>Active: {activeTradesCount.current}</div>
                        <div>P/L: ${totalPL}</div>
                        <div>Queue: {tradeQueue.current.length}</div>
                        <div>Triggered: {isTradeTriggered.current ? '⏳' : '✅'}</div>
                        {mode === 'SEQUENCE' && (
                            <div style={{ color: professionalColors.warning, width: '100%', textAlign: 'center' }}>
                                Type {currentSequenceType} | {runsCompletedInCurrentType}/{runsPerType}
                                {lastTradeWasLoss.current && martingaleEnabled ? ` (M:${martingaleCounterSeq.current}/${martingaleLimit === 0 ? '∞' : martingaleLimit})` : ''}
                                {seqTradeTriggered.current && ' ⏳'}
                            </div>
                        )}
                        {mode === 'DUAL' && (
                            <div style={{ color: dualRecoveryMode ? professionalColors.warning : professionalColors.success }}>
                                {dualRecoveryMode ? 'Type 2' : 'Type 1'} | ${currentDualStake.current.toFixed(2)}
                                {dualMartingaleCounter.current > 0 && ` (M:${dualMartingaleCounter.current}/${martingaleLimit === 0 ? '∞' : martingaleLimit})`}
                                {dualTradeLocked.current && ' ⏳'}
                                {dualRecoveryMode && ' 🔄'}
                            </div>
                        )}
                        {mode === 'OVER_UNDER_HEDGE' && (
                            <div style={{ color: professionalColors.purple }}>
                                Stake: ${currentHedgeStake.current.toFixed(2)} | Triggers: [{hedgeTriggers}] | Last: {hedgeLastDigit.current || '-'}
                                {hedgeTradePending.current && ' ⏳'}
                            </div>
                        )}
                        {mode === 'STRIKE' && (
                            <div style={{ color: professionalColors.danger, width: '100%', textAlign: 'center' }}>
                                {strikeInRecovery.current ? '🔄 Recovery' : strikePhase.current === 'RUN' ? '🚀 Running' : '🎯 Hunting'} | Stake: ${strikeCurrentStake.current.toFixed(2)}
                                {strikeMartingaleCounter.current > 0 && ` M:${strikeMartingaleCounter.current}`}
                                {strikeTradeLocked.current && ' ⏳'}
                            </div>
                        )}
                        {mode === 'PARALLEL' && (
                            <div style={{ color: professionalColors.purple, width: '100%', textAlign: 'center' }}>
                                🔀 {parallelCount} trades | Stake: ${currentParallelStake.current.toFixed(2)}
                                {parallelMartingaleCounter.current > 0 && ` M:${parallelMartingaleCounter.current}/${parallelMartingaleLimit === 0 ? '∞' : parallelMartingaleLimit}`}
                                {parallelPending.current ? ` ⏳ (${parallelRemainingCount.current} left)` : ''}
                                {parallelAutoRunActive.current ? ' 🔁 Auto-Run' : ''}
                                {parallelTriggerMethod === 'VLOSS' && parallelVLossCounter.current > 0 && ` V:${parallelVLossCounter.current}/${parallelVLossLimit}`}
                            </div>
                        )}
                        {mode === 'SCANNER' && (
                            <div style={{ color: '#0891B2', width: '100%', textAlign: 'center' }}>
                                📡 {scannerStatus} | Stake: ${scannerCurrentStake.current.toFixed(2)}
                                {scannerMartingaleCounter.current > 0 && ` M:${scannerMartingaleCounter.current}`}
                                {scannerActiveSymbol ? ` | ${scannerActiveSymbol}` : ' | All markets'}
                                {scannerContractType ? ` | ${scannerContractType}` : ''}
                                {` | W:${scannerStats.wins} L:${scannerStats.losses}`}
                            </div>
                        )}
                    </div>

                    <div style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        marginTop: isMobile ? '20px' : '20px',
                        padding: isMobile ? '15px' : '12px',
                        background: professionalColors.surface,
                        borderRadius: '12px',
                        fontSize: isMobile ? '14px' : '13px',
                        border: `1px solid ${professionalColors.border}`,
                        flexWrap: 'wrap',
                        gap: '8px'
                    }}>
                        <div style={{ color: professionalColors.success, fontWeight: '600' }}>W: {wins}</div>
                        <div style={{ color: professionalColors.danger, fontWeight: '600' }}>L: {losses}</div>
                        <div style={{ color: professionalColors.warning, fontWeight: '600' }}>
                            📈 R: {riseWins}/{riseTrades}
                        </div>
                        <div style={{ color: professionalColors.purple, fontWeight: '600' }}>
                            📉 F: {fallWins}/{fallTrades}
                        </div>
                        <div style={{ fontWeight: '600', color: parseFloat(totalPL) >= 0 ? professionalColors.success : professionalColors.danger }}>
                            ${totalPL} {currency || 'USD'}
                        </div>
                    </div>

                </div>
            </div>

            {/* FLOATING HELP TAB */}
            <FloatingHelpTab />
        </div>
    );
});

export default NyanyukiPro;