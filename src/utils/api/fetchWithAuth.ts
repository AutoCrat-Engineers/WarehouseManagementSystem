// // import { getSupabaseClient } from '../supabase/client';
// // import { projectId } from '../supabase/info';

// // const supabase = getSupabaseClient();

// // interface FetchWithAuthOptions extends RequestInit {
// //   accessToken?: string;
// // }

// // /**
// //  * Wrapper around fetch that handles authentication and token refresh
// //  * Automatically retries once with refreshed token on 401 errors
// //  */
// // export async function fetchWithAuth(
// //   endpoint: string,
// //   options: FetchWithAuthOptions = {}
// // ): Promise<Response> {
// //   const { accessToken, ...fetchOptions } = options;

// //   // Get current session token if not provided
// //   let token = accessToken;
// //   if (!token) {
// //     const { data: { session } } = await supabase.auth.getSession();
// //     token = session?.access_token;
// //   }

// //   if (!token) {
// //     throw new Error('No authentication token available');
// //   }

// //   // Build full URL
// //   const url = endpoint.startsWith('http') 
// //     ? endpoint 
// //     : `https://${projectId}.supabase.co/functions/v1/make-server-9c637d11${endpoint}`;

// //   // Make the request
// //   const headers = {
// //     ...fetchOptions.headers,
// //     'Authorization': `Bearer ${token}`,
// //   };

// //   let response = await fetch(url, {
// //     ...fetchOptions,
// //     headers,
// //   });

// //   // If 401, try to refresh token and retry once
// //   if (response.status === 401) {
// //     console.log('Received 401, attempting to refresh token...');
    
// //     const { data: { session }, error } = await supabase.auth.refreshSession();
    
// //     if (error || !session) {
// //       console.error('Token refresh failed:', error);
// //       // Force logout
// //       await supabase.auth.signOut();
// //       window.location.reload();
// //       throw new Error('Session expired. Please login again.');
// //     }

// //     console.log('Token refreshed, retrying request...');
    
// //     // Retry with new token
// //     response = await fetch(url, {
// //       ...fetchOptions,
// //       headers: {
// //         ...fetchOptions.headers,
// //         'Authorization': `Bearer ${session.access_token}`,
// //       },
// //     });
// //   }

// //   return response;
// // }

// // /**
// //  * Helper for JSON API calls
// //  */
// // export async function fetchJsonWithAuth<T = any>(
// //   endpoint: string,
// //   options: FetchWithAuthOptions = {}
// // ): Promise<T> {
// //   const response = await fetchWithAuth(endpoint, {
// //     ...options,
// //     headers: {
// //       'Content-Type': 'application/json',
// //       ...options.headers,
// //     },
// //   });

// //   if (!response.ok) {
// //     const errorText = await response.text();
// //     let errorMessage = `HTTP ${response.status}`;
    
// //     try {
// //       const errorJson = JSON.parse(errorText);
// //       errorMessage = errorJson.error || errorJson.message || errorMessage;
// //     } catch {
// //       errorMessage = errorText || errorMessage;
// //     }
    
// //     throw new Error(errorMessage);
// //   }

// //   return response.json();
// // }

// /**
//  * Supabase Authentication Utilities
//  * 
//  * Location: src/utils/supabase/auth.ts
//  * 
//  * This file handles all authentication operations with proper error handling
//  * and JWT token management
//  */

// import { getSupabaseClient } from './client';

// const supabase = getSupabaseClient();

// /**
//  * Sign in with email and password
//  * Returns the session with access token or error message
//  */
// export async function signInWithEmail(
//   email: string,
//   password: string
// ): Promise<{
//   session: any | null;
//   error: string | null;
// }> {
//   try {
//     const { data, error } = await supabase.auth.signInWithPassword({
//       email,
//       password,
//     });

//     if (error) {
//       console.error('Sign in error:', error.message);
//       return {
//         session: null,
//         error: error.message || 'Failed to sign in',
//       };
//     }

//     if (!data.session) {
//       return {
//         session: null,
//         error: 'No session received from auth provider',
//       };
//     }

