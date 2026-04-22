/**
 * BPADetail — Modal showing a single BPA with 3 tabs:
 *    1. Header    — agreement metadata + upload document
 *    2. Parts     — per-part config with fulfillment %
 *    3. Revisions — amendment history timeline
 *
 * "Amend" action opens BPAAmend modal.
 */
import React, { useEffect, useState } from 'react';
import { X, FileText, List, Clock, Edit3, Upload, Download } from 'lucide-react';
import { Card } from '../ui/EnterpriseUI';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { LoadingSpinner } from '../ui/EnterpriseUI';
import { sharedThStyle, sharedTdStyle } from '../ui/SharedComponents';
import { getBPA, uploadBPADocument, createBOFromBPA } from './bpaService';
import type { BPAGetResponse } from './bpaService';
import { BPAAmend } from './BPAAmend';

interface Props {
    agreementId: string;
    onClose: () => void;
    onAmended?: () => void;
    canAmend: boolean;
}

type Tab = 'header' | 'parts' | 'revisions' | 'fulfillment';

export function BPADetail({ agreementId, onClose, onAmended, canAmend }: Props) {
    const [data, setData] = useState<BPAGetResponse | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [tab, setTab] = useState<Tab>('header');
    const [showAmend, setShowAmend] = useState(false);
    const [uploading, setUploading] = useState(false);
    const [activatingBO, setActivatingBO] = useState(false);

    const load = async () => {
        setLoading(true); setError(null);
        try {
            setData(await getBPA({ agreement_id: agreementId }));
        } catch (e: any) {
            setError(e?.message ?? 'Failed to load');
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => { load(); /* eslint-disable-next-line */ }, [agreementId]);

    const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file || !data) return;
        setUploading(true);
        try {
            await uploadBPADocument(data.agreement.id, file);
            await load();
        } catch (err: any) {
            setError(err?.message ?? 'Upload failed');
        } finally {
            setUploading(false);
            e.target.value = '';
        }
    };

    const handleActivateBO = async () => {
        if (!data) return;
        setActivatingBO(true);
        try {
            const res = await createBOFromBPA(data.agreement.id);
            alert(`Blanket Order ${res.blanket_order_number} ready. ${res.line_configs_created} new line config(s) created (${res.line_configs_existing} already existed).`);
        } catch (err: any) {
            setError(err?.message ?? 'Failed to create BO');
        } finally {
            setActivatingBO(false);
        }
    };

    const tabButton = (t: Tab, label: string, icon: React.ReactNode) => (
        <button onClick={() => setTab(t)} style={{
            padding: '10px 18px', border: 'none', fontSize: '13px', fontWeight: 500,
            background: tab === t ? 'var(--enterprise-primary)' : 'transparent',
            color: tab === t ? 'white' : 'var(--enterprise-gray-600)',
            borderRadius: '6px 6px 0 0', cursor: 'pointer',
            display: 'flex', alignItems: 'center', gap: '6px',
        }}>{icon}{label}</button>
    );

    return (
        <div style={{
            position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)',
            zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center',
        }} onClick={onClose}>
            <Card onClick={(e) => e.stopPropagation()} style={{
                width: '90%', maxWidth: '1100px', maxHeight: '90vh', overflow: 'auto', padding: 0,
            }}>
                {/* Header */}
                <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--enterprise-gray-200)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div>
                        <h2 style={{ fontSize: '1.2rem', fontWeight: 700, margin: 0 }}>
                            {data?.agreement.agreement_number ?? 'Loading…'}
                            {data && <span style={{ color: 'var(--enterprise-gray-500)', fontWeight: 400, marginLeft: '8px' }}>
                                Rev {data.agreement.agreement_revision}
                            </span>}
                        </h2>
                        {data && <p style={{ fontSize: '13px', color: 'var(--enterprise-gray-600)', margin: '4px 0 0' }}>
                            {data.agreement.customer_name}
                        </p>}
                    </div>
                    <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer' }}>
                        <X size={20} />
                    </button>
                </div>

                {loading && <div style={{ padding: 60, textAlign: 'center' }}><LoadingSpinner size={32} /></div>}
                {error && <div style={{ padding: 20, background: '#fef2f2', color: '#991b1b' }}>{error}</div>}

                {data && (
                    <>
                        {/* Tab bar */}
                        <div style={{ padding: '0 20px', borderBottom: '1px solid var(--enterprise-gray-200)', display: 'flex', gap: '4px' }}>
                            {tabButton('header', 'Header', <FileText size={14} />)}
                            {tabButton('parts', `Parts (${data.parts.length})`, <List size={14} />)}
                            {tabButton('fulfillment', 'Fulfillment', <Clock size={14} />)}
                            {tabButton('revisions', `Revisions (${data.revisions.length})`, <Edit3 size={14} />)}
                        </div>

                        <div style={{ padding: 20 }}>
                            {tab === 'header' && <HeaderTab data={data} onUpload={handleUpload} uploading={uploading} canAmend={canAmend} onAmend={() => setShowAmend(true)} onActivateBO={handleActivateBO} activatingBO={activatingBO} />}
                            {tab === 'parts'       && <PartsTab data={data} />}
                            {tab === 'fulfillment' && <FulfillmentTab data={data} />}
                            {tab === 'revisions'   && <RevisionsTab data={data} />}
                        </div>
                    </>
                )}

                <div style={{ padding: '12px 20px', borderTop: '1px solid var(--enterprise-gray-200)', display: 'flex', justifyContent: 'flex-end' }}>
                    <Button variant="outline" onClick={onClose}>Close</Button>
                </div>
            </Card>

            {showAmend && data && (
                <BPAAmend
                    agreement={data.agreement}
                    parts={data.parts}
                    onClose={() => setShowAmend(false)}
                    onAmended={() => { setShowAmend(false); onAmended?.(); }}
                />
            )}
        </div>
    );
}

