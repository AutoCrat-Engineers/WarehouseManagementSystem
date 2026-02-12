/**
 * Stock Distribution Card Component
 * Displays warehouse stock distribution for an item matching the UI mockup
 * 
 * Shows:
 * - Warehouse (Available/Reserved)
 * - In Transit (Quantity)
 * - Production (Finished Stock)
 * - Net Available for Customer
 */

import React from 'react';
import { Box, Truck, Factory, Layers, Info } from 'lucide-react';
import { LoadingSpinner, Card } from './ui/EnterpriseUI';
import { useItemStockDashboard } from '../hooks/useInventory';
import type { ItemStockDashboard } from '../types/inventory';

// ============================================================================
// STYLES
// ============================================================================

const sectionTitleStyle: React.CSSProperties = {
    fontSize: 'var(--font-size-sm)',
    fontWeight: 'var(--font-weight-bold)',
    textTransform: 'uppercase',
    letterSpacing: '0.5px',
    marginBottom: '16px',
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    color: 'var(--enterprise-error)',
};

const stockCardStyle: React.CSSProperties = {
    background: 'white',
    padding: '16px',
    borderRadius: 'var(--border-radius-md)',
    boxShadow: 'var(--shadow-sm)',
};

const stockCardHeaderStyle: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    marginBottom: '12px',
};

const stockCardLabelStyle: React.CSSProperties = {
    fontWeight: 'var(--font-weight-semibold)',
    color: 'var(--enterprise-gray-700)',
};

const stockRowStyle: React.CSSProperties = {
    display: 'flex',
    justifyContent: 'space-between',
    marginBottom: '8px',
};

const stockLabelSmall: React.CSSProperties = {
    fontSize: 'var(--font-size-sm)',
    color: 'var(--enterprise-gray-500)',
};

const stockValueBold: React.CSSProperties = {
    fontWeight: 'var(--font-weight-bold)',
};

// ============================================================================
// PROPS
// ============================================================================

interface StockDistributionCardProps {
    /** Item code to display stock for */
    itemCode: string;
    /** Optional: Pre-fetched data (if using in a list context) */
    data?: ItemStockDashboard;
    /** Show action buttons */
    showActions?: boolean;
    /** Compact mode (smaller padding) */
    compact?: boolean;
}

// ============================================================================
// STOCK DISTRIBUTION CARD COMPONENT
// ============================================================================

