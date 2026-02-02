
import React, { useState } from 'react';
import { Mail, Lock, Eye, EyeOff, AlertCircle, CheckCircle, ArrowRight } from 'lucide-react';

export function LoginPage({ onLogin, onSignUp, isLoading, error: propError }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [isSignUp, setIsSignUp] = useState(false);
  const [localError, setLocalError] = useState(null);
  const [success, setSuccess] = useState(null);

  const displayError = propError || localError;

  const handleSubmit = async () => {
    setLocalError(null);
    setSuccess(null);

    if (!email || !password) {
      setLocalError('Please fill in all required fields');
      return;
    }

    if (password.length < 6) {
      setLocalError('Password must be at least 6 characters');
      return;
    }

    if (isSignUp) {
      if (!name.trim()) {
        setLocalError('Please enter your full name');
        return;
      }
      const success = await onSignUp(email, password, name);
      if (success) {
        setSuccess('Account created successfully! You can now sign in.');
        setTimeout(() => {
          setIsSignUp(false);
          setSuccess(null);
        }, 2000);
      }
    } else {
      await onLogin(email, password);
    }
  };

  const handleKeyPress = (e) => {
    if (e.key === 'Enter') {
      handleSubmit();
    }
  };

  return (
    <div style={{
      minHeight: '100vh',
      display: 'flex',
      backgroundColor: '#0a0f1e',
      position: 'relative',
      overflow: 'hidden',
    }}>
      {/* Google Fonts - Industry Standard Typography */}
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&family=Poppins:wght@400;500;600;700;800;900&display=swap');
      `}</style>

      {/* Left Side - Background Image with Overlay Content */}
      <div style={{
        flex: 1,
        position: 'relative',
        display: 'flex',
        alignItems: 'center',
        overflow: 'hidden',
      }}>
        {/* Background Image */}
        <div style={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          backgroundImage: 'url(/backgroundlogin.png)',
          backgroundSize: 'cover',
          backgroundPosition: 'center',
          backgroundRepeat: 'no-repeat',
        }}>
          {/* Dark overlay for better text contrast */}
          <div style={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: 'linear-gradient(135deg, rgba(10, 15, 30, 0.88) 0%, rgba(30, 41, 59, 0.78) 100%)',
          }} />
        </div>

        {/* Content Container */}
        <div style={{
          position: 'relative',
          zIndex: 1,
          padding: '80px 100px',
          maxWidth: '750px',
        }}>
          {/* Main Headline with Premium Typography */}
          <h1 style={{
            fontSize: '64px',
            fontWeight: '800',
            color: 'white',
            lineHeight: 1.1,
            marginBottom: '32px',
            letterSpacing: '-2px',
            fontFamily: '"Poppins", -apple-system, BlinkMacSystemFont, sans-serif',
            textShadow: '0 4px 20px rgba(0, 0, 0, 0.5)',
          }}>
            Intelligent Supply Chain Management
          </h1>
          
          <p style={{
            fontSize: '20px',
            color: 'rgba(255, 255, 255, 0.95)',
            lineHeight: 1.75,
            maxWidth: '580px',
            textShadow: '0 2px 8px rgba(0, 0, 0, 0.3)',
            fontWeight: '400',
            fontFamily: '"Inter", -apple-system, BlinkMacSystemFont, sans-serif',
          }}>
            Transform your operations with AI-powered inventory planning, real-time analytics, and predictive forecasting.
          </p>
        </div>
      </div>

      {/* Right Side - Login Form */}
      <div style={{
        width: '560px',
        background: 'white',
        display: 'flex',
        flexDirection: 'column',
        position: 'relative',
        zIndex: 1,
        boxShadow: '-20px 0 60px rgba(0, 0, 0, 0.3)',
        fontFamily: '"Inter", -apple-system, BlinkMacSystemFont, sans-serif',
      }}>
        {/* Logo Header - Larger & Better */}
        <div style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '50px 60px 30px',
          borderBottom: '1px solid #f1f5f9',
        }}>
          <img
            src="/logo.png"
            alt="Autocrat Engineers"
            style={{
              width: '300px',
              height: 'auto',
              objectFit: 'contain',
              userSelect: 'none',
              pointerEvents: 'none',
              filter: 'drop-shadow(0 2px 8px rgba(0, 0, 0, 0.08))',
            }}
          />
        </div>

        {/* Form Container */}
        <div style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          padding: '40px 60px 60px',
        }}>
          {/* Welcome Text with Premium Typography */}
          <div style={{ marginBottom: '40px' }}>
            <h2 style={{
              fontSize: '38px',
              fontWeight: '700',
              color: '#0f172a',
              marginBottom: '10px',
              letterSpacing: '-1.2px',
              fontFamily: '"Poppins", sans-serif',
            }}>
              {isSignUp ? 'Create Account' : 'Welcome Back'}
            </h2>
            <p style={{
              fontSize: '18px',
              color: '#64748b',
              fontWeight: '400',
              letterSpacing: '0.2px',
            }}>
              {isSignUp 
                ? 'Start managing your inventory efficiently' 
                : 'Sign in to access your dashboard'}
            </p>
          </div>

          {/* Tab Switcher */}
          <div style={{
            display: 'inline-flex',
            padding: '4px',
            background: '#f1f5f9',
            borderRadius: '10px',
            marginBottom: '32px',
            alignSelf: 'flex-start',
          }}>
            <button
              onClick={() => {
                setIsSignUp(false);
                setLocalError(null);
                setSuccess(null);
              }}
              style={{
                padding: '10px 28px',
                border: 'none',
                background: !isSignUp ? 'white' : 'transparent',
                fontSize: '14px',
                fontWeight: '600',
                color: !isSignUp ? '#1e40af' : '#64748b',
                borderRadius: '8px',
                cursor: 'pointer',
                transition: 'all 0.2s ease',
                boxShadow: !isSignUp ? '0 2px 8px rgba(0, 0, 0, 0.08)' : 'none',
                fontFamily: 'inherit',
              }}
            >
              Sign In
            </button>
            <button
              onClick={() => {
                setIsSignUp(true);
                setLocalError(null);
                setSuccess(null);
              }}
              style={{
                padding: '10px 28px',
                border: 'none',
                background: isSignUp ? 'white' : 'transparent',
                fontSize: '14px',
                fontWeight: '600',
                color: isSignUp ? '#1e40af' : '#64748b',
                borderRadius: '8px',
                cursor: 'pointer',
                transition: 'all 0.2s ease',
                boxShadow: isSignUp ? '0 2px 8px rgba(0, 0, 0, 0.08)' : 'none',
                fontFamily: 'inherit',
              }}
            >
              Sign Up
            </button>
          </div>

          {/* Success Message */}
          {success && (
            <div style={{
              padding: '14px 16px',
              marginBottom: '24px',
              background: 'linear-gradient(135deg, #f0fdf4 0%, #dcfce7 100%)',
              border: '1px solid #86efac',
              borderRadius: '10px',
              color: '#15803d',
              display: 'flex',
              gap: '12px',
              alignItems: 'flex-start',
              fontSize: '14px',
            }}>
              <CheckCircle size={18} style={{ flexShrink: 0, marginTop: '1px' }} />
              <div style={{ fontWeight: '500' }}>{success}</div>
            </div>
          )}

          {/* Error Message */}
          {displayError && (
            <div style={{
              padding: '14px 16px',
              marginBottom: '24px',
              background: 'linear-gradient(135deg, #fef2f2 0%, #fee2e2 100%)',
              border: '1px solid #fecaca',
              borderRadius: '10px',
              color: '#dc2626',
              display: 'flex',
              gap: '12px',
              alignItems: 'flex-start',
              fontSize: '14px',
            }}>
              <AlertCircle size={18} style={{ flexShrink: 0, marginTop: '1px' }} />
              <div style={{ fontWeight: '500' }}>{displayError}</div>
            </div>
          )}

          {/* Form Fields */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
            {/* Name Field */}
            {isSignUp && (
              <div>
                <label style={{
                  display: 'block',
                  fontSize: '14px',
                  fontWeight: '600',
                  color: '#1e293b',
                  marginBottom: '8px',
                }}>
                  Full Name
                </label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  onKeyPress={handleKeyPress}
                  placeholder="John Doe"
                  style={{
                    width: '100%',
                    padding: '14px 16px',
                    border: '2px solid #e2e8f0',
                    borderRadius: '10px',
                    fontSize: '15px',
                    boxSizing: 'border-box',
                    transition: 'all 0.2s ease',
                    fontFamily: 'inherit',
                    backgroundColor: 'white',
                  }}
                  onFocus={(e) => {
                    e.currentTarget.style.borderColor = '#3b82f6';
                    e.currentTarget.style.outline = 'none';
                    e.currentTarget.style.boxShadow = '0 0 0 4px rgba(59, 130, 246, 0.1)';
                  }}
                  onBlur={(e) => {
                    e.currentTarget.style.borderColor = '#e2e8f0';
                    e.currentTarget.style.boxShadow = 'none';
                  }}
                />
              </div>
            )}

            {/* Email Field */}
            <div>
              <label style={{
                display: 'block',
                fontSize: '14px',
                fontWeight: '600',
                color: '#1e293b',
                marginBottom: '8px',
              }}>
                Email Address
              </label>
              <div style={{ position: 'relative' }}>
                <Mail size={20} style={{
                  position: 'absolute',
                  left: '16px',
                  top: '50%',
                  transform: 'translateY(-50%)',
                  color: '#94a3b8',
                  pointerEvents: 'none',
                }} />
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  onKeyPress={handleKeyPress}
                  placeholder="you@company.com"
                  style={{
                    width: '100%',
                    padding: '14px 16px 14px 48px',
                    border: '2px solid #e2e8f0',
                    borderRadius: '10px',
                    fontSize: '15px',
                    boxSizing: 'border-box',
                    transition: 'all 0.2s ease',
                    fontFamily: 'inherit',
                    backgroundColor: 'white',
                  }}
                  onFocus={(e) => {
                    e.currentTarget.style.borderColor = '#3b82f6';
                    e.currentTarget.style.outline = 'none';
                    e.currentTarget.style.boxShadow = '0 0 0 4px rgba(59, 130, 246, 0.1)';
                  }}
                  onBlur={(e) => {
                    e.currentTarget.style.borderColor = '#e2e8f0';
                    e.currentTarget.style.boxShadow = 'none';
                  }}
                />
              </div>
            </div>

            {/* Password Field */}
            <div>
              <label style={{
                display: 'block',
                fontSize: '14px',
                fontWeight: '600',
                color: '#1e293b',
                marginBottom: '8px',
              }}>
                Password
              </label>
              <div style={{ position: 'relative' }}>
                <Lock size={20} style={{
                  position: 'absolute',
                  left: '16px',
                  top: '50%',
                  transform: 'translateY(-50%)',
                  color: '#94a3b8',
                  pointerEvents: 'none',
                }} />
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  onKeyPress={handleKeyPress}
                  placeholder="Enter your password"
                  style={{
                    width: '100%',
                    padding: '14px 48px',
                    border: '2px solid #e2e8f0',
                    borderRadius: '10px',
                    fontSize: '15px',
                    boxSizing: 'border-box',
                    transition: 'all 0.2s ease',
                    fontFamily: 'inherit',
                    backgroundColor: 'white',
                  }}
                  onFocus={(e) => {
                    e.currentTarget.style.borderColor = '#3b82f6';
                    e.currentTarget.style.outline = 'none';
                    e.currentTarget.style.boxShadow = '0 0 0 4px rgba(59, 130, 246, 0.1)';
                  }}
                  onBlur={(e) => {
                    e.currentTarget.style.borderColor = '#e2e8f0';
                    e.currentTarget.style.boxShadow = 'none';
                  }}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  style={{
                    position: 'absolute',
                    right: '16px',
                    top: '50%',
                    transform: 'translateY(-50%)',
                    border: 'none',
                    backgroundColor: 'transparent',
                    color: '#94a3b8',
                    cursor: 'pointer',
                    padding: '4px',
                    display: 'flex',
                    alignItems: 'center',
                  }}
                >
                  {showPassword ? <EyeOff size={20} /> : <Eye size={20} />}
                </button>
              </div>
            </div>

            {/* Submit Button */}
            <button
              onClick={handleSubmit}
              disabled={isLoading}
              style={{
                padding: '16px 24px',
                background: isLoading ? '#94a3b8' : 'linear-gradient(135deg, #3b82f6 0%, #1e40af 100%)',
                color: 'white',
                border: 'none',
                borderRadius: '10px',
                fontSize: '16px',
                fontWeight: '600',
                cursor: isLoading ? 'not-allowed' : 'pointer',
                transition: 'all 0.3s ease',
                marginTop: '8px',
                fontFamily: 'inherit',
                boxShadow: isLoading ? 'none' : '0 8px 24px rgba(59, 130, 246, 0.35)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '8px',
              }}
              onMouseEnter={(e) => {
                if (!isLoading) {
                  e.currentTarget.style.transform = 'translateY(-2px)';
                  e.currentTarget.style.boxShadow = '0 12px 32px rgba(59, 130, 246, 0.45)';
                }
              }}
              onMouseLeave={(e) => {
                if (!isLoading) {
                  e.currentTarget.style.transform = 'translateY(0)';
                  e.currentTarget.style.boxShadow = '0 8px 24px rgba(59, 130, 246, 0.35)';
                }
              }}
            >
              {isLoading ? 'Processing...' : (
                <>
                  {isSignUp ? 'Create Account' : 'Sign In'}
                  <ArrowRight size={20} />
                </>
              )}
            </button>
          </div>
        </div>

        {/* Footer */}
        <div style={{
          padding: '24px 60px',
          borderTop: '1px solid #f1f5f9',
          fontSize: '13px',
          color: '#64748b',
          textAlign: 'center',
        }}>
          © 2025 Autocrat Engineers. All rights reserved.
        </div>
      </div>
    </div>
  );
}

export default LoginPage;