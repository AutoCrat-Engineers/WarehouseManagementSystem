/**
 * Inventory Stock Grid Component
 * Displays all items with their stock distribution in a table format
 * 
 * Features:
 * - Summary cards (Total, Critical, Low, Healthy) with click-to-filter
 * - Sortable/filterable table with Active Status filter
 * - Search across item_code, master_serial_no, part_no
 * - CSV Export functionality
 * - View detailed stock distribution modal
 * 
 * Data Sources:
 * - Main Dashboard: vw_item_stock_dashboard
 * - View Screen: vw_item_stock_distribution
 */

import React, { useState, useMemo, useCallback } from 'react';
import {
    Package,
    RefreshCw,
    AlertTriangle,
    CheckCircle,
    Eye,
    Search,
    ChevronDown,
    ChevronUp,
    Download,
    X,
    XCircle,
} from 'lucide-react';
import { Card, Button, Badge, LoadingSpinner, EmptyState, Modal } from './ui/EnterpriseUI';
import { useAllItemsStockDashboard, useItemStockDistribution } from '../hooks/useInventory';
import type { ItemStockDashboard, ItemStockDistribution, StockStatus } from '../types/inventory';

// ============================================================================
// TYPES
// ============================================================================

type ActiveStatusFilter = 'ALL' | 'ACTIVE' | 'INACTIVE';
type SortField = 'itemCode' | 'masterSerialNo' | 'partNumber' | 'netAvailableForCustomer' | 'stockStatus';
type SortDirection = 'asc' | 'desc';

// Extended interface with is_active field
interface ItemStockDashboardExtended extends ItemStockDashboard {
    isActive?: boolean;
}

// ============================================================================
// STYLES
// ============================================================================

const thStyle: React.CSSProperties = {
    padding: '12px 14px',
    textAlign: 'left',
    fontSize: '12px',
    fontWeight: 600,
    color: 'var(--enterprise-gray-700)',
    textTransform: 'uppercase',
    letterSpacing: '0.4px',
    whiteSpace: 'nowrap',
    cursor: 'pointer',
    userSelect: 'none',
};

const tdStyle: React.CSSProperties = {
    padding: '12px 14px',
    fontSize: '13px',
    color: 'var(--enterprise-gray-800)',
};

// ============================================================================
// SUMMARY CARD COMPONENT (Clickable)
// ============================================================================

interface SummaryCardProps {
    label: string;
    value: number;
    icon: React.ReactNode;
    color: string;
    bgColor: string;
    isActive?: boolean;
    onClick?: () => void;
}

function SummaryCard({ label, value, icon, color, bgColor, isActive = false, onClick }: SummaryCardProps) {
    return (
        <div
            onClick={onClick}
            style={{
                cursor: onClick ? 'pointer' : 'default',
                transition: 'all 0.2s ease',
            }}
        >
            <Card
                style={{
                    border: isActive ? `2px solid ${color}` : '1px solid var(--enterprise-gray-200)',
                    boxShadow: isActive ? `0 0 0 3px ${bgColor}` : 'var(--shadow-sm)',
                }}
            >
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <div>
                        <p style={{
                            fontSize: '12px',
                            color: 'var(--enterprise-gray-600)',
                            fontWeight: 500,
                            marginBottom: '6px',
                        }}>
                            {label}
                        </p>
                        <p style={{
                            fontSize: '1.75rem',
                            fontWeight: 700,
                            color,
                        }}>
                            {value}
                        </p>
                    </div>
                    <div style={{
                        width: '44px',
                        height: '44px',
                        borderRadius: '8px',
                        backgroundColor: bgColor,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                    }}>
                        {icon}
                    </div>
                </div>
            </Card>
        </div>
    );
}

// ============================================================================
// FILTER BAR COMPONENT
// ============================================================================

interface FilterBarProps {
    searchTerm: string;
    onSearchChange: (value: string) => void;
    activeStatusFilter: ActiveStatusFilter;
    onActiveStatusFilterChange: (value: ActiveStatusFilter) => void;
    onRefresh: () => void;
    refreshing: boolean;
    onExport: () => void;
    onClearFilters: () => void;
    hasActiveFilters: boolean;
}

