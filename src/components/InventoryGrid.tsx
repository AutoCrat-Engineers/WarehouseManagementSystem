/**
 * Inventory Stock Grid Component
 * Displays all items with their stock distribution in a table format
 * 
 * Features:
 * - Summary cards (Total, Critical, Low, Healthy)
 * - Sortable/filterable table
 * - Click to view detailed stock distribution
 * - Real-time status indicators
 */

import React, { useState, useMemo } from 'react';
import {
    Package,
    RefreshCw,
    AlertTriangle,
    CheckCircle,
    Eye,
    Search,
    Filter,
    ChevronDown,
    ChevronUp,
    Download,
} from 'lucide-react';
import { Card, Button, Badge, LoadingSpinner, EmptyState, Modal } from './ui/EnterpriseUI';
import { StockDistributionCard } from './StockDistributionCard';
import { useAllItemsStockDashboard } from '../hooks/useInventory';
import type { ItemStockDashboard, StockStatus } from '../types/inventory';

// ============================================================================
// STYLES
// ============================================================================

const thStyle: React.CSSProperties = {
    padding: '14px 16px',
    textAlign: 'left',
    fontSize: 'var(--font-size-sm)',
    fontWeight: 'var(--font-weight-semibold)',
    color: 'var(--enterprise-gray-700)',
    textTransform: 'uppercase',
    letterSpacing: '0.5px',
    whiteSpace: 'nowrap',
    cursor: 'pointer',
    userSelect: 'none',
};

const tdStyle: React.CSSProperties = {
    padding: '14px 16px',
    fontSize: 'var(--font-size-base)',
    color: 'var(--enterprise-gray-800)',
};

// ============================================================================
// SUMMARY CARD COMPONENT
// ============================================================================

interface SummaryCardProps {
    label: string;
    value: number;
    icon: React.ReactNode;
    color: string;
    bgColor: string;
}

function SummaryCard({ label, value, icon, color, bgColor }: SummaryCardProps) {
    return (
        <Card>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div>
                    <p style={{
                        fontSize: 'var(--font-size-sm)',
                        color: 'var(--enterprise-gray-600)',
                        fontWeight: 'var(--font-weight-medium)',
                        marginBottom: '8px',
                    }}>
                        {label}
                    </p>
                    <p style={{
                        fontSize: '2rem',
                        fontWeight: 'var(--font-weight-bold)',
                        color,
                    }}>
                        {value}
                    </p>
                </div>
                <div style={{
                    width: '48px',
                    height: '48px',
                    borderRadius: 'var(--border-radius-md)',
                    backgroundColor: bgColor,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                }}>
                    {icon}
                </div>
            </div>
        </Card>
    );
}

// ============================================================================
// FILTER BAR COMPONENT
// ============================================================================

interface FilterBarProps {
    searchTerm: string;
    onSearchChange: (value: string) => void;
    statusFilter: StockStatus | 'ALL';
    onStatusFilterChange: (value: StockStatus | 'ALL') => void;
    onRefresh: () => void;
    refreshing: boolean;
}

