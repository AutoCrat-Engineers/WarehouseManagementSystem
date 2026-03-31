/**
 * Structured Audit Logger — Enterprise Logging Module
 *
 * Provides structured, JSON-formatted log output for all critical
 * warehouse operations. Designed for integration with log aggregation
 * systems (CloudWatch, Datadog, etc.).
 *
 * @version v0.4.1
 */

// ============================================================================
// TYPES
// ============================================================================

export type LogModule =
    | 'STICKER'
    | 'PACKING'
    | 'STOCK_MOVEMENT'
    | 'PRINTING'
    | 'MPL'
    | 'AUTH'
    | 'CONTAINER'
    | 'PALLET';

export type LogLevel = 'INFO' | 'WARN' | 'ERROR';

export interface StructuredLog {
    timestamp: string;
    userId: string;
    operation: string;
    referenceId: string;
    module: LogModule;
    level: LogLevel;
    duration_ms?: number;
    metadata?: Record<string, any>;
}

// ============================================================================
// CORE LOGGING
// ============================================================================

/**
 * Emit a structured log entry.
 * Output format: `[MODULE] { ...json }`
 */
export function logOperation(log: StructuredLog): void {
    const entry: StructuredLog = {
        ...log,
        timestamp: log.timestamp || new Date().toISOString(),
    };

    const prefix = `[${entry.module}]`;
    const payload = JSON.stringify(entry);

    switch (entry.level) {
        case 'ERROR':
            console.error(prefix, payload);
            break;
        case 'WARN':
            console.warn(prefix, payload);
            break;
        default:
            console.log(prefix, payload);
    }
}

// ============================================================================
// PERFORMANCE TIMING WRAPPER
// ============================================================================

/**
 * Execute an async operation with automatic timing and structured logging.
 *
 * On success: logs INFO with duration_ms.
 * On failure: logs ERROR with duration_ms and error message, then re-throws.
 *
 * @example
 * const boxes = await withTiming(
 *   'autoGenerateBoxes',
 *   'PACKING',
 *   userId,
 *   requestId,
 *   () => generateAllBoxes(requestId)
 * );
 */
export async function withTiming<T>(
    operation: string,
    module: LogModule,
    userId: string,
    referenceId: string,
    fn: () => Promise<T>,
): Promise<T> {
    const start = performance.now();
    try {
        const result = await fn();
        logOperation({
            timestamp: new Date().toISOString(),
            userId,
            operation,
            referenceId,
            module,
            level: 'INFO',
            duration_ms: Math.round(performance.now() - start),
        });
        return result;
    } catch (error: any) {
        logOperation({
            timestamp: new Date().toISOString(),
            userId,
            operation,
            referenceId,
            module,
            level: 'ERROR',
            duration_ms: Math.round(performance.now() - start),
            metadata: { error: error.message },
        });
        throw error;
    }
}

// ============================================================================
// CONVENIENCE HELPERS
// ============================================================================

/** Quick INFO log for a completed operation */
export function logInfo(
    module: LogModule,
    operation: string,
    userId: string,
    referenceId: string,
    metadata?: Record<string, any>,
): void {
    logOperation({
        timestamp: new Date().toISOString(),
        userId, operation, referenceId, module,
        level: 'INFO',
        metadata,
    });
}

/** Quick WARN log */
export function logWarn(
    module: LogModule,
    operation: string,
    userId: string,
    referenceId: string,
    metadata?: Record<string, any>,
): void {
    logOperation({
        timestamp: new Date().toISOString(),
        userId, operation, referenceId, module,
        level: 'WARN',
        metadata,
    });
}

/** Quick ERROR log */
export function logError(
    module: LogModule,
    operation: string,
    userId: string,
    referenceId: string,
    metadata?: Record<string, any>,
): void {
    logOperation({
        timestamp: new Date().toISOString(),
        userId, operation, referenceId, module,
        level: 'ERROR',
        metadata,
    });
}