function FilterBar({
    searchTerm,
    onSearchChange,
    activeStatusFilter,
    onActiveStatusFilterChange,
    onRefresh,
    refreshing,
    onExport,
    onClearFilters,
    hasActiveFilters,
}: FilterBarProps) {
    return (
        <div style={{
            display: 'flex',
            alignItems: 'center',
            marginBottom: '16px',
            gap: '12px',
            flexWrap: 'wrap',
            background: 'white',
            padding: '10px 16px',
            borderRadius: '8px',
            border: '1px solid var(--enterprise-gray-200)',
        }}>
            {/* Search - Elongated */}
            <div style={{
                display: 'flex',
                alignItems: 'center',
                background: 'var(--enterprise-gray-50)',
                border: '1px solid var(--enterprise-gray-300)',
                borderRadius: '6px',
                padding: '8px 12px',
                flex: 1,
                minWidth: '280px',
            }}>
                <Search size={18} style={{ color: 'var(--enterprise-gray-400)', marginRight: '10px', flexShrink: 0 }} />
                <input
                    type="text"
                    placeholder="Search by item code, MSN, part number..."
                    value={searchTerm}
                    onChange={(e) => onSearchChange(e.target.value)}
                    style={{
                        border: 'none',
                        outline: 'none',
                        flex: 1,
                        fontSize: '13px',
                        color: 'var(--enterprise-gray-800)',
                        background: 'transparent',
                        minWidth: '180px',
                    }}
                />
                {searchTerm && (
                    <button
                        onClick={() => onSearchChange('')}
                        style={{
                            background: 'var(--enterprise-gray-200)',
                            border: 'none',
                            cursor: 'pointer',
                            padding: '4px',
                            display: 'flex',
                            alignItems: 'center',
                            borderRadius: '4px',
                            marginLeft: '8px',
                        }}
                    >
                        <X size={14} style={{ color: 'var(--enterprise-gray-600)' }} />
                    </button>
                )}
            </div>

            {/* Filters and Actions - Right Side */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0 }}>

                {/* Active Status Filter */}
                <select
                    value={activeStatusFilter}
                    onChange={(e) => onActiveStatusFilterChange(e.target.value as ActiveStatusFilter)}
                    style={{
                        padding: '8px 12px',
                        borderRadius: '6px',
                        border: '1px solid var(--enterprise-gray-300)',
                        fontSize: '13px',
                        color: 'var(--enterprise-gray-700)',
                        background: 'white',
                        cursor: 'pointer',
                        height: '36px',
                    }}
                >
                    <option value="ALL">All Items</option>
                    <option value="ACTIVE">Active Only</option>
                    <option value="INACTIVE">Inactive Only</option>
                </select>

                {/* Clear Filters - Only show when filters active */}
                {hasActiveFilters && (
                    <button
                        onClick={onClearFilters}
                        style={{
                            padding: '0 12px',
                            height: '36px',
                            borderRadius: '6px',
                            border: '1px solid #dc2626',
                            background: 'white',
                            color: '#dc2626',
                            fontSize: '13px',
                            fontWeight: 500,
                            cursor: 'pointer',
                            display: 'flex',
                            alignItems: 'center',
                            gap: '4px',
                            whiteSpace: 'nowrap',
                        }}
                    >
                        <XCircle size={16} />
                        Clear Filters
                    </button>
                )}

                {/* Refresh Button */}
                <button
                    onClick={onRefresh}
                    disabled={refreshing}
                    style={{
                        padding: '0 14px',
                        height: '36px',
                        borderRadius: '6px',
                        border: '1px solid var(--enterprise-gray-300)',
                        background: 'white',
                        color: 'var(--enterprise-gray-700)',
                        fontSize: '13px',
                        fontWeight: 500,
                        cursor: refreshing ? 'not-allowed' : 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '6px',
                        opacity: refreshing ? 0.6 : 1,
                        whiteSpace: 'nowrap',
                    }}
                >
                    <RefreshCw size={14} className={refreshing ? 'spinning' : ''} />
                    Refresh
                </button>

                {/* Export Button - Primary action */}
                <button
                    onClick={onExport}
                    style={{
                        padding: '0 14px',
                        height: '36px',
                        borderRadius: '6px',
                        border: 'none',
                        background: '#1e3a8a',
                        color: 'white',
                        fontSize: '13px',
                        fontWeight: 500,
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '6px',
                        whiteSpace: 'nowrap',
                    }}
                >
                    <Download size={14} />
                    Export CSV
                </button>
            </div>
        </div>
    );
}