function FilterBar({
    searchTerm,
    onSearchChange,
    statusFilter,
    onStatusFilterChange,
    onRefresh,
    refreshing,
}: FilterBarProps) {
    return (
        <div style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: '16px',
            gap: '16px',
            flexWrap: 'wrap',
        }}>
            {/* Search */}
            <div style={{
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                flex: 1,
                minWidth: '250px',
                maxWidth: '400px',
            }}>
                <div style={{
                    display: 'flex',
                    alignItems: 'center',
                    background: 'white',
                    border: '1px solid var(--enterprise-gray-300)',
                    borderRadius: 'var(--border-radius-md)',
                    padding: '8px 12px',
                    flex: 1,
                }}>
                    <Search size={18} style={{ color: 'var(--enterprise-gray-400)', marginRight: '8px' }} />
                    <input
                        type="text"
                        placeholder="Search by item code or name..."
                        value={searchTerm}
                        onChange={(e) => onSearchChange(e.target.value)}
                        style={{
                            border: 'none',
                            outline: 'none',
                            flex: 1,
                            fontSize: 'var(--font-size-sm)',
                            color: 'var(--enterprise-gray-800)',
                        }}
                    />
                </div>
            </div>

            {/* Filters and Actions */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                {/* Status Filter */}
                <div style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px',
                }}>
                    <Filter size={16} style={{ color: 'var(--enterprise-gray-500)' }} />
                    <select
                        value={statusFilter}
                        onChange={(e) => onStatusFilterChange(e.target.value as StockStatus | 'ALL')}
                        style={{
                            padding: '8px 12px',
                            borderRadius: 'var(--border-radius-md)',
                            border: '1px solid var(--enterprise-gray-300)',
                            fontSize: 'var(--font-size-sm)',
                            color: 'var(--enterprise-gray-700)',
                            background: 'white',
                            cursor: 'pointer',
                        }}
                    >
                        <option value="ALL">All Statuses</option>
                        <option value="CRITICAL">Critical</option>
                        <option value="LOW">Low Stock</option>
                        <option value="MEDIUM">Medium</option>
                        <option value="HEALTHY">Healthy</option>
                    </select>
                </div>

                {/* Refresh Button */}
                <Button
                    variant="secondary"
                    icon={<RefreshCw size={16} className={refreshing ? 'spinning' : ''} />}
                    onClick={onRefresh}
                    disabled={refreshing}
                >
                    {refreshing ? 'Refreshing...' : 'Refresh'}
                </Button>

                {/* Export Button */}
                <Button
                    variant="secondary"
                    icon={<Download size={16} />}
                    onClick={() => alert('Export functionality coming soon')}
                >
                    Export
                </Button>
            </div>
        </div>
    );
}

// ============================================================================
// MAIN INVENTORY GRID COMPONENT
// ============================================================================

type SortField = 'itemCode' | 'warehouseAvailable' | 'inTransitQuantity' | 'netAvailableForCustomer' | 'stockStatus';
type SortDirection = 'asc' | 'desc';

