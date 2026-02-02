import React, { useState } from 'react';
import { projectId } from '../utils/supabase/info';
import { Bug, CheckCircle, XCircle, Loader2 } from 'lucide-react';

interface AuthDebugProps {
  accessToken: string;
}

export function AuthDebug({ accessToken }: AuthDebugProps) {
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState<any>(null);

  const testAuth = async () => {
    setTesting(true);
    setResult(null);

    try {
      console.log('🔍 Testing auth with token (first 20 chars):', accessToken.substring(0, 20));
      
      const response = await fetch(
        `https://${projectId}.supabase.co/functions/v1/make-server-9c637d11/debug/auth`,
        {
          method: 'GET',
          headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Content-Type': 'application/json'
          }
        }
      );

      const data = await response.json();
      
      setResult({
        status: response.status,
        ok: response.ok,
        data
      });

      console.log('🔍 Auth test result:', {
        status: response.status,
        ok: response.ok,
        data
      });
    } catch (error) {
      console.error('🔍 Auth test error:', error);
      setResult({
        status: 0,
        ok: false,
        data: { error: error instanceof Error ? error.message : String(error) }
      });
    } finally {
      setTesting(false);
    }
  };

  return (
    <div className="bg-yellow-50 border-2 border-yellow-300 rounded-lg p-4 mb-6">
      <div className="flex items-center gap-3 mb-3">
        <Bug className="text-yellow-600" size={24} />
        <h3 className="text-lg font-semibold text-yellow-900">
          🔧 Authentication Debug Tool
        </h3>
      </div>
      
      <p className="text-sm text-yellow-800 mb-4">
        Click the button below to test if your access token is valid and working with the backend.
      </p>

      <div className="space-y-3">
        <button
          onClick={testAuth}
          disabled={testing}
          className="bg-yellow-600 text-white px-4 py-2 rounded-lg hover:bg-yellow-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
        >
          {testing ? (
            <>
              <Loader2 className="animate-spin" size={18} />
              Testing Authentication...
            </>
          ) : (
            <>
              <Bug size={18} />
              Test Authentication
            </>
          )}
        </button>

        {result && (
          <div className={`p-4 rounded-lg border-2 ${
            result.ok 
              ? 'bg-green-50 border-green-300' 
              : 'bg-red-50 border-red-300'
          }`}>
            <div className="flex items-center gap-2 mb-2">
              {result.ok ? (
                <>
                  <CheckCircle className="text-green-600" size={20} />
                  <span className="font-semibold text-green-900">✅ Success</span>
                </>
              ) : (
                <>
                  <XCircle className="text-red-600" size={20} />
                  <span className="font-semibold text-red-900">❌ Failed</span>
                </>
              )}
              <span className={`ml-auto px-2 py-1 rounded text-sm font-mono ${
                result.ok ? 'bg-green-200 text-green-800' : 'bg-red-200 text-red-800'
              }`}>
                HTTP {result.status}
              </span>
            </div>
            
            <div className="mt-3">
              <p className="text-xs font-mono text-gray-600 mb-1">Response:</p>
              <pre className="text-xs bg-gray-900 text-green-400 p-3 rounded overflow-auto max-h-64">
                {JSON.stringify(result.data, null, 2)}
              </pre>
            </div>

            {result.ok && result.data.user && (
              <div className="mt-3 p-3 bg-green-100 rounded">
                <p className="text-sm text-green-900">
                  <strong>Token is valid!</strong> Authenticated as: {result.data.user.email}
                </p>
              </div>
            )}

            {!result.ok && (
              <div className="mt-3 p-3 bg-red-100 rounded">
                <p className="text-sm text-red-900 font-semibold mb-1">
                  ⚠️ Authentication Issue Detected:
                </p>
                <p className="text-xs text-red-800">
                  {result.data.error || result.data.details || 'Unknown error'}
                </p>
                <p className="text-xs text-red-700 mt-2">
                  <strong>Troubleshooting:</strong>
                  <br/>
                  1. Try logging out and logging back in
                  <br/>
                  2. Check Supabase project configuration
                  <br/>
                  3. Verify SUPABASE_ANON_KEY in backend environment
                </p>
              </div>
            )}
          </div>
        )}

        <details className="text-xs text-gray-600">
          <summary className="cursor-pointer hover:text-gray-800 font-medium">
            🔍 Show Token Info (for debugging)
          </summary>
          <div className="mt-2 p-3 bg-gray-100 rounded font-mono break-all">
            <p><strong>Token (first 30 chars):</strong> {accessToken.substring(0, 30)}...</p>
            <p><strong>Token length:</strong> {accessToken.length} characters</p>
            <p><strong>Format:</strong> {accessToken.includes('.') ? 'JWT (contains dots ✓)' : 'Invalid JWT format ✗'}</p>
          </div>
        </details>
      </div>
    </div>
  );
}
