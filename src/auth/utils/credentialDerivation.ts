/**
 * Credential Utilities
 *
 * Location: src/auth/utils/credentialDerivation.ts
 *
 * Email normalization for consistent identity matching.
 */

export function normalizeLoginIdentifier(identifier: string): string {
  return identifier.trim().toLowerCase();
}
