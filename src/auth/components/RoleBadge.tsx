import React from 'react';

interface RoleBadgeProps {
    role: string;
}

const roleConfig: Record<string, { label: string; bg: string; color: string }> = {
    L1: {
        label: 'OPERATOR',
        bg: '#dbeafe',
        color: '#1d4ed8',
    },
    L2: {
        label: 'SUPERVISOR',
        bg: '#fef3c7',
        color: '#b45309',
    },
    L3: {
        label: 'MANAGER',
        bg: '#ede9fe',
        color: '#7c3aed',
    },
};

export function RoleBadge({ role }: RoleBadgeProps): React.ReactElement {
    const config = roleConfig[role] || roleConfig.L1;

    return (
        <span
            style={{
                display: 'inline-flex',
                alignItems: 'center',
                padding: '4px 12px',
                borderRadius: '20px',
                fontSize: '11px',
                fontWeight: '700',
                letterSpacing: '0.05em',
                backgroundColor: config.bg,
                color: config.color,
            }}
        >
            {config.label}
        </span>
    );
}