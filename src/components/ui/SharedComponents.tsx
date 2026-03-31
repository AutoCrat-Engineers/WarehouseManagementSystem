/**
 * SharedComponents.tsx — Centralized UI elements for consistent styling across ALL modules.
 *
 * PURPOSE: Every module must import from here instead of defining their own
 *          SummaryCard, SearchBox, ActionButton, DateRangeFilter, or FilterBar.
 *
 * ICON STANDARD: All icons use lucide-react exclusively.
 *
 * SIZING STANDARD:
 *   - Toolbar buttons: height=36px, border-radius=6px, font-size=13px, fontWeight=500
 *   - Summary card icon container: 44×44px, border-radius=8px
 *   - Summary card value: 1.75rem, fontWeight=700
 *   - Summary card label: 12px, fontWeight=500
 *   - Search input font: 13px
 *   - Date picker font: 13px
 *   - Table header: 12px, uppercase, letterSpacing=0.5px, padding=12px 16px
 *   - Table cell: 13px, padding=12px 16px
 */

import React, { CSSProperties } from 'react';
import {
    Search,
    X,
    XCircle,
    Download,
    RefreshCw,
    Plus,
    CalendarDays,
    ChevronLeft,
    ChevronRight,
} from 'lucide-react';
import { Card } from './EnterpriseUI';

// ============================================================================
// TABLE STYLES — shared across all modules
// ============================================================================

export const sharedThStyle: CSSProperties = {
    padding: '12px 16px',
    textAlign: 'left',
    fontSize: '12px',
    fontWeight: 600,
    color: 'var(--enterprise-gray-700)',
    textTransform: 'uppercase',
    letterSpacing: '0.5px',
    whiteSpace: 'nowrap',
};

export const sharedTdStyle: CSSProperties = {
    padding: '12px 16px',
    fontSize: '13px',
    color: 'var(--enterprise-gray-800)',
};

// ============================================================================
// SUMMARY CARD — Top metric cards (clickable, filterable)
// ============================================================================

export interface SummaryCardProps {
    label: string;
    value: number;
    icon: React.ReactNode;
    color: string;
    bgColor: string;
    isActive?: boolean;
    onClick?: () => void;
}

export function SummaryCard({
    label,
    value,
    icon,
    color,
    bgColor,
    isActive = false,
    onClick,
}: SummaryCardProps) {
    return (
        <div
            onClick={onClick}
            style={{ cursor: onClick ? 'pointer' : 'default', transition: 'all 0.2s ease' }}
        >
            <Card
                style={{
                    border: isActive ? `2px solid ${color}` : '1px solid var(--enterprise-gray-200)',
                    boxShadow: isActive ? `0 0 0 3px ${bgColor}` : 'var(--shadow-sm)',
                }}
            >
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <div>
                        <p
                            style={{
                                fontSize: '12px',
                                color: 'var(--enterprise-gray-600)',
                                fontWeight: 500,
                                marginBottom: '6px',
                            }}
                        >
                            {label}
                        </p>
                        <p style={{ fontSize: '1.75rem', fontWeight: 700, color }}>{value}</p>
                    </div>
                    <div
                        style={{
                            width: '44px',
                            height: '44px',
                            borderRadius: '8px',
                            backgroundColor: bgColor,
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                        }}
                    >
                        {icon}
                    </div>
                </div>
            </Card>
        </div>
    );
}

// ============================================================================
// ACTION BUTTON — Standardized toolbar button (Refresh, Export, Clear, Add, etc.)
// ============================================================================

export interface ActionButtonProps {
    label: string;
    icon: React.ReactNode;
    onClick: () => void;
    variant?: 'primary' | 'secondary' | 'danger';
    disabled?: boolean;
    spinning?: boolean;
}

const ACTION_BTN_BASE: CSSProperties = {
    padding: '0 14px',
    height: '36px',
    borderRadius: '6px',
    fontSize: '13px',
    fontWeight: 500,
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    whiteSpace: 'nowrap',
    transition: 'all 0.15s ease',
};