// ──────────────────────────────────────────────────────────────────────

function HeaderTab({ data, onUpload, uploading, canAmend, onAmend, onActivateBO, activatingBO }: {
    data: BPAGetResponse; onUpload: (e: any) => void; uploading: boolean;
    canAmend: boolean; onAmend: () => void; onActivateBO: () => void; activatingBO: boolean;
}) {
    const a = data.agreement;
    const Field = ({ label, value }: { label: string; value: React.ReactNode }) => (
        <div>
            <p style={{ fontSize: '11px', textTransform: 'uppercase', color: 'var(--enterprise-gray-500)', marginBottom: '3px', fontWeight: 600 }}>{label}</p>
            <p style={{ fontSize: '13px', color: 'var(--enterprise-gray-800)' }}>{value}</p>
        </div>
    );

    return (
        <div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '16px', marginBottom: '20px' }}>
                <Field label="Status" value={<Badge variant={(a.status === 'ACTIVE' ? 'success' : a.status === 'AMENDED' ? 'warning' : 'neutral') as any}>{a.status}</Badge>} />
                <Field label="Type" value={a.agreement_type} />
                <Field label="Revision" value={a.agreement_revision} />
                <Field label="Customer Code" value={a.customer_code} />
                <Field label="Customer Name" value={a.customer_name} />
                <Field label="Buyer" value={a.buyer_name ?? '—'} />
                <Field label="Buyer Email" value={a.buyer_email ?? '—'} />
                <Field label="Agreement Date" value={new Date(a.agreement_date).toLocaleDateString()} />
                <Field label="Effective" value={`${new Date(a.effective_start_date).toLocaleDateString()} – ${new Date(a.effective_end_date).toLocaleDateString()}`} />
                <Field label="Payment Terms" value={a.payment_terms ?? '—'} />
                <Field label="Incoterms" value={a.incoterms ?? '—'} />
                <Field label="Ship Via" value={a.ship_via ?? '—'} />
                <Field label="Total Parts" value={a.total_parts} />
                <Field label="Total Blanket Value" value={`${a.currency_code} ${Number(a.total_blanket_value ?? 0).toLocaleString()}`} />
                <Field label="Currency" value={a.currency_code} />
            </div>

            <div style={{ display: 'flex', gap: '12px', marginTop: '20px', paddingTop: '20px', borderTop: '1px solid var(--enterprise-gray-200)' }}>
                {canAmend && (
                    <Button variant="outline" onClick={onAmend}><Edit3 size={14} style={{ marginRight: '6px' }} />Amend</Button>
                )}
                <Button variant="outline" onClick={onActivateBO} disabled={activatingBO}>
                    {activatingBO ? 'Activating…' : 'Activate / Refresh BO'}
                </Button>
                <label style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', padding: '6px 14px', height: '36px', border: '1px solid var(--enterprise-gray-300)', borderRadius: '6px', cursor: 'pointer', fontSize: '13px', background: 'white' }}>
                    <Upload size={14} />
                    {uploading ? 'Uploading…' : 'Upload PDF'}
                    <input type="file" accept=".pdf,image/*" style={{ display: 'none' }} onChange={onUpload} disabled={uploading} />
                </label>
                {a.document_url && (
                    <a href={a.document_url} target="_blank" rel="noopener noreferrer"
                       style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', padding: '6px 14px', height: '36px', border: '1px solid var(--enterprise-gray-300)', borderRadius: '6px', fontSize: '13px', background: 'white', textDecoration: 'none', color: 'var(--enterprise-gray-700)' }}>
                        <Download size={14} /> View Document
                    </a>
                )}
            </div>
        </div>
    );
}