// ============================================================================
// ACTIVE STATUS DOT COMPONENT
// ============================================================================

function ActiveStatusDot({ isActive }: { isActive?: boolean }) {
    return (
        <span
            style={{
                display: 'inline-block',
                width: '8px',
                height: '8px',
                borderRadius: '50%',
                backgroundColor: isActive ? '#22c55e' : '#ef4444',
                marginRight: '6px',
            }}
            title={isActive ? 'Active' : 'Inactive'}
        />
    );
}

// ============================================================================
// STOCK DETAIL MODAL COMPONENT
// ============================================================================

interface StockDetailModalProps {
    isOpen: boolean;
    onClose: () => void;
    item: ItemStockDashboard | null;
}

function StockDetailModal({ isOpen, onClose, item }: StockDetailModalProps) {
    const { data: distribution, loading } = useItemStockDistribution(
        isOpen && item ? item.itemCode : null
    );

    if (!item) return null;

    // Get status-based glow color
    const getGlowColor = (status?: string) => {
        switch (status?.toUpperCase()) {
            case 'CRITICAL': return 'rgba(220, 38, 38, 0.15)';
            case 'LOW': return 'rgba(234, 179, 8, 0.15)';
            case 'HEALTHY': return 'rgba(34, 197, 94, 0.15)';
            default: return 'rgba(59, 130, 246, 0.1)';
        }
    };

    const getGlowBorder = (status?: string) => {
        switch (status?.toUpperCase()) {
            case 'CRITICAL': return '1px solid rgba(220, 38, 38, 0.3)';
            case 'LOW': return '1px solid rgba(234, 179, 8, 0.3)';
            case 'HEALTHY': return '1px solid rgba(34, 197, 94, 0.3)';
            default: return '1px solid rgba(59, 130, 246, 0.2)';
        }
    };

    const stockData = distribution || item;

    return (
        <Modal
            isOpen={isOpen}
            onClose={onClose}
            title={`Stock Details – ${item.masterSerialNo || item.itemCode}`}
            maxWidth="800px"
        >
            <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
                {/* Item Information Section */}
                <div style={{
                    background: 'var(--enterprise-gray-50)',
                    padding: '16px',
                    borderRadius: '8px',
                }}>
                    {/* Item Name - Prominent */}
                    <h3 style={{
                        fontSize: '16px',
                        fontWeight: 600,
                        color: 'var(--enterprise-gray-900)',
                        marginBottom: '12px',
                    }}>
                        {item.itemName}
                    </h3>

                    {/* Compact Metadata Row */}
                    <div style={{
                        display: 'flex',
                        flexWrap: 'wrap',
                        gap: '16px',
                        fontSize: '13px',
                        color: 'var(--enterprise-gray-600)',
                    }}>
                        <span><strong>Code:</strong> {item.itemCode}</span>
                        <span><strong>Part No:</strong> {item.partNumber || '-'}</span>
                        <span><strong>UOM:</strong> {item.uom}</span>
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', verticalAlign: 'middle' }}>
                            <strong style={{ lineHeight: '1' }}>Status:</strong>
                            <Badge variant={getStatusVariant(item.stockStatus)} style={{ verticalAlign: 'middle' }}>
                                {item.stockStatus}
                            </Badge>
                        </span>
                    </div>
                </div>

                {/* Stock Distribution Section */}
                {loading ? (
                    <div style={{ textAlign: 'center', padding: '40px' }}>
                        <LoadingSpinner size={32} />
                        <p style={{ marginTop: '12px', color: 'var(--enterprise-gray-500)', fontSize: '13px' }}>
                            Loading stock distribution...
                        </p>
                    </div>
                ) : (
                    <>
                        {/* Distribution Cards - Row 1 */}
                        <div style={{
                            display: 'grid',
                            gridTemplateColumns: 'repeat(2, 1fr)',
                            gap: '12px',
                        }}>
                            {/* Production Warehouse */}
                            <div style={{
                                background: 'white',
                                padding: '14px',
                                borderRadius: '8px',
                                border: '1px solid var(--enterprise-gray-200)',
                            }}>
                                <div style={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: '8px',
                                    marginBottom: '10px',
                                    fontSize: '13px',
                                    fontWeight: 600,
                                    color: 'var(--enterprise-gray-700)',
                                }}>
                                    <Package size={16} style={{ color: 'var(--enterprise-primary)' }} />
                                    Production Warehouse
                                </div>
                                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13px' }}>
                                    <span style={{ color: 'var(--enterprise-gray-500)' }}>Available</span>
                                    <span style={{ fontWeight: 600, color: 'var(--enterprise-success)' }}>
                                        {(distribution as any)?.productionAvailable ?? item.productionFinishedStock ?? 0}
                                    </span>
                                </div>
                            </div>

                            {/* In Transit */}
                            <div style={{
                                background: 'white',
                                padding: '14px',
                                borderRadius: '8px',
                                border: '1px solid var(--enterprise-gray-200)',
                            }}>
                                <div style={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: '8px',
                                    marginBottom: '10px',
                                    fontSize: '13px',
                                    fontWeight: 600,
                                    color: 'var(--enterprise-gray-700)',
                                }}>
                                    <RefreshCw size={16} style={{ color: 'var(--enterprise-info)' }} />
                                    In Transit
                                </div>
                                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13px' }}>
                                    <span style={{ color: 'var(--enterprise-gray-500)' }}>Quantity</span>
                                    <span style={{ fontWeight: 600, color: 'var(--enterprise-info)' }}>
                                        {(distribution as any)?.inTransitQty ?? item.inTransitQuantity ?? 0}
                                    </span>
                                </div>
                            </div>
                        </div>

                        {/* Distribution Cards - Row 2 */}
                        <div style={{
                            display: 'grid',
                            gridTemplateColumns: 'repeat(2, 1fr)',
                            gap: '12px',
                        }}>
                            {/* S&V Warehouse */}
                            <div style={{
                                background: 'white',
                                padding: '14px',
                                borderRadius: '8px',
                                border: '1px solid var(--enterprise-gray-200)',
                            }}>
                                <div style={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: '8px',
                                    marginBottom: '10px',
                                    fontSize: '13px',
                                    fontWeight: 600,
                                    color: 'var(--enterprise-gray-700)',
                                }}>
                                    <Package size={16} style={{ color: 'var(--enterprise-secondary)' }} />
                                    S&V Warehouse
                                </div>
                                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13px' }}>
                                    <span style={{ color: 'var(--enterprise-gray-500)' }}>On Hand</span>
                                    <span style={{ fontWeight: 600, color: 'var(--enterprise-secondary)' }}>
                                        {(distribution as any)?.snvOnHand ?? item.snvStock ?? 0}
                                    </span>
                                </div>
                            </div>

                            {/* US Warehouse */}
                            <div style={{
                                background: 'white',
                                padding: '14px',
                                borderRadius: '8px',
                                border: '1px solid var(--enterprise-gray-200)',
                            }}>
                                <div style={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: '8px',
                                    marginBottom: '10px',
                                    fontSize: '13px',
                                    fontWeight: 600,
                                    color: 'var(--enterprise-gray-700)',
                                }}>
                                    <Package size={16} style={{ color: '#6366f1' }} />
                                    US Warehouse
                                </div>
                                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px', fontSize: '13px' }}>
                                    <span style={{ color: 'var(--enterprise-gray-500)' }}>On Hand</span>
                                    <span style={{ fontWeight: 600, color: '#6366f1' }}>
                                        {(distribution as any)?.usTransitOnHand ?? item.usTransitStock ?? 0}
                                    </span>
                                </div>
                                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13px' }}>
                                    <span style={{ color: 'var(--enterprise-gray-500)' }}>Reserved (Next Month)</span>
                                    <span style={{ fontWeight: 600, color: 'var(--enterprise-warning)' }}>
                                        {(distribution as any)?.blanketNextMonthReserved ?? item.reservedNextMonth ?? 0}
                                    </span>
                                </div>
                            </div>
                        </div>

                        {/* Net Available for Customer - Prominent Card with Status Glow */}
                        <div style={{
                            background: getGlowColor(item.stockStatus),
                            borderRadius: '10px',
                            padding: '20px',
                            textAlign: 'center',
                            border: getGlowBorder(item.stockStatus),
                        }}>
                            <p style={{
                                fontSize: '12px',
                                fontWeight: 600,
                                color: 'var(--enterprise-gray-600)',
                                letterSpacing: '0.4px',
                                marginBottom: '8px',
                                textTransform: 'uppercase',
                            }}>
                                Net Available for Customer
                            </p>

                            <p style={{
                                fontSize: '2.2rem',
                                fontWeight: 700,
                                color: getStatusColor(item.stockStatus),
                                margin: '4px 0',
                            }}>
                                {item.netAvailableForCustomer}
                            </p>

                            {/* Formula documentation */}
                            <p style={{
                                fontSize: '11px',
                                color: 'var(--enterprise-gray-500)',
                                marginTop: '8px',
                            }}>
                                = US Warehouse + In Transit + S&V Warehouse − Reserved (Next Month)
                            </p>
                        </div>
                    </>
                )}

                {/* Close Button */}
                <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                    <Button variant="primary" onClick={onClose}>
                        Close
                    </Button>
                </div>
            </div>
        </Modal>
    );
}