//     console.log('✓ Sign in successful');
//     return {
//       session: data.session,
//       error: null,
//     };
//   } catch (err) {
//     const errorMsg = err instanceof Error ? err.message : 'Unknown error';
//     console.error('Sign in exception:', err);
//     return {
//       session: null,
//       error: errorMsg,
//     };
//   }
// }

// /**
//  * Sign up with email, password, and name
//  * User must confirm email before logging in
//  */
// export async function signUpWithEmail(
//   email: string,
//   password: string,
//   name: string
// ): Promise<{
//   user: any | null;
//   error: string | null;
// }> {
//   try {
//     const { data, error } = await supabase.auth.signUp({
//       email,
//       password,
//       options: {
//         data: {
//           name,
//         },
//       },
//     });

//     if (error) {
//       console.error('Sign up error:', error.message);
//       return {
//         user: null,
//         error: error.message || 'Failed to sign up',
//       };
//     }

//     console.log('✓ Sign up successful, awaiting email confirmation');
//     return {
//       user: data.user,
//       error: null,
//     };
//   } catch (err) {
//     const errorMsg = err instanceof Error ? err.message : 'Unknown error';
//     console.error('Sign up exception:', err);
//     return {
//       user: null,
//       error: errorMsg,
//     };
//   }
// }

// /**
//  * Get current authentication token from active session
//  * This should be used in components to pass to API endpoints
//  */
// export async function getAuthToken(): Promise<string | null> {
//   try {
//     const { data: { session }, error } = await supabase.auth.getSession();

//     if (error) {
//       console.error('Get session error:', error.message);
//       return null;
//     }

//     if (!session?.access_token) {
//       console.warn('No active session or access token');
//       return null;
//     }

//     return session.access_token;
//   } catch (err) {
//     console.error('Get auth token exception:', err);
//     return null;
//   }
// }

// /**
//  * Get current user information
//  */
// export async function getCurrentUser(): Promise<any | null> {
//   try {
//     const { data: { user }, error } = await supabase.auth.getUser();

//     if (error) {
//       console.error('Get user error:', error.message);
//       return null;
//     }

//     return user;
//   } catch (err) {
//     console.error('Get current user exception:', err);
//     return null;
//   }
// }

// /**
//  * Refresh the access token
//  * Call this if you get a 401 Unauthorized response
//  */
// export async function refreshAuthToken(): Promise<string | null> {
//   try {
//     const { data, error } = await supabase.auth.refreshSession();

//     if (error) {
//       console.error('Token refresh error:', error.message);
//       return null;
//     }

//     if (!data.session?.access_token) {
//       console.error('No token received after refresh');
//       return null;
//     }

//     console.log('✓ Token refreshed successfully');
//     return data.session.access_token;
//   } catch (err) {
//     console.error('Token refresh exception:', err);
//     return null;
//   }
// }

// /**
//  * Sign out the current user
//  */
// export async function signOut(): Promise<{
//   success: boolean;
//   error: string | null;
// }> {
//   try {
//     const { error } = await supabase.auth.signOut();

//     if (error) {
//       console.error('Sign out error:', error.message);
//       return {
//         success: false,
//         error: error.message || 'Failed to sign out',
//       };
//     }

//     console.log('✓ Sign out successful');
//     return {
//       success: true,
//       error: null,
//     };
//   } catch (err) {
//     const errorMsg = err instanceof Error ? err.message : 'Unknown error';
//     console.error('Sign out exception:', err);
//     return {
//       success: false,
//       error: errorMsg,
//     };
//   }
// }

// /**
//  * Wrapper function for API calls with automatic token refresh
//  * Use this instead of fetch() directly for protected API endpoints
//  */
// export async function fetchWithAuth(
//   url: string,
//   options: RequestInit = {}
// ): Promise<Response> {
//   let token = await getAuthToken();

//   if (!token) {
//     throw new Error('No authentication token available. Please login.');
//   }

