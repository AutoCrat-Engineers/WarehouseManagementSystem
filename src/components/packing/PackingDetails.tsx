/**
 * Packing Details — Item Master-linked packing specifications
 *
 * CORE RULES:
 * - Strictly against Item Master (FK with CASCADE DELETE)
 * - One packing record per item only
 * - Status auto-synced from Item Master via DB trigger
 * - All lengths stored in mm, all weights stored in kg
 * - Real-time unit conversion in view & edit modes
 */

import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { getSupabaseClient } from '../../utils/supabase/client';
import {
    Card, Button, Badge, Input, Label, Select,
    Modal, LoadingSpinner, EmptyState, ModuleLoader,
} from '../ui/EnterpriseUI';
import {
    SummaryCard, SummaryCardsGrid,
    FilterBar as SharedFilterBar, ActionBar,
    SearchBox, ClearFiltersButton, ExportCSVButton, RefreshButton, AddButton,
} from '../ui/SharedComponents';
import {
    PackageOpen, Search, Plus, Eye, Edit2, Download,
    X, CheckCircle2, XCircle, AlertTriangle, Info,
    ClipboardList, Ruler, Weight, Box, ChevronDown,
    RefreshCw, Filter, Trash2, Settings,
} from 'lucide-react';

// ============================================================================
// TYPES
// ============================================================================

type UserRole = 'L1' | 'L2' | 'L3' | null;

interface PackingDetailsProps {
    accessToken: string;
    userRole?: UserRole;
    userPerms?: Record<string, boolean>;
    onNavigate?: (view: string) => void;
}

interface ItemMaster {
    id: string;
    item_code: string;
    item_name: string;
    master_serial_no: string | null;
    part_number: string | null;
    is_active: boolean;
}

interface PackingSpec {
    id: string;
    item_id: string;
    item_code: string;
    inner_box_length_mm: number;
    inner_box_width_mm: number;
    inner_box_height_mm: number;
    inner_box_quantity: number;
    inner_box_net_weight_kg: number;
    outer_box_length_mm: number;
    outer_box_width_mm: number;
    outer_box_height_mm: number;
    outer_box_quantity: number;
    outer_box_gross_weight_kg: number;
    is_active: boolean;
    created_at: string;
    updated_at: string;
    // Joined from items
    item_name?: string;
    master_serial_no?: string;
    part_number?: string;
    revision?: string;
}

interface PackingFormData {
    inner_box_length_mm: number;
    inner_box_width_mm: number;
    inner_box_height_mm: number;
    inner_box_quantity: number;
    inner_box_net_weight_kg: number;
    outer_box_length_mm: number;
    outer_box_width_mm: number;
    outer_box_height_mm: number;
    outer_box_quantity: number;
    outer_box_gross_weight_kg: number;
}

type LengthUnit = 'mm' | 'cm' | 'inches';
type WeightUnit = 'g' | 'kg' | 'lbs';
type CardFilter = 'ALL' | 'ACTIVE' | 'INACTIVE';

// ============================================================================
// UNIT CONVERSION HELPERS
// ============================================================================

const LENGTH_FACTORS: Record<LengthUnit, number> = { mm: 1, cm: 0.1, inches: 1 / 25.4 };
const WEIGHT_FACTORS: Record<WeightUnit, number> = { g: 1000, kg: 1, lbs: 2.20462 };
const LENGTH_LABELS: Record<LengthUnit, string> = { mm: 'mm', cm: 'cm', inches: 'in' };
const WEIGHT_LABELS: Record<WeightUnit, string> = { g: 'g', kg: 'kg', lbs: 'lbs' };

function convertLength(mm: number, to: LengthUnit): number {
    return +(mm * LENGTH_FACTORS[to]).toFixed(2);
}
function convertWeight(kg: number, to: WeightUnit): number {
    return +(kg * WEIGHT_FACTORS[to]).toFixed(4);
}
function toMm(val: number, from: LengthUnit): number {
    return +(val / LENGTH_FACTORS[from]).toFixed(2);
}
function toKg(val: number, from: WeightUnit): number {
    return +(val / WEIGHT_FACTORS[from]).toFixed(4);
}

// ============================================================================
// BOX WEIGHT AUTO-CALCULATORS
// ============================================================================
// Inner box = corrugated cardboard (3-ply): ~0.55 kg/m² surface area
// Outer box = wooden plywood (12mm):       ~7.2  kg/m² surface area
// Surface area of a box = 2 * (L×W + W×H + L×H)
// ============================================================================

const CARTON_DENSITY_KG_M2 = 0.55;   // corrugated cardboard
const PLYWOOD_DENSITY_KG_M2 = 7.2;   // 12mm plywood

function calcBoxWeight(l_mm: number, w_mm: number, h_mm: number, density: number): number {
    if (l_mm <= 0 || w_mm <= 0 || h_mm <= 0) return 0;
    const surfaceArea_m2 = 2 * (l_mm * w_mm + w_mm * h_mm + l_mm * h_mm) / 1_000_000;
    return +(surfaceArea_m2 * density).toFixed(4);
}

function calcCartonWeight(l: number, w: number, h: number): number {
    return calcBoxWeight(l, w, h, CARTON_DENSITY_KG_M2);
}
function calcPlywoodWeight(l: number, w: number, h: number): number {
    return calcBoxWeight(l, w, h, PLYWOOD_DENSITY_KG_M2);
}

const formDefault: PackingFormData = {
    inner_box_length_mm: 0, inner_box_width_mm: 0, inner_box_height_mm: 0,
    inner_box_quantity: 0, inner_box_net_weight_kg: 0,
    outer_box_length_mm: 0, outer_box_width_mm: 0, outer_box_height_mm: 0,
    outer_box_quantity: 0, outer_box_gross_weight_kg: 0,
};

// ============================================================================
// STYLES (matching ItemMaster exactly)
// ============================================================================

const thStyle: React.CSSProperties = {
    padding: '12px 16px', textAlign: 'left',
    fontSize: 'var(--font-size-sm)', fontWeight: 'var(--font-weight-semibold)',
    color: 'var(--enterprise-gray-700)', textTransform: 'uppercase', letterSpacing: '0.5px',
};
const tdStyle: React.CSSProperties = {
    padding: '12px 16px', fontSize: 'var(--font-size-base)', color: 'var(--enterprise-gray-800)',
};
const sectionStyle: React.CSSProperties = {
    borderRadius: 'var(--border-radius-md)', padding: '16px', marginBottom: '16px',
};



// ============================================================================
// UNIT TOGGLE BUTTON (compact, ERP-style)
// ============================================================================

function UnitToggle<T extends string>({ units, active, onChange, label, icon }: {
    units: readonly T[]; active: T; onChange: (u: T) => void; label?: string; icon?: React.ReactNode;
}) {
    return (
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
            {icon ? (
                <span style={{ display: 'flex', alignItems: 'center', color: 'var(--enterprise-gray-500)' }}>{icon}</span>
            ) : label ? (
                <span style={{ fontSize: '10px', color: 'var(--enterprise-gray-500)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px' }}>{label}:</span>
            ) : null}
            <div style={{ display: 'inline-flex', borderRadius: '6px', border: '1px solid var(--enterprise-gray-200)', overflow: 'hidden' }}>
                {units.map(u => (
                    <button
                        key={u}
                        onClick={() => onChange(u)}
                        style={{
                            padding: '3px 8px', border: 'none', fontSize: '11px', fontWeight: active === u ? 700 : 500,
                            background: active === u ? 'var(--enterprise-primary)' : 'white',
                            color: active === u ? 'white' : 'var(--enterprise-gray-600)',
                            cursor: 'pointer', transition: 'all 0.15s ease',
                        }}
                    >{u}</button>
                ))}
            </div>
        </div>
    );
}

// ============================================================================
// CONTAINER BREAKDOWN CALCULATOR (for Contract Config tab)
// ============================================================================
function calcContainerBreakdown(outerQty: number, innerQty: number) {
    if (!outerQty || !innerQty || innerQty <= 0) return { full: 0, adjustment: 0, total: 0 };
    const full = Math.floor(outerQty / innerQty);
    const adjustment = outerQty % innerQty;
    return { full, adjustment, total: outerQty };
}

// ============================================================================
// VIEW MODAL (with switchable tabs: Packing Details + Contract Config)
// ============================================================================

type ViewModalTab = 'packing-details' | 'contract-config';

