/**
 * Supabase Project Configuration
 *
 * Uses environment variables when available (recommended for portability),
 * falls back to hardcoded values for backward compatibility.
 *
 * For local development, create a .env file with:
 *   VITE_SUPABASE_URL=https://your-project.supabase.co
 *   VITE_SUPABASE_ANON_KEY=your-anon-key
 */

const DEFAULT_PROJECT_ID = "sugvmurszfcneaeyoagv";
const DEFAULT_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InN1Z3ZtdXJzemZjbmVhZXlvYWd2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njg0MDUzMTUsImV4cCI6MjA4Mzk4MTMxNX0.mbCqGbmHFrR0Hk_1GqWYRxy6TapS_ajJJHwiG0LKK1w";

// Extract project ID from VITE_SUPABASE_URL if provided (e.g., https://xyz.supabase.co → xyz)
function getProjectId(): string {
    const envUrl = import.meta.env.VITE_SUPABASE_URL;
    if (envUrl) {
        const match = envUrl.match(/https:\/\/([^.]+)\.supabase\.co/);
        if (match) return match[1];
    }
    return DEFAULT_PROJECT_ID;
}

export const projectId = getProjectId();
export const publicAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || DEFAULT_ANON_KEY;