//   let response = await fetch(url, {
//     ...options,
//     headers: {
//       ...options.headers,
//       'Authorization': `Bearer ${token}`,
//       'Content-Type': 'application/json',
//     },
//   });

//   // If 401 Unauthorized, try refreshing token and retry once
//   if (response.status === 401) {
//     console.warn('Got 401, attempting token refresh...');
//     const newToken = await refreshAuthToken();

//     if (!newToken) {
//       throw new Error('Authentication failed. Please login again.');
//     }

//     response = await fetch(url, {
//       ...options,
//       headers: {
//         ...options.headers,
//         'Authorization': `Bearer ${newToken}`,
//         'Content-Type': 'application/json',
//       },
//     });
//   }

//   return response;
// }


/**
 * Supabase Authentication Utilities
 * 
 * Location: src/utils/supabase/auth.ts
 * 
 * This file handles all authentication operations with proper error handling
 * and JWT token management
 */

// import { getSupabaseClient } from './client';

// const supabase = getSupabaseClient();

// /**
//  * Sign in with email and password
//  * Returns the session with access token or error message
//  */
// export async function signInWithEmail(
//   email: string,
//   password: string
// ): Promise<{
//   session: any | null;
//   error: string | null;
// }> {
//   try {
//     const { data, error } = await supabase.auth.signInWithPassword({
//       email,
//       password,
//     });

//     if (error) {
//       console.error('Sign in error:', error.message);
//       return {
//         session: null,
//         error: error.message || 'Failed to sign in',
//       };
//     }

//     if (!data.session) {
//       return {
//         session: null,
//         error: 'No session received from auth provider',
//       };
//     }

//     console.log('✓ Sign in successful');
//     return {
//       session: data.session,
//       error: null,
//     };
//   } catch (err) {
//     const errorMsg = err instanceof Error ? err.message : 'Unknown error';
//     console.error('Sign in exception:', err);
//     return {
//       session: null,
//       error: errorMsg,
//     };
//   }
// }

// /**
//  * Sign up with email, password, and name
//  * User must confirm email before logging in
//  */
// export async function signUpWithEmail(
//   email: string,
//   password: string,
//   name: string
// ): Promise<{
//   user: any | null;
//   error: string | null;
// }> {
//   try {
//     const { data, error } = await supabase.auth.signUp({
//       email,
//       password,
//       options: {
//         data: {
//           name,
//         },
//       },
//     });

//     if (error) {
//       console.error('Sign up error:', error.message);
//       return {
//         user: null,
//         error: error.message || 'Failed to sign up',
//       };
//     }

//     console.log('✓ Sign up successful, awaiting email confirmation');
//     return {
//       user: data.user,
//       error: null,
//     };
//   } catch (err) {
//     const errorMsg = err instanceof Error ? err.message : 'Unknown error';
//     console.error('Sign up exception:', err);
//     return {
//       user: null,
//       error: errorMsg,
//     };
//   }
// }

// /**
//  * Get current authentication token from active session
//  * This should be used in components to pass to API endpoints
//  */
// export async function getAuthToken(): Promise<string | null> {
//   try {
//     const { data: { session }, error } = await supabase.auth.getSession();

//     if (error) {
//       console.error('Get session error:', error.message);
//       return null;
//     }

//     if (!session?.access_token) {
//       console.warn('No active session or access token');
//       return null;
//     }

//     return session.access_token;
//   } catch (err) {
//     console.error('Get auth token exception:', err);
//     return null;
//   }
// }

// /**
//  * Get current user information
//  */
// export async function getCurrentUser(): Promise<any | null> {
//   try {
//     const { data: { user }, error } = await supabase.auth.getUser();

//     if (error) {
//       console.error('Get user error:', error.message);
//       return null;
//     }

//     return user;
//   } catch (err) {
//     console.error('Get current user exception:', err);
//     return null;
//   }
// }

// /**
//  * Refresh the access token
//  * Call this if you get a 401 Unauthorized response
//  */
// export async function refreshAuthToken(): Promise<string | null> {
//   try {
//     const { data, error } = await supabase.auth.refreshSession();

