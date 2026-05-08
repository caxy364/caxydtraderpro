// src/components/DTraderTab/DTraderTab.tsx
import React from 'react';
import { observer } from 'mobx-react-lite';
import { useStore } from '@/hooks/useStore';

export const DTraderTab = observer(() => {
    const { client } = useStore();
    
    const loginId = localStorage.getItem('active_loginid') || client.loginid;
    const accountsList = JSON.parse(localStorage.getItem('accountsList') || '{}');
    const token = localStorage.getItem('authToken') || accountsList[loginId] || '';
    const currency = client.accounts?.[loginId]?.currency || 'USD';
    const appId = '117013';

    const iframeSrc = token
        ? `https://deriv-dtrader.vercel.app/dtrader?acct1=${loginId}&token1=${token}&cur1=${currency}&lang=EN&app_id=${appId}`
        : `https://deriv-dtrader.vercel.app/dtrader`;

    return (
        <div style={{
            position: 'relative',
            width: '100%',
            height: '100%',
            minHeight: '500px',
            overflow: 'hidden',
            background: '#ffffff'
        }}>
            <iframe
                key={token || 'guest'}
                src={iframeSrc}
                title="DTrader"
                style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    width: '100%',
                    height: '100%',
                    border: 'none',
                    backgroundColor: '#ffffff'
                }}
                allow="fullscreen; clipboard-write; payment"
                sandbox="allow-same-origin allow-scripts allow-popups allow-forms allow-modals"
            />
        </div>
    );
});

export default DTraderTab;