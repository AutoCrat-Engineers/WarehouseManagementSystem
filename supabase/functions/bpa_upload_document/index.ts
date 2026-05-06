/**
 * bpa_upload_document — Edge Function
 *
 * Uploads a BPA or amendment PDF to Supabase Storage bucket `bpa-documents`,
 * stores the path on the agreement or revision row.
 *
 * INPUT (multipart/form-data):
 *   - file:                the PDF (max 10 MB)
 *   - agreement_id:        uuid (required)
 *   - revision_id:         uuid (optional — attach to revision, not agreement header)
 *
 * OUTPUT:
 *   { success: true, document_url, path, size_bytes, content_type }
 *
 * Storage convention:
 *   bpa-documents/{agreement_id}/{timestamp}_{filename}
 *   bpa-documents/{agreement_id}/revisions/{revision_id}_{timestamp}_{filename}
 */
import { withMutationGuard } from '../_shared/session.ts';
import { jsonResponse, errorResponse, withErrorHandler } from '../_shared/errors.ts';

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB
const ALLOWED_TYPES = ['application/pdf', 'image/png', 'image/jpeg'];
const BUCKET = 'bpa-documents';

export const handler = withErrorHandler((req) => withMutationGuard(req, { label: 'Uploading BPA Document' }, async (ctx) => {
    const origin = req.headers.get('origin') ?? undefined;

    const contentType = req.headers.get('content-type') ?? '';
    if (!contentType.startsWith('multipart/form-data')) {
        return errorResponse('VALIDATION_FAILED',
            'Request must be multipart/form-data with a "file" field', { origin });
    }

    const form = await req.formData();
    const file = form.get('file') as File | null;
    const agreementId = form.get('agreement_id') as string | null;
    const revisionId  = form.get('revision_id')  as string | null;

    if (!file) return errorResponse('VALIDATION_FAILED', 'Missing file', { origin });
    if (!agreementId) return errorResponse('VALIDATION_FAILED', 'Missing agreement_id', { origin });
    if (file.size > MAX_FILE_SIZE) {
        return errorResponse('VALIDATION_FAILED',
            `File exceeds 10 MB limit (${file.size} bytes)`, { origin });
    }
    if (!ALLOWED_TYPES.includes(file.type)) {
        return errorResponse('VALIDATION_FAILED',
            `Unsupported file type: ${file.type}. Allowed: ${ALLOWED_TYPES.join(', ')}`, { origin });
    }

    // Ensure the agreement exists
    const { data: agr, error: agrErr } = await ctx.db
        .from('customer_agreements').select('id, agreement_number')
        .eq('id', agreementId).single();
    if (agrErr || !agr) {
        return errorResponse('NOT_FOUND', 'Agreement not found', { origin });
    }

    // Build storage path
    const safeName = file.name.replace(/[^\w.\-]/g, '_');
    const ts = Date.now();
    const path = revisionId
        ? `${agreementId}/revisions/${revisionId}_${ts}_${safeName}`
        : `${agreementId}/${ts}_${safeName}`;

    // Upload via storage REST API (Edge Functions don't have direct storage client for multipart)
    const bytes = new Uint8Array(await file.arrayBuffer());
    const { data: upload, error: upErr } = await ctx.db.storage
        .from(BUCKET)
        .upload(path, bytes, { contentType: file.type, upsert: false });
    if (upErr) {
        return errorResponse('INTERNAL_ERROR', `Upload failed: ${upErr.message}`, { origin });
    }

    const { data: pub } = ctx.db.storage.from(BUCKET).getPublicUrl(upload.path);
    const documentUrl = pub.publicUrl;

    // Persist URL on the appropriate row
    if (revisionId) {
        const { error } = await ctx.db
            .from('customer_agreement_revisions')
            .update({ amendment_document_url: documentUrl })
            .eq('id', revisionId)
            .eq('agreement_id', agreementId);
        if (error) return errorResponse('INTERNAL_ERROR', error.message, { origin });
    } else {
        const { error } = await ctx.db
            .from('customer_agreements')
            .update({ document_url: documentUrl })
            .eq('id', agreementId);
        if (error) return errorResponse('INTERNAL_ERROR', error.message, { origin });
    }

    // Audit
    await ctx.db.from('release_audit_log').insert({
        entity_type:   revisionId ? 'AGREEMENT' : 'AGREEMENT',
        entity_id:     revisionId ?? agreementId,
        entity_number: agr.agreement_number,
        action:        'UPDATED',
        metadata: { field: 'document_url', path, size_bytes: file.size, content_type: file.type },
        performed_by:  ctx.userId,
    });

    return jsonResponse({
        success:      true,
        document_url: documentUrl,
        path:         upload.path,
        size_bytes:   file.size,
        content_type: file.type,
    }, { origin });
}));

if (import.meta.main) Deno.serve(handler);