//     if (error) {
//       console.error('Token refresh error:', error.message);
//       return null;
//     }

//     if (!data.session?.access_token) {
//       console.error('No token received after refresh');
//       return null;
//     }

//     console.log('✓ Token refreshed successfully');
//     return data.session.access_token;
//   } catch (err) {
//     console.error('Token refresh exception:', err);
//     return null;
//   }
// }

// /**
//  * Sign out the current user
//  */
// export async function signOut(): Promise<{
//   success: boolean;
//   error: string | null;
// }> {
//   try {
//     const { error } = await supabase.auth.signOut();

//     if (error) {
//       console.error('Sign out error:', error.message);
//       return {
//         success: false,
//         error: error.message || 'Failed to sign out',
//       };
//     }

//     console.log('✓ Sign out successful');
//     return {
//       success: true,
//       error: null,
//     };
//   } catch (err) {
//     const errorMsg = err instanceof Error ? err.message : 'Unknown error';
//     console.error('Sign out exception:', err);
//     return {
//       success: false,
//       error: errorMsg,
//     };
//   }
// }

// /**
//  * Wrapper function for API calls with automatic token refresh
//  * Use this instead of fetch() directly for protected API endpoints
//  * 
//  * FIXED: Now properly uses the refreshed token in retry attempt
//  */
// export async function fetchWithAuth(
//   url: string,
//   options: RequestInit = {}
// ): Promise<Response> {
//   // Get fresh session for the initial request
//   const { data: { session }, error: sessionError } = await supabase.auth.getSession();

//   if (sessionError || !session?.access_token) {
//     throw new Error('No authentication token available. Please login.');
//   }

//   let token = session.access_token;

//   // Make the initial request
//   let response = await fetch(url, {
//     ...options,
//     headers: {
//       ...options.headers,
//       'Authorization': `Bearer ${token}`,
//       'Content-Type': 'application/json',
//     },
//   });

//   // If 401 Unauthorized, try refreshing token and retry ONCE
//   if (response.status === 401) {
//     console.log('Got 401, attempting token refresh...');
    
//     // Refresh the token
//     const { data: refreshData, error: refreshError } = await supabase.auth.refreshSession();

//     if (refreshError || !refreshData.session?.access_token) {
//       console.error('Token refresh failed:', refreshError?.message);
//       throw new Error('Authentication failed. Please login again.');
//     }

//     console.log('✓ Token refreshed successfully');
    
//     // Use the NEW token from the refresh
//     const newToken = refreshData.session.access_token;

//     // Retry the request with the NEW token
//     response = await fetch(url, {
//       ...options,
//       headers: {
//         ...options.headers,
//         'Authorization': `Bearer ${newToken}`,
//         'Content-Type': 'application/json',
//       },
//     });

//     // If still 401 after refresh, something is wrong
//     if (response.status === 401) {
//       throw new Error('Authentication failed after token refresh. Please login again.');
//     }
//   }

//   return response;
// }

import { getSupabaseClient } from './client';

const supabase = getSupabaseClient();

/**
 * Sign in with email and password
 * Returns the session with access token or error message
 */
export async function signInWithEmail(
  email: string,
  password: string
): Promise<{
  session: any | null;
  error: string | null;
}> {
  try {
    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (error) {
      console.error('Sign in error:', error.message);
      return {
        session: null,
        error: error.message || 'Failed to sign in',
      };
    }

    if (!data.session) {
      return {
        session: null,
        error: 'No session received from auth provider',
      };
    }

    console.log('✓ Sign in successful');
    return {
      session: data.session,
      error: null,
    };
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : 'Unknown error';
    console.error('Sign in exception:', err);
    return {
      session: null,
      error: errorMsg,
    };
  }
}

/**
 * Sign up with email, password, and name
 * User must confirm email before logging in
 */
