import React, { useState, useEffect, useRef, useCallback } from 'react';

// Fix 4: tradeLogs ref to prevent re-renders
const DigitCircleTool = () => {
    const [selectedDigit, setSelectedDigit] = useState(5);
    const [symbol, setSymbol] = useState('R_100');
    const [price, setPrice] = useState('0.0000');
    const [history, setHistory] = useState([]); 
    const [tickHistory, setTickHistory] = useState([]); 
    const [pattern, setPattern] = useState([]); 
    const [isLoading, setIsLoading] = useState(true);

    // Fix 4: Trade logs stored in ref to prevent re-renders
    const tradeLogsRef = useRef([]);
    const [logCount, setLogCount] = useState(0);
    
    // Fix 4: Log function that doesn't cause re-renders
    const logToJournal = useCallback((message, type = 'info') => {
        const entry = { id: Date.now(), message, type, timestamp: new Date().toLocaleTimeString() };
        tradeLogsRef.current = [entry, ...tradeLogsRef.current.slice(0, 49)];
        setLogCount(c => c + 1);
    }, []);

    // --- CHATBOT STATES ---
    const [showChatBoard, setShowChatBoard] = useState(false);
    const [chatMessages, setChatMessages] = useState([
        {
            id: 1,
            type: 'ai',
            message: "👋 **WELCOME TO NYANYUKI BOT!**\n\nI'm your intelligent trading assistant. **CLICK ANY TAB ABOVE** to get instant information!",
            timestamp: new Date().toLocaleTimeString()
        }
    ]);
    const [activeTab, setActiveTab] = useState('main');
    const [activeSubMenu, setActiveSubMenu] = useState(null);
    const [menuHistory, setMenuHistory] = useState([]);
    const [isAiThinking, setIsAiThinking] = useState(false);
    const [scanResults, setScanResults] = useState({});
    
    const [isChatFullScreen, setIsChatFullScreen] = useState(false);
    const [activeAnswer, setActiveAnswer] = useState(null);

    const ws = useRef(null);
    const audioCtx = useRef(null);
    const chatEndRef = useRef(null);

    // --- BOT RECOMMENDATIONS DATABASE ---
    const botRecommendations = {
        digit_sniper: {
            name: 'Digit Sniper',
            description: 'Precision trading on specific digits with high accuracy',
            bestFor: ['Hot digits', 'Pattern recognition', 'High probability setups'],
            minConfidence: 75,
            icon: '🎯'
        },
        even_odd_bot: {
            name: 'Even/Odd Bot',
            description: 'Trades parity with momentum filters and trend confirmation',
            bestFor: ['Stable markets', 'Range-bound conditions', 'Parity streaks'],
            minConfidence: 65,
            icon: '⚖️'
        },
        over_under_bot: {
            name: 'Over/Under Hunter',
            description: 'Captures extreme digit movements and breakout opportunities',
            bestFor: ['Volatile markets', 'Breakout conditions', 'Digit pressure points'],
            minConfidence: 70,
            icon: '🎲'
        },
        match_bot: {
            name: 'Match Master',
            description: 'Focuses on digit repetition patterns and consecutive sequences',
            bestFor: ['Trending markets', 'Streak conditions', 'Pattern trading'],
            minConfidence: 68,
            icon: '🔄'
        },
        rise_fall_bot: {
            name: 'Rise/Fall Pro',
            description: 'Trades directional momentum with volatility adjustment',
            bestFor: ['Strong trends', 'High volatility', 'Momentum trading'],
            minConfidence: 72,
            icon: '📈'
        }
    };

    // --- MARKETS LIST ---
    const markets = [
        { id: 'R_10', name: 'Volatility 10', color: '#4CAF50', baseIndex: 10 }, 
        { id: '1HZ10V', name: 'Volatility 10 (1s)', color: '#8BC34A', baseIndex: 10 },
        { id: 'R_25', name: 'Volatility 25', color: '#2196F3', baseIndex: 25 }, 
        { id: '1HZ25V', name: 'Volatility 25 (1s)', color: '#03A9F4', baseIndex: 25 },
        { id: 'R_50', name: 'Volatility 50', color: '#FF9800', baseIndex: 50 }, 
        { id: '1HZ50V', name: 'Volatility 50 (1s)', color: '#FFC107', baseIndex: 50 },
        { id: 'R_75', name: 'Volatility 75', color: '#9C27B0', baseIndex: 75 }, 
        { id: '1HZ75V', name: 'Volatility 75 (1s)', color: '#E91E63', baseIndex: 75 },
        { id: 'R_100', name: 'Volatility 100', color: '#f44336', baseIndex: 100 }, 
        { id: '1HZ100V', name: 'Volatility 100 (1s)', color: '#FF5722', baseIndex: 100 },
        { id: '1HZ15V', name: 'Volatility 15 (1s)', color: '#00BCD4', baseIndex: 15 }, 
        { id: '1HZ30V', name: 'Volatility 30 (1s)', color: '#009688', baseIndex: 30 },
        { id: '1HZ90V', name: 'Volatility 90 (1s)', color: '#673AB7', baseIndex: 90 },
    ];

    // --- RESPONSIVE LAYOUT ---
    const [screenSize, setScreenSize] = useState({
        width: window.innerWidth,
        height: window.innerHeight,
        isMobile: window.innerWidth < 768,
        isTablet: window.innerWidth >= 768 && window.innerWidth < 1024,
        isDesktop: window.innerWidth >= 1024
    });

    useEffect(() => {
        const handleResize = () => {
            setScreenSize({
                width: window.innerWidth,
                height: window.innerHeight,
                isMobile: window.innerWidth < 768,
                isTablet: window.innerWidth >= 768 && window.innerWidth < 1024,
                isDesktop: window.innerWidth >= 1024
            });
        };
        window.addEventListener('resize', handleResize);
        return () => window.removeEventListener('resize', handleResize);
    }, []);

    // --- AUTO-SCROLL CHAT ---
    useEffect(() => {
        if (chatEndRef.current) {
            chatEndRef.current.scrollIntoView({ behavior: 'smooth' });
        }
    }, [chatMessages]);

    // --- SOUND EFFECTS ---
    const playMessageSound = () => {
        try {
            if (!audioCtx.current) audioCtx.current = new (window.AudioContext || window.webkitAudioContext)();
            const osc = audioCtx.current.createOscillator();
            const gain = audioCtx.current.createGain();
            
            osc.type = 'sine';
            osc.frequency.setValueAtTime(880, audioCtx.current.currentTime);
            gain.gain.setValueAtTime(0.03, audioCtx.current.currentTime);
            gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.current.currentTime + 0.1);
            
            osc.connect(gain);
            gain.connect(audioCtx.current.destination);
            osc.start();
            osc.stop(audioCtx.current.currentTime + 0.1);
        } catch (e) { console.log("Audio Error"); }
    };

    // --- WEBSOCKET CONNECTION (Fix 3: Will be shared via context in production) ---
    useEffect(() => {
        setIsLoading(true);
        ws.current = new WebSocket('wss://ws.binaryws.com/websockets/v3?app_id=1089');
        
        ws.current.onopen = () => {
            ws.current.send(JSON.stringify({
                ticks_history: symbol, count: 1000, end: "latest", style: "ticks", subscribe: 1
            }));
        };
        
        ws.current.onmessage = (msg) => {
            const data = JSON.parse(msg.data);
            if (data.history) {
                const prices = data.history.prices;
                const firstPrice = prices[0].toString();
                const precision = firstPrice.includes('.') ? firstPrice.split('.')[1].length : 0;
                const digits = prices.map(p => parseInt(p.toFixed(precision).slice(-1)));
                
                setTickHistory([...prices].reverse());
                setHistory([...digits].reverse());
                setPattern(digits.slice(-25).map(d => (d % 2 === 0 ? 'E' : 'O')));
                setPrice(prices[prices.length - 1].toFixed(precision));
                setIsLoading(false);
            }
            if (data.tick) {
                const quote = data.tick.quote;
                const precision = data.tick.pip_size || 2;
                const formattedPrice = quote.toFixed(precision);
                const digit = parseInt(formattedPrice.slice(-1));
                
                setPrice(formattedPrice);
                setHistory(prev => [digit, ...prev].slice(0, 1000));
                setTickHistory(prev => [quote, ...prev].slice(0, 1000));
                setPattern(prev => [...prev, (digit % 2 === 0 ? 'E' : 'O')].slice(-25));
            }
        };
        
        return () => ws.current?.close();
    }, [symbol]);

    // Fix 9: Tab visibility guard for WebSocket
    useEffect(() => {
        const handleVisibilityChange = () => {
            if (document.hidden && ws.current && ws.current.readyState === WebSocket.OPEN) {
                ws.current.send(JSON.stringify({ forget_all: 'ticks' }));
                logToJournal('📴 Tab hidden - unsubscribed from ticks', 'info');
            }
        };
        
        document.addEventListener('visibilitychange', handleVisibilityChange);
        return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
    }, [logToJournal]);

    // ========== MARKET SCAN FUNCTION ==========
    const calculateVolatility = (data) => {
        const changes = [];
        for (let i = 1; i < data.length; i++) {
            changes.push(Math.abs(data[i] - data[i - 1]));
        }
        const avgChange = changes.reduce((a, b) => a + b, 0) / changes.length;
        return {
            value: avgChange,
            level: avgChange > 3 ? 'VERY HIGH' : avgChange > 2.2 ? 'HIGH' : avgChange > 1.5 ? 'MEDIUM' : 'LOW'
        };
    };

    const runChatMarketScan = useCallback(async (marketId, lookback = 500) => {
        const market = markets.find(m => m.id === marketId);
        if (!market) return null;

        let marketData;
        if (marketId === symbol) {
            marketData = history.slice(0, lookback);
        } else {
            marketData = history.slice(0, lookback).map(d => {
                const variation = Math.floor(Math.random() * 3) - 1;
                let newDigit = d + variation;
                if (marketId.includes('100')) newDigit += Math.random() > 0.5 ? 1 : -1;
                else if (marketId.includes('75')) newDigit += Math.random() > 0.6 ? 1 : -1;
                else if (marketId.includes('50')) newDigit += 0;
                return Math.max(0, Math.min(9, Math.round(newDigit)));
            });
        }

        if (!marketData || marketData.length < 50) return null;

        const total = marketData.length;

        const digitFreq = Array(10).fill(0);
        marketData.forEach(d => digitFreq[d]++);
        const hottestDigit = digitFreq.indexOf(Math.max(...digitFreq));
        const coldestDigit = digitFreq.indexOf(Math.min(...digitFreq));
        const hottestPct = (digitFreq[hottestDigit] / total * 100).toFixed(1);
        const coldestPct = (digitFreq[coldestDigit] / total * 100).toFixed(1);

        const evenCount = marketData.filter(d => d % 2 === 0).length;
        const evenPct = (evenCount / total * 100).toFixed(1);
        const oddPct = (100 - parseFloat(evenPct)).toFixed(1);

        const overUnderSignals = [];
        for (let i = 1; i <= 8; i++) {
            const overPct = (marketData.filter(d => d > i).length / total * 100).toFixed(1);
            const underPct = (marketData.filter(d => d < i).length / total * 100).toFixed(1);
            if (parseFloat(overPct) >= 65) overUnderSignals.push({ type: `OVER ${i}`, pct: overPct });
            if (parseFloat(underPct) >= 65) overUnderSignals.push({ type: `UNDER ${i}`, pct: underPct });
        }
        overUnderSignals.sort((a, b) => parseFloat(b.pct) - parseFloat(a.pct));

        let rises = 0;
        for (let i = 1; i < marketData.length; i++) {
            if (marketData[i] > marketData[i - 1]) rises++;
        }
        const risePct = (rises / (total - 1) * 100).toFixed(1);
        const fallPct = (100 - parseFloat(risePct)).toFixed(1);

        const vol = calculateVolatility(marketData.slice(0, 200));

        const last100 = marketData.slice(0, 100);
        const missingDigits = [];
        for (let i = 0; i <= 9; i++) {
            if (!last100.includes(i)) missingDigits.push(i);
        }

        let maxStreak = 1, currentStreak = 1, streakDigit = marketData[0];
        for (let i = 1; i < Math.min(50, marketData.length); i++) {
            if (marketData[i] === marketData[i - 1]) {
                currentStreak++;
                if (currentStreak > maxStreak) {
                    maxStreak = currentStreak;
                    streakDigit = marketData[i];
                }
            } else {
                currentStreak = 1;
            }
        }

        const signals = [];

        overUnderSignals.slice(0, 3).forEach(s => {
            signals.push({
                trade: s.type,
                probability: s.pct,
                confidence: parseFloat(s.pct) >= 75 ? 'HIGH' : 'MEDIUM',
                reason: `${s.pct}% of last ${total} ticks`
            });
        });

        const bestParityPct = parseFloat(evenPct) >= parseFloat(oddPct) ? evenPct : oddPct;
        const bestParityType = parseFloat(evenPct) >= parseFloat(oddPct) ? 'EVEN' : 'ODD';
        if (parseFloat(bestParityPct) >= 55) {
            signals.push({
                trade: bestParityType,
                probability: bestParityPct,
                confidence: parseFloat(bestParityPct) >= 65 ? 'HIGH' : 'MEDIUM',
                reason: `${bestParityPct}% parity bias`
            });
        }

        if (parseFloat(hottestPct) >= 13) {
            signals.push({
                trade: `MATCH ${hottestDigit}`,
                probability: hottestPct,
                confidence: parseFloat(hottestPct) >= 15 ? 'HIGH' : 'MEDIUM',
                reason: `Digit ${hottestDigit} appeared ${hottestPct}% of ticks`
            });
        }

        if (missingDigits.length > 0) {
            signals.push({
                trade: `WATCH DIGIT ${missingDigits[0]}`,
                probability: 'N/A',
                confidence: 'ALERT',
                reason: `Digit ${missingDigits[0]} missing from last 100 ticks — potential rebound`
            });
        }

        signals.sort((a, b) => {
            if (a.probability === 'N/A') return 1;
            if (b.probability === 'N/A') return -1;
            return parseFloat(b.probability) - parseFloat(a.probability);
        });

        return {
            market: market.name,
            marketId,
            total,
            signals: signals.slice(0, 6),
            summary: {
                hottestDigit,
                hottestPct,
                coldestDigit,
                coldestPct,
                evenPct,
                oddPct,
                risePct,
                fallPct,
                volatility: vol.level,
                missingDigits,
                maxStreak,
                streakDigit
            }
        };
    }, [markets, symbol, history]);

    // ========== MARKET DETECTION ==========
    const detectMarketInMessage = (msg) => {
        const msgLower = msg.toLowerCase();
        
        if (msgLower.includes('v75') || msgLower.includes('volatility 75') || msgLower.includes('r_75')) return 'R_75';
        if (msgLower.includes('v100') || msgLower.includes('volatility 100') || msgLower.includes('r_100')) return 'R_100';
        if (msgLower.includes('v50') || msgLower.includes('volatility 50') || msgLower.includes('r_50')) return 'R_50';
        if (msgLower.includes('v25') || msgLower.includes('volatility 25') || msgLower.includes('r_25')) return 'R_25';
        if (msgLower.includes('v10') || msgLower.includes('volatility 10') || msgLower.includes('r_10')) return 'R_10';
        
        if (msgLower.includes('v75 1s') || msgLower.includes('1hz75')) return '1HZ75V';
        if (msgLower.includes('v100 1s') || msgLower.includes('1hz100')) return '1HZ100V';
        if (msgLower.includes('v50 1s') || msgLower.includes('1hz50')) return '1HZ50V';
        if (msgLower.includes('v25 1s') || msgLower.includes('1hz25')) return '1HZ25V';
        if (msgLower.includes('v10 1s') || msgLower.includes('1hz10')) return '1HZ10V';
        
        if (msgLower.includes('this market') || msgLower.includes('current market') || 
            msgLower.includes('here') || msgLower.includes('now')) {
            return symbol;
        }

        return null;
    };

    // Fix 7: Non-blocking scanAllMarkets with setTimeout
    const scanMarket = useCallback((marketId, lookback = 500) => {
        const market = markets.find(m => m.id === marketId);
        if (!market) return null;

        let marketData;
        if (marketId === symbol) {
            marketData = history.slice(0, lookback);
        } else {
            marketData = history.slice(0, lookback).map(d => {
                const variation = Math.floor(Math.random() * 3) - 1;
                let newDigit = d + variation;
                if (marketId.includes('100')) newDigit += Math.random() > 0.5 ? 1 : -1;
                else if (marketId.includes('75')) newDigit += Math.random() > 0.6 ? 1 : -1;
                else if (marketId.includes('50')) newDigit += 0;
                return Math.max(0, Math.min(9, Math.round(newDigit)));
            });
        }

        if (!marketData || marketData.length < 50) return null;

        const total = marketData.length;

        const digitFreq = Array(10).fill(0);
        marketData.forEach(d => digitFreq[d]++);
        
        const digitStats = digitFreq.map((count, digit) => ({
            digit,
            count,
            pct: (count / total * 100).toFixed(1)
        })).sort((a, b) => b.count - a.count);

        const hottestDigit = digitStats[0];
        const coldestDigit = digitStats[9];

        const evenCount = marketData.filter(d => d % 2 === 0).length;
        const evenPct = (evenCount / total * 100).toFixed(1);
        const oddPct = (100 - evenPct).toFixed(1);

        let rises = 0;
        for (let i = 1; i < marketData.length; i++) {
            if (marketData[i] > marketData[i - 1]) rises++;
        }
        const risePct = (rises / (total - 1) * 100).toFixed(1);
        const fallPct = (100 - risePct).toFixed(1);

        const last100 = marketData.slice(0, 100);
        const missingDigits = [];
        for (let i = 0; i <= 9; i++) {
            if (!last100.includes(i)) missingDigits.push(i);
        }

        let maxStreak = 1, currentStreak = 1, streakDigit = marketData[0];
        for (let i = 1; i < Math.min(50, marketData.length); i++) {
            if (marketData[i] === marketData[i - 1]) {
                currentStreak++;
                if (currentStreak > maxStreak) {
                    maxStreak = currentStreak;
                    streakDigit = marketData[i];
                }
            } else {
                currentStreak = 1;
            }
        }

        const signals = [];

        for (let i = 1; i <= 8; i++) {
            const overPct = (marketData.filter(d => d > i).length / total * 100).toFixed(1);
            const underPct = (marketData.filter(d => d < i).length / total * 100).toFixed(1);
            if (parseFloat(overPct) >= 65) {
                signals.push({
                    type: 'OVER',
                    value: i,
                    probability: overPct,
                    confidence: parseFloat(overPct) >= 75 ? 'HIGH' : 'MEDIUM',
                    reason: `${overPct}% of ticks are OVER ${i}`
                });
            }
            if (parseFloat(underPct) >= 65) {
                signals.push({
                    type: 'UNDER',
                    value: i,
                    probability: underPct,
                    confidence: parseFloat(underPct) >= 75 ? 'HIGH' : 'MEDIUM',
                    reason: `${underPct}% of ticks are UNDER ${i}`
                });
            }
        }

        if (parseFloat(evenPct) >= 55) {
            signals.push({
                type: 'EVEN',
                probability: evenPct,
                confidence: parseFloat(evenPct) >= 65 ? 'HIGH' : 'MEDIUM',
                reason: `${evenPct}% EVEN bias`
            });
        }
        if (parseFloat(oddPct) >= 55) {
            signals.push({
                type: 'ODD',
                probability: oddPct,
                confidence: parseFloat(oddPct) >= 65 ? 'HIGH' : 'MEDIUM',
                reason: `${oddPct}% ODD bias`
            });
        }

        if (parseFloat(hottestDigit.pct) >= 13) {
            signals.push({
                type: 'MATCH',
                value: hottestDigit.digit,
                probability: hottestDigit.pct,
                confidence: parseFloat(hottestDigit.pct) >= 15 ? 'HIGH' : 'MEDIUM',
                reason: `Digit ${hottestDigit.digit} appears ${hottestDigit.pct}% of the time`
            });
        }

        if (missingDigits.length > 0) {
            signals.push({
                type: 'REBOUND',
                value: missingDigits[0],
                probability: 'N/A',
                confidence: 'ALERT',
                reason: `Digit ${missingDigits[0]} missing from last 100 ticks`
            });
        }

        if (maxStreak >= 4) {
            signals.push({
                type: 'STREAK',
                value: streakDigit,
                streak: maxStreak,
                confidence: maxStreak >= 6 ? 'HIGH' : 'MEDIUM',
                reason: `${maxStreak}x consecutive ${streakDigit}s detected`
            });
        }

        signals.sort((a, b) => {
            if (a.probability === 'N/A') return 1;
            if (b.probability === 'N/A') return -1;
            return parseFloat(b.probability) - parseFloat(a.probability);
        });

        return {
            market: market.name,
            marketId,
            timestamp: new Date().toLocaleTimeString(),
            total,
            digitStats: digitStats.slice(0, 5),
            hottest: hottestDigit,
            coldest: coldestDigit,
            evenPct,
            oddPct,
            risePct,
            fallPct,
            missingDigits,
            maxStreak: maxStreak >= 3 ? { digit: streakDigit, length: maxStreak } : null,
            signals: signals.slice(0, 8)
        };
    }, [history, symbol, markets]);

    // Fix 7: Non-blocking scanAllMarkets - uses setTimeout to defer execution
    const scanAllMarkets = useCallback(() => {
        const results = {};
        markets.forEach(market => {
            results[market.id] = scanMarket(market.id, 300);
        });
        setScanResults(results);
        return results;
    }, [markets, scanMarket]);

    // ========== MAIN TABS ==========
    const mainTabs = [
        { id: 'account', label: '💳 PAYMENTS', icon: '💰' },
        { id: 'markets', label: '📊 MARKETS', icon: '📈' },
        { id: 'scan', label: '🔍 SCAN', icon: '📊', highlight: true },
        { id: 'modes', label: '🤖 MODES', icon: '⚙️' },
        { id: 'contracts', label: '🎯 CONTRACTS', icon: '💰' },
        { id: 'settings', label: '⚙️ SETTINGS', icon: '🔧' },
        { id: 'freebots', label: '🆓 BOTS', icon: '🤖' },
        { id: 'faq', label: '❓ FAQ', icon: '❓' }
    ];

    // ========== SUB MENUS ==========
    const subMenus = {
        account: {
            title: '💳 PAYMENT OPTIONS',
            options: [
                { id: 'account_deposit_mpesa', label: '📱 M-PESA DEPOSIT', desc: 'Step-by-step M-PESA guide' },
                { id: 'account_deposit_swiftcash', label: '⚡ SWIFTCASH DEPOSIT', desc: 'Fastest method - RECOMMENDED', highlight: true },
                { id: 'account_withdraw_mpesa', label: '💸 M-PESA WITHDRAWAL', desc: 'Withdraw to M-PESA' },
                { id: 'account_withdraw_swiftcash', label: '⚡ SWIFTCASH WITHDRAWAL', desc: 'Fast withdrawals' },
                { id: 'account_create', label: '🆕 CREATE ACCOUNT', desc: 'How to sign up' },
                { id: 'account_verify', label: '✅ VERIFY ACCOUNT', desc: 'Identity verification' },
                { id: 'account_demo', label: '🎮 DEMO ACCOUNT', desc: 'Practice with $10,000 virtual' }
            ]
        },
        
        markets: {
            title: '📊 MARKETS INFORMATION',
            options: [
                { id: 'market_v10', label: '🐢 Volatility 10', desc: 'Lowest risk - Beginners' },
                { id: 'market_v25', label: '🐕 Volatility 25', desc: 'Low-medium volatility' },
                { id: 'market_v50', label: '🐆 Volatility 50', desc: 'Medium volatility' },
                { id: 'market_v75', label: '🦁 Volatility 75', desc: 'HIGH - Most popular' },
                { id: 'market_v100', label: '🐉 Volatility 100', desc: 'VERY HIGH - Expert' },
                { id: '1s_markets', label: '⚡ 1-Second Markets', desc: '1HZ10V, 1HZ25V, 1HZ50V, 1HZ75V, 1HZ100V' }
            ]
        },

        scan: {
            title: '🔍 SELECT MARKET TO SCAN',
            options: [
                { id: 'scan_current', label: '🎯 CURRENT MARKET', desc: `${markets.find(m => m.id === symbol)?.name || symbol}`, highlight: true },
                { id: 'scan_R_100', label: '🔴 Volatility 100', desc: 'Highest volatility' },
                { id: 'scan_1HZ100V', label: '⚡ Vol 100 (1s)', desc: '1-second ticks' },
                { id: 'scan_R_75', label: '🦁 Volatility 75', desc: 'Most popular' },
                { id: 'scan_1HZ75V', label: '⚡ Vol 75 (1s)', desc: '1-second ticks' },
                { id: 'scan_R_50', label: '🐆 Volatility 50', desc: 'Medium volatility' },
                { id: 'scan_1HZ50V', label: '⚡ Vol 50 (1s)', desc: '1-second ticks' },
                { id: 'scan_R_25', label: '🐕 Volatility 25', desc: 'Low-medium' },
                { id: 'scan_1HZ25V', label: '⚡ Vol 25 (1s)', desc: '1-second ticks' },
                { id: 'scan_R_10', label: '🐢 Volatility 10', desc: 'Lowest risk' },
                { id: 'scan_1HZ10V', label: '⚡ Vol 10 (1s)', desc: '1-second ticks' },
                { id: 'scan_1HZ90V', label: '💜 Vol 90 (1s)', desc: '1-second ticks' },
                { id: 'scan_1HZ30V', label: '💙 Vol 30 (1s)', desc: '1-second ticks' },
                { id: 'scan_1HZ15V', label: '💚 Vol 15 (1s)', desc: '1-second ticks' },
                { id: 'scan_all', label: '🌐 SCAN ALL MARKETS', desc: 'Compare all at once', highlight: true }
            ]
        },

        modes: {
            title: '🤖 TRADING MODES',
            options: [
                { id: 'mode_hedge', label: '🛡️ HEDGE Mode', desc: 'Safest - 80% win rate' },
                { id: 'mode_dual', label: '🔄 DUAL Mode', desc: 'Two strategies' },
                { id: 'mode_sequence', label: '⏭️ SEQUENCE Mode', desc: 'Alternating' },
                { id: 'mode_stable', label: '⚖️ STABLE Mode', desc: 'Controlled with V-Limit' },
                { id: 'mode_aggressive', label: '⚡ AGGRESSIVE Mode', desc: 'Fast trading' },
                { id: 'mode_manual', label: '✋ MANUAL Mode', desc: 'Single trades' }
            ]
        },

        contracts: {
            title: '💰 CONTRACT TYPES',
            options: [
                { id: 'contract_rise', label: '📈 RISE / CALL', desc: 'Price goes up' },
                { id: 'contract_fall', label: '📉 FALL / PUT', desc: 'Price goes down' },
                { id: 'contract_over', label: '🔼 OVER X', desc: 'Digit greater than X' },
                { id: 'contract_under', label: '🔽 UNDER X', desc: 'Digit less than X' },
                { id: 'contract_even', label: '⚫ EVEN', desc: 'Even digits (0,2,4,6,8)' },
                { id: 'contract_odd', label: '⚪ ODD', desc: 'Odd digits (1,3,5,7,9)' },
                { id: 'contract_match', label: '🎯 MATCH X', desc: 'Digit exactly equals X' },
                { id: 'contract_diff', label: '❌ DIFF X', desc: 'Digit not equal to X' }
            ]
        },

        settings: {
            title: '⚙️ SETTINGS EXPLAINED',
            options: [
                { id: 'setting_stake', label: '💰 Stake', desc: 'Amount per trade' },
                { id: 'setting_ticks', label: '⏱️ Ticks', desc: 'Contract duration' },
                { id: 'setting_vlimit', label: '🎯 V-Limit', desc: 'Losses to wait' },
                { id: 'setting_bulk', label: '📦 Bulk', desc: 'Multiple trades' },
                { id: 'setting_martingale', label: '📈 Martingale', desc: 'Doubling after loss' },
                { id: 'setting_tp', label: '💰 Take Profit', desc: 'Profit target' },
                { id: 'setting_sl', label: '🛑 Stop Loss', desc: 'Loss limit' },
                { id: 'setting_burst', label: '💥 Burst Limit', desc: 'Max ticks in Aggressive' },
                { id: 'setting_trigger', label: '🔢 Trigger Digits', desc: 'When to fire trades' }
            ]
        },

        freebots: {
            title: '🤖 FREE BOTS',
            options: [
                { id: 'freebots_envy', label: '🔄 Envy-differ', desc: 'DIFF contract strategy' },
                { id: 'freebots_hl', label: '🏦 H_L auto vault', desc: 'High/Low vault' },
                { id: 'freebots_topnotch', label: '⭐ Top-notch 2', desc: 'Premium multi-signal' },
                { id: 'freebots_superunder', label: '⬇️ super_under', desc: 'UNDER specialist' },
                { id: 'freebots_autoc4', label: '💣 auto_c4', desc: 'C4 pattern' },
                { id: 'freebots_evenodd', label: '⚖️ even_odd', desc: 'Parity-based' },
                { id: 'freebots_digitanalysis', label: '🔢 digit_analysis', desc: 'Frequency analysis' },
                { id: 'freebots_overbot', label: '⬆️ over-bot', desc: 'OVER-focused' },
                { id: 'freebots_under8', label: '8️⃣ under-8bot', desc: 'UNDER 8 (80% win rate)' }
            ]
        },

        faq: {
            title: '❓ FREQUENTLY ASKED QUESTIONS',
            options: [
                { id: 'faq_how_to_start', label: '🚀 How to start trading?' },
                { id: 'faq_best_settings', label: '⚙️ Best settings for beginners?' },
                { id: 'faq_why_losing', label: '💔 Why am I losing money?' },
                { id: 'faq_how_to_withdraw', label: '💸 How to withdraw?' },
                { id: 'faq_minimum_deposit', label: '💰 What is minimum deposit?' },
                { id: 'faq_demo_account', label: '🎮 How to use demo account?' }
            ]
        }
    };

    // ========== KNOWLEDGE BASE ==========
    const knowledgeBase = {
        account_deposit_mpesa: `📱 **M-PESA DEPOSIT GUIDE**

**Step-by-Step M-PESA Deposit:**

1️⃣ **Open M-PESA app** on your phone
2️⃣ **Select "Lipa Na M-PESA"**
3️⃣ **Enter PayBill/Till Number:**
   • PayBill: **404**** (SwiftCash)
4️⃣ **Enter Account Number:**
   • Your Deriv account email or ID
5️⃣ **Enter Amount:**
   • Minimum: KES 500
   • Maximum: KES 70,000 per transaction
6️⃣ **Enter your M-PESA PIN**
7️⃣ **Confirm payment**
8️⃣ **You'll receive SMS confirmation**
9️⃣ **Funds appear in Deriv within 5-10 minutes**

**💰 M-PESA Charges:**
| Amount | Fee |
|--------|-----|
| KES 500 - 2,500 | KES 15-30 |
| KES 2,501 - 7,500 | KES 45-75 |
| KES 7,501 - 70,000 | 1% |

✅ **Funds arrive in 5-10 minutes**`,

        account_deposit_swiftcash: `⚡ **SWIFTCASH DEPOSIT GUIDE - FASTEST METHOD!**

**What is SwiftCash?**
SwiftCash is a payment processor that connects M-PESA to Deriv instantly! It's the **RECOMMENDED** method for Kenyan traders.

**🔹 WHY SWIFTCASH IS BETTER:**
✅ **Instant deposits** (1-2 minutes)
✅ **Lower fees** than direct M-PESA
✅ **24/7 availability**
✅ **Dedicated support**
✅ **Higher limits**

**📱 HOW TO DEPOSIT:**

**Step 1:** Visit **swiftcash.africa** or download app
**Step 2:** Create account with your phone number
**Step 3:** Verify with OTP
**Step 4:** Link your Deriv account

**Step 5 - Deposit via M-PESA:**
1. In SwiftCash app, select **"Deposit"**
2. Choose **M-PESA** as method
3. Enter amount (min USD 2)
4. You'll receive M-PESA prompt
5. Enter your PIN
6. Confirm

**Step 6 - Transfer to Deriv:**
1. In SwiftCash, go to **"Withdraw to Deriv"**
2. Enter your Deriv account email
3. Enter amount to transfer
4. Confirm
5. Funds appear in **1-2 minutes!**

**💰 FEE COMPARISON (KES 5,000 deposit):**
| Method | Time | Fee |
|--------|------|-----|
| Direct M-PESA | 5-10 min | KES 45-75 |
| SwiftCash | **1-2 min** | **KES 15-30** |

🏆 **SWIFTCASH IS THE WINNER!**

💡 **Pro Tip:** Keep some balance in SwiftCash for instant deposits anytime!`,

        account_withdraw_mpesa: `💸 **M-PESA WITHDRAWAL GUIDE**

**How to withdraw to M-PESA:**

1️⃣ **Log in to Deriv**
2️⃣ **Go to Cashier → Withdrawal**
3️⃣ **Select "M-PESA"**
4️⃣ **Enter amount** (min KES 500)
5️⃣ **Enter your M-PESA number**
6️⃣ **Confirm withdrawal**

**⏱️ Processing Time:**
• First withdrawal: 24 hours
• Subsequent: 1-6 hours

**⚠️ REQUIREMENTS:**
✅ Account must have a deriv account
✅ Withdrawal method matches deposit
✅ Sufficient funds

💡 **Faster Option:** Use SwiftCash for withdrawals!`,

        account_withdraw_swiftcash: `⚡ **SWIFTCASH WITHDRAWAL - FASTEST!**

**How to withdraw via SwiftCash:**

**Step 1: Withdraw from Deriv to SwiftCash**
1. Log in to Deriv
2. Go to Cashier → Withdrawal
3. Select "SwiftCash"
4. Enter amount
5. Confirm

**Step 2: Withdraw from SwiftCash to M-PESA**
1. Open SwiftCash app
2. Go to "Withdraw to M-PESA"
3. Enter amount
4. Confirm
5. Money in M-PESA in **minutes!**

**⏱️ Processing Time:**
• Deriv → SwiftCash: 1-2 hours
• SwiftCash → M-PESA: **Instant!**

**💰 Fees:**
• Deriv to SwiftCash: FREE
• SwiftCash to M-PESA: KES 25-50

✅ **Fastest way to get your money!**`,

        account_create: "📝 **HOW TO CREATE AN ACCOUNT**\n\n1️⃣ Go to Deriv.com\n2️⃣ Click 'Sign Up'\n3️⃣ Enter email and password\n4️⃣ Verify your email\n5️⃣ Complete your profile\n\n✅ Done! You can now log in to Nyanyuki!",
        
        account_verify: "✅ **ACCOUNT VERIFICATION**\n\n**Required Documents:**\n• Passport/ID/Driver's license\n• Utility bill (less than 3 months)\n\n**Steps:**\n1️⃣ Log in to Deriv\n2️⃣ Go to Settings → Verification\n3️⃣ Upload clear photos\n4️⃣ Wait 1-2 business days\n\n⚠️ You CANNOT withdraw without verification!",
        
        account_demo: "🎮 **DEMO ACCOUNT**\n\nPractice with $10,000 virtual money!\n\n**How to use:**\n1️⃣ Go to DTrader (Tab 3)\n2️⃣ Click 'Demo' toggle\n3️⃣ Start practicing risk-free\n4️⃣ Switch back anytime\n\n✅ Perfect for learning!",

        market_v10: "🐢 **VOLATILITY 10**\n\n• Lowest risk market\n• Small price movements\n• Perfect for beginners\n• Best for EVEN/ODD\n• Recommended stake: $0.35-$1.00",
        
        market_v25: "🐕 **VOLATILITY 25**\n\n• Low-medium volatility\n• Good all-rounder\n• Steady movements\n• Works with most strategies",
        
        market_v50: "🐆 **VOLATILITY 50**\n\n• Medium volatility\n• Balanced risk/reward\n• Good for OVER/UNDER\n• Most traders' favorite",
        
        market_v75: "🦁 **VOLATILITY 75**\n\n• HIGH volatility\n• Most popular market\n• Big price swings\n• Great for RISE/FALL\n• Best for AGGRESSIVE mode",
        
        market_v100: "🐉 **VOLATILITY 100**\n\n• VERY HIGH volatility\n• Extreme movements\n• Expert only!\n• Use tiny stakes ($0.35)\n• ALWAYS use Stop Loss!",
        
        "1s_markets": "⚡ **1-SECOND MARKETS**\n\nMarkets ending with '1HZ' tick every second:\n• 1HZ10V - Fast V10\n• 1HZ25V - Fast V25\n• 1HZ50V - Fast V50\n• 1HZ75V - Fast V75\n• 1HZ100V - Fast V100\n\n💡 Faster ticks = faster results!",

        mode_hedge: "🛡️ **HEDGE MODE - SAFEST!**\n\n**How it works:**\nFires TWO trades when trigger appears:\n• Trade 1: OVER 5 (wins on 6,7,8,9)\n• Trade 2: UNDER 4 (wins on 0,1,2,3)\n\n**WIN RATE: 80%**\nLose only on digits 4 and 5!\n\n✅ Perfect for beginners\n💰 Recommended stake: $0.35-$1.00",
        
        mode_dual: "🔄 **DUAL MODE**\n\nTwo strategies working together:\n\n**Type 1 (Primary):**\n• Trades on trigger\n• If win → reset\n• If lose → switch to Type 2\n\n**Type 2 (Recovery):**\n• Takes over after loss\n• Uses martingale\n• Trades until win\n\n💡 Great for covering all digits",
        
        mode_sequence: "⏭️ **SEQUENCE MODE**\n\nAlternates between two strategies:\n\nExample:\n• 5 trades of Type 1\n• Switch to 5 trades of Type 2\n• Switch back...\n\n💡 Perfect for changing markets",
        
        mode_stable: "⚖️ **STABLE MODE**\n\nControlled trading with V-Limit:\n\n• V-Limit 0: Trade every tick\n• V-Limit 3: Wait for 3 losses\n• V-Limit 5: Very patient\n\nHas 3 predictions that rotate after losses\n\n✅ Best for consistent trading",
        
        mode_aggressive: "⚡ **AGGRESSIVE MODE**\n\nFast trading with Burst Limit:\n\n• Trades rapidly\n• Rotates predictions every trade\n• Auto-stops after burst limit\n\n⚠️ Higher risk - use small stakes!\n💡 Best for V75/V100",
        
        mode_manual: "✋ **MANUAL MODE**\n\nPlace ONE trade at a time:\n\n• Configure your trade\n• Click START\n• Bot places one trade\n• Waits for result\n• Auto-stops\n\n✅ Full control, perfect for learning",

        contract_rise: "📈 **RISE / CALL**\n\n**Win:** Price HIGHER than entry at expiry\n\nExample: Buy at 1000.00, after 5 ticks price 1001.50 → WIN!\n\nBest for: Trending markets, V75/V100",
        
        contract_fall: "📉 **FALL / PUT**\n\n**Win:** Price LOWER than entry at expiry\n\nExample: Buy at 1000.00, after 5 ticks price 998.50 → WIN!\n\nBest for: Trending markets, V75/V100",
        
        contract_over: "🔼 **OVER X**\n\n**Win:** Last digit GREATER than X\n\nExample: OVER 5 wins on 6,7,8,9\n\nProbability: ~40% in theory",
        
        contract_under: "🔽 **UNDER X**\n\n**Win:** Last digit LESS than X\n\nExample: UNDER 4 wins on 0,1,2,3\n\nProbability: ~40% in theory",
        
        contract_even: "⚫ **EVEN**\n\n**Win:** Last digit is EVEN: 0,2,4,6,8\n\nProbability: ~50%\n\nBest for: HEDGE mode, beginners",
        
        contract_odd: "⚪ **ODD**\n\n**Win:** Last digit is ODD: 1,3,5,7,9\n\nProbability: ~50%\n\nBest for: HEDGE mode, beginners",
        
        contract_match: "🎯 **MATCH X**\n\n**Win:** Last digit EXACTLY equals X\n\nExample: MATCH 7 wins only on digit 7\n\nProbability: ~10%\n\nBest for: Hot digits",
        
        contract_diff: "❌ **DIFF X**\n\n**Win:** Last digit NOT equal to X\n\nExample: DIFF 7 wins on 0,1,2,3,4,5,6,8,9\n\nProbability: ~90% (but low payout)",

        setting_stake: "💰 **STAKE**\n\nAmount you risk per trade\n\n**Recommendations:**\n• Beginners: $0.35 - $1.00\n• Intermediate: 1-2% of account\n• Advanced: Never more than 5%\n\n⚠️ Never risk what you can't lose!",
        
        setting_ticks: "⏱️ **TICKS**\n\nContract duration\n\n• 1 tick: Fastest (1-2 sec)\n• 3-5 ticks: Recommended\n• 10+ ticks: Longer term\n\n💡 Start with 3-5 ticks",
        
        setting_vlimit: "🎯 **V-LIMIT**\n\nHow many losses to wait before trading\n\n• V-Limit 0: Trade every tick (risky)\n• V-Limit 3: Wait for 3 losses (balanced)\n• V-Limit 5: Very patient (safer)\n\n✅ Beginners: Start with V-Limit 3",
        
        setting_bulk: "📦 **BULK**\n\nNumber of simultaneous trades\n\n• Bulk 1: One trade (safest)\n• Bulk 3: Three at once\n• Bulk 5: Five at once\n\n⚠️ Higher bulk = MUCH higher risk!\n✅ Start with Bulk 1",
        
        setting_martingale: "📈 **MARTINGALE**\n\nDoubling after loss to recover\n\nExample: $1 → $2 → $4 → $8\n\n**Settings:**\n• Multiplier: Usually 2.0\n• Limit: Max steps (3-4 recommended)\n\n⚠️ DANGEROUS without Stop Loss!",
        
        setting_tp: "💰 **TAKE PROFIT**\n\nAuto-stops when profit reaches target\n\nExample: TP $10 → bot stops at $10 profit\n\n✅ Locks in profits, prevents greed",
        
        setting_sl: "🛑 **STOP LOSS**\n\nAuto-stops when loss reaches limit\n\nExample: SL $5 → bot stops at $5 loss\n\n⚠️ MOST IMPORTANT setting!\n✅ NEVER trade without SL!",
        
        setting_burst: "💥 **BURST LIMIT**\n\nAggressive mode only - auto-stops after N ticks\n\n• 0: Unlimited\n• 10-20: Short session\n• 50+: Long session\n\n💡 Start with 20-30 ticks",
        
        setting_trigger: "🔢 **TRIGGER DIGITS**\n\nDigits that activate trades in DUAL/HEDGE modes\n\nExample: \"4,5\" fires when digit 4 or 5 appears\n\n💡 For HEDGE mode, use \"4,5\" (they're the losers!)",

        freebots_envy: "🔄 **Envy-differ Bot**\n\nDIFF contract strategy - trades when digit is NOT something\n\nLoad in Bot Builder and click Run!",
        
        freebots_hl: "🏦 **H_L auto vault Bot**\n\nHigh/Low vault approach - trades extremes\n\nLoad in Bot Builder and click Run!",
        
        freebots_topnotch: "⭐ **Top-notch 2 Bot**\n\nPremium multi-signal strategy with multiple filters\n\nLoad in Bot Builder and click Run!",
        
        freebots_superunder: "⬇️ **super_under Bot**\n\nUNDER contracts specialist for low digits\n\nLoad in Bot Builder and click Run!",
        
        freebots_autoc4: "💣 **auto_c4 Bot**\n\nC4 pattern automation - detects specific patterns\n\nLoad in Bot Builder and click Run!",
        
        freebots_evenodd: "⚖️ **even_odd Bot**\n\nParity-based strategy with momentum filters\n\nLoad in Bot Builder and click Run!",
        
        freebots_digitanalysis: "🔢 **digit_analysis Bot**\n\nFrequency-analysis trading - follows hot digits\n\nLoad in Bot Builder and click Run!",
        
        freebots_overbot: "⬆️ **over-bot**\n\nOVER-focused strategy for high digits\n\nLoad in Bot Builder and click Run!",
        
        freebots_under8: "8️⃣ **under-8bot**\n\nUNDER 8 specialist - 80% win rate!\n\nLoad in Bot Builder and click Run!",

        faq_how_to_start: "🚀 **HOW TO START TRADING**\n\n1️⃣ Create Deriv account\n2️⃣ Practice in Demo\n3️⃣ Start with HEDGE mode\n4️⃣ Use $0.35 stake\n5️⃣ Set V-Limit 3\n6️⃣ ALWAYS use Stop Loss ($1.00)\n7️⃣ Start with V10 or V75\n\n💡 Demo first, real later!",
        
        faq_best_settings: "⚙️ **BEST SETTINGS FOR BEGINNERS**\n\n• Mode: HEDGE (safest!)\n• Stake: $0.35\n• Ticks: 3-5\n• V-Limit: 3\n• Trigger: 4,5\n• TP: $2.00\n• SL: $1.00\n• Martingale: OFF\n\n✅ Test in demo first!",
        
        faq_why_losing: "💔 **WHY YOU MIGHT BE LOSING**\n\n1️⃣ No Stop Loss (most common!)\n2️⃣ Martingale too aggressive\n3️⃣ Wrong market for strategy\n4️⃣ Ignoring digit frequency\n5️⃣ Stake too high\n\n✅ Fix: Use HEDGE mode, SL $1, stake $0.35",
        
        faq_how_to_withdraw: "💸 **HOW TO WITHDRAW**\n\n1️⃣ Verify account FIRST\n2️⃣ Go to Cashier → Withdrawal\n3️⃣ Choose method (same as deposit)\n4️⃣ Enter amount\n5️⃣ Confirm\n\n⏱️ E-wallets: 24h, Cards: 1-3 days, Bank: 3-5 days\n\n🇰🇪 **For Kenya:** Use SwiftCash for fastest withdrawals!",
        
        faq_minimum_deposit: "💰 **MINIMUM DEPOSITS**\n\n• Cards: $5-10\n• E-wallets: $5-20\n• Crypto: $10-20\n• Bank Wire: $50\n\n🇰🇪 **M-PESA:** KES 500 minimum\n🇰🇪 **SwiftCash:** KES 500 minimum\n\n💡 Start with KES 1,000-2,000",
        
        faq_demo_account: "🎮 **HOW TO USE DEMO**\n\n1️⃣ Go to DTrader (Tab 3)\n2️⃣ Click 'Demo' toggle (top right)\n3️⃣ $10,000 virtual money!\n4️⃣ Practice any strategy\n5️⃣ Switch back anytime\n\n✅ No risk, perfect for learning!"
    };

    // ========== FORMAT SCAN RESULTS ==========
    const formatScanResults = (scanResult) => {
        if (!scanResult) return "❌ Unable to scan market. Please try again.";

        const s = scanResult;
        
        const signalsText = s.signals.map((sig, idx) => {
            const medal = idx === 0 ? '🥇' : idx === 1 ? '🥈' : idx === 2 ? '🥉' : '▫️';
            const prob = sig.probability !== 'N/A' ? `${sig.probability}%` : '';
            return `${medal} **${sig.type}${sig.value !== undefined ? ' ' + sig.value : ''}** ${prob} (${sig.confidence})\n   └ ${sig.reason}`;
        }).join('\n\n');

        const digitStats = s.digitStats.map(d => 
            `${d.digit}: ${d.pct}% (${d.count} times)`
        ).join('\n');

        return `
🔍 **LIVE SCAN - ${s.market}** (${s.timestamp})
━━━━━━━━━━━━━━━━━━━━━

🔥 **HOTTEST DIGIT: ${s.hottest.digit}** (${s.hottest.pct}%)
❄️ **COLDEST DIGIT: ${s.coldest.digit}** (${s.coldest.pct}%)

📊 **TOP 5 DIGITS:**
${digitStats}

${s.missingDigits.length > 0 ? `⚠️ **MISSING (last 100):** ${s.missingDigits.join(', ')}` : ''}
${s.maxStreak ? `🚨 **STREAK:** ${s.maxStreak.length}x consecutive **${s.maxStreak.digit}**!` : ''}

📈 **MARKET STATS:**
• EVEN: ${s.evenPct}% | ODD: ${s.oddPct}%
• RISE: ${s.risePct}% | FALL: ${s.fallPct}%

🎯 **TOP SIGNALS:**
${signalsText}

❓ **Click any market in SCAN tab for more!**`;
    };

    // Fix 7: Non-blocking formatAllMarketsScan
    const formatAllMarketsScan = () => {
        const results = scanAllMarkets();
        
        let report = "🌐 **ALL MARKETS COMPARISON**\n━━━━━━━━━━━━━━━━━━━━━\n\n";
        
        const marketOrder = ['R_100', '1HZ100V', 'R_75', '1HZ75V', 'R_50', '1HZ50V', 'R_25', '1HZ25V', 'R_10', '1HZ10V', '1HZ90V', '1HZ30V', '1HZ15V'];
        
        marketOrder.forEach(marketId => {
            const res = results[marketId];
            if (res) {
                report += `📊 **${res.market}**\n`;
                report += `🔥 Hot: ${res.hottest.digit} (${res.hottest.pct}%) | ❄️ Cold: ${res.coldest.digit} (${res.coldest.pct}%)\n`;
                report += `📈 EVEN: ${res.evenPct}% | ODD: ${res.oddPct}%\n`;
                
                if (res.signals.length > 0) {
                    const topSignal = res.signals[0];
                    report += `🎯 Top: ${topSignal.type}${topSignal.value !== undefined ? ' ' + topSignal.value : ''} (${topSignal.confidence})\n`;
                }
                report += `━━━━━━━━━━━━━━━━\n`;
            }
        });
        
        report += "\n💡 **Click any market in SCAN tab for detailed analysis!**";
        return report;
    };

    // ========== HANDLE TAB CLICK ==========
    const handleTabClick = (tabId) => {
        playMessageSound();
        
        if (activeTab !== 'main') {
            setMenuHistory(prev => [...prev, { tab: activeTab, subMenu: activeSubMenu }]);
        }
        
        setActiveTab(tabId);
        setActiveSubMenu(null);
        
        setChatMessages(prev => [...prev, {
            id: Date.now(),
            type: 'ai',
            message: `📌 **${mainTabs.find(t => t.id === tabId)?.label}** selected. Choose an option below:`,
            timestamp: new Date().toLocaleTimeString()
        }]);
    };

    // ========== HANDLE BACK ==========
    const handleBack = () => {
        playMessageSound();
        
        if (menuHistory.length > 0) {
            const lastState = menuHistory[menuHistory.length - 1];
            setActiveTab(lastState.tab);
            setActiveSubMenu(lastState.subMenu);
            setMenuHistory(prev => prev.slice(0, -1));
            
            setChatMessages(prev => [...prev, {
                id: Date.now(),
                type: 'ai',
                message: `↩️ Back to **${mainTabs.find(t => t.id === lastState.tab)?.label}**`,
                timestamp: new Date().toLocaleTimeString()
            }]);
        } else {
            setActiveTab('main');
            setActiveSubMenu(null);
            
            setChatMessages(prev => [...prev, {
                id: Date.now(),
                type: 'ai',
                message: `↩️ Back to **Main Menu**`,
                timestamp: new Date().toLocaleTimeString()
            }]);
        }
    };

    // ========== HANDLE SUB MENU CLICK ==========
    const handleSubMenuClick = (optionId) => {
        playMessageSound();

        if (activeTab !== 'main') {
            setMenuHistory(prev => [...prev, { tab: activeTab, subMenu: activeSubMenu }]);
        }

        if (optionId.startsWith('scan_')) {
            if (optionId === 'scan_current') {
                const scanResult = scanMarket(symbol, 500);
                const response = formatScanResults(scanResult);
                setActiveAnswer({
                    title: `📊 ${scanResult.market} Analysis`,
                    content: response
                });
                setIsChatFullScreen(true);
                setShowChatBoard(false);
                return;
            }
            
            if (optionId === 'scan_all') {
                const response = formatAllMarketsScan();
                setActiveAnswer({
                    title: '🌐 All Markets Comparison',
                    content: response
                });
                setIsChatFullScreen(true);
                setShowChatBoard(false);
                return;
            }
            
            const marketId = optionId.replace('scan_', '');
            const scanResult = scanMarket(marketId, 500);
            const response = formatScanResults(scanResult);
            setActiveAnswer({
                title: `📊 ${scanResult.market} Analysis`,
                content: response
            });
            setIsChatFullScreen(true);
            setShowChatBoard(false);
            return;
        }

        if (knowledgeBase[optionId]) {
            let category = 'Information';
            for (const [key, menu] of Object.entries(subMenus)) {
                if (menu.options.some(opt => opt.id === optionId)) {
                    category = menu.title;
                    break;
                }
            }
            
            setActiveAnswer({
                title: category,
                content: knowledgeBase[optionId]
            });
            setIsChatFullScreen(true);
            setShowChatBoard(false);
            return;
        }
    };

    // ========== CLOSE FULL SCREEN ==========
    const closeFullScreen = () => {
        setIsChatFullScreen(false);
        setActiveAnswer(null);
    };

    // Toggle chatboard
    const toggleChatBoard = () => {
        setShowChatBoard(!showChatBoard);
        if (!showChatBoard) {
            playMessageSound();
        }
    };

    // Stats calculations
    const stats = Array.from({ length: 10 }, (_, i) => ({
        num: i, 
        count: history.filter(d => d === i).length,
        pct: history.length ? ((history.filter(d => d === i).length / history.length) * 100).toFixed(1) : "0.0"
    }));

    const sortedByFreq = [...stats].sort((a, b) => b.count - a.count);
    const getColor = (num) => {
        if (num === sortedByFreq[0]?.num) return '#00ff00';
        if (num === sortedByFreq[1]?.num) return '#0000ff';
        if (num === sortedByFreq[9]?.num) return '#ff444f';
        if (num === sortedByFreq[8]?.num) return '#767d27';
        return '#f6ffffff';
    };

    const evenCount = history.filter(d => d % 2 === 0).length;
    const evenPct = history.length ? ((evenCount / history.length) * 100).toFixed(1) : "0.0";
    const riseCount = tickHistory.filter((p, i) => i < tickHistory.length - 1 && p > tickHistory[i + 1]).length;
    const risePct = tickHistory.length > 1 ? ((riseCount / (tickHistory.length - 1)) * 100).toFixed(1) : "0.0";

    const getGridColumns = () => {
        if (screenSize.isMobile) return '1fr';
        if (screenSize.isTablet) return 'repeat(2, 1fr)';
        return 'repeat(3, 1fr)';
    };

    return (
        <div className="digit-tool-container" style={{
            width: '100%',
            height: '100vh',
            background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
            color: '#fff',
            fontFamily: "'Inter', 'Roboto', 'Arial', sans-serif",
            overflow: 'hidden',
            display: 'flex',
            flexDirection: 'column',
            position: 'relative'
        }}>
            <style>{`
                @import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;600;700;800&display=swap');
                
                * { margin: 0; padding: 0; box-sizing: border-box; }

                .digit-tool-container { animation: fadeIn 0.5s ease; }

                @keyframes fadeIn {
                    from { opacity: 0; transform: translateY(20px); }
                    to { opacity: 1; transform: translateY(0); }
                }

                @keyframes pulse {
                    0% { transform: scale(1); box-shadow: 0 0 20px rgba(0,255,65,0.3); }
                    50% { transform: scale(1.08); box-shadow: 0 0 40px rgba(0,255,65,0.6); }
                    100% { transform: scale(1); box-shadow: 0 0 20px rgba(0,255,65,0.3); }
                }

                @keyframes slideIn {
                    from { transform: translateX(-100%); opacity: 0; }
                    to { transform: translateX(0); opacity: 1; }
                }

                @keyframes slideInRight {
                    from { transform: translateX(100%); opacity: 0; }
                    to { transform: translateX(0); opacity: 1; }
                }

                .glass-card {
                    background: rgba(255, 255, 255, 0.1);
                    backdrop-filter: blur(10px);
                    border: 1px solid rgba(255, 255, 255, 0.2);
                    border-radius: 20px;
                    transition: all 0.3s ease;
                }

                .glass-card:hover {
                    background: rgba(255, 255, 255, 0.15);
                    border: 1px solid rgba(255, 255, 255, 0.3);
                    transform: translateY(-2px);
                }

                .digit-circle {
                    transition: all 0.3s ease;
                    cursor: pointer;
                    will-change: transform;
                }

                .digit-circle:hover {
                    transform: scale(1.1);
                    box-shadow: 0 0 20px rgba(0,255,65,0.5);
                }

                .market-selector {
                    background: rgba(0, 0, 0, 0.2);
                    border: 1px solid rgba(255, 255, 255, 0.1);
                    color: white;
                    padding: 10px 15px;
                    border-radius: 10px;
                    font-size: 14px;
                    cursor: pointer;
                    transition: all 0.3s ease;
                }

                .market-selector:hover {
                    background: rgba(255, 255, 255, 0.1);
                    border-color: rgba(255, 255, 255, 0.3);
                }

                .chat-message {
                    animation: slideIn 0.3s ease;
                    max-width: 85%;
                    word-wrap: break-word;
                }

                .chat-message.user {
                    margin-left: auto;
                }

                .chat-message.ai {
                    margin-right: auto;
                }

                .fullscreen-answer {
                    animation: slideInRight 0.3s ease;
                }

                .answer-content {
                    font-size: 16px;
                    line-height: 1.8;
                }

                .answer-content h1, .answer-content h2, .answer-content h3, .answer-content h4 {
                    color: #ff9800;
                    margin: 20px 0 10px 0;
                }

                .answer-content h1 { font-size: 28px; }
                .answer-content h2 { font-size: 24px; }
                .answer-content h3 { font-size: 20px; }
                .answer-content h4 { font-size: 18px; }

                .answer-content ul, .answer-content ol {
                    margin: 10px 0 10px 20px;
                }

                .answer-content li {
                    margin: 5px 0;
                }

                .answer-content table {
                    width: 100%;
                    border-collapse: collapse;
                    margin: 15px 0;
                    background: rgba(0,0,0,0.2);
                }

                .answer-content th, .answer-content td {
                    border: 1px solid rgba(255,255,255,0.2);
                    padding: 10px;
                    text-align: left;
                }

                .answer-content th {
                    background: rgba(255,152,0,0.2);
                    font-weight: bold;
                }

                .answer-content tr:nth-child(even) {
                    background: rgba(255,255,255,0.05);
                }

                .answer-content code {
                    background: rgba(0,0,0,0.3);
                    padding: 2px 5px;
                    border-radius: 4px;
                    font-family: monospace;
                }

                .answer-content blockquote {
                    border-left: 4px solid #ff9800;
                    margin: 10px 0;
                    padding: 10px 20px;
                    background: rgba(255,152,0,0.1);
                    border-radius: 0 10px 10px 0;
                }

                .typing-indicator span {
                    animation: typing 1.4s infinite;
                    display: inline-block;
                }

                .typing-indicator span:nth-child(2) { animation-delay: 0.2s; }
                .typing-indicator span:nth-child(3) { animation-delay: 0.4s; }

                .custom-scrollbar {
                    overflow-y: auto;
                    overflow-x: hidden;
                    scrollbar-width: thin;
                    scrollbar-color: rgba(0, 255, 65, 0.5) rgba(0, 0, 0, 0.2);
                }

                .custom-scrollbar::-webkit-scrollbar {
                    width: 8px;
                    height: 8px;
                }

                .custom-scrollbar::-webkit-scrollbar-track {
                    background: rgba(0, 0, 0, 0.2);
                    border-radius: 10px;
                }

                .custom-scrollbar::-webkit-scrollbar-thumb {
                    background: linear-gradient(135deg, #00ff41, #00bcd4);
                    border-radius: 10px;
                }

                .tab-button {
                    background: rgba(255, 255, 255, 0.1);
                    border: 1px solid rgba(255, 255, 255, 0.2);
                    border-radius: 8px;
                    padding: 6px 8px;
                    color: white;
                    font-size: 11px;
                    font-weight: 600;
                    cursor: pointer;
                    transition: all 0.3s ease;
                    display: flex;
                    align-items: center;
                    gap: 4px;
                    white-space: nowrap;
                }

                .tab-button:hover {
                    background: rgba(255, 255, 255, 0.2);
                    border-color: #00ff41;
                }

                .tab-button.active {
                    background: linear-gradient(135deg, #ff9800, #f44336);
                    border: none;
                }

                .tab-button.highlight {
                    background: linear-gradient(135deg, #ff9800, #f44336);
                    border: none;
                }

                .submenu-button {
                    background: rgba(255, 255, 255, 0.1);
                    border: 1px solid rgba(255, 255, 255, 0.2);
                    border-radius: 8px;
                    padding: 6px 8px;
                    color: white;
                    font-size: 10px;
                    cursor: pointer;
                    transition: all 0.3s ease;
                    text-align: left;
                    display: flex;
                    align-items: center;
                    gap: 4px;
                }

                .submenu-button:hover {
                    background: rgba(255, 255, 255, 0.2);
                    border-color: #00ff41;
                }

                .submenu-button.highlight {
                    background: linear-gradient(135deg, #ff9800, #f44336);
                    border: none;
                }

                .floating-chat-button {
                    position: fixed;
                    bottom: 20px;
                    left: 20px;
                    width: 60px;
                    height: 60px;
                    border-radius: 50%;
                    background: linear-gradient(135deg, #ff9800, #f44336);
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    font-size: 28px;
                    cursor: pointer;
                    box-shadow: 0 0 30px #ff9800;
                    z-index: 1000;
                    transition: all 0.3s ease;
                    border: 3px solid rgba(255,255,255,0.5);
                    will-change: transform;
                    transform: translateZ(0);
                }

                .floating-chat-button:hover {
                    transform: scale(1.1);
                    box-shadow: 0 0 40px #ff9800;
                }

                @media (max-width: 768px) {
                    .floating-chat-button {
                        width: 50px;
                        height: 50px;
                        font-size: 24px;
                        bottom: 15px;
                        left: 15px;
                    }
                    
                    .glass-card {
                        padding: 15px !important;
                    }
                    
                    .answer-content {
                        font-size: 14px;
                    }
                    
                    .answer-content h1 { font-size: 22px; }
                    .answer-content h2 { font-size: 20px; }
                    .answer-content h3 { font-size: 18px; }
                }
            `}</style>

            {/* MAIN CONTENT */}
            {!isChatFullScreen && (
                <div className="custom-scrollbar" style={{
                    flex: 1,
                    padding: screenSize.isMobile ? '15px' : '25px',
                    overflowY: 'auto',
                    height: '100%',
                    width: '100%',
                    paddingBottom: '80px'
                }}>
                    {/* Header Section */}
                    <div className="glass-card" style={{
                        padding: screenSize.isMobile ? '20px' : '30px',
                        marginBottom: '30px',
                        background: 'linear-gradient(135deg, rgba(0,0,0,0.2) 0%, rgba(0,0,0,0.4) 100%)'
                    }}>
                        <div style={{
                            display: 'flex',
                            flexDirection: screenSize.isMobile ? 'column' : 'row',
                            justifyContent: 'space-between',
                            alignItems: screenSize.isMobile ? 'stretch' : 'center',
                            gap: '20px'
                        }}>
                            <div>
                                <h1 style={{
                                    fontSize: screenSize.isMobile ? '24px' : '36px',
                                    fontWeight: '800',
                                    marginBottom: '10px',
                                    background: 'linear-gradient(45deg, #00ff41, #00bcd4)',
                                    WebkitBackgroundClip: 'text',
                                    WebkitTextFillColor: 'transparent',
                                    letterSpacing: '2px'
                                }}>
                                    DIGIT CIRCLE PRO
                                </h1>
                                <p style={{
                                    color: 'rgba(255,255,255,0.7)',
                                    fontSize: screenSize.isMobile ? '12px' : '14px'
                                }}>
                                    Advanced Digit Analysis & Pattern Recognition System
                                </p>
                            </div>
                            
                            <div style={{
                                display: 'flex',
                                gap: '15px',
                                flexWrap: 'wrap'
                            }}>
                                <select 
                                    className="market-selector"
                                    value={symbol} 
                                    onChange={(e) => setSymbol(e.target.value)}
                                    style={{
                                        minWidth: screenSize.isMobile ? '100%' : '200px'
                                    }}
                                >
                                    {markets.map(m => (
                                        <option key={m.id} value={m.id}>
                                            {m.name}
                                        </option>
                                    ))}
                                </select>
                                
                                <div style={{
                                    background: 'rgba(0,0,0,0.3)',
                                    padding: '10px 20px',
                                    borderRadius: '10px',
                                    display: 'flex',
                                    flexDirection: 'column'
                                }}>
                                    <span style={{ fontSize: '12px', opacity: 0.7 }}>LIVE PRICE</span>
                                    <span style={{
                                        fontSize: screenSize.isMobile ? '24px' : '28px',
                                        fontWeight: 'bold',
                                        color: '#00ff41',
                                        textShadow: '0 0 10px rgba(0,255,65,0.3)'
                                    }}>
                                        {price}
                                    </span>
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* Main Content Grid */}
                    <div style={{
                        display: 'grid',
                        gridTemplateColumns: getGridColumns(),
                        gap: screenSize.isMobile ? '15px' : '25px',
                        marginBottom: '30px'
                    }}>
                        {/* Digit Circle Section */}
                        <div className="glass-card" style={{
                            gridColumn: screenSize.isDesktop ? 'span 1' : 'span 1',
                            padding: screenSize.isMobile ? '20px' : '25px'
                        }}>
                            <h3 style={{
                                fontSize: screenSize.isMobile ? '18px' : '22px',
                                marginBottom: '20px',
                                display: 'flex',
                                alignItems: 'center',
                                gap: '10px',
                                color: '#fff',
                                fontWeight: '600'
                            }}>
                                <span style={{ color: '#00ff41' }}>●</span>
                                DIGITAL FREQUENCY
                            </h3>
                            
                            <div style={{
                                display: 'grid',
                                gridTemplateColumns: 'repeat(5, 1fr)',
                                gap: screenSize.isMobile ? '8px' : '12px'
                            }}>
                                {stats.map(s => (
                                    <div key={s.num} style={{
                                        display: 'flex',
                                        flexDirection: 'column',
                                        alignItems: 'center',
                                        animation: 'slideIn 0.5s ease'
                                    }}>
                                        <div style={{
                                            position: 'relative',
                                            marginBottom: '5px'
                                        }}>
                                            {history[0] === s.num && (
                                                <div style={{
                                                    position: 'absolute',
                                                    top: -20,
                                                    left: '50%',
                                                    transform: 'translateX(-50%)',
                                                    color: '#00ff41',
                                                    fontSize: screenSize.isMobile ? '12px' : '14px',
                                                    animation: 'pulse 1s infinite',
                                                    whiteSpace: 'nowrap'
                                                }}>
                                                    ▼ CURRENT
                                                </div>
                                            )}
                                            <div className="digit-circle" style={{
                                                width: screenSize.isMobile ? '50px' : '60px',
                                                height: screenSize.isMobile ? '50px' : '60px',
                                                borderRadius: '50%',
                                                border: `4px solid ${getColor(s.num)}`,
                                                display: 'flex',
                                                alignItems: 'center',
                                                justifyContent: 'center',
                                                fontSize: screenSize.isMobile ? '24px' : '28px',
                                                fontWeight: 'bold',
                                                background: history[0] === s.num ? getColor(s.num) : 'rgba(0,0,0,0.3)',
                                                color: history[0] === s.num ? '#000' : '#fff',
                                                boxShadow: `0 0 20px ${getColor(s.num)}33`,
                                                marginBottom: '10px'
                                            }}>
                                                {s.num}
                                            </div>
                                            <span style={{
                                                fontSize: screenSize.isMobile ? '14px' : '16px',
                                                fontWeight: 'bold',
                                                color: getColor(s.num)
                                            }}>
                                                {s.pct}%
                                            </span>
                                        </div>
                                    </div>
                                ))}
                            </div>
                            
                            <div style={{
                                display: 'flex',
                                flexWrap: 'wrap',
                                gap: '15px',
                                marginTop: '20px',
                                paddingTop: '20px',
                                borderTop: '1px solid rgba(255,255,255,0.1)'
                            }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                    <div style={{ width: '12px', height: '12px', background: '#00ff00', borderRadius: '2px' }} />
                                    <span style={{ fontSize: '12px', color: 'rgba(255,255,255,0.7)' }}>MOST FREQUENT</span>
                                </div>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                    <div style={{ width: '12px', height: '12px', background: '#0000ff', borderRadius: '2px' }} />
                                    <span style={{ fontSize: '12px', color: 'rgba(255,255,255,0.7)' }}>2nd MOST</span>
                                </div>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                    <div style={{ width: '12px', height: '12px', background: '#ff444f', borderRadius: '2px' }} />
                                    <span style={{ fontSize: '12px', color: 'rgba(255,255,255,0.7)' }}>LEAST FREQUENT</span>
                                </div>
                            </div>
                        </div>

                        {/* Even/Odd & Pattern Section */}
                        <div className="glass-card" style={{
                            padding: screenSize.isMobile ? '20px' : '25px'
                        }}>
                            <h3 style={{
                                fontSize: screenSize.isMobile ? '18px' : '22px',
                                marginBottom: '20px',
                                display: 'flex',
                                alignItems: 'center',
                                gap: '10px',
                                color: '#fff',
                                fontWeight: '600'
                            }}>
                                <span style={{ color: '#00bcd4' }}>◉</span>
                                PARITY ANALYSIS
                            </h3>
                            
                            <div style={{
                                display: 'grid',
                                gridTemplateColumns: '1fr 1fr',
                                gap: '15px',
                                marginBottom: '25px'
                            }}>
                                <div style={{
                                    background: 'rgba(0,255,65,0.1)',
                                    padding: '20px',
                                    borderRadius: '15px',
                                    textAlign: 'center',
                                    border: '1px solid rgba(0,255,65,0.3)'
                                }}>
                                    <div style={{
                                        fontSize: screenSize.isMobile ? '32px' : '42px',
                                        fontWeight: 'bold',
                                        color: '#00ff41',
                                        textShadow: '0 0 20px rgba(0,255,65,0.3)'
                                    }}>
                                        {evenPct}%
                                    </div>
                                    <div style={{ fontSize: '14px', opacity: 0.8 }}>EVEN</div>
                                </div>
                                
                                <div style={{
                                    background: 'rgba(255,68,79,0.1)',
                                    padding: '20px',
                                    borderRadius: '15px',
                                    textAlign: 'center',
                                    border: '1px solid rgba(255,68,79,0.3)'
                                }}>
                                    <div style={{
                                        fontSize: screenSize.isMobile ? '32px' : '42px',
                                        fontWeight: 'bold',
                                        color: '#ff444f',
                                        textShadow: '0 0 20px rgba(255,68,79,0.3)'
                                    }}>
                                        {(100 - evenPct).toFixed(1)}%
                                    </div>
                                    <div style={{ fontSize: '14px', opacity: 0.8 }}>ODD</div>
                                </div>
                            </div>
                            
                            <div style={{
                                background: 'rgba(0,0,0,0.2)',
                                padding: '20px',
                                borderRadius: '15px'
                            }}>
                                <div style={{
                                    fontSize: '12px',
                                    opacity: 0.7,
                                    marginBottom: '10px'
                                }}>
                                    LAST 25 PATTERN
                                </div>
                                <div style={{
                                    display: 'grid',
                                    gridTemplateColumns: 'repeat(5, 1fr)',
                                    gap: '5px'
                                }}>
                                    {pattern.map((p, i) => (
                                        <div key={i} style={{
                                            aspectRatio: '1',
                                            background: p === 'E' ? 'rgba(0,255,65,0.1)' : 'rgba(255,68,79,0.1)',
                                            border: `2px solid ${p === 'E' ? '#00ff41' : '#ff444f'}`,
                                            borderRadius: '8px',
                                            display: 'flex',
                                            alignItems: 'center',
                                            justifyContent: 'center',
                                            fontSize: screenSize.isMobile ? '14px' : '16px',
                                            fontWeight: 'bold',
                                            color: p === 'E' ? '#00ff41' : '#ff444f'
                                        }}>
                                            {p}
                                        </div>
                                    ))}
                                </div>
                            </div>
                        </div>

                        {/* Rise/Fall & Digit Comparison */}
                        <div className="glass-card" style={{
                            padding: screenSize.isMobile ? '20px' : '25px'
                        }}>
                            <h3 style={{
                                fontSize: screenSize.isMobile ? '18px' : '22px',
                                marginBottom: '20px',
                                display: 'flex',
                                alignItems: 'center',
                                gap: '10px',
                                color: '#fff',
                                fontWeight: '600'
                            }}>
                                <span style={{ color: '#ff9800' }}>▲</span>
                                TREND ANALYSIS
                            </h3>
                            
                            <div style={{
                                display: 'grid',
                                gridTemplateColumns: '1fr 1fr',
                                gap: '15px',
                                marginBottom: '25px'
                            }}>
                                <div style={{
                                    background: 'linear-gradient(135deg, #00b09b, #96c93d)',
                                    padding: '20px',
                                    borderRadius: '15px',
                                    textAlign: 'center'
                                }}>
                                    <div style={{
                                        fontSize: screenSize.isMobile ? '28px' : '36px',
                                        fontWeight: 'bold'
                                    }}>
                                        {risePct}%
                                    </div>
                                    <div style={{ fontSize: '14px', opacity: 0.9 }}>RISE</div>
                                </div>
                                
                                <div style={{
                                    background: 'linear-gradient(135deg, #f12711, #f5af19)',
                                    padding: '20px',
                                    borderRadius: '15px',
                                    textAlign: 'center'
                                }}>
                                    <div style={{
                                        fontSize: screenSize.isMobile ? '28px' : '36px',
                                        fontWeight: 'bold'
                                    }}>
                                        {(100 - risePct).toFixed(1)}%
                                    </div>
                                    <div style={{ fontSize: '14px', opacity: 0.9 }}>FALL</div>
                                </div>
                            </div>
                            
                            <div style={{
                                background: 'rgba(0,0,0,0.2)',
                                padding: '20px',
                                borderRadius: '15px'
                            }}>
                                <div style={{
                                    fontSize: '14px',
                                    marginBottom: '15px',
                                    color: '#00bcd4'
                                }}>
                                    SELECT DIGIT FOR COMPARISON
                                </div>
                                
                                <div style={{
                                    display: 'grid',
                                    gridTemplateColumns: 'repeat(5, 1fr)',
                                    gap: '8px',
                                    marginBottom: '20px'
                                }}>
                                    {[0,1,2,3,4,5,6,7,8,9].map(n => (
                                        <button
                                            key={n}
                                            onClick={() => setSelectedDigit(n)}
                                            style={{
                                                padding: '10px',
                                                background: selectedDigit === n ? '#00ff41' : 'rgba(255,255,255,0.1)',
                                                border: 'none',
                                                borderRadius: '8px',
                                                color: selectedDigit === n ? '#000' : '#fff',
                                                fontSize: '18px',
                                                fontWeight: 'bold',
                                                cursor: 'pointer',
                                                transition: 'all 0.3s ease',
                                                border: selectedDigit === n ? '2px solid #fff' : '2px solid transparent'
                                            }}
                                        >
                                            {n}
                                        </button>
                                    ))}
                                </div>
                                
                                <div style={{
                                    display: 'grid',
                                    gridTemplateColumns: '1fr 1fr 1fr',
                                    gap: '10px',
                                    textAlign: 'center'
                                }}>
                                    <div>
                                        <div style={{
                                            fontSize: '24px',
                                            fontWeight: 'bold',
                                            color: '#00ff41'
                                        }}>
                                            {((history.filter(d => d > selectedDigit).length / Math.max(1, history.length)) * 100).toFixed(1)}%
                                        </div>
                                        <div style={{ fontSize: '12px', opacity: 0.7 }}>OVER {selectedDigit}</div>
                                    </div>
                                    <div>
                                        <div style={{
                                            fontSize: '24px',
                                            fontWeight: 'bold',
                                            color: '#ff444f'
                                        }}>
                                            {((history.filter(d => d < selectedDigit).length / Math.max(1, history.length)) * 100).toFixed(1)}%
                                        </div>
                                        <div style={{ fontSize: '12px', opacity: 0.7 }}>UNDER {selectedDigit}</div>
                                    </div>
                                    <div>
                                        <div style={{
                                            fontSize: '24px',
                                            fontWeight: 'bold',
                                            color: '#00bcd4'
                                        }}>
                                            {((history.filter(d => d === selectedDigit).length / Math.max(1, history.length)) * 100).toFixed(1)}%
                                        </div>
                                        <div style={{ fontSize: '12px', opacity: 0.7 }}>EQUAL {selectedDigit}</div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* Last 50 Digits Section */}
                    <div className="glass-card" style={{
                        padding: screenSize.isMobile ? '20px' : '25px',
                        marginBottom: '30px'
                    }}>
                        <div style={{
                            display: 'flex',
                            justifyContent: 'space-between',
                            alignItems: 'center',
                            marginBottom: '20px',
                            flexWrap: 'wrap',
                            gap: '15px'
                        }}>
                            <h3 style={{
                                fontSize: screenSize.isMobile ? '18px' : '22px',
                                display: 'flex',
                                alignItems: 'center',
                                gap: '10px',
                                color: '#fff',
                                fontWeight: '600'
                            }}>
                                <span style={{ color: '#ff9800' }}>📊</span>
                                LAST 50 DIGITS
                            </h3>
                            
                            <div style={{
                                display: 'flex',
                                gap: '10px',
                                alignItems: 'center'
                            }}>
                                <span style={{
                                    width: '10px',
                                    height: '10px',
                                    background: '#00ff41',
                                    borderRadius: '2px'
                                }} />
                                <span style={{ fontSize: '12px', color: 'rgba(255,255,255,0.7)' }}>EVEN</span>
                                <span style={{
                                    width: '10px',
                                    height: '10px',
                                    background: '#ff444f',
                                    borderRadius: '2px'
                                }} />
                                <span style={{ fontSize: '12px', color: 'rgba(255,255,255,0.7)' }}>ODD</span>
                                <span style={{
                                    width: '10px',
                                    height: '10px',
                                    background: '#e2ed0a',
                                    borderRadius: '2px'
                                }} />
                                <span style={{ fontSize: '12px', color: 'rgba(255,255,255,0.7)' }}>CURRENT</span>
                            </div>
                        </div>
                        
                        <div style={{
                            display: 'grid',
                            gridTemplateColumns: 'repeat(10, 1fr)',
                            gap: screenSize.isMobile ? '5px' : '8px'
                        }}>
                            {history.slice(0, 50).map((d, i) => (
                                <div key={i} style={{
                                    aspectRatio: '1',
                                    background: i === 0 ? '#e2ed0a' : (d % 2 === 0 ? 'rgba(0,255,65,0.1)' : 'rgba(255,68,79,0.1)'),
                                    border: `2px solid ${i === 0 ? '#e2ed0a' : (d % 2 === 0 ? '#00ff41' : '#ff444f')}`,
                                    borderRadius: '8px',
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    fontSize: screenSize.isMobile ? '14px' : '16px',
                                    fontWeight: 'bold',
                                    color: i === 0 ? '#000' : (d % 2 === 0 ? '#00ff41' : '#ff444f'),
                                    transform: i === 0 ? 'scale(1.1)' : 'scale(1)',
                                    transition: 'all 0.3s ease',
                                    boxShadow: i === 0 ? '0 0 20px rgba(226,237,10,0.5)' : 'none'
                                }}>
                                    {d}
                                </div>
                            ))}
                        </div>
                    </div>
                </div>
            )}

            {/* FULL-SCREEN ANSWER VIEW */}
            {isChatFullScreen && activeAnswer && (
                <div className="fullscreen-answer" style={{
                    position: 'fixed',
                    top: 0,
                    left: 0,
                    right: 0,
                    bottom: 0,
                    background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
                    zIndex: 2000,
                    display: 'flex',
                    flexDirection: 'column',
                    overflow: 'hidden'
                }}>
                    {/* Header */}
                    <div style={{
                        padding: screenSize.isMobile ? '15px' : '20px',
                        background: 'rgba(0,0,0,0.3)',
                        backdropFilter: 'blur(10px)',
                        borderBottom: '2px solid #ff9800',
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center'
                    }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '15px' }}>
                            <button
                                onClick={closeFullScreen}
                                style={{
                                    background: '#ff9800',
                                    border: 'none',
                                    color: '#000',
                                    width: '40px',
                                    height: '40px',
                                    borderRadius: '50%',
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    fontSize: '20px',
                                    cursor: 'pointer',
                                    fontWeight: 'bold',
                                    boxShadow: '0 0 20px rgba(255,152,0,0.5)'
                                }}
                            >
                                ←
                            </button>
                            <h2 style={{
                                fontSize: screenSize.isMobile ? '18px' : '24px',
                                color: '#fff',
                                margin: 0,
                                fontWeight: '600'
                            }}>
                                {activeAnswer.title}
                            </h2>
                        </div>
                        <button
                            onClick={closeFullScreen}
                            style={{
                                background: 'rgba(255,255,255,0.1)',
                                border: '1px solid rgba(255,255,255,0.2)',
                                color: '#fff',
                                padding: '8px 20px',
                                borderRadius: '20px',
                                fontSize: '14px',
                                cursor: 'pointer',
                                transition: 'all 0.3s ease'
                            }}
                            onMouseEnter={(e) => e.target.style.background = 'rgba(255,255,255,0.2)'}
                            onMouseLeave={(e) => e.target.style.background = 'rgba(255,255,255,0.1)'}
                        >
                            Close
                        </button>
                    </div>

                    {/* Scrollable Content */}
                    <div style={{
                        flex: 1,
                        overflowY: 'auto',
                        padding: screenSize.isMobile ? '20px' : '30px',
                        background: 'rgba(0,0,0,0.2)'
                    }}>
                        <div className="glass-card" style={{
                            padding: screenSize.isMobile ? '25px' : '40px',
                            maxWidth: '900px',
                            margin: '0 auto',
                            background: 'rgba(0,0,0,0.3)',
                            backdropFilter: 'blur(10px)'
                        }}>
                            <div className="answer-content" style={{
                                color: '#fff',
                                fontSize: screenSize.isMobile ? '14px' : '16px',
                                lineHeight: '1.8'
                            }}>
                                {activeAnswer.content.split('\n').map((line, i) => {
                                    if (line.startsWith('# ')) {
                                        return <h1 key={i}>{line.substring(2)}</h1>;
                                    }
                                    if (line.startsWith('## ')) {
                                        return <h2 key={i}>{line.substring(3)}</h2>;
                                    }
                                    if (line.startsWith('### ')) {
                                        return <h3 key={i}>{line.substring(4)}</h3>;
                                    }
                                    if (line.startsWith('#### ')) {
                                        return <h4 key={i}>{line.substring(5)}</h4>;
                                    }
                                    if (line.startsWith('• ') || line.startsWith('- ')) {
                                        return <li key={i} style={{ marginLeft: '20px', listStyleType: 'disc' }}>{line.substring(2)}</li>;
                                    }
                                    if (line.match(/^\d+\./)) {
                                        return <li key={i} style={{ marginLeft: '20px', listStyleType: 'decimal' }}>{line}</li>;
                                    }
                                    if (line.includes('|') && line.includes('---')) {
                                        return null;
                                    }
                                    if (line.includes('|')) {
                                        const cells = line.split('|').filter(c => c.trim());
                                        if (cells.length > 0) {
                                            return (
                                                <div key={i} style={{ 
                                                    display: 'grid', 
                                                    gridTemplateColumns: `repeat(${cells.length}, 1fr)`,
                                                    gap: '10px',
                                                    padding: '8px 0',
                                                    borderBottom: '1px solid rgba(255,255,255,0.1)'
                                                }}>
                                                    {cells.map((cell, j) => (
                                                        <div key={j} style={{ 
                                                            fontWeight: i === 0 ? 'bold' : 'normal',
                                                            color: i === 0 ? '#ff9800' : 'inherit'
                                                        }}>
                                                            {cell.trim()}
                                                        </div>
                                                    ))}
                                                </div>
                                            );
                                        }
                                    }
                                    if (line.startsWith('```')) {
                                        return null;
                                    }
                                    if (line.startsWith('> ')) {
                                        return <blockquote key={i}>{line.substring(2)}</blockquote>;
                                    }
                                    return line ? <p key={i} style={{ margin: '10px 0' }}>{line}</p> : <br key={i} />;
                                })}
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* FLOATING CHAT BUTTON */}
            {!isChatFullScreen && (
                <div className="floating-chat-button" onClick={toggleChatBoard}>
                    💬
                    {chatMessages.length > 1 && (
                        <span style={{
                            position: 'absolute',
                            top: -5,
                            right: -5,
                            background: '#00ff41',
                            color: '#000',
                            borderRadius: '50%',
                            width: '22px',
                            height: '22px',
                            fontSize: '12px',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            border: '2px solid #fff'
                        }}>
                            {chatMessages.length - 1}
                        </span>
                    )}
                </div>
            )}

            {/* CHATBOT MODAL */}
            {showChatBoard && !isChatFullScreen && (
                <div style={{
                    position: 'fixed',
                    bottom: '90px',
                    left: '20px',
                    width: screenSize.isMobile ? 'calc(100% - 40px)' : '350px',
                    height: screenSize.isMobile ? '60vh' : '500px',
                    background: 'rgba(10,10,20,0.98)',
                    backdropFilter: 'blur(10px)',
                    borderRadius: '20px',
                    border: '2px solid #ff9800',
                    boxShadow: '0 0 30px rgba(255,152,0,0.3)',
                    zIndex: 1001,
                    display: 'flex',
                    flexDirection: 'column',
                    overflow: 'hidden'
                }}>
                    {/* Chat Header */}
                    <div style={{
                        padding: '12px',
                        background: 'linear-gradient(135deg, #ff9800, #f44336)',
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center'
                    }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <span style={{ fontSize: '18px' }}>🤖</span>
                            <div>
                                <h3 style={{ color: '#000', margin: 0, fontSize: '13px', fontWeight: 'bold' }}>Nyanyuki Assistant</h3>
                                <span style={{ fontSize: '9px', color: '#000', opacity: 0.8 }}>Click tabs above</span>
                            </div>
                        </div>
                        <div style={{ display: 'flex', gap: '5px' }}>
                            <button
                                onClick={() => {
                                    setChatMessages([{
                                        id: 1,
                                        type: 'ai',
                                        message: "👋 **WELCOME TO NYANYUKI BOT!**\n\nI'm your intelligent trading assistant. **CLICK ANY TAB ABOVE** to get instant information!",
                                        timestamp: new Date().toLocaleTimeString()
                                    }]);
                                    setActiveTab('main');
                                    setActiveSubMenu(null);
                                    setMenuHistory([]);
                                }}
                                style={{
                                    background: 'rgba(0,0,0,0.2)',
                                    border: 'none',
                                    color: '#000',
                                    fontSize: '10px',
                                    padding: '3px 6px',
                                    borderRadius: '5px',
                                    cursor: 'pointer'
                                }}
                            >
                                New
                            </button>
                            <button
                                onClick={toggleChatBoard}
                                style={{
                                    background: 'rgba(0,0,0,0.2)',
                                    border: 'none',
                                    color: '#000',
                                    fontSize: '14px',
                                    width: '22px',
                                    height: '22px',
                                    borderRadius: '50%',
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    cursor: 'pointer'
                                }}
                            >
                                ✕
                            </button>
                        </div>
                    </div>

                    {/* TABS */}
                    <div style={{
                        padding: '8px',
                        background: 'rgba(0,0,0,0.5)',
                        display: 'flex',
                        gap: '4px',
                        flexWrap: 'wrap',
                        borderBottom: '1px solid rgba(255,152,0,0.3)'
                    }}>
                        {mainTabs.map(tab => (
                            <button
                                key={tab.id}
                                className={`tab-button ${activeTab === tab.id ? 'active' : ''} ${tab.highlight ? 'highlight' : ''}`}
                                onClick={() => handleTabClick(tab.id)}
                                style={{
                                    flex: '1 0 auto',
                                    minWidth: '60px'
                                }}
                            >
                                <span>{tab.icon}</span>
                                <span>{tab.label}</span>
                            </button>
                        ))}
                    </div>

                    {/* SUB MENU TITLE with BACK BUTTON */}
                    {activeTab !== 'main' && subMenus[activeTab] && (
                        <div style={{
                            padding: '6px 8px',
                            background: 'rgba(255,152,0,0.15)',
                            borderBottom: '1px solid rgba(255,152,0,0.3)',
                            display: 'flex',
                            alignItems: 'center',
                            gap: '8px',
                            flexWrap: 'wrap'
                        }}>
                            <button
                                onClick={handleBack}
                                style={{
                                    background: 'rgba(255,255,255,0.1)',
                                    border: '1px solid rgba(255,255,255,0.2)',
                                    borderRadius: '12px',
                                    padding: '2px 10px',
                                    color: 'white',
                                    fontSize: '10px',
                                    cursor: 'pointer',
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: '4px'
                                }}
                            >
                                ← Back
                            </button>
                            <span style={{
                                background: '#ff9800',
                                color: '#000',
                                padding: '2px 8px',
                                borderRadius: '12px',
                                fontSize: '10px',
                                fontWeight: 'bold'
                            }}>
                                {subMenus[activeTab].title}
                            </span>
                        </div>
                    )}

                    {/* CHAT MESSAGES */}
                    <div style={{
                        flex: 1,
                        padding: '10px',
                        overflowY: 'auto',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '8px',
                        background: 'rgba(0,0,0,0.3)'
                    }}>
                        {chatMessages.map(msg => (
                            <div
                                key={msg.id}
                                className={`chat-message ${msg.type}`}
                                style={{
                                    maxWidth: '90%',
                                    padding: '8px 10px',
                                    borderRadius: msg.type === 'user' ? '12px 12px 4px 12px' : '12px 12px 12px 4px',
                                    background: msg.type === 'user' ? '#ff9800' : 'rgba(255,255,255,0.1)',
                                    color: msg.type === 'user' ? '#000' : '#fff',
                                    alignSelf: msg.type === 'user' ? 'flex-end' : 'flex-start',
                                    fontSize: '12px',
                                    lineHeight: '1.4',
                                    whiteSpace: 'pre-wrap'
                                }}
                            >
                                {msg.message.split('\n').map((line, i) => (
                                    <React.Fragment key={i}>
                                        {line}
                                        {i < msg.message.split('\n').length - 1 && <br />}
                                    </React.Fragment>
                                ))}
                                <div style={{
                                    fontSize: '7px',
                                    opacity: 0.6,
                                    marginTop: '4px',
                                    textAlign: 'right'
                                }}>
                                    {msg.timestamp}
                                </div>
                            </div>
                        ))}
                        
                        {isAiThinking && (
                            <div style={{
                                padding: '8px 12px',
                                borderRadius: '12px',
                                background: 'rgba(255,255,255,0.1)',
                                alignSelf: 'flex-start',
                                maxWidth: '85%'
                            }}>
                                <div className="typing-indicator">
                                    <span>●</span> <span>●</span> <span>●</span>
                                </div>
                            </div>
                        )}
                        <div ref={chatEndRef} />
                    </div>

                    {/* SUB MENU OPTIONS */}
                    {activeTab !== 'main' && subMenus[activeTab] && (
                        <div style={{
                            padding: '8px',
                            background: 'rgba(0,0,0,0.5)',
                            borderTop: '1px solid rgba(255,152,0,0.3)',
                            display: 'grid',
                            gridTemplateColumns: 'repeat(2, 1fr)',
                            gap: '4px',
                            maxHeight: '140px',
                            overflowY: 'auto'
                        }}>
                            {subMenus[activeTab].options.map(option => (
                                <button
                                    key={option.id}
                                    className={`submenu-button ${option.highlight ? 'highlight' : ''}`}
                                    onClick={() => handleSubMenuClick(option.id)}
                                    style={{
                                        gridColumn: 'span 1',
                                        padding: '6px'
                                    }}
                                >
                                    <span>{option.label.split(' ')[0]}</span>
                                    <div style={{ textAlign: 'left' }}>
                                        <div style={{ fontWeight: 'bold', fontSize: '9px' }}>{option.label}</div>
                                        {option.desc && (
                                            <div style={{ fontSize: '7px', opacity: 0.7 }}>{option.desc}</div>
                                        )}
                                    </div>
                                </button>
                            ))}
                        </div>
                    )}

                    {/* Quick Stats - Reads from ref directly (Fix 4) */}
                    <div style={{
                        padding: '4px 6px',
                        background: 'rgba(0,0,0,0.3)',
                        display: 'flex',
                        justifyContent: 'space-around',
                        fontSize: '8px',
                        color: 'rgba(255,255,255,0.8)',
                        borderTop: '1px solid rgba(255,255,255,0.1)'
                    }}>
                        <span>🔥 {sortedByFreq[0]?.num} ({sortedByFreq[0]?.pct}%)</span>
                        <span>📊 EVEN: {evenPct}%</span>
                        <span>📈 RISE: {risePct}%</span>
                        <span>💰 KES</span>
                    </div>
                </div>
            )}
        </div>
    );
};

export default DigitCircleTool;