function ViewModal({ isOpen, onClose, spec, item }: {
    isOpen: boolean; onClose: () => void; spec: PackingSpec | null; item?: ItemMaster | null;
}) {
    const [lu, setLu] = useState<LengthUnit>('mm');
    const [wu, setWu] = useState<WeightUnit>('kg');
    const [modalTab, setModalTab] = useState<ViewModalTab>('packing-details');

    // Reset tab when modal opens with a new spec
    useEffect(() => {
        if (isOpen) setModalTab('packing-details');
    }, [isOpen, spec?.id]);

    if (!spec) return null;

    const fmtSize = (l: number, w: number, h: number) =>
        `${convertLength(l, lu)} × ${convertLength(w, lu)} × ${convertLength(h, lu)} ${LENGTH_LABELS[lu]}`;

    const detailCard: React.CSSProperties = {
        background: 'white', padding: '14px 16px', borderRadius: 'var(--border-radius-sm)',
        border: '1px solid var(--enterprise-gray-100)', boxShadow: '0 1px 2px rgba(0,0,0,0.03)',
    };
    const lblStyle: React.CSSProperties = {
        fontSize: '11px', color: 'var(--enterprise-gray-500)', marginBottom: '6px',
        textTransform: 'uppercase', letterSpacing: '0.4px', fontWeight: 600,
    };

    // Contract Config calculations
    const breakdown = calcContainerBreakdown(spec.outer_box_quantity, spec.inner_box_quantity);
    const isConfigValid = spec.outer_box_quantity > 0 && spec.inner_box_quantity > 0;

    // Tab definitions
    const modalTabs: { id: ViewModalTab; label: string; icon: React.ReactNode }[] = [
        { id: 'packing-details', label: 'Packing Details', icon: <ClipboardList size={15} /> },
        { id: 'contract-config', label: 'Contract Config', icon: <Settings size={15} /> },
    ];

    return (
        <Modal isOpen={isOpen} onClose={onClose} title={
            <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%' }}>
                <span>View Packing Specification</span>
                <Badge variant={spec.is_active ? 'success' : 'error'}>{spec.is_active ? 'Active' : 'Inactive'}</Badge>
            </span>
        } maxWidth="800px">

            {/* ═══ TAB BAR ═══ */}
            <div style={{
                display: 'flex', alignItems: 'stretch',
                borderBottom: '2px solid var(--enterprise-gray-200, #e5e7eb)',
                marginBottom: '20px',
            }}>
                {modalTabs.map(tab => (
                    <button
                        key={tab.id}
                        onClick={() => setModalTab(tab.id)}
                        style={{
                            display: 'flex', alignItems: 'center', gap: '7px',
                            padding: '11px 20px', border: 'none',
                            borderBottom: modalTab === tab.id
                                ? '3px solid var(--enterprise-primary, #1e3a8a)'
                                : '3px solid transparent',
                            marginBottom: '-2px',
                            fontSize: '13px',
                            fontWeight: modalTab === tab.id ? 700 : 500,
                            cursor: 'pointer',
                            transition: 'all 0.2s ease',
                            background: 'transparent',
                            color: modalTab === tab.id
                                ? 'var(--enterprise-primary, #1e3a8a)'
                                : 'var(--enterprise-gray-500, #6b7280)',
                        }}
                        onMouseEnter={e => {
                            if (modalTab !== tab.id) {
                                e.currentTarget.style.color = 'var(--enterprise-gray-700, #374151)';
                                e.currentTarget.style.borderBottomColor = 'var(--enterprise-gray-300, #d1d5db)';
                            }
                        }}
                        onMouseLeave={e => {
                            if (modalTab !== tab.id) {
                                e.currentTarget.style.color = 'var(--enterprise-gray-500, #6b7280)';
                                e.currentTarget.style.borderBottomColor = 'transparent';
                            }
                        }}
                    >
                        <span style={{ display: 'flex', alignItems: 'center', opacity: modalTab === tab.id ? 1 : 0.6 }}>{tab.icon}</span>
                        {tab.label}
                    </button>
                ))}
            </div>

            {/* ═══ TAB: PACKING DETAILS ═══ */}
            {modalTab === 'packing-details' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                    {/* Item Info */}
                    <div style={{ ...sectionStyle, background: 'linear-gradient(135deg, rgba(30,58,138,0.03), rgba(30,58,138,0.08))', border: '1px solid rgba(30,58,138,0.1)' }}>
                        <p style={{ fontSize: '12px', fontWeight: 700, color: 'var(--enterprise-primary)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '12px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                            <PackageOpen size={14} /> Item Information
                        </p>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                            <div><Label>Item Code</Label><Input value={spec.item_code} disabled /></div>
                            <div><Label>Part Number</Label><Input value={spec.part_number || '—'} disabled /></div>
                            <div><Label>MSN</Label><Input value={spec.master_serial_no || '—'} disabled /></div>
                            <div><Label>Revision</Label><Input value={spec.revision || '—'} disabled /></div>
                            <div style={{ gridColumn: '1 / -1' }}><Label>Description</Label><Input value={spec.item_name || '—'} disabled /></div>
                        </div>
                    </div>

                    {/* Unit Toggles */}
                    <div style={{ display: 'flex', gap: '20px', justifyContent: 'flex-end' }}>
                        <UnitToggle<LengthUnit> units={['mm', 'cm', 'inches']} active={lu} onChange={setLu} icon={<Ruler size={14} />} />
                        <UnitToggle<WeightUnit> units={['g', 'kg', 'lbs']} active={wu} onChange={setWu} icon={<Weight size={14} />} />
                    </div>

                    {/* Inner Box */}
                    <div style={{ ...sectionStyle, background: 'linear-gradient(135deg, rgba(34,197,94,0.03), rgba(34,197,94,0.08))', border: '1px solid rgba(34,197,94,0.15)' }}>
                        <p style={{ fontSize: '12px', fontWeight: 700, color: 'var(--enterprise-success)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '12px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                            <Box size={14} /> Inner Box
                        </p>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '12px' }}>
                            <div style={detailCard}><p style={lblStyle}>Size (L × W × H)</p><p style={{ fontWeight: 700, color: 'var(--enterprise-gray-800)' }}>{fmtSize(spec.inner_box_length_mm, spec.inner_box_width_mm, spec.inner_box_height_mm)}</p></div>
                            <div style={detailCard}><p style={lblStyle}>Quantity</p><p style={{ fontWeight: 700, color: 'var(--enterprise-info, #3b82f6)', fontSize: '18px' }}>{spec.inner_box_quantity}</p></div>
                            <div style={detailCard}><p style={lblStyle}>Carton Box Gross Weight</p><p style={{ fontWeight: 700, color: 'var(--enterprise-gray-800)' }}>{convertWeight(spec.inner_box_net_weight_kg, wu)} {WEIGHT_LABELS[wu]}</p></div>
                        </div>
                    </div>

                    {/* Outer Box */}
                    <div style={{ ...sectionStyle, background: 'linear-gradient(135deg, rgba(168,85,247,0.03), rgba(168,85,247,0.08))', border: '1px solid rgba(168,85,247,0.15)', marginBottom: 0 }}>
                        <p style={{ fontSize: '12px', fontWeight: 700, color: 'rgb(168,85,247)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '12px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                            <PackageOpen size={14} /> Outer Box
                        </p>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '12px' }}>
                            <div style={detailCard}><p style={lblStyle}>Size (L × W × H)</p><p style={{ fontWeight: 700, color: 'var(--enterprise-gray-800)' }}>{fmtSize(spec.outer_box_length_mm, spec.outer_box_width_mm, spec.outer_box_height_mm)}</p></div>
                            <div style={detailCard}><p style={lblStyle}>Quantity</p><p style={{ fontWeight: 700, color: 'rgb(168,85,247)', fontSize: '18px' }}>{spec.outer_box_quantity}</p></div>
                            <div style={detailCard}><p style={lblStyle}>Plywood Box Gross Weight</p><p style={{ fontWeight: 700, color: 'var(--enterprise-gray-800)' }}>{convertWeight(spec.outer_box_gross_weight_kg, wu)} {WEIGHT_LABELS[wu]}</p></div>
                        </div>
                    </div>
                </div>
            )}

            {/* ═══ TAB: CONTRACT CONFIG ═══ */}
            {modalTab === 'contract-config' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                    {/* Item identifier bar */}
                    <div style={{
                        display: 'flex', alignItems: 'center', gap: '12px', padding: '12px 16px',
                        borderRadius: 'var(--border-radius-md)',
                        background: 'linear-gradient(135deg, rgba(30,58,138,0.04), rgba(30,58,138,0.08))',
                        border: '1px solid rgba(30,58,138,0.12)',
                    }}>
                        <PackageOpen size={16} style={{ color: 'var(--enterprise-primary)', flexShrink: 0 }} />
                        <div style={{ flex: 1 }}>
                            <span style={{ fontWeight: 700, color: 'var(--enterprise-primary)', fontSize: '14px' }}>{spec.item_code}</span>
                            <span style={{ margin: '0 8px', color: 'var(--enterprise-gray-300)' }}>|</span>
                            <span style={{ fontSize: '13px', color: 'var(--enterprise-gray-600)' }}>{spec.item_name || '—'}</span>
                        </div>
                        {spec.master_serial_no && (
                            <span style={{ fontSize: '12px', fontFamily: 'monospace', color: 'var(--enterprise-gray-500)', background: 'rgba(30,58,138,0.06)', padding: '3px 8px', borderRadius: '4px' }}>
                                MSN: {spec.master_serial_no}
                            </span>
                        )}
                    </div>

                    {/* Packing Configuration Summary */}
                    <div style={{ ...sectionStyle, background: 'linear-gradient(135deg, rgba(30,58,138,0.02), rgba(30,58,138,0.06))', border: '1px solid rgba(30,58,138,0.1)' }}>
                        <p style={{ fontSize: '12px', fontWeight: 700, color: 'var(--enterprise-primary)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '14px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                            <Settings size={14} /> Packing Configuration
                        </p>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                            <div style={detailCard}>
                                <p style={lblStyle}>Outer Box Quantity</p>
                                <p style={{ fontWeight: 700, color: 'rgb(168,85,247)', fontSize: '20px' }}>
                                    {spec.outer_box_quantity > 0 ? spec.outer_box_quantity.toLocaleString() : '—'}
                                </p>
                                <p style={{ fontSize: '11px', color: 'var(--enterprise-gray-400)', marginTop: '4px' }}>pcs per outer box</p>
                            </div>
                            <div style={detailCard}>
                                <p style={lblStyle}>Inner Box Quantity</p>
                                <p style={{ fontWeight: 700, color: 'var(--enterprise-info, #3b82f6)', fontSize: '20px' }}>
                                    {spec.inner_box_quantity > 0 ? spec.inner_box_quantity.toLocaleString() : '—'}
                                </p>
                                <p style={{ fontSize: '11px', color: 'var(--enterprise-gray-400)', marginTop: '4px' }}>pcs per inner box</p>
                            </div>
                        </div>
                    </div>

                    {/* Container Breakdown Calculation */}
                    <div style={{ ...sectionStyle, background: isConfigValid ? 'linear-gradient(135deg, rgba(34,197,94,0.03), rgba(34,197,94,0.08))' : 'linear-gradient(135deg, rgba(220,38,38,0.03), rgba(220,38,38,0.06))', border: isConfigValid ? '1px solid rgba(34,197,94,0.15)' : '1px solid rgba(220,38,38,0.15)' }}>
                        <p style={{ fontSize: '12px', fontWeight: 700, color: isConfigValid ? 'var(--enterprise-success)' : '#dc2626', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '14px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                            {isConfigValid ? <CheckCircle2 size={14} /> : <AlertTriangle size={14} />}
                            Container Breakdown
                        </p>
                        {isConfigValid ? (
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '12px' }}>
                                <div style={detailCard}>
                                    <p style={lblStyle}>Full Containers</p>
                                    <p style={{ fontWeight: 700, color: 'var(--enterprise-primary)', fontSize: '22px' }}>{breakdown.full}</p>
                                    <p style={{ fontSize: '11px', color: 'var(--enterprise-gray-400)', marginTop: '4px' }}>
                                        {breakdown.full} × {spec.inner_box_quantity} = {(breakdown.full * spec.inner_box_quantity).toLocaleString()} pcs
                                    </p>
                                </div>
                                <div style={detailCard}>
                                    <p style={lblStyle}>Top-off / Adjustment</p>
                                    {breakdown.adjustment > 0 ? (
                                        <>
                                            <p style={{ fontWeight: 700, color: '#d97706', fontSize: '22px' }}>{breakdown.adjustment}</p>
                                            <p style={{ fontSize: '11px', color: '#92400e', marginTop: '4px' }}>pcs in partial container</p>
                                        </>
                                    ) : (
                                        <>
                                            <p style={{ fontWeight: 700, color: '#16a34a', fontSize: '16px' }}>Clean Split</p>
                                            <p style={{ fontSize: '11px', color: 'var(--enterprise-gray-400)', marginTop: '4px' }}>No remainder</p>
                                        </>
                                    )}
                                </div>
                                <div style={detailCard}>
                                    <p style={lblStyle}>Total Pieces</p>
                                    <p style={{ fontWeight: 700, color: 'var(--enterprise-gray-800)', fontSize: '22px' }}>{spec.outer_box_quantity.toLocaleString()}</p>
                                    <p style={{ fontSize: '11px', color: 'var(--enterprise-gray-400)', marginTop: '4px' }}>per pallet / shipment</p>
                                </div>
                            </div>
                        ) : (
                            <div style={{ padding: '20px', textAlign: 'center', color: '#991b1b', fontSize: '13px' }}>
                                <AlertTriangle size={24} style={{ color: '#dc2626', marginBottom: '8px' }} />
                                <p style={{ fontWeight: 600, marginBottom: '4px' }}>Incomplete Configuration</p>
                                <p style={{ color: 'var(--enterprise-gray-500)' }}>Outer box and inner box quantities must both be greater than zero to calculate container breakdown.</p>
                            </div>
                        )}
                    </div>

                    {/* Box Dimensions Summary */}
                    <div style={{ ...sectionStyle, background: 'var(--enterprise-gray-50, #f9fafb)', border: '1px solid var(--enterprise-gray-200, #e5e7eb)' }}>
                        <p style={{ fontSize: '12px', fontWeight: 700, color: 'var(--enterprise-gray-600)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '14px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                            <Box size={14} /> Box Dimensions & Weight Summary
                        </p>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                            <div style={{ ...detailCard, borderLeft: '3px solid #22c55e' }}>
                                <p style={{ ...lblStyle, color: '#16a34a' }}>Inner Box</p>
                                <p style={{ fontSize: '13px', fontWeight: 600, color: 'var(--enterprise-gray-700)' }}>
                                    {spec.inner_box_length_mm} × {spec.inner_box_width_mm} × {spec.inner_box_height_mm} mm
                                </p>
                                <p style={{ fontSize: '12px', color: 'var(--enterprise-gray-500)', marginTop: '4px' }}>
                                    Net Weight: {spec.inner_box_net_weight_kg} kg
                                </p>
                            </div>
                            <div style={{ ...detailCard, borderLeft: '3px solid rgb(168,85,247)' }}>
                                <p style={{ ...lblStyle, color: 'rgb(168,85,247)' }}>Outer Box</p>
                                <p style={{ fontSize: '13px', fontWeight: 600, color: 'var(--enterprise-gray-700)' }}>
                                    {spec.outer_box_length_mm} × {spec.outer_box_width_mm} × {spec.outer_box_height_mm} mm
                                </p>
                                <p style={{ fontSize: '12px', color: 'var(--enterprise-gray-500)', marginTop: '4px' }}>
                                    Gross Weight: {spec.outer_box_gross_weight_kg} kg
                                </p>
                            </div>
                        </div>
                    </div>

                    {/* Info note */}
                    <div style={{
                        display: 'flex', alignItems: 'center', gap: '8px',
                        padding: '10px 14px', borderRadius: '8px',
                        background: 'linear-gradient(135deg, #eff6ff, #f0f4ff)',
                        border: '1px solid #bfdbfe',
                    }}>
                        <Info size={14} style={{ color: '#1e3a8a', flexShrink: 0 }} />
                        <span style={{ fontSize: '12px', color: '#1e40af' }}>
                            Quantities and dimensions are managed in <strong>Packing Details</strong>. Use the Edit action to update values.
                        </span>
                    </div>
                </div>
            )}

            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '20px' }}><Button variant="primary" onClick={onClose}>Close</Button></div>
        </Modal>
    );
}

// ============================================================================
// MAIN COMPONENT
// ============================================================================

export function PackingDetails({ accessToken, userRole, userPerms = {} }: PackingDetailsProps) {
    // RBAC helpers — granular permissions with role-based fallback
    const hasPerms = Object.keys(userPerms).length > 0;
    const canAdd = userRole === 'L3' || (hasPerms ? userPerms['packing.packing-details.create'] === true : userRole === 'L2');
    const canEdit = userRole === 'L3' || (hasPerms ? userPerms['packing.packing-details.edit'] === true : false);
    const canDelete = userRole === 'L3' || (hasPerms ? userPerms['packing.packing-details.delete'] === true : false);
    const canAction = canEdit || canDelete;

    // Data state
    const [specs, setSpecs] = useState<PackingSpec[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    // UI state
    const [searchTerm, setSearchTerm] = useState('');
    const [cardFilter, setCardFilter] = useState<CardFilter>('ALL');
    const [displayCount, setDisplayCount] = useState(20);
    const ITEMS_PER_PAGE = 20;

    // Table unit toggles
    const [tableLU, setTableLU] = useState<LengthUnit>('mm');

    // Modal state
    const [showAddModal, setShowAddModal] = useState(false);
    const [editSpec, setEditSpec] = useState<PackingSpec | null>(null);
    const [viewSpec, setViewSpec] = useState<PackingSpec | null>(null);

    // Add modal — item search
    const [itemSearch, setItemSearch] = useState('');
    const [itemResults, setItemResults] = useState<ItemMaster[]>([]);
    const [searchingItems, setSearchingItems] = useState(false);
    const [selectedItem, setSelectedItem] = useState<ItemMaster | null>(null);

    // Form state
    const [formData, setFormData] = useState<PackingFormData>(formDefault);
    // Separate unit states for inner and outer box sections
    const [innerFormLU, setInnerFormLU] = useState<LengthUnit>('mm');
    const [innerFormWU, setInnerFormWU] = useState<WeightUnit>('kg');
    const [outerFormLU, setOuterFormLU] = useState<LengthUnit>('mm');
    const [outerFormWU, setOuterFormWU] = useState<WeightUnit>('kg');
    const [saving, setSaving] = useState(false);

    // Actions dropdown state (matches ItemMaster pattern)
    const [activeDropdown, setActiveDropdown] = useState<string | null>(null);
    const dropdownRef = useRef<HTMLDivElement | null>(null);

    // Delete confirmation state
    const [showDeleteModal, setShowDeleteModal] = useState(false);
    const [deleteTarget, setDeleteTarget] = useState<PackingSpec | null>(null);

    // Toast
    const [toast, setToast] = useState<{ type: 'success' | 'error' | 'warning' | 'info'; title: string; text: string } | null>(null);
    const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
    const showToast = useCallback((type: 'success' | 'error' | 'warning' | 'info', title: string, text: string, dur = 5000) => {
        if (toastTimer.current) clearTimeout(toastTimer.current);
        setToast({ type, title, text });
        toastTimer.current = setTimeout(() => setToast(null), dur);
    }, []);

    // ── FETCH ──
    const fetchSpecs = useCallback(async () => {
        setError(null); setLoading(true);
        try {
            const supabase = getSupabaseClient();
            const { data, error: e } = await supabase
                .from('packing_specifications')
                .select('*, items!inner(item_name, master_serial_no, part_number, revision)')
                .order('created_at', { ascending: false });
            if (e) throw e;
            const mapped: PackingSpec[] = (data || []).map((r: any) => ({
                ...r,
                item_name: r.items?.item_name,
                master_serial_no: r.items?.master_serial_no,
                part_number: r.items?.part_number,
                revision: r.items?.revision,
            }));
            setSpecs(mapped);
        } catch (err: any) {
            setError(err.message || 'Failed to load packing specifications');
            setSpecs([]);
        } finally { setLoading(false); }
    }, []);

    useEffect(() => { fetchSpecs(); }, [fetchSpecs]);

    // Close dropdown on click outside
    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (activeDropdown && dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
                setActiveDropdown(null);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, [activeDropdown]);

    // ── STATS ──
    const stats = useMemo(() => ({
        total: specs.length,
        active: specs.filter(s => s.is_active).length,
        inactive: specs.filter(s => !s.is_active).length,
    }), [specs]);

    // ── FILTER + SEARCH ──
    const filtered = useMemo(() => {
        let r = specs;
        if (cardFilter === 'ACTIVE') r = r.filter(s => s.is_active);
        else if (cardFilter === 'INACTIVE') r = r.filter(s => !s.is_active);
        if (searchTerm.trim()) {
            const q = searchTerm.toLowerCase();
            r = r.filter(s =>
                s.item_code.toLowerCase().includes(q) ||
                (s.item_name || '').toLowerCase().includes(q) ||
                (s.master_serial_no || '').toLowerCase().includes(q) ||
                (s.part_number || '').toLowerCase().includes(q)
            );
        }
        return r;
    }, [specs, cardFilter, searchTerm]);

    const displayed = useMemo(() => filtered.slice(0, displayCount), [filtered, displayCount]);
    const hasMore = displayCount < filtered.length;

    useEffect(() => { setDisplayCount(ITEMS_PER_PAGE); }, [cardFilter, searchTerm]);

    // ── ITEM SEARCH (for Add modal) ──
    const searchItems = useCallback(async (q: string) => {
        if (q.trim().length < 2) { setItemResults([]); return; }
        setSearchingItems(true);
        try {
            const supabase = getSupabaseClient();
            const { data } = await supabase
                .from('items')
                .select('id, item_code, item_name, master_serial_no, part_number, is_active')
                .eq('is_active', true)
                .or(`item_code.ilike.%${q}%,item_name.ilike.%${q}%,master_serial_no.ilike.%${q}%,part_number.ilike.%${q}%`)
                .limit(10);
            // Filter out items that already have packing specs
            const existingIds = new Set(specs.map(s => s.item_id));
            setItemResults((data || []).filter((i: any) => !existingIds.has(i.id)));
        } catch { setItemResults([]); }
        finally { setSearchingItems(false); }
    }, [specs]);

    useEffect(() => {
        const t = setTimeout(() => searchItems(itemSearch), 300);
        return () => clearTimeout(t);
    }, [itemSearch, searchItems]);

    // ── SAVE (Create / Update) ──
    const handleSave = async () => {
        // Validation
        const { inner_box_length_mm, inner_box_width_mm, inner_box_height_mm, inner_box_quantity,
            inner_box_net_weight_kg, outer_box_length_mm, outer_box_width_mm, outer_box_height_mm,
            outer_box_quantity, outer_box_gross_weight_kg } = formData;
        const allValues = [inner_box_length_mm, inner_box_width_mm, inner_box_height_mm, inner_box_quantity,
            inner_box_net_weight_kg, outer_box_length_mm, outer_box_width_mm, outer_box_height_mm,
            outer_box_quantity, outer_box_gross_weight_kg];
        if (allValues.some(v => v < 0)) { showToast('error', 'Validation Error', 'Negative values are not allowed.'); return; }
        if (allValues.some(v => v === 0)) { showToast('warning', 'Warning', 'Some values are zero. Please verify all fields.'); }

        setSaving(true);
        try {
            const supabase = getSupabaseClient();
            if (editSpec) {
                // UPDATE
                const { error: e } = await supabase
                    .from('packing_specifications')
                    .update({ ...formData, updated_at: new Date().toISOString() })
                    .eq('id', editSpec.id);
                if (e) throw e;
                showToast('success', 'Updated', 'Packing specification updated successfully.');
            } else {
                // CREATE
                if (!selectedItem) { showToast('error', 'Error', 'Please select an item first.'); setSaving(false); return; }
                const { error: e } = await supabase
                    .from('packing_specifications')
                    .insert({
                        item_id: selectedItem.id,
                        item_code: selectedItem.item_code,
                        is_active: selectedItem.is_active,
                        ...formData,
                    });
                if (e) {
                    if (e.message.includes('uq_packing_spec_item') || e.message.includes('duplicate')) {
                        showToast('error', 'Duplicate', 'A packing specification already exists for this item.');
                    } else throw e;
                    setSaving(false); return;
                }
                showToast('success', 'Created', `Packing specification created for ${selectedItem.item_code}.`);
            }
            handleCloseModal();
            fetchSpecs();
        } catch (err: any) {
            showToast('error', 'Error', err.message || 'Failed to save.');
        } finally { setSaving(false); }
    };

    // ── MODAL HELPERS ──
    const handleCloseModal = () => {
        setShowAddModal(false); setEditSpec(null); setSelectedItem(null);
        setItemSearch(''); setItemResults([]); setFormData(formDefault);
        setRawInputs({});
        setInnerFormLU('mm'); setInnerFormWU('kg');
        setOuterFormLU('mm'); setOuterFormWU('kg');
    };

    const openEdit = (spec: PackingSpec) => {
        setEditSpec(spec);
        setFormData({
            inner_box_length_mm: spec.inner_box_length_mm, inner_box_width_mm: spec.inner_box_width_mm,
            inner_box_height_mm: spec.inner_box_height_mm, inner_box_quantity: spec.inner_box_quantity,
            inner_box_net_weight_kg: spec.inner_box_net_weight_kg,
            outer_box_length_mm: spec.outer_box_length_mm, outer_box_width_mm: spec.outer_box_width_mm,
            outer_box_height_mm: spec.outer_box_height_mm, outer_box_quantity: spec.outer_box_quantity,
            outer_box_gross_weight_kg: spec.outer_box_gross_weight_kg,
        });
        setInnerFormLU('mm'); setInnerFormWU('kg');
        setOuterFormLU('mm'); setOuterFormWU('kg');
        setShowAddModal(true);
    };

    // ── FORM INPUT with unit conversion (per-section) ──
    // Raw input tracking to prevent backspace glitch with unit conversions
    const [rawInputs, setRawInputs] = useState<Record<string, string>>({});

    const handleNumericInput = (
        field: keyof PackingFormData,
        rawVal: string,
        convertFn: (v: number) => number,
    ) => {
        setRawInputs(prev => ({ ...prev, [field]: rawVal }));
        const num = parseFloat(rawVal);
        if (!isNaN(num)) {
            setFormData(prev => ({ ...prev, [field]: convertFn(num) }));
        } else if (rawVal === '' || rawVal === '-') {
            setFormData(prev => ({ ...prev, [field]: 0 }));
        }
    };

    const getDisplayValue = (
        field: keyof PackingFormData,
        convertFn: (v: number) => number,
    ): string => {
        // If user is actively editing this field, show their raw input
        if (rawInputs[field] !== undefined) return rawInputs[field];
        const v = convertFn(formData[field] as number);
        return v ? String(v) : '';
    };

    // Clear raw inputs when unit changes so display re-syncs from stored values
    useEffect(() => { setRawInputs({}); }, [innerFormLU, innerFormWU, outerFormLU, outerFormWU]);

    const setInnerLenField = (field: keyof PackingFormData, raw: string) => {
        handleNumericInput(field, raw, v => toMm(v, innerFormLU));
    };
    const setInnerWtField = (field: keyof PackingFormData, raw: string) => {
        handleNumericInput(field, raw, v => toKg(v, innerFormWU));
    };
    const getInnerLenDisplay = (field: keyof PackingFormData) =>
        getDisplayValue(field, v => convertLength(v, innerFormLU));
    const getInnerWtDisplay = (field: keyof PackingFormData) =>
        getDisplayValue(field, v => convertWeight(v, innerFormWU));

    const setOuterLenField = (field: keyof PackingFormData, raw: string) => {
        handleNumericInput(field, raw, v => toMm(v, outerFormLU));
    };
    const setOuterWtField = (field: keyof PackingFormData, raw: string) => {
        handleNumericInput(field, raw, v => toKg(v, outerFormWU));
    };
    const getOuterLenDisplay = (field: keyof PackingFormData) =>
        getDisplayValue(field, v => convertLength(v, outerFormLU));
    const getOuterWtDisplay = (field: keyof PackingFormData) =>
        getDisplayValue(field, v => convertWeight(v, outerFormWU));

    // ── EXCEL EXPORT ──
    const handleExport = () => {
        import('xlsx').then(XLSX => {
            const header = ['ID', 'Item Code', 'MSN', 'Description', 'Inner Box Size (mm)', 'Inner Box Qty', 'Inner Net Wt (kg)', 'Outer Box Size (mm)', 'Outer Gross Wt (kg)', 'Status'];
            const rows = filtered.map((s, i) => [
                i + 1, s.item_code, s.master_serial_no || '', s.item_name || '',
                `${s.inner_box_length_mm}x${s.inner_box_width_mm}x${s.inner_box_height_mm}`,
                s.inner_box_quantity, s.inner_box_net_weight_kg,
                `${s.outer_box_length_mm}x${s.outer_box_width_mm}x${s.outer_box_height_mm}`,
                s.outer_box_gross_weight_kg, s.is_active ? 'Active' : 'Inactive',
            ]);
            const ws = XLSX.utils.aoa_to_sheet([header, ...rows]);
            const wb = XLSX.utils.book_new();
            XLSX.utils.book_append_sheet(wb, ws, 'Packing Details');
            XLSX.writeFile(wb, `packing_details_${new Date().toISOString().slice(0, 10)}.xlsx`);
            showToast('success', 'Exported', `${filtered.length} records exported to Excel.`);
        });
    };

    const hasActiveFilters = cardFilter !== 'ALL';

    // ── DELETE FLOW ──
    const handleDeleteClick = (spec: PackingSpec) => {
        setDeleteTarget(spec);
        setShowDeleteModal(true);
    };

    const handleDeleteConfirm = async (reason: string) => {
        if (!deleteTarget) return;
        try {
            const supabase = getSupabaseClient();
            // Log to audit_log
            const { data: sessionData } = await supabase.auth.getSession();
            if (sessionData?.session) {
                const { error: auditErr } = await supabase.from('audit_log').insert({
                    user_id: sessionData.session.user.id,
                    action: 'DELETE_PACKING_SPEC',
                    target_type: 'packing_specification',
                    target_id: deleteTarget.item_code,
                    old_value: deleteTarget,
                    new_value: null,
                });
                if (auditErr) console.warn('Audit log warning:', auditErr.message);
            }
            const { error: e } = await supabase.from('packing_specifications').delete().eq('id', deleteTarget.id);
            if (e) throw e;
            showToast('success', 'Deleted', `Packing specification for "${deleteTarget.item_code}" has been permanently deleted.`);
            fetchSpecs();
        } catch (err: any) {
            showToast('error', 'Delete Failed', err.message || 'Failed to delete specification.');
        }
        setShowDeleteModal(false);
        setDeleteTarget(null);
    };

    // ── LOADING STATE (only on initial load) ──
    if (loading && specs.length === 0) {
        return (
            <ModuleLoader moduleName="Packing Details" icon={<ClipboardList size={24} style={{ color: 'var(--enterprise-primary)', animation: 'moduleLoaderSpin 0.8s linear infinite' }} />} />
        );
    }

    if (error) {
        return (
            <div style={{ textAlign: 'center', padding: '60px 20px' }}>
                <AlertTriangle size={48} style={{ color: '#dc2626', marginBottom: '16px' }} />
                <h3 style={{ color: 'var(--enterprise-gray-700)', marginBottom: '8px' }}>Error Loading Data</h3>
                <p style={{ color: 'var(--enterprise-gray-500)', marginBottom: '20px' }}>{error}</p>
                <Button variant="primary" onClick={fetchSpecs} icon={<RefreshCw size={16} />}>Retry</Button>
            </div>
        );
    }

    // ── RENDER ──
    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
            {/* Toast */}
            {toast && (
                <div style={{
                    position: 'fixed', top: '24px', right: '24px', zIndex: 9999,
                    padding: '16px 20px', borderRadius: '14px', maxWidth: '420px', minWidth: '320px',
                    background: toast.type === 'success' ? 'linear-gradient(135deg, #f0fdf4, #dcfce7)'
                        : toast.type === 'error' ? 'linear-gradient(135deg, #fef2f2, #fee2e2)'
                            : toast.type === 'warning' ? 'linear-gradient(135deg, #fffbeb, #fef3c7)'
                                : 'linear-gradient(135deg, #eff6ff, #dbeafe)',
                    border: `1.5px solid ${toast.type === 'success' ? '#86efac' : toast.type === 'error' ? '#fca5a5' : toast.type === 'warning' ? '#fcd34d' : '#93c5fd'}`,
                    boxShadow: '0 10px 40px rgba(0,0,0,0.12)', display: 'flex', alignItems: 'flex-start', gap: '12px',
                    animation: 'slideInDown 0.4s cubic-bezier(0.16, 1, 0.3, 1)',
                }}>
                    <div style={{
                        width: '36px', height: '36px', borderRadius: '10px', flexShrink: 0,
                        background: toast.type === 'success' ? 'linear-gradient(135deg, #16a34a, #15803d)' : toast.type === 'error' ? 'linear-gradient(135deg, #dc2626, #b91c1c)' : toast.type === 'warning' ? 'linear-gradient(135deg, #f59e0b, #d97706)' : 'linear-gradient(135deg, #2563eb, #1d4ed8)',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                    }}>
                        {toast.type === 'success' && <CheckCircle2 size={18} style={{ color: '#fff' }} />}
                        {toast.type === 'error' && <XCircle size={18} style={{ color: '#fff' }} />}
                        {toast.type === 'warning' && <AlertTriangle size={18} style={{ color: '#fff' }} />}
                        {toast.type === 'info' && <Info size={18} style={{ color: '#fff' }} />}
                    </div>
                    <div style={{ flex: 1 }}>
                        <div style={{ fontSize: '13px', fontWeight: 800, color: toast.type === 'success' ? '#14532d' : toast.type === 'error' ? '#7f1d1d' : toast.type === 'warning' ? '#78350f' : '#1e3a5f', marginBottom: '2px' }}>{toast.title}</div>
                        <div style={{ fontSize: '12px', fontWeight: 500, lineHeight: '1.5', color: toast.type === 'success' ? '#166534' : toast.type === 'error' ? '#991b1b' : toast.type === 'warning' ? '#92400e' : '#1e40af' }}>{toast.text}</div>
                    </div>
                    <button onClick={() => { if (toastTimer.current) clearTimeout(toastTimer.current); setToast(null); }} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '4px', borderRadius: '6px', display: 'flex', color: 'var(--enterprise-gray-400)' }}><X size={16} /></button>
                </div>
            )}

            {/* Summary Cards */}
            <SummaryCardsGrid>
                <SummaryCard label="Total Specifications" value={stats.total} icon={<ClipboardList size={22} style={{ color: 'var(--enterprise-primary)' }} />} color="var(--enterprise-primary)" bgColor="rgba(30, 58, 138, 0.1)" isActive={cardFilter === 'ALL'} onClick={() => setCardFilter(p => p === 'ALL' ? 'ALL' : 'ALL')} />
                <SummaryCard label="Active" value={stats.active} icon={<CheckCircle2 size={22} style={{ color: 'var(--enterprise-success)' }} />} color="var(--enterprise-success)" bgColor="rgba(34, 197, 94, 0.1)" isActive={cardFilter === 'ACTIVE'} onClick={() => setCardFilter(p => p === 'ACTIVE' ? 'ALL' : 'ACTIVE')} />
                <SummaryCard label="Inactive" value={stats.inactive} icon={<AlertTriangle size={22} style={{ color: '#b91c1c' }} />} color="#b91c1c" bgColor="rgba(185, 28, 28, 0.1)" isActive={cardFilter === 'INACTIVE'} onClick={() => setCardFilter(p => p === 'INACTIVE' ? 'ALL' : 'INACTIVE')} />
            </SummaryCardsGrid>

            {/* Toolbar */}
            <SharedFilterBar>
                <SearchBox
                    value={searchTerm}
                    onChange={setSearchTerm}
                    placeholder="Search by Item Code, Part Number, MSN, or Description..."
                />

                {/* Unit Dropdowns */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <Ruler size={14} style={{ color: 'var(--enterprise-gray-400)' }} />
                    <select
                        value={tableLU}
                        onChange={e => setTableLU(e.target.value as LengthUnit)}
                        style={{
                            padding: '7px 28px 7px 10px', border: '1.5px solid var(--enterprise-gray-200)',
                            borderRadius: '6px', fontSize: '12px', fontWeight: 600,
                            color: 'var(--enterprise-gray-700)', background: 'white', cursor: 'pointer',
                            outline: 'none', appearance: 'none', height: '36px',
                            backgroundImage: `url("data:image/svg+xml,%3Csvg width='10' height='6' viewBox='0 0 10 6' fill='none' xmlns='http://www.w3.org/2000/svg'%3E%3Cpath d='M1 1L5 5L9 1' stroke='%236b7280' stroke-width='1.5' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E")`,
                            backgroundRepeat: 'no-repeat', backgroundPosition: 'right 8px center',
                        }}
                    >
                        <option value="mm">mm</option>
                        <option value="cm">cm</option>
                        <option value="inches">inches</option>
                    </select>
                </div>

                <ActionBar>
                    {hasActiveFilters && (
                        <ClearFiltersButton onClick={() => setCardFilter('ALL')} />
                    )}
                    <ExportCSVButton onClick={handleExport} />
                    <RefreshButton onClick={() => { fetchSpecs().then(() => showToast('info', 'Refreshed', 'Data refreshed successfully.')); }} loading={loading} />
                    {canAdd && <AddButton label="Add Specification" onClick={() => setShowAddModal(true)} />}
                </ActionBar>
            </SharedFilterBar>

            {/* Data Table */}
            <Card style={{ padding: 0 }}>
                {filtered.length === 0 ? (
                    <EmptyState
                        icon={<ClipboardList size={48} />}
                        title={hasActiveFilters || searchTerm ? 'No Matching Specifications' : 'No Packing Specifications'}
                        description={hasActiveFilters || searchTerm ? 'Try adjusting your search or filter criteria' : 'Add packing specifications for items from the Item Master'}
                        action={!hasActiveFilters && !searchTerm && canAdd ? { label: 'Add Specification', onClick: () => setShowAddModal(true) } : undefined}
                    />
                ) : (
                    <div className="table-responsive" style={{ overflowX: 'auto', opacity: loading ? 0.5 : 1, transition: 'opacity 0.2s', pointerEvents: loading ? 'none' : 'auto' }}>
                        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                            <thead>
                                <tr style={{ backgroundColor: 'var(--table-header-bg)', borderBottom: '2px solid var(--table-border)' }}>
                                    <th style={{ ...thStyle, minWidth: '50px', textAlign: 'center' }}>#</th>
                                    <th style={{ ...thStyle, minWidth: '180px' }}>Item Details</th>
                                    <th style={{ ...thStyle, minWidth: '140px' }}>Inner Box Size</th>
                                    <th style={{ ...thStyle, textAlign: 'center', minWidth: '60px' }}>Inner Qty</th>
                                    <th style={{ ...thStyle, minWidth: '140px' }}>Outer Box Size</th>
                                    <th style={{ ...thStyle, textAlign: 'center', minWidth: '60px' }}>Outer Qty</th>
                                    <th style={{ ...thStyle, textAlign: 'center', minWidth: '80px' }}>Status</th>
                                    <th style={{ ...thStyle, textAlign: 'center', minWidth: '70px' }}>View</th>
                                    {canAction && <th style={{ ...thStyle, textAlign: 'center', minWidth: '110px' }}>Action</th>}
                                </tr>
                            </thead>
                            <tbody>
                                {displayed.map((s, idx) => {
                                    const fmtSz = (l: number, w: number, h: number) => `${convertLength(l, tableLU)}×${convertLength(w, tableLU)}×${convertLength(h, tableLU)}`;
                                    return (
                                        <tr
                                            key={s.id}
                                            style={{ backgroundColor: idx % 2 === 0 ? 'white' : 'var(--table-stripe)', borderBottom: '1px solid var(--table-border)', transition: 'background-color 0.15s ease' }}
                                            onMouseEnter={e => { e.currentTarget.style.backgroundColor = 'var(--table-hover)'; }}
                                            onMouseLeave={e => { e.currentTarget.style.backgroundColor = idx % 2 === 0 ? 'white' : 'var(--table-stripe)'; }}
                                        >
                                            <td style={{ ...tdStyle, textAlign: 'center', color: 'var(--enterprise-gray-500)', fontWeight: 500 }}>{idx + 1}</td>
                                            <td style={tdStyle}>
                                                <div style={{ fontWeight: 600, color: 'var(--enterprise-primary)', fontSize: '13px' }}>{s.master_serial_no || s.item_code}</div>
                                                <div style={{ fontSize: '12px', color: 'var(--enterprise-gray-500)', marginTop: '2px' }}>{s.item_name || '—'}</div>
                                            </td>
                                            <td style={{ ...tdStyle, fontFamily: 'monospace', fontSize: '12px' }}>{fmtSz(s.inner_box_length_mm, s.inner_box_width_mm, s.inner_box_height_mm)} {LENGTH_LABELS[tableLU]}</td>
                                            <td style={{ ...tdStyle, textAlign: 'center', fontWeight: 700, color: 'var(--enterprise-info, #3b82f6)' }}>{s.inner_box_quantity}</td>
                                            <td style={{ ...tdStyle, fontFamily: 'monospace', fontSize: '12px' }}>{fmtSz(s.outer_box_length_mm, s.outer_box_width_mm, s.outer_box_height_mm)} {LENGTH_LABELS[tableLU]}</td>
                                            <td style={{ ...tdStyle, textAlign: 'center', fontWeight: 700, color: (s.inner_box_quantity > 0 && s.outer_box_quantity > 0 && (s.outer_box_quantity % s.inner_box_quantity) !== 0) ? '#d97706' : 'rgb(168,85,247)' }}>{s.outer_box_quantity}</td>
                                            <td style={{ ...tdStyle, textAlign: 'center' }}><Badge variant={s.is_active ? 'success' : 'error'} style={!s.is_active ? { backgroundColor: '#fee2e2', color: '#b91c1c' } : {}}>{s.is_active ? 'Active' : 'Inactive'}</Badge></td>
                                            {/* View — ALL roles */}
                                            <td style={{ ...tdStyle, textAlign: 'center', padding: '8px 12px' }}>
                                                <Button variant="tertiary" size="sm" icon={<Eye size={14} />} onClick={() => setViewSpec(s)} style={{ minWidth: '55px' }}>View</Button>
                                            </td>
                                            {/* Actions dropdown — L2/L3 only */}
                                            {canAction && (
                                                <td style={{ ...tdStyle, textAlign: 'center', padding: '8px 12px', position: 'relative' }}>
                                                    <div ref={activeDropdown === s.id ? dropdownRef : null} style={{ position: 'relative', display: 'inline-block' }}>
                                                        <button
                                                            onClick={() => setActiveDropdown(activeDropdown === s.id ? null : s.id)}
                                                            style={{
                                                                padding: '8px 12px', border: '1px solid #e5e7eb', borderRadius: '8px',
                                                                backgroundColor: activeDropdown === s.id ? '#f8fafc' : 'white',
                                                                cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: '6px',
                                                                fontSize: '13px', color: '#374151', fontWeight: 500, transition: 'all 0.15s ease',
                                                            }}
                                                        >
                                                            <Settings size={16} />
                                                            Actions
                                                            <ChevronDown size={14} style={{ transition: 'transform 0.2s', transform: activeDropdown === s.id ? 'rotate(180deg)' : 'rotate(0deg)' }} />
                                                        </button>
                                                        {activeDropdown === s.id && (() => {
                                                            const isLastRows = idx >= displayed.length - 2;
                                                            return (
                                                                <div
                                                                    style={{
                                                                        position: 'absolute',
                                                                        ...(isLastRows
                                                                            ? { bottom: '100%', marginBottom: '4px' }
                                                                            : { top: '100%', marginTop: '4px' }
                                                                        ),
                                                                        right: '0', zIndex: 50,
                                                                        width: '160px', backgroundColor: 'white', borderRadius: '12px',
                                                                        boxShadow: '0 10px 40px rgba(0,0,0,0.15)', border: '1px solid #e5e7eb', overflow: 'hidden',
                                                                    }}
                                                                >
                                                                    {canEdit && (
                                                                        <button
                                                                            onClick={() => { openEdit(s); setActiveDropdown(null); }}
                                                                            style={{ width: '100%', padding: '12px 16px', display: 'flex', alignItems: 'center', gap: '10px', border: 'none', backgroundColor: 'transparent', cursor: 'pointer', fontSize: '14px', textAlign: 'left', color: '#374151' }}
                                                                            onMouseEnter={e => { e.currentTarget.style.backgroundColor = '#f8fafc'; }}
                                                                            onMouseLeave={e => { e.currentTarget.style.backgroundColor = 'transparent'; }}
                                                                        >
                                                                            <Edit2 size={16} /> Edit Specs
                                                                        </button>
                                                                    )}
                                                                    {canEdit && canDelete && <div style={{ borderTop: '1px solid #f3f4f6' }}></div>}
                                                                    {canDelete && (
                                                                        <button
                                                                            onClick={() => { handleDeleteClick(s); setActiveDropdown(null); }}
                                                                            style={{ width: '100%', padding: '12px 16px', display: 'flex', alignItems: 'center', gap: '10px', border: 'none', backgroundColor: 'transparent', cursor: 'pointer', fontSize: '14px', textAlign: 'left', color: '#ef4444' }}
                                                                            onMouseEnter={e => { e.currentTarget.style.backgroundColor = '#fef2f2'; }}
                                                                            onMouseLeave={e => { e.currentTarget.style.backgroundColor = 'transparent'; }}
                                                                        >
                                                                            <Trash2 size={16} /> Delete Specs
                                                                        </button>
                                                                    )}
                                                                </div>
                                                            );
                                                        })()}
                                                    </div>
                                                </td>
                                            )}
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                )}
            </Card>

            {/* Load More — placed OUTSIDE the Card to prevent hover/scroll clipping */}
            {filtered.length > 0 && hasMore && (
                <div style={{ padding: '16px', textAlign: 'center' }}>
                    <Button variant="primary" onClick={() => setDisplayCount(p => p + ITEMS_PER_PAGE)}>
                        Load More ({Math.min(ITEMS_PER_PAGE, filtered.length - displayed.length)} more)
                    </Button>
                </div>
            )}
            {filtered.length > 0 && !hasMore && displayed.length > 0 && (
                <div style={{ padding: '8px 16px', textAlign: 'center' }}>
                    <p style={{ fontSize: '13px', color: 'var(--enterprise-gray-500)' }}>Showing all {filtered.length} specifications</p>
                </div>
            )}

            {/* ADD / EDIT MODAL */}
            <Modal isOpen={showAddModal || !!editSpec} onClose={handleCloseModal} title={editSpec ? 'Edit Packing Specification' : 'Add Packing Specification'} maxWidth="800px">
                <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
                    {/* Item Search (only for new) */}
                    {!editSpec && !selectedItem && (
                        <div style={{ ...sectionStyle, background: 'linear-gradient(135deg, rgba(30,58,138,0.03), rgba(30,58,138,0.08))', border: '1px solid rgba(30,58,138,0.1)' }}>
                            <div style={{ position: 'relative' }}>
                                <Search size={16} style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: 'var(--enterprise-gray-400)' }} />
                                <input
                                    type="text" value={itemSearch} onChange={e => setItemSearch(e.target.value)}
                                    placeholder="Search by Item Code, Part Number, MSN, or Description..."
                                    style={{ width: '100%', padding: '10px 14px 10px 40px', border: '1.5px solid var(--enterprise-gray-200)', borderRadius: '8px', fontSize: '13px', outline: 'none' }}
                                    onFocus={e => { e.target.style.borderColor = 'var(--enterprise-primary)'; e.target.style.boxShadow = '0 0 0 3px rgba(30,58,138,0.1)'; }}
                                    onBlur={e => { e.target.style.borderColor = 'var(--enterprise-gray-200)'; e.target.style.boxShadow = 'none'; }}
                                    autoFocus
                                />
                            </div>
                            {searchingItems && <p style={{ fontSize: '12px', color: 'var(--enterprise-gray-500)', marginTop: '8px' }}>Searching...</p>}
                            {itemResults.length > 0 && (
                                <div style={{ marginTop: '8px', border: '1px solid var(--enterprise-gray-200)', borderRadius: '8px', maxHeight: '200px', overflowY: 'auto' }}>
                                    {itemResults.map(item => (
                                        <div
                                            key={item.id}
                                            onClick={() => { setSelectedItem(item); setItemSearch(''); setItemResults([]); }}
                                            style={{ padding: '10px 14px', cursor: 'pointer', borderBottom: '1px solid var(--enterprise-gray-100)', transition: 'background 0.15s' }}
                                            onMouseEnter={e => { e.currentTarget.style.background = 'rgba(30,58,138,0.05)'; }}
                                            onMouseLeave={e => { e.currentTarget.style.background = 'white'; }}
                                        >
                                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                                <div>
                                                    <span style={{ fontWeight: 600, color: 'var(--enterprise-primary)', fontSize: '13px' }}>{item.item_code}</span>
                                                    <span style={{ margin: '0 8px', color: 'var(--enterprise-gray-300)' }}>|</span>
                                                    <span style={{ fontSize: '12px', color: 'var(--enterprise-gray-600)' }}>{item.part_number || '—'}</span>
                                                    <span style={{ margin: '0 8px', color: 'var(--enterprise-gray-300)' }}>|</span>
                                                    <span style={{ fontSize: '12px', color: 'var(--enterprise-gray-500)', fontFamily: 'monospace' }}>{item.master_serial_no || '—'}</span>
                                                </div>
                                                <Badge variant={item.is_active ? 'success' : 'error'} style={{ fontSize: '10px' }}>{item.is_active ? 'Active' : 'Inactive'}</Badge>
                                            </div>
                                            <div style={{ fontSize: '12px', color: 'var(--enterprise-gray-500)', marginTop: '3px' }}>{item.item_name}</div>
                                        </div>
                                    ))}
                                </div>
                            )}
                            {itemSearch.trim().length >= 2 && !searchingItems && itemResults.length === 0 && (
                                <p style={{ fontSize: '12px', color: 'var(--enterprise-gray-500)', marginTop: '8px', textAlign: 'center' }}>No matching items or all matching items already have packing specs.</p>
                            )}
                        </div>
                    )}

                    {/* Selected Item Info (for new) */}
                    {!editSpec && selectedItem && (
                        <div style={{ ...sectionStyle, background: 'linear-gradient(135deg, rgba(30,58,138,0.03), rgba(30,58,138,0.08))', border: '1px solid rgba(30,58,138,0.1)' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                                <p style={{ fontSize: '12px', fontWeight: 700, color: 'var(--enterprise-primary)', textTransform: 'uppercase', letterSpacing: '0.5px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                                    <PackageOpen size={14} /> Selected Item
                                </p>
                                <Button variant="tertiary" size="sm" onClick={() => setSelectedItem(null)}>Change Item</Button>
                            </div>
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                                <div><Label>Item Code</Label><Input value={selectedItem.item_code} disabled /></div>
                                <div><Label>Part Number</Label><Input value={selectedItem.part_number || '—'} disabled /></div>
                                <div><Label>MSN</Label><Input value={selectedItem.master_serial_no || '—'} disabled /></div>
                                <div><Label>Description</Label><Input value={selectedItem.item_name} disabled /></div>
                            </div>
                        </div>
                    )}

                    {/* Edit mode: show item info */}
                    {editSpec && (
                        <div style={{ ...sectionStyle, background: 'linear-gradient(135deg, rgba(30,58,138,0.03), rgba(30,58,138,0.08))', border: '1px solid rgba(30,58,138,0.1)' }}>
                            <p style={{ fontSize: '12px', fontWeight: 700, color: 'var(--enterprise-primary)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '12px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                                <PackageOpen size={14} /> Item Information (Read Only)
                            </p>
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                                <div><Label>Item Code</Label><Input value={editSpec.item_code} disabled /></div>
                                <div><Label>Part Number</Label><Input value={editSpec.part_number || '—'} disabled /></div>
                                <div><Label>MSN</Label><Input value={editSpec.master_serial_no || '—'} disabled /></div>
                                <div><Label>Description</Label><Input value={editSpec.item_name || '—'} disabled /></div>
                            </div>
                        </div>
                    )}

                    {/* Step 2: Packing Inputs (show after item selected or in edit mode) */}
                    {(selectedItem || editSpec) && (
                        <>
                            {/* Inner Box */}
                            <div style={{ ...sectionStyle, background: 'linear-gradient(135deg, rgba(34,197,94,0.03), rgba(34,197,94,0.08))', border: '1px solid rgba(34,197,94,0.15)' }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px', flexWrap: 'wrap', gap: '8px' }}>
                                    <p style={{ fontSize: '12px', fontWeight: 700, color: 'var(--enterprise-success)', textTransform: 'uppercase', letterSpacing: '0.5px', display: 'flex', alignItems: 'center', gap: '6px', margin: 0 }}>
                                        <Box size={14} /> Inner Box Specifications
                                    </p>
                                    <div style={{ display: 'flex', gap: '12px' }}>
                                        <UnitToggle<LengthUnit> units={['mm', 'cm', 'inches']} active={innerFormLU} onChange={setInnerFormLU} icon={<Ruler size={14} />} />
                                        <UnitToggle<WeightUnit> units={['g', 'kg', 'lbs']} active={innerFormWU} onChange={setInnerFormWU} icon={<Weight size={14} />} />
                                    </div>
                                </div>
                                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '12px' }}>
                                    <div><Label required>Length ({LENGTH_LABELS[innerFormLU]})</Label><Input type="number" step="any" min={0} value={getInnerLenDisplay('inner_box_length_mm')} onChange={e => setInnerLenField('inner_box_length_mm', e.target.value)} onBlur={() => setRawInputs(prev => { const n = { ...prev }; delete n['inner_box_length_mm']; return n; })} placeholder="e.g. 100" /></div>
                                    <div><Label required>Width ({LENGTH_LABELS[innerFormLU]})</Label><Input type="number" step="any" min={0} value={getInnerLenDisplay('inner_box_width_mm')} onChange={e => setInnerLenField('inner_box_width_mm', e.target.value)} onBlur={() => setRawInputs(prev => { const n = { ...prev }; delete n['inner_box_width_mm']; return n; })} placeholder="e.g. 70" /></div>
                                    <div><Label required>Height ({LENGTH_LABELS[innerFormLU]})</Label><Input type="number" step="any" min={0} value={getInnerLenDisplay('inner_box_height_mm')} onChange={e => setInnerLenField('inner_box_height_mm', e.target.value)} onBlur={() => setRawInputs(prev => { const n = { ...prev }; delete n['inner_box_height_mm']; return n; })} placeholder="e.g. 50" /></div>
                                </div>
                                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginTop: '12px' }}>
                                    <div><Label required>Quantity per Box</Label><Input type="number" min={0} value={formData.inner_box_quantity || ''} onChange={e => setFormData(p => ({ ...p, inner_box_quantity: parseInt(e.target.value) || 0 }))} placeholder="e.g. 450" /></div>
                                    <div><Label required>Gross Weight ({WEIGHT_LABELS[innerFormWU]})</Label><Input type="number" step="any" min={0} value={getInnerWtDisplay('inner_box_net_weight_kg')} onChange={e => setInnerWtField('inner_box_net_weight_kg', e.target.value)} onBlur={() => setRawInputs(prev => { const n = { ...prev }; delete n['inner_box_net_weight_kg']; return n; })} placeholder="e.g. 0.5" /></div>
                                </div>
                            </div>

                            {/* Outer Box */}
                            <div style={{ ...sectionStyle, background: 'linear-gradient(135deg, rgba(168,85,247,0.03), rgba(168,85,247,0.08))', border: '1px solid rgba(168,85,247,0.15)' }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px', flexWrap: 'wrap', gap: '8px' }}>
                                    <p style={{ fontSize: '12px', fontWeight: 700, color: 'rgb(168,85,247)', textTransform: 'uppercase', letterSpacing: '0.5px', display: 'flex', alignItems: 'center', gap: '6px', margin: 0 }}>
                                        <PackageOpen size={14} /> Outer Box Specifications
                                    </p>
                                    <div style={{ display: 'flex', gap: '12px' }}>
                                        <UnitToggle<LengthUnit> units={['mm', 'cm', 'inches']} active={outerFormLU} onChange={setOuterFormLU} icon={<Ruler size={14} />} />
                                        <UnitToggle<WeightUnit> units={['g', 'kg', 'lbs']} active={outerFormWU} onChange={setOuterFormWU} icon={<Weight size={14} />} />
                                    </div>
                                </div>
                                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '12px' }}>
                                    <div><Label required>Length ({LENGTH_LABELS[outerFormLU]})</Label><Input type="number" step="any" min={0} value={getOuterLenDisplay('outer_box_length_mm')} onChange={e => setOuterLenField('outer_box_length_mm', e.target.value)} onBlur={() => setRawInputs(prev => { const n = { ...prev }; delete n['outer_box_length_mm']; return n; })} placeholder="e.g. 1000" /></div>
                                    <div><Label required>Width ({LENGTH_LABELS[outerFormLU]})</Label><Input type="number" step="any" min={0} value={getOuterLenDisplay('outer_box_width_mm')} onChange={e => setOuterLenField('outer_box_width_mm', e.target.value)} onBlur={() => setRawInputs(prev => { const n = { ...prev }; delete n['outer_box_width_mm']; return n; })} placeholder="e.g. 700" /></div>
                                    <div><Label required>Height ({LENGTH_LABELS[outerFormLU]})</Label><Input type="number" step="any" min={0} value={getOuterLenDisplay('outer_box_height_mm')} onChange={e => setOuterLenField('outer_box_height_mm', e.target.value)} onBlur={() => setRawInputs(prev => { const n = { ...prev }; delete n['outer_box_height_mm']; return n; })} placeholder="e.g. 500" /></div>
                                </div>
                                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginTop: '12px' }}>
                                    <div><Label required>Quantity per Box</Label><Input type="number" min={0} value={formData.outer_box_quantity || ''} onChange={e => setFormData(p => ({ ...p, outer_box_quantity: parseInt(e.target.value) || 0 }))} placeholder="e.g. 1200" /></div>
                                    <div><Label required>Gross Weight ({WEIGHT_LABELS[outerFormWU]})</Label><Input type="number" step="any" min={0} value={getOuterWtDisplay('outer_box_gross_weight_kg')} onChange={e => setOuterWtField('outer_box_gross_weight_kg', e.target.value)} onBlur={() => setRawInputs(prev => { const n = { ...prev }; delete n['outer_box_gross_weight_kg']; return n; })} placeholder="e.g. 50" /></div>
                                </div>
                            </div>

                            {/* Actions */}
                            <div style={{ display: 'flex', gap: '12px' }}>
                                <Button variant="primary" fullWidth onClick={handleSave} disabled={saving} style={{ padding: '12px 24px', fontWeight: 'var(--font-weight-semibold)' }}>
                                    {saving ? 'Saving...' : editSpec ? '✓ Update Specification' : '+ Create Specification'}
                                </Button>
                                <Button variant="tertiary" fullWidth onClick={handleCloseModal} style={{ padding: '12px 24px' }}>Cancel</Button>
                            </div>
                        </>
                    )}
                </div>
            </Modal>

            {/* VIEW MODAL */}
            <ViewModal isOpen={!!viewSpec} onClose={() => setViewSpec(null)} spec={viewSpec} />

            {/* DELETE CONFIRMATION MODAL */}
            <PackingDeleteModal
                isOpen={showDeleteModal}
                onClose={() => { setShowDeleteModal(false); setDeleteTarget(null); }}
                onConfirm={handleDeleteConfirm}
                spec={deleteTarget}
            />

            {/* Animation keyframes */}
            <style>{`
        @keyframes slideInDown {
          from { opacity: 0; transform: translateY(-20px) scale(0.95); }
          to   { opacity: 1; transform: translateY(0) scale(1); }
        }
      `}</style>
        </div>
    );
}

// ============================================================================
// DELETE CONFIRMATION MODAL (matches ItemMaster pattern)
// ============================================================================

function PackingDeleteModal({ isOpen, onClose, onConfirm, spec }: {
    isOpen: boolean; onClose: () => void; onConfirm: (reason: string) => void; spec: PackingSpec | null;
}) {
    const [itemCodeInput, setItemCodeInput] = useState('');
    const [deletionReason, setDeletionReason] = useState('');
    const [error, setError] = useState('');

    useEffect(() => {
        if (isOpen) {
            setItemCodeInput('');
            setDeletionReason('');
            setError('');
        }
    }, [isOpen]);

    const handleConfirm = () => {
        if (!spec) return;
        if (itemCodeInput.trim() !== spec.item_code) {
            setError('Item Code does not match. Please enter the exact Item Code to confirm deletion.');
            return;
        }
        if (!deletionReason.trim()) {
            setError('Please provide a reason for deletion.');
            return;
        }
        setError('');
        onConfirm(deletionReason.trim());
    };

    if (!spec) return null;

    return (
        <Modal isOpen={isOpen} onClose={onClose} title="Confirm Specification Deletion" maxWidth="500px">
            <div style={{ display: 'flex', flexDirection: 'column', gap: '20px', userSelect: 'none' }} onCopy={e => e.preventDefault()}>
                {/* Warning Banner */}
                <div style={{
                    background: 'linear-gradient(135deg, rgba(220,38,38,0.05) 0%, rgba(220,38,38,0.1) 100%)',
                    border: '1px solid rgba(220,38,38,0.2)', borderRadius: 'var(--border-radius-md)',
                    padding: '16px', display: 'flex', gap: '12px', alignItems: 'flex-start',
                }}>
                    <AlertTriangle size={24} style={{ color: 'var(--enterprise-error)', flexShrink: 0 }} />
                    <div>
                        <p style={{ fontWeight: 600, color: 'var(--enterprise-error)', marginBottom: '4px' }}>
                            This action cannot be undone
                        </p>
                        <p style={{ fontSize: '13px', color: 'var(--enterprise-gray-600)' }}>
                            You are about to <strong>permanently delete</strong> the packing specification for this item. Please confirm by entering the Item Code below.
                        </p>
                    </div>
                </div>

                {/* Item Info Display */}
                <div style={{
                    background: 'var(--enterprise-gray-50)', borderRadius: 'var(--border-radius-md)', padding: '16px',
                }}>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                        <div>
                            <p style={{ fontSize: '11px', color: 'var(--enterprise-gray-500)', textTransform: 'uppercase', marginBottom: '4px' }}>Item Code</p>
                            <p style={{ fontWeight: 600, color: 'var(--enterprise-primary)' }}>{spec.item_code}</p>
                        </div>
                        <div>
                            <p style={{ fontSize: '11px', color: 'var(--enterprise-gray-500)', textTransform: 'uppercase', marginBottom: '4px' }}>MSN</p>
                            <p style={{ fontFamily: 'monospace' }}>{spec.master_serial_no || '—'}</p>
                        </div>
                        <div style={{ gridColumn: '1 / -1' }}>
                            <p style={{ fontSize: '11px', color: 'var(--enterprise-gray-500)', textTransform: 'uppercase', marginBottom: '4px' }}>Description</p>
                            <p>{spec.item_name || '—'}</p>
                        </div>
                    </div>
                </div>

                {/* Item Code Confirmation Input */}
                <div>
                    <Label required>Type Item Code to Confirm</Label>
                    <input
                        type="text"
                        value={itemCodeInput}
                        onChange={e => setItemCodeInput(e.target.value)}
                        placeholder={`Enter "${spec.item_code}" to confirm`}
                        onPaste={e => e.preventDefault()}
                        onCopy={e => e.preventDefault()}
                        onCut={e => e.preventDefault()}
                        onDrop={e => e.preventDefault()}
                        onContextMenu={e => e.preventDefault()}
                        autoComplete="off"
                        style={{
                            width: '100%', padding: '8px 12px', fontSize: '14px',
                            color: 'var(--foreground)', backgroundColor: 'var(--background)',
                            border: '1px solid var(--border-color)', borderRadius: 'var(--border-radius-md)',
                            outline: 'none', transition: 'all 0.15s ease',
                        }}
                        onFocus={e => { e.target.style.borderColor = 'var(--enterprise-primary)'; e.target.style.boxShadow = '0 0 0 3px rgba(30, 58, 138, 0.1)'; }}
                        onBlur={e => { e.target.style.borderColor = 'var(--border-color)'; e.target.style.boxShadow = 'none'; }}
                    />
                    <p style={{ fontSize: '11px', color: 'var(--enterprise-gray-500)', marginTop: '4px' }}>
                        Must match exactly: <strong>{spec.item_code}</strong>
                    </p>
                </div>

                {/* Deletion Reason */}
                <div>
                    <Label required>Reason for Deletion</Label>
                    <textarea
                        value={deletionReason}
                        onChange={e => setDeletionReason(e.target.value)}
                        placeholder="Why is this specification being deleted?"
                        rows={3}
                        style={{
                            width: '100%', padding: '8px 12px', fontSize: '14px', resize: 'vertical',
                            color: 'var(--foreground)', backgroundColor: 'var(--background)',
                            border: '1px solid var(--border-color)', borderRadius: 'var(--border-radius-md)',
                            outline: 'none', transition: 'all 0.15s ease', fontFamily: 'inherit',
                        }}
                        onFocus={e => { e.target.style.borderColor = 'var(--enterprise-primary)'; e.target.style.boxShadow = '0 0 0 3px rgba(30, 58, 138, 0.1)'; }}
                        onBlur={e => { e.target.style.borderColor = 'var(--border-color)'; e.target.style.boxShadow = 'none'; }}
                    />
                </div>

                {/* Error Message */}
                {error && (
                    <div style={{
                        padding: '10px 14px', borderRadius: 'var(--border-radius-md)',
                        backgroundColor: '#fef2f2', border: '1px solid #fecaca',
                        display: 'flex', alignItems: 'center', gap: '8px',
                    }}>
                        <XCircle size={16} style={{ color: '#ef4444', flexShrink: 0 }} />
                        <p style={{ fontSize: '13px', color: '#b91c1c' }}>{error}</p>
                    </div>
                )}

                {/* Action Buttons */}
                <div style={{ display: 'flex', gap: '12px', justifyContent: 'flex-end' }}>
                    <Button variant="tertiary" onClick={onClose}>Cancel</Button>
                    <Button
                        variant="danger"
                        onClick={handleConfirm}
                        disabled={!itemCodeInput.trim() || !deletionReason.trim()}
                        icon={<Trash2 size={16} />}
                    >
                        Delete Specification
                    </Button>
                </div>
            </div>
        </Modal>
    );
}
