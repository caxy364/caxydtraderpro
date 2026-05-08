import React, { useEffect } from 'react';
import { observer } from 'mobx-react-lite';
import classNames from 'classnames';
import { digitStore } from './digit-store'; // adjust path

const VOLATILITIES = [
    { text: 'Vol 10 (1s)', value: '1HZ10V' },
    { text: 'Vol 25 (1s)', value: '1HZ25V' },
    { text: 'Vol 50 (1s)', value: '1HZ50V' },
    { text: 'Vol 75 (1s)', value: '1HZ75V' },
    { text: 'Vol 100 (1s)', value: '1HZ100V' },
    { text: 'Vol 150 (1s)', value: '1HZ150V' },
    { text: 'Vol 250 (1s)', value: '1HZ250V' },
    { text: 'Vol 10 Index', value: 'R_10' },
    { text: 'Vol 50 Index', value: 'R_50' },
    { text: 'Vol 100 Index', value: 'R_100' },
];

const DigitCircles = observer(() => {
    const stats = digitStore.digitStats;
    const max = Math.max(...stats);
    const min = Math.min(...stats);

    return (
        <div className="digit-analysis-container">
            <div className="market-header">
                <select 
                    value={digitStore.selected_market} 
                    onChange={(e) => digitStore.setMarket(e.target.value)}
                >
                    {VOLATILITIES.map(v => <option key={v.value} value={v.value}>{v.text}</option>)}
                </select>
            </div>

            <div className="digit-grid">
                {stats.map((percent, digit) => (
                    <div key={digit} className={classNames('digit-item', {
                        'is-current': digitStore.current_digit === digit
                    })}>
                        <div className={classNames('digit-circle', {
                            'strongest': percent == max && max !== min,
                            'weakest': percent == min && max !== min
                        })}>
                            <span className="number">{digit}</span>
                            <span className="percent">{percent}%</span>
                        </div>
                        {/* THE CURSOR */}
                        <div className="cursor-indicator" />
                    </div>
                ))}
            </div>
        </div>
    );
});

export default DigitCircles;