export function ActionButton({
    label,
    icon,
    onClick,
    variant = 'secondary',
    disabled = false,
    spinning = false,
}: ActionButtonProps) {
    const variantStyles: Record<string, CSSProperties> = {
        primary: {
            border: 'none',
            background: '#1e3a8a',
            color: 'white',
        },
        secondary: {
            border: '1px solid var(--enterprise-gray-300)',
            background: 'white',
            color: 'var(--enterprise-gray-700)',
        },
        danger: {
            border: '1px solid #dc2626',
            background: 'white',
            color: '#dc2626',
        },
    };

    return (
        <button
            onClick={onClick}
            disabled={disabled}
            style={{
                ...ACTION_BTN_BASE,
                ...variantStyles[variant],
                opacity: disabled ? 0.6 : 1,
                cursor: disabled ? 'not-allowed' : 'pointer',
            }}
        >
            {spinning ? (
                <RefreshCw size={14} style={{ animation: 'spin 0.8s linear infinite' }} />
            ) : (
                icon
            )}
            {label}
        </button>
    );
}

// ============================================================================
// Convenience buttons with pre-configured icons
// ============================================================================

export function RefreshButton({
    onClick,
    loading = false,
}: {
    onClick: () => void;
    loading?: boolean;
}) {
    return (
        <ActionButton
            label={loading ? 'Loading...' : 'Refresh'}
            icon={<RefreshCw size={14} />}
            onClick={onClick}
            disabled={loading}
            spinning={loading}
            variant="secondary"
        />
    );
}

export function ExportCSVButton({ onClick }: { onClick: () => void }) {
    return (
        <ActionButton
            label="Export Excel"
            icon={<Download size={14} />}
            onClick={onClick}
            variant="secondary"
        />
    );
}

export function ClearFiltersButton({ onClick }: { onClick: () => void }) {
    return (
        <ActionButton
            label="Clear"
            icon={<XCircle size={16} />}
            onClick={onClick}
            variant="danger"
        />
    );
}

export function AddButton({ label, onClick }: { label: string; onClick: () => void }) {
    return (
        <ActionButton
            label={label}
            icon={<Plus size={14} />}
            onClick={onClick}
            variant="primary"
        />
    );
}

// ============================================================================
// SEARCH BOX — Elongated search input with clear button
// ============================================================================

export interface SearchBoxProps {
    value: string;
    onChange: (value: string) => void;
    placeholder?: string;
    minWidth?: string;
}

