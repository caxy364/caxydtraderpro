import React from 'react';

// We are bypassing the broken Stepper import from quill-ui
const QsStepper = ({ current_step, steps }: any) => {
    return (
        <div className="qs-stepper" style={{ padding: '10px', borderBottom: '1px solid #eee', marginBottom: '20px' }}>
            <div style={{ display: 'flex', gap: '20px', fontSize: '14px' }}>
                {['Trade Parameters', 'Loss Threshold', 'Profit Target'].map((label, index) => (
                    <span key={label} style={{ 
                        fontWeight: current_step === index ? 'bold' : 'normal',
                        color: current_step === index ? '#ff444f' : '#999'
                    }}>
                        {index + 1}. {label}
                    </span>
                ))}
            </div>
        </div>
    );
};

export default QsStepper;