// ============================================================================
// CSV EXPORT UTILITY
// ============================================================================

function exportToCSV(data: ItemStockDashboard[], filename: string = 'inventory_export') {
    const headers = [
        'Item Code',
        'Description',
        'MSN',
        'Part Number',
        'Net Available',
        'Status',
        'Active'
    ];

    const rows = data.map(item => [
        item.itemCode,
        item.itemName || '',
        item.masterSerialNo || '',
        item.partNumber || '',
        item.netAvailableForCustomer,
        item.stockStatus || '',
        (item as ItemStockDashboardExtended).isActive !== false ? 'Active' : 'Inactive'
    ]);

    const csvContent = [
        headers.join(','),
        ...rows.map(row => row.map(cell =>
            typeof cell === 'string' && (cell.includes(',') || cell.includes('"'))
                ? `"${cell.replace(/"/g, '""')}"`
                : cell
        ).join(','))
    ].join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);

    link.setAttribute('href', url);
    link.setAttribute('download', `${filename}_${new Date().toISOString().split('T')[0]}.csv`);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
}

// ============================================================================
// MAIN INVENTORY GRID COMPONENT
// ============================================================================

export function InventoryGrid() {
    const { items, loading, error, refetch, stats } = useAllItemsStockDashboard();

    // Local state
    const [refreshing, setRefreshing] = useState(false);
    const [searchTerm, setSearchTerm] = useState('');
    const [statusFilter, setStatusFilter] = useState<StockStatus | 'ALL'>('ALL');
    const [activeStatusFilter, setActiveStatusFilter] = useState<ActiveStatusFilter>('ALL');
    const [cardFilter, setCardFilter] = useState<StockStatus | 'ALL' | 'TOTAL'>('ALL');
    const [sortField, setSortField] = useState<SortField>('itemCode');
    const [sortDirection, setSortDirection] = useState<SortDirection>('asc');
    const [selectedItem, setSelectedItem] = useState<ItemStockDashboard | null>(null);
    const [showDetailModal, setShowDetailModal] = useState(false);

    // Handle refresh
    const handleRefresh = async () => {
        setRefreshing(true);
        await refetch();
        setRefreshing(false);
    };

    // Handle sort
    const handleSort = (field: SortField) => {
        if (sortField === field) {
            setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
        } else {
            setSortField(field);
            setSortDirection('asc');
        }
    };

    // Handle card click filter
    const handleCardClick = (filter: StockStatus | 'ALL' | 'TOTAL') => {
        if (cardFilter === filter) {
            // Toggle off if clicking the same card
            setCardFilter('ALL');
            setStatusFilter('ALL');
        } else {
            setCardFilter(filter);
            if (filter === 'TOTAL') {
                setStatusFilter('ALL');
            } else if (filter !== 'ALL') {
                setStatusFilter(filter);
            }
        }
    };

    // Clear card/dropdown filters only (search has its own X button)
    const handleClearFilters = useCallback(() => {
        setStatusFilter('ALL');
        setActiveStatusFilter('ALL');
        setCardFilter('ALL');
    }, []);

    // Check if any CARD/DROPDOWN filters are active (not search - search has its own X button)
    const hasActiveFilters = statusFilter !== 'ALL' || activeStatusFilter !== 'ALL' || cardFilter !== 'ALL';

    // Filter and sort items
    const filteredItems = useMemo(() => {
        let result = [...items];

        // Apply search filter (item_code, master_serial_no, part_no)
        if (searchTerm) {
            const searchLower = searchTerm.toLowerCase();
            result = result.filter(item =>
                item.itemCode.toLowerCase().includes(searchLower) ||
                item.masterSerialNo?.toLowerCase().includes(searchLower) ||
                item.partNumber?.toLowerCase().includes(searchLower)
            );
        }

        // Apply stock status filter
        if (statusFilter !== 'ALL') {
            result = result.filter(item => item.stockStatus === statusFilter);
        }

        // Apply active status filter
        if (activeStatusFilter !== 'ALL') {
            result = result.filter(item => {
                const isActive = (item as ItemStockDashboardExtended).isActive;
                if (activeStatusFilter === 'ACTIVE') return isActive !== false;
                if (activeStatusFilter === 'INACTIVE') return isActive === false;
                return true;
            });
        }

        // Apply sorting
        result.sort((a, b) => {
            let aVal: any = a[sortField];
            let bVal: any = b[sortField];

            if (typeof aVal === 'string') {
                aVal = aVal?.toLowerCase() || '';
                bVal = bVal?.toLowerCase() || '';
            }

            if (aVal < bVal) return sortDirection === 'asc' ? -1 : 1;
            if (aVal > bVal) return sortDirection === 'asc' ? 1 : -1;
            return 0;
        });

        return result;
    }, [items, searchTerm, statusFilter, activeStatusFilter, sortField, sortDirection]);

    // Handle export
    const handleExport = useCallback(() => {
        exportToCSV(filteredItems, 'inventory_export');
    }, [filteredItems]);

    // Handle view details
    const handleViewDetails = (item: ItemStockDashboard) => {
        setSelectedItem(item);
        setShowDetailModal(true);
    };

    // Render sort indicator
    const SortIndicator = ({ field }: { field: SortField }) => {
        if (sortField !== field) return null;
        return sortDirection === 'asc'
            ? <ChevronUp size={12} style={{ marginLeft: '4px' }} />
            : <ChevronDown size={12} style={{ marginLeft: '4px' }} />;
    };

    // Loading state
    if (loading && items.length === 0) {
        return (
            <div style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                padding: '60px',
            }}>
                <LoadingSpinner size={48} />
                <p style={{
                    marginTop: '16px',
                    color: 'var(--enterprise-gray-600)',
                    fontSize: '14px',
                }}>
                    Loading inventory data...
                </p>
            </div>
        );
    }

    // Error state
    if (error) {
        return (
            <Card>
                <div style={{ textAlign: 'center', padding: '40px' }}>
                    <AlertTriangle size={48} style={{ color: 'var(--enterprise-error)', marginBottom: '16px' }} />
                    <h3 style={{ color: 'var(--enterprise-gray-800)', marginBottom: '8px' }}>
                        Failed to Load Inventory
                    </h3>
                    <p style={{ color: 'var(--enterprise-gray-600)', marginBottom: '16px' }}>
                        {error}
                    </p>
                    <Button variant="primary" onClick={handleRefresh}>
                        Try Again
                    </Button>
                </div>
            </Card>
        );
    }

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
            {/* Summary Cards - Responsive Grid with Click-to-Filter */}
            <div style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
                gap: '14px',
            }}>
                <SummaryCard
                    label="Total Items"
                    value={stats.totalItems}
                    icon={<Package size={22} style={{ color: 'var(--enterprise-primary)' }} />}
                    color="var(--enterprise-primary)"
                    bgColor="rgba(30, 58, 138, 0.1)"
                    isActive={cardFilter === 'TOTAL'}
                    onClick={() => handleCardClick('TOTAL')}
                />
                <SummaryCard
                    label="Healthy Stock"
                    value={stats.healthyCount}
                    icon={<CheckCircle size={22} style={{ color: 'var(--enterprise-success)' }} />}
                    color="var(--enterprise-success)"
                    bgColor="rgba(34, 197, 94, 0.1)"
                    isActive={cardFilter === 'HEALTHY'}
                    onClick={() => handleCardClick('HEALTHY')}
                />
                <SummaryCard
                    label="Low Stock"
                    value={stats.lowCount}
                    icon={<AlertTriangle size={22} style={{ color: 'var(--enterprise-warning)' }} />}
                    color="var(--enterprise-warning)"
                    bgColor="rgba(234, 179, 8, 0.1)"
                    isActive={cardFilter === 'LOW'}
                    onClick={() => handleCardClick('LOW')}
                />
                <SummaryCard
                    label="Critical Stock"
                    value={stats.criticalCount}
                    icon={<AlertTriangle size={22} style={{ color: 'var(--enterprise-error)' }} />}
                    color="var(--enterprise-error)"
                    bgColor="rgba(220, 38, 38, 0.1)"
                    isActive={cardFilter === 'CRITICAL'}
                    onClick={() => handleCardClick('CRITICAL')}
                />
            </div>

            {/* Filter Bar */}
            <FilterBar
                searchTerm={searchTerm}
                onSearchChange={setSearchTerm}
                activeStatusFilter={activeStatusFilter}
                onActiveStatusFilterChange={setActiveStatusFilter}
                onRefresh={handleRefresh}
                refreshing={refreshing}
                onExport={handleExport}
                onClearFilters={handleClearFilters}
                hasActiveFilters={hasActiveFilters}
            />

            {/* Inventory Table */}
            <Card style={{ padding: 0, overflow: 'hidden' }}>
                {filteredItems.length === 0 ? (
                    <EmptyState
                        icon={<Package size={48} />}
                        title={hasActiveFilters ? "No Matching Items" : "No Inventory Data"}
                        description={
                            hasActiveFilters
                                ? "Try adjusting your search or filter criteria"
                                : "Stock data will appear here once the inventory tables are populated"
                        }
                    />
                ) : (
                    <div style={{ overflowX: 'auto' }}>
                        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                            <thead>
                                <tr style={{
                                    backgroundColor: 'var(--table-header-bg)',
                                    borderBottom: '2px solid var(--table-border)',
                                }}>
                                    <th
                                        style={{ ...thStyle, minWidth: '100px' }}
                                        onClick={() => handleSort('itemCode')}
                                    >
                                        <span style={{ display: 'flex', alignItems: 'center' }}>
                                            Item Code <SortIndicator field="itemCode" />
                                        </span>
                                    </th>
                                    <th style={{ ...thStyle, minWidth: '180px', cursor: 'default' }}>
                                        Description
                                    </th>
                                    <th
                                        style={{ ...thStyle, minWidth: '100px' }}
                                        onClick={() => handleSort('masterSerialNo')}
                                    >
                                        <span style={{ display: 'flex', alignItems: 'center' }}>
                                            MSN <SortIndicator field="masterSerialNo" />
                                        </span>
                                    </th>
                                    <th
                                        style={{ ...thStyle, minWidth: '100px' }}
                                        onClick={() => handleSort('partNumber')}
                                    >
                                        <span style={{ display: 'flex', alignItems: 'center' }}>
                                            Part Number <SortIndicator field="partNumber" />
                                        </span>
                                    </th>
                                    <th
                                        style={{ ...thStyle, textAlign: 'right', minWidth: '110px' }}
                                        onClick={() => handleSort('netAvailableForCustomer')}
                                    >
                                        <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end' }}>
                                            Net Available <SortIndicator field="netAvailableForCustomer" />
                                        </span>
                                    </th>
                                    <th
                                        style={{ ...thStyle, textAlign: 'center', minWidth: '90px' }}
                                        onClick={() => handleSort('stockStatus')}
                                    >
                                        <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                            Status <SortIndicator field="stockStatus" />
                                        </span>
                                    </th>
                                    <th style={{ ...thStyle, textAlign: 'center', minWidth: '70px', cursor: 'default' }}>
                                        Action
                                    </th>
                                    <th style={{ ...thStyle, textAlign: 'center', minWidth: '80px', cursor: 'default' }}>
                                        Active
                                    </th>
                                </tr>
                            </thead>
                            <tbody>
                                {filteredItems.map((item, index) => (
                                    <tr
                                        key={item.itemCode}
                                        style={{
                                            backgroundColor: index % 2 === 0 ? 'white' : 'var(--table-stripe)',
                                            borderBottom: '1px solid var(--table-border)',
                                            transition: 'background-color 0.15s ease',
                                        }}
                                        onMouseEnter={(e) => {
                                            e.currentTarget.style.backgroundColor = 'var(--table-hover)';
                                        }}
                                        onMouseLeave={(e) => {
                                            e.currentTarget.style.backgroundColor = index % 2 === 0 ? 'white' : 'var(--table-stripe)';
                                        }}
                                    >
                                        <td style={{
                                            ...tdStyle,
                                            fontWeight: 600,
                                            color: 'var(--enterprise-primary)'
                                        }}>
                                            {item.itemCode}
                                        </td>
                                        <td style={tdStyle}>
                                            {item.itemName || '-'}
                                        </td>
                                        <td style={{ ...tdStyle, color: 'var(--enterprise-gray-600)' }}>
                                            {item.masterSerialNo || '-'}
                                        </td>
                                        <td style={{ ...tdStyle, color: 'var(--enterprise-gray-600)' }}>
                                            {item.partNumber || '-'}
                                        </td>
                                        <td style={{
                                            ...tdStyle,
                                            textAlign: 'right',
                                            fontWeight: 600,
                                            color: getStatusColor(item.stockStatus),
                                        }}>
                                            {(item.snvStock ?? 0) + (item.usTransitStock ?? 0)}
                                        </td>
                                        <td style={{ ...tdStyle, textAlign: 'center' }}>
                                            <Badge variant={getStatusVariant(item.stockStatus)}>
                                                {item.stockStatus}
                                            </Badge>
                                        </td>
                                        <td style={{ ...tdStyle, textAlign: 'center' }}>
                                            <Button
                                                variant="tertiary"
                                                size="sm"
                                                icon={<Eye size={14} />}
                                                onClick={() => handleViewDetails(item)}
                                            >
                                                View
                                            </Button>
                                        </td>
                                        <td style={{ ...tdStyle, textAlign: 'center' }}>
                                            <ActiveStatusDot isActive={(item as ItemStockDashboardExtended).isActive !== false} />
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </Card>

            {/* Results Summary */}
            <div style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                fontSize: '12px',
                color: 'var(--enterprise-gray-600)',
            }}>
                <span>
                    Showing {filteredItems.length} of {items.length} items
                    {hasActiveFilters && ' (filtered)'}
                </span>
                <span>
                    Total Net Available: {' '}
                    <strong style={{ color: 'var(--enterprise-primary)' }}>
                        {filteredItems.reduce((sum, item) => sum + (item.netAvailableForCustomer || 0), 0).toLocaleString()}
                    </strong>
                </span>
            </div>

            {/* Stock Detail Modal */}
            <StockDetailModal
                isOpen={showDetailModal}
                onClose={() => setShowDetailModal(false)}
                item={selectedItem}
            />

            {/* Spinning animation for refresh button */}
            <style>{`
                @keyframes spin {
                    to { transform: rotate(360deg); }
                }
                .spinning {
                    animation: spin 1s linear infinite;
                }
            `}</style>
        </div>
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
            return 'var(--enterprise-success)';
    }
}

function getStatusVariant(status?: string): 'success' | 'warning' | 'error' | 'info' | 'neutral' {
    switch (status?.toUpperCase()) {
        case 'CRITICAL':
            return 'error';
        case 'LOW':
            return 'warning';
        case 'MEDIUM':
            return 'info';
        case 'HEALTHY':
            return 'success';
        default:
            return 'neutral';
    }
}

// ============================================================================
// EXPORTS
// ============================================================================

export default InventoryGrid;