export function SearchBox({
    value,
    onChange,
    placeholder = 'Search...',
    minWidth = '260px',
}: SearchBoxProps) {
    return (
        <div
            style={{
                display: 'flex',
                alignItems: 'center',
                background: 'var(--enterprise-gray-50)',
                border: '1px solid var(--enterprise-gray-300)',
                borderRadius: '6px',
                padding: '8px 12px',
                flex: 1,
                minWidth,
            }}
        >
            <Search
                size={18}
                style={{ color: 'var(--enterprise-gray-400)', marginRight: '10px', flexShrink: 0 }}
            />
            <input
                type="text"
                placeholder={placeholder}
                value={value}
                onChange={(e) => onChange(e.target.value)}
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
            {value && (
                <button
                    onClick={() => onChange('')}
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
    );
}

// ============================================================================
// STATUS FILTER DROPDOWN — Standardized select
// ============================================================================

export interface StatusFilterProps {
    value: string;
    onChange: (value: string) => void;
    options: { value: string; label: string }[];
}

export function StatusFilter({ value, onChange, options }: StatusFilterProps) {
    return (
        <select
            value={value}
            onChange={(e) => onChange(e.target.value)}
            style={{
                padding: '8px 12px',
                borderRadius: '6px',
                border: '1px solid var(--enterprise-gray-300)',
                fontSize: '13px',
                fontWeight: 500,
                cursor: 'pointer',
                background: 'white',
                height: '36px',
            }}
        >
            {options.map((opt) => (
                <option key={opt.value} value={opt.value}>
                    {opt.label}
                </option>
            ))}
        </select>
    );
}

// ============================================================================
// DATE RANGE FILTER — From/To date picker with clear
// ============================================================================

export interface DateRangeFilterProps {
    dateFrom: string;
    dateTo: string;
    onDateFromChange: (value: string) => void;
    onDateToChange: (value: string) => void;
}

export function DateRangeFilter({
    dateFrom,
    dateTo,
    onDateFromChange,
    onDateToChange,
}: DateRangeFilterProps) {
    const hasValue = !!(dateFrom || dateTo);

    return (
        <div
            style={{
                display: 'flex',
                alignItems: 'center',
                gap: '0px',
                height: '36px',
                borderRadius: '6px',
                border: `1px solid ${hasValue ? '#93c5fd' : 'var(--enterprise-gray-300)'}`,
                background: hasValue ? '#eff6ff' : 'white',
                transition: 'background 0.2s, border-color 0.2s',
                flexShrink: 0,
                overflow: 'hidden',
            }}
        >
            {/* From date */}
            <div
                style={{
                    position: 'relative',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '5px',
                    padding: '0 12px',
                    height: '100%',
                    cursor: 'pointer',
                    transition: 'background 0.15s ease',
                }}
                onMouseEnter={(e) => {
                    e.currentTarget.style.background = dateFrom ? '#dbeafe' : '#f3f4f6';
                }}
                onMouseLeave={(e) => {
                    e.currentTarget.style.background = 'transparent';
                }}
            >
                <CalendarDays
                    size={14}
                    style={{
                        color: dateFrom ? '#2563eb' : '#9ca3af',
                        flexShrink: 0,
                        pointerEvents: 'none',
                    }}
                />
                <span
                    style={{
                        fontSize: '13px',
                        fontWeight: 500,
                        color: dateFrom ? 'var(--enterprise-gray-700)' : 'var(--enterprise-gray-500)',
                        pointerEvents: 'none',
                        whiteSpace: 'nowrap',
                    }}
                >
                    {dateFrom ? dateFrom.split('-').reverse().join('-') : 'From'}
                </span>
                <input
                    type="date"
                    value={dateFrom}
                    onChange={(e) => onDateFromChange(e.target.value)}
                    title="From date"
                    style={{
                        position: 'absolute',
                        inset: 0,
                        opacity: 0,
                        cursor: 'pointer',
                        width: '100%',
                        height: '100%',
                    }}
                />
            </div>

            <div style={{ width: '1px', height: '18px', background: '#d1d5db', flexShrink: 0 }} />

            {/* To date */}
            <div
                style={{
                    position: 'relative',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '5px',
                    padding: '0 12px',
                    height: '100%',
                    cursor: 'pointer',
                    transition: 'background 0.15s ease',
                }}
                onMouseEnter={(e) => {
                    e.currentTarget.style.background = dateTo ? '#dbeafe' : '#f3f4f6';
                }}
                onMouseLeave={(e) => {
                    e.currentTarget.style.background = 'transparent';
                }}
            >
                <CalendarDays
                    size={14}
                    style={{
                        color: dateTo ? '#2563eb' : '#9ca3af',
                        flexShrink: 0,
                        pointerEvents: 'none',
                    }}
                />
                <span
                    style={{
                        fontSize: '13px',
                        fontWeight: 500,
                        color: dateTo ? 'var(--enterprise-gray-700)' : 'var(--enterprise-gray-500)',
                        pointerEvents: 'none',
                        whiteSpace: 'nowrap',
                    }}
                >
                    {dateTo ? dateTo.split('-').reverse().join('-') : 'To'}
                </span>
                <input
                    type="date"
                    value={dateTo}
                    onChange={(e) => onDateToChange(e.target.value)}
                    title="To date"
                    style={{
                        position: 'absolute',
                        inset: 0,
                        opacity: 0,
                        cursor: 'pointer',
                        width: '100%',
                        height: '100%',
                    }}
                />
            </div>

            {/* Clear button */}
            {hasValue && (
                <button
                    onClick={() => {
                        onDateFromChange('');
                        onDateToChange('');
                    }}
                    style={{
                        background: 'none',
                        border: 'none',
                        cursor: 'pointer',
                        padding: '6px 10px',
                        display: 'flex',
                        alignItems: 'center',
                        borderRadius: '0',
                        flexShrink: 0,
                        height: '100%',
                        transition: 'background 0.15s ease',
                    }}
                    onMouseEnter={(e) => {
                        e.currentTarget.style.background = '#fee2e2';
                    }}
                    onMouseLeave={(e) => {
                        e.currentTarget.style.background = 'transparent';
                    }}
                    title="Clear date filter"
                >
                    <X size={14} style={{ color: '#dc2626' }} />
                </button>
            )}
        </div>
    );
}

// ============================================================================
// FILTER BAR WRAPPER — Container for search + filters + action buttons
// ============================================================================

export interface FilterBarProps {
    children: React.ReactNode;
}

export function FilterBar({ children }: FilterBarProps) {
    return (
        <div
            className="filter-bar"
            style={{
                display: 'flex',
                alignItems: 'center',
                marginBottom: '16px',
                gap: '12px',
                flexWrap: 'wrap',
                background: 'white',
                padding: '10px 16px',
                borderRadius: '8px',
                border: '1px solid var(--enterprise-gray-200)',
            }}
        >
            {children}
        </div>
    );
}

// ============================================================================
// ACTION BAR — Right-aligned action buttons inside FilterBar
// ============================================================================

export function ActionBar({ children }: { children: React.ReactNode }) {
    return (
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0 }}>
            {children}
        </div>
    );
}