function PartsTab({ data }: { data: BPAGetResponse }) {
    const byPn = new Map(data.fulfillment.map(r => [r.part_number, r]));
    return (
        <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                    <tr style={{ background: 'var(--enterprise-gray-50)', borderBottom: '1px solid var(--enterprise-gray-200)' }}>
                        <th style={sharedThStyle}>#</th>
                        <th style={sharedThStyle}>MSN</th>
                        <th style={sharedThStyle}>Part #</th>
                        <th style={sharedThStyle}>Drawing</th>
                        <th style={sharedThStyle}>Rev</th>
                        <th style={sharedThStyle}>Blanket Qty</th>
                        <th style={sharedThStyle}>Unit Price</th>
                        <th style={sharedThStyle}>Total</th>
                        <th style={sharedThStyle}>REL MULT</th>
                        <th style={sharedThStyle}>MIN/MAX</th>
                        <th style={sharedThStyle}>AVG/MO</th>
                        <th style={sharedThStyle}>Fulfill %</th>
                    </tr>
                </thead>
                <tbody>
                    {data.parts.map(p => {
                        const f = byPn.get(p.part_number);
                        return (
                            <tr key={p.id} style={{ borderBottom: '1px solid var(--enterprise-gray-100)' }}>
                                <td style={sharedTdStyle}>{p.line_number}</td>
                                <td style={{ ...sharedTdStyle, fontWeight: 600 }}>{p.msn_code}</td>
                                <td style={sharedTdStyle}>{p.part_number}</td>
                                <td style={sharedTdStyle}>{p.drawing_number}</td>
                                <td style={sharedTdStyle}>{p.drawing_revision ?? '—'}</td>
                                <td style={{ ...sharedTdStyle, textAlign: 'right' }}>{p.blanket_quantity.toLocaleString()}</td>
                                <td style={{ ...sharedTdStyle, textAlign: 'right' }}>{Number(p.unit_price).toFixed(2)}</td>
                                <td style={{ ...sharedTdStyle, textAlign: 'right', fontWeight: 600 }}>{Number(p.total_value ?? 0).toLocaleString()}</td>
                                <td style={{ ...sharedTdStyle, textAlign: 'right' }}>{p.release_multiple}</td>
                                <td style={sharedTdStyle}>{p.min_warehouse_stock} / {p.max_warehouse_stock}</td>
                                <td style={{ ...sharedTdStyle, textAlign: 'right' }}>{Number(p.avg_monthly_demand).toFixed(0)}</td>
                                <td style={sharedTdStyle}>{f ? `${f.fulfillment_pct.toFixed(1)}%` : '—'}</td>
                            </tr>
                        );
                    })}
                </tbody>
            </table>
        </div>
    );
}