export function InventoryGrid() {
    const { items, loading, error, refetch, stats } = useAllItemsStockDashboard();

    // Local state
    const [refreshing, setRefreshing] = useState(false);
    const [searchTerm, setSearchTerm] = useState('');
    const [statusFilter, setStatusFilter] = useState<StockStatus | 'ALL'>('ALL');
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

    // Filter and sort items
    const filteredItems = useMemo(() => {
        let result = [...items];

        // Apply search filter
        if (searchTerm) {
            const searchLower = searchTerm.toLowerCase();
            result = result.filter(item =>
                item.itemCode.toLowerCase().includes(searchLower) ||
                item.itemName?.toLowerCase().includes(searchLower) ||
                item.partNumber?.toLowerCase().includes(searchLower) ||
                item.masterSerialNo?.toLowerCase().includes(searchLower)
            );
        }

        // Apply status filter
        if (statusFilter !== 'ALL') {
            result = result.filter(item => item.stockStatus === statusFilter);
        }

        // Apply sorting
        result.sort((a, b) => {
            let aVal: any = a[sortField];
            let bVal: any = b[sortField];

            if (typeof aVal === 'string') {
                aVal = aVal.toLowerCase();
                bVal = bVal?.toLowerCase() || '';
            }

            if (aVal < bVal) return sortDirection === 'asc' ? -1 : 1;
            if (aVal > bVal) return sortDirection === 'asc' ? 1 : -1;
            return 0;
        });

        return result;
    }, [items, searchTerm, statusFilter, sortField, sortDirection]);

    // Handle view details
    const handleViewDetails = (item: ItemStockDashboard) => {
        setSelectedItem(item);
        setShowDetailModal(true);
    };

    // Render sort indicator
    const SortIndicator = ({ field }: { field: SortField }) => {
        if (sortField !== field) return null;
        return sortDirection === 'asc'
            ? <ChevronUp size={14} style={{ marginLeft: '4px' }} />
            : <ChevronDown size={14} style={{ marginLeft: '4px' }} />;
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
                    fontSize: 'var(--font-size-base)',
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
        <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
            {/* Summary Cards */}
            <div style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(4, 1fr)',
                gap: '16px',
            }}>
                <SummaryCard
                    label="Total Items"
                    value={stats.totalItems}
                    icon={<Package size={24} style={{ color: 'var(--enterprise-primary)' }} />}
                    color="var(--enterprise-primary)"
                    bgColor="rgba(30, 58, 138, 0.1)"
                />
                <SummaryCard
                    label="Healthy Stock"
                    value={stats.healthyCount}
                    icon={<CheckCircle size={24} style={{ color: 'var(--enterprise-success)' }} />}
                    color="var(--enterprise-success)"
                    bgColor="rgba(34, 197, 94, 0.1)"
                />
                <SummaryCard
                    label="Low Stock"
                    value={stats.lowCount}
                    icon={<AlertTriangle size={24} style={{ color: 'var(--enterprise-warning)' }} />}
                    color="var(--enterprise-warning)"
                    bgColor="rgba(234, 179, 8, 0.1)"
                />
                <SummaryCard
                    label="Critical Stock"
                    value={stats.criticalCount}
                    icon={<AlertTriangle size={24} style={{ color: 'var(--enterprise-error)' }} />}
                    color="var(--enterprise-error)"
                    bgColor="rgba(220, 38, 38, 0.1)"
                />
            </div>

            {/* Filter Bar */}
            <FilterBar
                searchTerm={searchTerm}
                onSearchChange={setSearchTerm}
                statusFilter={statusFilter}
                onStatusFilterChange={setStatusFilter}
                onRefresh={handleRefresh}
                refreshing={refreshing}
            />

            {/* Inventory Table */}
            <Card style={{ padding: 0, overflow: 'hidden' }}>
                {filteredItems.length === 0 ? (
                    <EmptyState
                        icon={<Package size={48} />}
                        title={searchTerm || statusFilter !== 'ALL' ? "No Matching Items" : "No Inventory Data"}
                        description={
                            searchTerm || statusFilter !== 'ALL'
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
                                        style={{ ...thStyle, minWidth: '120px' }}
                                        onClick={() => handleSort('itemCode')}
                                    >
                                        <span style={{ display: 'flex', alignItems: 'center' }}>
                                            Item Code <SortIndicator field="itemCode" />
                                        </span>
                                    </th>
                                    <th style={{ ...thStyle, minWidth: '120px', cursor: 'default' }}>
                                        Part Number
                                    </th>
                                    <th style={{ ...thStyle, minWidth: '120px', cursor: 'default' }}>
                                        Master S/N
                                    </th>
                                    <th style={{ ...thStyle, minWidth: '200px', cursor: 'default' }}>
                                        Description
                                    </th>
                                    <th style={{ ...thStyle, textAlign: 'center', minWidth: '60px', cursor: 'default' }}>
                                        UOM
                                    </th>
                                    <th
                                        style={{ ...thStyle, textAlign: 'right', minWidth: '100px' }}
                                        onClick={() => handleSort('warehouseAvailable')}
                                    >
                                        <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end' }}>
                                            Warehouse <SortIndicator field="warehouseAvailable" />
                                        </span>
                                    </th>
                                    <th
                                        style={{ ...thStyle, textAlign: 'right', minWidth: '100px' }}
                                        onClick={() => handleSort('inTransitQuantity')}
                                    >
                                        <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end' }}>
                                            In Transit <SortIndicator field="inTransitQuantity" />
                                        </span>
                                    </th>
                                    <th style={{ ...thStyle, textAlign: 'right', minWidth: '100px', cursor: 'default' }}>
                                        Production
                                    </th>
                                    <th
                                        style={{ ...thStyle, textAlign: 'right', minWidth: '120px' }}
                                        onClick={() => handleSort('netAvailableForCustomer')}
                                    >
                                        <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end' }}>
                                            Net Available <SortIndicator field="netAvailableForCustomer" />
                                        </span>
                                    </th>
                                    <th
                                        style={{ ...thStyle, textAlign: 'center', minWidth: '100px' }}
                                        onClick={() => handleSort('stockStatus')}
                                    >
                                        <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                            Status <SortIndicator field="stockStatus" />
                                        </span>
                                    </th>
                                    <th style={{ ...thStyle, textAlign: 'center', minWidth: '80px', cursor: 'default' }}>
                                        Action
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
                                            transition: 'background-color var(--transition-fast)',
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
                                            fontWeight: 'var(--font-weight-semibold)',
                                            color: 'var(--enterprise-primary)'
                                        }}>
                                            {item.itemCode}
                                        </td>
                                        <td style={{ ...tdStyle, color: 'var(--enterprise-gray-600)' }}>
                                            {item.partNumber || '-'}
                                        </td>
                                        <td style={{ ...tdStyle, color: 'var(--enterprise-gray-600)' }}>
                                            {item.masterSerialNo || '-'}
                                        </td>
                                        <td style={tdStyle}>
                                            {item.itemName || '-'}
                                        </td>
                                        <td style={{ ...tdStyle, textAlign: 'center' }}>
                                            {item.uom || 'PCS'}
                                        </td>
                                        <td style={{
                                            ...tdStyle,
                                            textAlign: 'right',
                                            fontWeight: 'var(--font-weight-medium)',
                                        }}>
                                            {item.warehouseAvailable}
                                        </td>
                                        <td style={{
                                            ...tdStyle,
                                            textAlign: 'right',
                                            fontWeight: 'var(--font-weight-medium)',
                                            color: 'var(--enterprise-info)',
                                        }}>
                                            {item.inTransitQuantity}
                                        </td>
                                        <td style={{
                                            ...tdStyle,
                                            textAlign: 'right',
                                            fontWeight: 'var(--font-weight-medium)',
                                            color: 'var(--enterprise-secondary)',
                                        }}>
                                            {item.productionFinishedStock}
                                        </td>
                                        <td style={{
                                            ...tdStyle,
                                            textAlign: 'right',
                                            fontWeight: 'var(--font-weight-bold)',
                                            color: getStatusColor(item.stockStatus),
                                        }}>
                                            {item.netAvailableForCustomer}
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
                fontSize: 'var(--font-size-sm)',
                color: 'var(--enterprise-gray-600)',
            }}>
                <span>
                    Showing {filteredItems.length} of {items.length} items
                    {(searchTerm || statusFilter !== 'ALL') && ' (filtered)'}
                </span>
                <span>
                    Total Net Available: {' '}
                    <strong style={{ color: 'var(--enterprise-primary)' }}>
                        {filteredItems.reduce((sum, item) => sum + (item.netAvailableForCustomer || 0), 0).toLocaleString()}
                    </strong>
                </span>
            </div>

            {/* Detail Modal */}
            <Modal
                isOpen={showDetailModal}
                onClose={() => setShowDetailModal(false)}
                title={`Stock Details - ${selectedItem?.itemCode || ''}`}
                maxWidth="900px"
            >
                {selectedItem && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
                        {/* Item Info Header */}
                        <div style={{
                            background: 'var(--enterprise-gray-50)',
                            padding: '16px',
                            borderRadius: 'var(--border-radius-md)',
                        }}>
                            <h3 style={{
                                marginBottom: '8px',
                                color: 'var(--enterprise-gray-800)',
                                fontSize: 'var(--font-size-lg)',
                            }}>
                                {selectedItem.itemName}
                            </h3>
                            <div style={{
                                display: 'flex',
                                gap: '24px',
                                fontSize: 'var(--font-size-sm)',
                                color: 'var(--enterprise-gray-600)',
                            }}>
                                <span><strong>Code:</strong> {selectedItem.itemCode}</span>
                                <span><strong>UOM:</strong> {selectedItem.uom}</span>
                                <span>
                                    <strong>Status:</strong>{' '}
                                    <Badge variant={getStatusVariant(selectedItem.stockStatus)}>
                                        {selectedItem.stockStatus}
                                    </Badge>
                                </span>
                            </div>
                        </div>

                        {/* Stock Distribution Card */}
                        <StockDistributionCard
                            itemCode={selectedItem.itemCode}
                            data={selectedItem}
                            showActions={true}
                            compact={false}
                        />

                        {/* Close Button */}
                        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                            <Button variant="primary" onClick={() => setShowDetailModal(false)}>
                                Close
                            </Button>
                        </div>
                    </div>
                )}
            </Modal>

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