export function StockDistributionCard({
    itemCode,
    data: externalData,
    showActions = true,
    compact = false,
}: StockDistributionCardProps) {
    // Use hook if no external data provided
    const { data: hookData, loading, error } = useItemStockDashboard(
        externalData ? null : itemCode
    );

    const data = externalData || hookData;

    if (loading) {
        return (
            <div style={{ textAlign: 'center', padding: compact ? '20px' : '40px' }}>
                <LoadingSpinner size={32} />
                <p style={{
                    marginTop: '12px',
                    color: 'var(--enterprise-gray-500)',
                    fontSize: 'var(--font-size-sm)'
                }}>
                    Loading stock data...
                </p>
            </div>
        );
    }

    if (error) {
        return (
            <div style={{
                textAlign: 'center',
                padding: compact ? '20px' : '40px',
                color: 'var(--enterprise-error)',
            }}>
                <p>Failed to load stock data</p>
                <p style={{ fontSize: 'var(--font-size-sm)', marginTop: '4px' }}>{error}</p>
            </div>
        );
    }

    if (!data) {
        return (
            <div style={{
                textAlign: 'center',
                padding: compact ? '20px' : '40px',
                color: 'var(--enterprise-gray-500)',
            }}>
                <p>No stock data available for {itemCode}</p>
            </div>
        );
    }

    const padding = compact ? '16px' : '20px';

    return (
        <div style={{
            background: 'linear-gradient(135deg, rgba(220,38,38,0.03) 0%, rgba(220,38,38,0.08) 100%)',
            borderRadius: 'var(--border-radius-lg)',
            padding,
            border: '1px solid rgba(220,38,38,0.12)',
        }}>
            {/* Section Title */}
            <p style={sectionTitleStyle}>
                <Layers size={18} /> Stock Distribution & Movements
            </p>

            {/* Stock by Location - 3 Cards */}
            <div style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(3, 1fr)',
                gap: '16px',
                marginBottom: '20px'
            }}>
                {/* Warehouse Card */}
                <div style={stockCardStyle}>
                    <div style={stockCardHeaderStyle}>
                        <Box size={18} style={{ color: 'var(--enterprise-primary)' }} />
                        <span style={stockCardLabelStyle}>Warehouse</span>
                    </div>
                    <div style={stockRowStyle}>
                        <span style={stockLabelSmall}>Available</span>
                        <span style={{ ...stockValueBold, color: 'var(--enterprise-success)' }}>
                            {data.warehouseAvailable}
                        </span>
                    </div>
                    <div style={{ ...stockRowStyle, marginBottom: 0 }}>
                        <span style={stockLabelSmall}>Reserved</span>
                        <span style={{ ...stockValueBold, color: 'var(--enterprise-warning)' }}>
                            {data.warehouseReserved}
                        </span>
                    </div>
                </div>

                {/* In Transit Card */}
                <div style={stockCardStyle}>
                    <div style={stockCardHeaderStyle}>
                        <Truck size={18} style={{ color: 'var(--enterprise-info)' }} />
                        <span style={stockCardLabelStyle}>In Transit</span>
                    </div>
                    <div style={{ ...stockRowStyle, marginBottom: 0 }}>
                        <span style={stockLabelSmall}>Quantity</span>
                        <span style={{ ...stockValueBold, color: 'var(--enterprise-info)' }}>
                            {data.inTransitQuantity}
                        </span>
                    </div>
                </div>

                {/* Production Card */}
                <div style={stockCardStyle}>
                    <div style={stockCardHeaderStyle}>
                        <Factory size={18} style={{ color: 'var(--enterprise-secondary)' }} />
                        <span style={stockCardLabelStyle}>Production</span>
                    </div>
                    <div style={{ ...stockRowStyle, marginBottom: 0 }}>
                        <span style={stockLabelSmall}>Finished Stock</span>
                        <span style={{ ...stockValueBold, color: 'var(--enterprise-secondary)' }}>
                            {data.productionFinishedStock}
                        </span>
                    </div>
                </div>
            </div>

            {/* Net Available for Customer - Hero Card */}
            <div style={{
                background: 'linear-gradient(135deg, #eef4ff 0%, #e0ebff 100%)',
                borderRadius: 'var(--border-radius-md)',
                padding: '20px',
                textAlign: 'center',
                border: '1px solid #c7d7fe',
                marginBottom: showActions ? '20px' : 0,
            }}>
                <p style={{
                    fontSize: 'var(--font-size-sm)',
                    fontWeight: 'var(--font-weight-semibold)',
                    color: 'var(--enterprise-gray-600)',
                    letterSpacing: '0.4px',
                    marginBottom: '6px',
                    textTransform: 'uppercase',
                }}>
                    Net Available for Customer
                </p>

                <p style={{
                    fontSize: '2.6rem',
                    fontWeight: 'var(--font-weight-bold)',
                    color: getStatusColor(data.stockStatus),
                    margin: '4px 0',
                }}>
                    {data.netAvailableForCustomer}
                </p>

                <p style={{
                    fontSize: 'var(--font-size-xs)',
                    color: 'var(--enterprise-gray-500)',
                }}>
                    {data.calculationFormula ||
                        `= Warehouse Available (${data.warehouseAvailable}) + In Transit (${data.inTransitQuantity}) − Reserved (${data.warehouseReserved})`
                    }
                </p>
            </div>

            {/* Inventory Actions */}
            {showActions && (
                <>
                    <p style={{
                        fontSize: 'var(--font-size-sm)',
                        fontWeight: 'var(--font-weight-medium)',
                        color: 'var(--enterprise-gray-600)',
                        marginBottom: '12px'
                    }}>
                        Inventory Actions
                    </p>
                    <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
                        <ActionButton icon={<Factory size={14} />} disabled>
                            Receive from Production
                        </ActionButton>
                        <ActionButton icon={<Truck size={14} />} disabled>
                            Transfer to Warehouse
                        </ActionButton>
                        <ActionButton icon={<Truck size={14} />} disabled>
                            Dispatch to Customer
                        </ActionButton>
                        <ActionButton variant="tertiary" disabled>
                            Adjust Stock (Admin)
                        </ActionButton>
                    </div>
                    <p style={{
                        fontSize: 'var(--font-size-xs)',
                        color: 'var(--enterprise-gray-400)',
                        marginTop: '8px',
                        fontStyle: 'italic',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '4px',
                    }}>
                        <Info size={12} />
                        Stock movement actions will be available via the Stock Movements module
                    </p>
                </>
            )}
        </div>
    );
}

// ============================================================================
// HELPER COMPONENTS
// ============================================================================

interface ActionButtonProps {
    children: React.ReactNode;
    icon?: React.ReactNode;
    disabled?: boolean;
    variant?: 'secondary' | 'tertiary';
    onClick?: () => void;
}

function ActionButton({
    children,
    icon,
    disabled = false,
    variant = 'secondary',
    onClick,
}: ActionButtonProps) {
    const baseStyle: React.CSSProperties = {
        display: 'inline-flex',
        alignItems: 'center',
        gap: '6px',
        padding: '8px 12px',
        borderRadius: 'var(--border-radius-md)',
        fontSize: 'var(--font-size-sm)',
        fontWeight: 'var(--font-weight-medium)',
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.5 : 1,
        border: variant === 'secondary'
            ? '1px solid var(--enterprise-gray-300)'
            : 'none',
        background: variant === 'secondary'
            ? 'white'
            : 'transparent',
        color: 'var(--enterprise-gray-700)',
        transition: 'all var(--transition-fast)',
    };

    return (
        <button
            style={baseStyle}
            disabled={disabled}
            onClick={onClick}
        >
            {icon}
            {children}
        </button>
    );
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

function getStatusColor(status?: string): string {
    switch (status?.toUpperCase()) {
        case 'CRITICAL':
            return 'var(--enterprise-error)';
        case 'LOW':
            return 'var(--enterprise-warning)';
        case 'MEDIUM':
            return 'var(--enterprise-info)';
        case 'HEALTHY':
        default:
            return 'var(--enterprise-primary)';
    }
}

// ============================================================================
// EXPORTS
// ============================================================================

export default StockDistributionCard;