// ============================================================================
// SUMMARY CARDS GRID — Standardized grid container for top cards
// ============================================================================

export function SummaryCardsGrid({
    children,
    columns,
}: {
    children: React.ReactNode;
    columns?: number;
}) {
    return (
        <div
            className="summary-cards-grid"
            style={{
                display: 'grid',
                gridTemplateColumns: columns
                    ? `repeat(${columns}, 1fr)`
                    : 'repeat(auto-fit, minmax(200px, 1fr))',
                gap: '16px',
                marginBottom: '20px',
            }}
        >
            {children}
        </div>
    );
}

// ============================================================================
// PAGINATION — Standardized footer across all grids
// ============================================================================

export interface PaginationProps {
    page: number;          // 0-indexed
    pageSize: number;
    totalCount: number;
    onPageChange: (newPage: number) => void;
}

export function Pagination({ page, pageSize, totalCount, onPageChange }: PaginationProps) {
    const totalPages = Math.ceil(totalCount / pageSize);

    if (totalCount === 0 || totalPages <= 1) {
        return (
            <div style={{ padding: '12px 16px', borderTop: '1px solid var(--table-border)', fontSize: '13px', color: 'var(--enterprise-gray-600)' }}>
                Showing {totalCount > 0 ? `all ${totalCount}` : '0'} records
            </div>
        );
    }

    const startItem = page * pageSize + 1;
    const endItem = Math.min((page + 1) * pageSize, totalCount);

    return (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px', borderTop: '1px solid var(--table-border)', fontSize: 13, color: 'var(--enterprise-gray-600)' }}>
            <span>Showing {startItem}–{endItem} of {totalCount}</span>
            <div style={{ display: 'flex', gap: 4 }}>
                <button 
                    onClick={() => onPageChange(Math.max(0, page - 1))} 
                    disabled={page === 0} 
                    style={{ padding: '6px 10px', borderRadius: 6, border: '1px solid #d1d5db', backgroundColor: page === 0 ? '#f9fafb' : '#fff', cursor: page === 0 ? 'default' : 'pointer', opacity: page === 0 ? 0.5 : 1 }}
                >
                    <ChevronLeft size={14} />
                </button>
                <span style={{ padding: '6px 12px', fontWeight: 600 }}>{page + 1} / {totalPages}</span>
                <button 
                    onClick={() => onPageChange(Math.min(totalPages - 1, page + 1))} 
                    disabled={page >= totalPages - 1} 
                    style={{ padding: '6px 10px', borderRadius: 6, border: '1px solid #d1d5db', backgroundColor: page >= totalPages - 1 ? '#f9fafb' : '#fff', cursor: page >= totalPages - 1 ? 'default' : 'pointer', opacity: page >= totalPages - 1 ? 0.5 : 1 }}
                >
                    <ChevronRight size={14} />
                </button>
            </div>
        </div>
    );
}
