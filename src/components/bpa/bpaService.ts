/**
 * bpaService — thin client around BPA edge functions.
 */
import { fetchWithAuth } from '../../utils/supabase/auth';
import { getEdgeFunctionUrl } from '../../utils/supabase/info';
import type {
    CustomerAgreement, CustomerAgreementPart, AgreementRevision, FulfillmentRow,
    AgreementCreateForm, AgreementStatus,
} from './types';

export interface BPAListFilters {
    page?:          number;
    page_size?:     number;
    status_filter?: 'ALL' | AgreementStatus;
    search_term?:   string;
    customer_code?: string;
}

export interface BPAListResponse {
    agreements:  CustomerAgreement[];
    total_count: number;
    counts: { total: number; active: number; draft: number; amended: number; expired: number; cancelled: number };
}

export interface BPAGetResponse {
    agreement:   CustomerAgreement;
    parts:       CustomerAgreementPart[];
    revisions:   AgreementRevision[];
    fulfillment: FulfillmentRow[];
}

async function callEdge<T>(name: string, body: unknown, options: { method?: string } = {}): Promise<T> {
    const res = await fetchWithAuth(getEdgeFunctionUrl(name), {
        method: options.method ?? 'POST',
        body: JSON.stringify(body),
    });
    const json = await res.json();
    if (!res.ok || json?.error) {
        throw new Error(json?.error?.message || json?.error || `Request failed (${res.status})`);
    }
    return json as T;
}

export async function listBPAs(filters: BPAListFilters = {}): Promise<BPAListResponse> {
    return callEdge('bpa_list', filters);
}

export async function getBPA(params:
    | { agreement_id: string; revision_history_limit?: number }
    | { agreement_number: string; revision?: number; revision_history_limit?: number }
): Promise<BPAGetResponse> {
    return callEdge('bpa_get', params);
}

export async function createBPA(form: AgreementCreateForm): Promise<{
    agreement_id: string; agreement_number: string; revision: number; parts_created: number;
}> {
    return callEdge('bpa_create', form);
}

export interface BPAAmendInput {
    agreement_id:          string;
    expected_row_version:  number;
    revision_reason:       string;
    changes: {
        header?: Partial<Record<string, unknown>>;
        parts?:  Array<{ part_number: string; [k: string]: unknown }>;
    };
    idempotency_key?: string;
}

export async function amendBPA(input: BPAAmendInput): Promise<{
    agreement_id: string; revision_from: number; revision_to: number;
    revision_id: string; parts_changed: number; cascaded_to_line_configs: number;
}> {
    return callEdge('bpa_amend', input);
}

export async function uploadBPADocument(
    agreementId: string,
    file: File,
    revisionId?: string,
): Promise<{ document_url: string; path: string; size_bytes: number; content_type: string }> {
    const form = new FormData();
    form.append('file', file);
    form.append('agreement_id', agreementId);
    if (revisionId) form.append('revision_id', revisionId);
    const res = await fetchWithAuth(getEdgeFunctionUrl('bpa_upload_document'), {
        method: 'POST',
        body: form,
    });
    const json = await res.json();
    if (!res.ok || json?.error) {
        throw new Error(json?.error?.message || json?.error || `Upload failed (${res.status})`);
    }
    return json;
}

/** Creates blanket_orders + line_configs from an active BPA. Idempotent. */
export async function createBOFromBPA(agreementId: string): Promise<{
    blanket_order_id: string; blanket_order_number: string;
    line_configs_created: number; line_configs_existing: number;
}> {
    return callEdge('bo_create_from_bpa', { agreement_id: agreementId });
}