export async function signUpWithEmail(
  email: string,
  password: string,
  name: string
): Promise<{
  user: any | null;
  error: string | null;
}> {
  try {
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: {
          name,
        },
      },
    });

    if (error) {
      console.error('Sign up error:', error.message);
      return {
        user: null,
        error: error.message || 'Failed to sign up',
      };
    }

    console.log('✓ Sign up successful, awaiting email confirmation');
    return {
      user: data.user,
      error: null,
    };
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : 'Unknown error';
    console.error('Sign up exception:', err);
    return {
      user: null,
      error: errorMsg,
    };
  }
}

/**
 * Get current authentication token from active session
 * This should be used in components to pass to API endpoints
 */
export async function getAuthToken(): Promise<string | null> {
  try {
    const { data: { session }, error } = await supabase.auth.getSession();

    if (error) {
      console.error('Get session error:', error.message);
      return null;
    }

    if (!session?.access_token) {
      console.warn('No active session or access token');
      return null;
    }

    return session.access_token;
  } catch (err) {
    console.error('Get auth token exception:', err);
    return null;
  }
}

/**
 * Get current user information
 */
export async function getCurrentUser(): Promise<any | null> {
  try {
    const { data: { user }, error } = await supabase.auth.getUser();

    if (error) {
      console.error('Get user error:', error.message);
      return null;
    }

    return user;
  } catch (err) {
    console.error('Get current user exception:', err);
    return null;
  }
}

/**
 * Refresh the access token
 * Call this if you get a 401 Unauthorized response
 */
export async function refreshAuthToken(): Promise<string | null> {
  try {
    const { data, error } = await supabase.auth.refreshSession();

    if (error) {
      console.error('Token refresh error:', error.message);
      return null;
    }

    if (!data.session?.access_token) {
      console.error('No token received after refresh');
      return null;
    }

    console.log('✓ Token refreshed successfully');
    return data.session.access_token;
  } catch (err) {
    console.error('Token refresh exception:', err);
    return null;
  }
}

/**
 * Sign out the current user
 */
export async function signOut(): Promise<{
  success: boolean;
  error: string | null;
}> {
  try {
    const { error } = await supabase.auth.signOut();

    if (error) {
      console.error('Sign out error:', error.message);
      return {
        success: false,
        error: error.message || 'Failed to sign out',
      };
    }

    console.log('✓ Sign out successful');
    return {
      success: true,
      error: null,
    };
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : 'Unknown error';
    console.error('Sign out exception:', err);
    return {
      success: false,
      error: errorMsg,
    };
  }
}

/**
 * Wrapper function for API calls with automatic token refresh
 * Use this instead of fetch() directly for protected API endpoints
 *
 * FIXED: Now properly uses the refreshed token in retry attempt
 */
export async function fetchWithAuth(
  url: string,
  options: RequestInit = {}
): Promise<Response> {
  // Get fresh session for the initial request
  const { data: { session }, error: sessionError } = await supabase.auth.getSession();

  if (sessionError || !session?.access_token) {
    throw new Error('No authentication token available. Please login.');
  }

  let token = session.access_token;

  // Make the initial request
  let response = await fetch(url, {
    ...options,
    headers: {
      ...options.headers,
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
  });

  // If 401 Unauthorized, try refreshing token and retry ONCE
  if (response.status === 401) {
    console.log('Got 401, attempting token refresh...');
    
    // Refresh the token
    const { data: refreshData, error: refreshError } = await supabase.auth.refreshSession();

    if (refreshError || !refreshData.session?.access_token) {
      console.error('Token refresh failed:', refreshError?.message);
      throw new Error('Authentication failed. Please login again.');
    }

    console.log('✓ Token refreshed successfully');
    
    // Use the NEW token from the refresh
    const newToken = refreshData.session.access_token;

    // Retry the request with the NEW token
    response = await fetch(url, {
      ...options,
      headers: {
        ...options.headers,
        'Authorization': `Bearer ${newToken}`,
        'Content-Type': 'application/json',
      },
    });

    // If still 401 after refresh, something is wrong
    if (response.status === 401) {
      throw new Error('Authentication failed after token refresh. Please login again.');
    }
  }

  return response;
}