import { projectId } from '../supabase/info';
import { getSupabaseClient } from '../supabase/client';

export class APIError extends Error {
  constructor(
    message: string,
    public statusCode: number,
    public details?: any
  ) {
    super(message);
    this.name = 'APIError';
  }
}

export interface APIResponse<T> {
  data?: T;
  error?: string;
}

class APIClient {
  private baseUrl: string;
  private defaultHeaders: HeadersInit;
  private supabase = getSupabaseClient();

  constructor() {
    this.baseUrl = `https://${projectId}.supabase.co/functions/v1/make-server-9c637d11`;
    this.defaultHeaders = {
      'Content-Type': 'application/json',
    };
  }

  private async request<T>(
    endpoint: string,
    options: RequestInit = {},
    accessToken?: string,
    retryCount = 0
  ): Promise<T> {
    // Always get fresh token from current session
    let token = accessToken;
    if (!token) {
      console.log('No token provided, fetching from current session...');
      const { data: { session }, error } = await this.supabase.auth.getSession();
      if (error) {
        console.error('Error getting session:', error);
        throw new APIError('Failed to get authentication session', 401);
      }
      if (!session) {
        console.error('No active session found');
        throw new APIError('No active session. Please login.', 401);
      }
      token = session.access_token;
      console.log('Retrieved token from session:', token.substring(0, 30) + '...');
    }

    const headers: HeadersInit = {
      ...this.defaultHeaders,
      ...options.headers,
    };

    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    const url = `${this.baseUrl}${endpoint}`;

    console.log(`API Request: ${options.method || 'GET'} ${url}`);
    console.log('Token (first 30 chars):', token?.substring(0, 30) + '...');

    try {
      const response = await fetch(url, {
        ...options,
        headers,
      });

      console.log(`API Response: ${response.status} ${response.statusText}`);

      // Handle 401 Unauthorized - try to refresh token once
      if (response.status === 401 && retryCount === 0) {
        console.log('❌ Received 401 Unauthorized, attempting token refresh...');
        
        const { data: refreshData, error: refreshError } = await this.supabase.auth.refreshSession();
        
        if (refreshError || !refreshData.session) {
          console.error('❌ Token refresh failed:', refreshError);
          
          // Sign out and force re-login
          await this.supabase.auth.signOut();
          
          throw new APIError('Session expired. Please login again.', 401);
        }

        console.log('✅ Token refreshed successfully, retrying request...');
        
        // Retry the request with new token
        return this.request<T>(endpoint, options, refreshData.session.access_token, retryCount + 1);
      }

      // Parse JSON response
      let data;
      try {
        data = await response.json();
      } catch (e) {
        // If JSON parse fails, check if response was successful
        if (!response.ok) {
          throw new APIError(
            `HTTP ${response.status}: ${response.statusText}`,
            response.status
          );
        }
        throw new APIError('Invalid JSON response from server', response.status);
      }

      // Handle error responses
      if (!response.ok) {
        const errorMessage = data.error || data.message || `HTTP ${response.status}: ${response.statusText}`;
        console.error(`❌ API Error: ${errorMessage}`, data);
        throw new APIError(
          errorMessage,
          response.status,
          data
        );
      }

      console.log(`✅ API Success: ${options.method || 'GET'} ${url}`);
      return data as T;
    } catch (error) {
      if (error instanceof APIError) {
        throw error;
      }

      // Network errors, timeout, etc.
      if (error instanceof TypeError && error.message.includes('fetch')) {
        console.error('❌ Network error:', error);
        throw new APIError('Network error: Please check your connection', 0);
      }

      console.error('❌ Unknown error:', error);
      throw new APIError(
        error instanceof Error ? error.message : 'Unknown error occurred',
        0
      );
    }
  }

  async get<T>(endpoint: string, accessToken?: string): Promise<T> {
    return this.request<T>(endpoint, { method: 'GET' }, accessToken);
  }

  async post<T>(
    endpoint: string,
    body?: any,
    accessToken?: string
  ): Promise<T> {
    return this.request<T>(
      endpoint,
      {
        method: 'POST',
        body: body ? JSON.stringify(body) : undefined,
      },
      accessToken
    );
  }

  async put<T>(
    endpoint: string,
    body?: any,
    accessToken?: string
  ): Promise<T> {
    return this.request<T>(
      endpoint,
      {
        method: 'PUT',
        body: body ? JSON.stringify(body) : undefined,
      },
      accessToken
    );
  }

  async delete<T>(endpoint: string, accessToken?: string): Promise<T> {
    return this.request<T>(endpoint, { method: 'DELETE' }, accessToken);
  }
}

// Singleton instance
export const apiClient = new APIClient();