function FulfillmentTab({ data }: { data: BPAGetResponse }) {
    if (data.fulfillment.length === 0) {
        return <p style={{ color: 'var(--enterprise-gray-500)' }}>No fulfillment data yet. Activate the BO from the Header tab.</p>;
    }
    return (
        <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                    <tr style={{ background: 'var(--enterprise-gray-50)', borderBottom: '1px solid var(--enterprise-gray-200)' }}>
                        <th style={sharedThStyle}>MSN</th>
                        <th style={sharedThStyle}>Part #</th>
                        <th style={sharedThStyle}>Blanket</th>
                        <th style={sharedThStyle}>Shipped</th>
                        <th style={sharedThStyle}>Released</th>
                        <th style={sharedThStyle}>Delivered</th>
                        <th style={sharedThStyle}>Pending</th>
                        <th style={sharedThStyle}>In Rack</th>
                        <th style={sharedThStyle}>Fulfillment %</th>
                    </tr>
                </thead>
                <tbody>
                    {data.fulfillment.map(f => (
                        <tr key={`${f.agreement_id}-${f.part_number}`} style={{ borderBottom: '1px solid var(--enterprise-gray-100)' }}>
                            <td style={{ ...sharedTdStyle, fontWeight: 600 }}>{f.msn_code}</td>
                            <td style={sharedTdStyle}>{f.part_number}</td>
                            <td style={{ ...sharedTdStyle, textAlign: 'right' }}>{f.blanket_quantity.toLocaleString()}</td>
                            <td style={{ ...sharedTdStyle, textAlign: 'right' }}>{f.shipped_quantity.toLocaleString()}</td>
                            <td style={{ ...sharedTdStyle, textAlign: 'right' }}>{f.released_quantity.toLocaleString()}</td>
                            <td style={{ ...sharedTdStyle, textAlign: 'right' }}>{f.delivered_quantity.toLocaleString()}</td>
                            <td style={{ ...sharedTdStyle, textAlign: 'right', fontWeight: 600 }}>{f.pending_quantity.toLocaleString()}</td>
                            <td style={{ ...sharedTdStyle, textAlign: 'right' }}>{f.pallets_in_rack} ({f.qty_in_rack.toLocaleString()})</td>
                            <td style={sharedTdStyle}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                    <div style={{ flex: 1, height: '6px', background: 'var(--enterprise-gray-200)', borderRadius: '3px', overflow: 'hidden' }}>
                                        <div style={{ width: `${Math.min(100, f.fulfillment_pct)}%`, height: '100%', background: f.fulfillment_pct >= 80 ? '#16a34a' : f.fulfillment_pct >= 40 ? '#d97706' : '#6366f1' }} />
                                    </div>
                                    <span style={{ fontSize: '12px', minWidth: '40px', textAlign: 'right' }}>{f.fulfillment_pct.toFixed(0)}%</span>
                                </div>
                            </td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );
}

function RevisionsTab({ data }: { data: BPAGetResponse }) {
    if (data.revisions.length === 0) {
        return <p style={{ color: 'var(--enterprise-gray-500)' }}>No amendments yet.</p>;
    }
    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            {data.revisions.map(r => (
                <Card key={r.id} style={{ borderLeft: '3px solid var(--enterprise-warning)' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start' }}>
                        <div>
                            <p style={{ fontSize: '14px', fontWeight: 600 }}>
                                Rev {r.revision_from} → {r.revision_to}
                            </p>
                            <p style={{ fontSize: '12px', color: 'var(--enterprise-gray-500)' }}>
                                {new Date(r.revision_date).toLocaleString()}
                            </p>
                        </div>
                        {r.amendment_document_url && (
                            <a href={r.amendment_document_url} target="_blank" rel="noopener noreferrer" style={{ fontSize: '12px' }}>
                                View amendment doc →
                            </a>
                        )}
                    </div>
                    {r.revision_reason && (
                        <p style={{ fontSize: '13px', margin: '8px 0', fontStyle: 'italic', color: 'var(--enterprise-gray-700)' }}>
                            "{r.revision_reason}"
                        </p>
                    )}
                    <details style={{ marginTop: '8px' }}>
                        <summary style={{ cursor: 'pointer', fontSize: '12px', color: 'var(--enterprise-primary)' }}>View changes</summary>
                        <pre style={{ fontSize: '11px', background: 'var(--enterprise-gray-50)', padding: '10px', borderRadius: '4px', marginTop: '6px', overflow: 'auto' }}>
                            {JSON.stringify({ header: r.agreement_changes, parts: r.part_changes }, null, 2)}
                        </pre>
                    </details>
                </Card>
            ))}
        </div>
    );
}
