import React, { useState, useEffect } from 'react';
import { getSupabaseClient } from '../utils/supabase/client';
import { projectId } from '../utils/supabase/info';
import { RefreshCw, Check, X, AlertCircle } from 'lucide-react';

interface AuthDebugPanelProps {
  accessToken: string | null;
}

export function AuthDebugPanel({ accessToken }: AuthDebugPanelProps) {
  const [sessionInfo, setSessionInfo] = useState<any>(null);
  const [testResult, setTestResult] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const supabase = getSupabaseClient();

  const checkSession = async () => {
    setLoading(true);
    try {
      const { data: { session }, error } = await supabase.auth.getSession();
      setSessionInfo({
        hasSession: !!session,
        error: error?.message,
        user: session?.user?.email,
        tokenExpiry: session?.expires_at ? new Date(session.expires_at * 1000).toLocaleString() : 'N/A',
        tokenPreview: session?.access_token?.substring(0, 50) + '...'
      });
    } catch (err) {
      setSessionInfo({ error: err instanceof Error ? err.message : 'Unknown error' });
    } finally {
      setLoading(false);
    }
  };

  const testEndpoint = async () => {
    setLoading(true);
    setTestResult('');
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        setTestResult('❌ No session found');
        return;
      }

      const response = await fetch(
        `https://${projectId}.supabase.co/functions/v1/make-server-9c637d11/health`,
        {
          headers: {
            'Authorization': `Bearer ${session.access_token}`
          }
        }
      );

      if (response.ok) {
        const data = await response.json();
        setTestResult(`✅ Health check passed: ${JSON.stringify(data)}`);
      } else {
        const errorText = await response.text();
        setTestResult(`❌ Health check failed (${response.status}): ${errorText}`);
      }
    } catch (err) {
      setTestResult(`❌ Error: ${err instanceof Error ? err.message : 'Unknown'}`);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    checkSession();
  }, [accessToken]);

  if (!sessionInfo) return null;

  return (
    <div className="fixed bottom-4 right-4 bg-white rounded-lg shadow-xl border-2 border-blue-500 p-4 max-w-md z-50">
      <div className="flex items-center justify-between mb-3">
        <h3 className="font-bold text-gray-900 flex items-center gap-2">
          <AlertCircle size={20} className="text-blue-600" />
          Auth Debug Panel
        </h3>
        <button
          onClick={checkSession}
          disabled={loading}
          className="p-1 hover:bg-gray-100 rounded"
        >
          <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
        </button>
      </div>

      <div className="space-y-2 text-sm">
        <div className="flex items-center gap-2">
          {sessionInfo.hasSession ? (
            <>
              <Check size={16} className="text-green-600" />
              <span className="text-green-700 font-medium">Session Active</span>
            </>
          ) : (
            <>
              <X size={16} className="text-red-600" />
              <span className="text-red-700 font-medium">No Session</span>
            </>
          )}
        </div>

        {sessionInfo.user && (
          <div className="text-gray-700">
            <strong>User:</strong> {sessionInfo.user}
          </div>
        )}

        {sessionInfo.tokenExpiry && sessionInfo.tokenExpiry !== 'N/A' && (
          <div className="text-gray-700">
            <strong>Expires:</strong> {sessionInfo.tokenExpiry}
          </div>
        )}

        {sessionInfo.tokenPreview && (
          <div className="text-gray-700 text-xs break-all">
            <strong>Token:</strong> {sessionInfo.tokenPreview}
          </div>
        )}

        {sessionInfo.error && (
          <div className="text-red-600 bg-red-50 p-2 rounded">
            <strong>Error:</strong> {sessionInfo.error}
          </div>
        )}

        <div className="flex gap-2 mt-3">
          <button
            onClick={testEndpoint}
            disabled={loading}
            className="flex-1 bg-blue-600 text-white px-3 py-1 rounded text-xs hover:bg-blue-700 disabled:opacity-50"
          >
            Test API
          </button>
          <button
            onClick={async () => {
              await supabase.auth.refreshSession();
              checkSession();
            }}
            disabled={loading}
            className="flex-1 bg-green-600 text-white px-3 py-1 rounded text-xs hover:bg-green-700 disabled:opacity-50"
          >
            Refresh Token
          </button>
        </div>

        {testResult && (
          <div className={`mt-2 p-2 rounded text-xs ${
            testResult.includes('✅') ? 'bg-green-50 text-green-800' : 'bg-red-50 text-red-800'
          }`}>
            {testResult}
          </div>
        )}
      </div>
    </div>
  );
}
