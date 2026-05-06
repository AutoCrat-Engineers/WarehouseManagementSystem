/**
 * Enterprise Login Page
 * 
 * Location: src/auth/login/LoginPage.tsx
 * 
 * Clean enterprise login - NO public signup.
 * Users receive credentials from L3 manager.
 */

import React, { useState } from 'react';
import { Mail, Lock, Eye, EyeOff, AlertCircle, Loader2, LogIn, ShieldAlert } from 'lucide-react';
import { RotatingQuote } from '../../components/ui/RotatingQuote';

export interface LoginResult {
    ok: boolean;
    code?: string;
    error?: string;
    sessionBusy?: { in_flight: Array<{ op_label: string; age_seconds: number }> };
    attemptsRemaining?: number;
}

interface LoginPageProps {
    onLogin: (email: string, password: string, opts?: { forceTakeover?: boolean }) => Promise<LoginResult>;
    isLoading?: boolean;
    error?: string | null;
}

export function LoginPage({ onLogin, isLoading = false, error: propError }: LoginPageProps) {
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [showPassword, setShowPassword] = useState(false);
    const [localError, setLocalError] = useState<string | null>(null);
    const [busyPrompt, setBusyPrompt] = useState<LoginResult['sessionBusy'] | null>(null);
    const [waiting, setWaiting] = useState<{ secondsLeft: number; opLabel: string } | null>(null);

    const displayError = propError || localError;

    const AUTO_WAIT_SECONDS = 60;
    const AUTO_WAIT_POLL_MS = 2000;

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setLocalError(null);
        setBusyPrompt(null);
        setWaiting(null);

        if (!email.trim()) { setLocalError('Please enter your email address'); return; }
        if (!password)     { setLocalError('Please enter your password'); return; }
        if (password.length < 6) { setLocalError('Password must be at least 6 characters'); return; }

        await attemptLoginWithWait();
    };

    /**
     * Login with auto-wait on 409 SESSION_BUSY.  Polls every 2s for up to
     * 60s while the previous session finishes its in-flight transaction,
     * then either succeeds quietly or surfaces the force-takeover modal.
     */
    const attemptLoginWithWait = async () => {
        const startedAt = Date.now();
        const deadline  = startedAt + AUTO_WAIT_SECONDS * 1000;

        // First attempt.
        let result = await onLogin(email, password);

        while (!result.ok && result.code === 'SESSION_BUSY' && result.sessionBusy && Date.now() < deadline) {
            const op = result.sessionBusy.in_flight?.[0]?.op_label ?? 'an operation';
            setWaiting({
                secondsLeft: Math.max(0, Math.ceil((deadline - Date.now()) / 1000)),
                opLabel:     op,
            });
            await new Promise((r) => setTimeout(r, AUTO_WAIT_POLL_MS));
            result = await onLogin(email, password);
        }

        setWaiting(null);

        if (!result.ok && result.code === 'SESSION_BUSY' && result.sessionBusy) {
            // Still busy after the wait window → fall back to the manual modal.
            setBusyPrompt(result.sessionBusy);
        }
    };

    const handleForceTakeover = async () => {
        setLocalError(null);
        setBusyPrompt(null);
        const result = await onLogin(email, password, { forceTakeover: true });
        if (!result.ok && result.code === 'SESSION_BUSY' && result.sessionBusy) {
            setBusyPrompt(result.sessionBusy);
        }
    };

    return (
        <div style={{
            minHeight: '100vh',
            display: 'flex',
            backgroundColor: '#0a0f1e',
            position: 'relative',
            overflow: 'hidden',
            fontFamily: '"Inter", -apple-system, BlinkMacSystemFont, sans-serif',
        }}>
            {/* Google Fonts */}
            <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&family=Poppins:wght@400;500;600;700;800;900&display=swap');
      `}</style>

            {/* Left Side - Background Image */}
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
                    {/* Dark overlay */}
                    <div style={{
                        position: 'absolute',
                        top: 0,
                        left: 0,
                        right: 0,
                        bottom: 0,
                        background: 'linear-gradient(135deg, rgba(10, 15, 30, 0.88) 0%, rgba(30, 41, 59, 0.78) 100%)',
                    }} />
                </div>

                {/* Content */}
                <div style={{
                    position: 'relative',
                    zIndex: 1,
                    padding: '80px 100px',
                    maxWidth: '750px',
                }}>
                    <h1 style={{
                        fontSize: '58px',
                        fontWeight: '800',
                        color: 'white',
                        lineHeight: 1.1,
                        marginBottom: '28px',
                        letterSpacing: '-2px',
                        fontFamily: '"Poppins", sans-serif',
                        textShadow: '0 4px 20px rgba(0, 0, 0, 0.5)',
                    }}>
                        Supply Chain Management System
                    </h1>

                    <p style={{
                        fontSize: '19px',
                        color: 'rgba(255, 255, 255, 0.92)',
                        lineHeight: 1.7,
                        maxWidth: '560px',
                        textShadow: '0 2px 8px rgba(0, 0, 0, 0.3)',
                        fontWeight: '400',
                    }}>
                        Enterprise-grade inventory planning, real-time analytics, and intelligent demand forecasting for manufacturing excellence.
                    </p>

                    {/* Feature Pills */}
                    <div style={{
                        display: 'flex',
                        gap: '12px',
                        marginTop: '40px',
                        flexWrap: 'wrap',
                    }}>
                        {['Inventory Control', 'MRP Planning', 'Demand Forecasting'].map((feature) => (
                            <span key={feature} style={{
                                padding: '8px 16px',
                                background: 'rgba(255, 255, 255, 0.1)',
                                backdropFilter: 'blur(10px)',
                                borderRadius: '8px',
                                fontSize: '13px',
                                fontWeight: '500',
                                color: 'rgba(255, 255, 255, 0.9)',
                                border: '1px solid rgba(255, 255, 255, 0.15)',
                            }}>
                                {feature}
                            </span>
                        ))}
                    </div>
                </div>
            </div>

            {/* Right Side - Login Form */}
            <div style={{
                width: '520px',
                background: 'white',
                display: 'flex',
                flexDirection: 'column',
                position: 'relative',
                zIndex: 1,
                boxShadow: '-20px 0 60px rgba(0, 0, 0, 0.3)',
            }}>
                {/* Logo Header - Reduced padding */}
                <div style={{
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    padding: '40px 60px 24px',
                    borderBottom: '1px solid #f1f5f9',
                }}>
                    <img
                        src="/logo.png"
                        alt="Autocrat Engineers"
                        style={{
                            width: '240px',
                            height: 'auto',
                            objectFit: 'contain',
                            userSelect: 'none',
                            pointerEvents: 'none',
                            filter: 'drop-shadow(0 2px 8px rgba(0, 0, 0, 0.08))',
                        }}
                    />
                </div>

                {/* Form Container - Tightened spacing */}
                <div style={{
                    flex: 1,
                    display: 'flex',
                    flexDirection: 'column',
                    justifyContent: 'flex-start',
                    padding: '32px 60px 48px',
                }}>
                    {/* System Title Block - No duplicate company name */}
                    <div style={{
                        marginBottom: '24px',
                        textAlign: 'center',
                    }}>
                        {/* Primary Title */}
                        <h2 style={{
                            fontSize: '20px',
                            fontWeight: '600',
                            color: '#1e293b',
                            marginBottom: '8px',
                            letterSpacing: '-0.3px',
                            fontFamily: '"Poppins", sans-serif',
                        }}>
                            U.S Warehouse Management System
                        </h2>
                        {/* Secondary Supporting Line */}
                        <p style={{
                            fontSize: '13px',
                            color: '#475569',
                            fontWeight: '500',
                            lineHeight: 1.5,
                        }}>
                            Your Leading Partner in Precision Manufacturing Excellence
                        </p>
                    </div>

                    {/* Rotating Quote Display - fills vertical space with polish */}
                    <RotatingQuote
                        dataSource="/data/quotes.json"
                        intervalMs={30000}
                        height="72px"
                    />
                    <br></br>
                    <br></br>
                    {/* Instructional Text - Left aligned with form */}
                    <p style={{
                        fontSize: '13px',
                        color: '#94a3b8',
                        fontWeight: '400',
                        marginBottom: '20px',
                        textAlign: 'left',
                    }}>
                        Enter your login credentials to access the System
                    </p>

                    {/* Error Message */}
                    {displayError && !waiting && (
                        <div style={{
                            padding: '12px 14px',
                            marginBottom: '20px',
                            background: '#fef2f2',
                            border: '1px solid #fecaca',
                            borderRadius: '8px',
                            color: '#dc2626',
                            display: 'flex',
                            gap: '10px',
                            alignItems: 'flex-start',
                            fontSize: '13px',
                        }}>
                            <AlertCircle size={16} style={{ flexShrink: 0, marginTop: '1px' }} />
                            <div style={{ fontWeight: '500' }}>{displayError}</div>
                        </div>
                    )}

                    {/* Auto-wait banner: shown while polling for the previous session to finish */}
                    {waiting && (
                        <div style={{
                            padding: '14px 16px',
                            marginBottom: '20px',
                            background: '#fffbeb',
                            border: '1px solid #fde68a',
                            borderRadius: '8px',
                            color: '#92400e',
                            display: 'flex',
                            gap: '12px',
                            alignItems: 'center',
                            fontSize: '13px',
                        }}>
                            <Loader2 size={18} style={{ flexShrink: 0, animation: 'spin 1s linear infinite' }} />
                            <div style={{ lineHeight: 1.4 }}>
                                <div style={{ fontWeight: 600, marginBottom: '2px' }}>
                                    Waiting for previous session to finish…
                                </div>
                                <div style={{ fontSize: '12px', color: '#b45309' }}>
                                    {waiting.opLabel} — will sign in automatically when complete ({waiting.secondsLeft}s remaining).
                                </div>
                            </div>
                        </div>
                    )}

                    {/* Login Form */}
                    <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
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
                                    placeholder="you@company.com"
                                    disabled={isLoading}
                                    style={{
                                        width: '100%',
                                        padding: '14px 16px 14px 48px',
                                        border: '2px solid #e2e8f0',
                                        borderRadius: '10px',
                                        fontSize: '15px',
                                        boxSizing: 'border-box',
                                        transition: 'all 0.2s ease',
                                        fontFamily: 'inherit',
                                        backgroundColor: isLoading ? '#f9fafb' : 'white',
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
                                    placeholder="Enter your password"
                                    disabled={isLoading}
                                    style={{
                                        width: '100%',
                                        padding: '14px 48px',
                                        border: '2px solid #e2e8f0',
                                        borderRadius: '10px',
                                        fontSize: '15px',
                                        boxSizing: 'border-box',
                                        transition: 'all 0.2s ease',
                                        fontFamily: 'inherit',
                                        backgroundColor: isLoading ? '#f9fafb' : 'white',
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

                        <button
                            type="submit"
                            disabled={isLoading}
                            style={{
                                padding: '16px 24px',
                                background: isLoading ? '#94a3b8' : 'linear-gradient(135deg, #b91c1c 0%, #dc2626 100%)',
                                color: 'white',
                                border: 'none',
                                borderRadius: '10px',
                                fontSize: '16px',
                                fontWeight: '600',
                                cursor: isLoading ? 'not-allowed' : 'pointer',
                                transition: 'all 0.3s ease',
                                marginTop: '8px',
                                fontFamily: 'inherit',
                                boxShadow: isLoading ? 'none' : '0 8px 24px rgba(185, 28, 28, 0.35)',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                gap: '10px',
                            }}
                        >
                            {isLoading ? (
                                <>
                                    <Loader2 size={20} style={{ animation: 'spin 1s linear infinite' }} />
                                    Signing in...
                                </>
                            ) : (
                                <>
                                    <LogIn size={20} />
                                    Login to System
                                </>
                            )}

                        </button>
                    </form>

                    {/* Help Text */}
                    <p style={{
                        marginTop: '28px',
                        fontSize: '13px',
                        color: '#94a3b8',
                        textAlign: 'center',
                    }}>
                        Contact your administrator if you need access credentials
                    </p>
                </div>

                {/* Footer */}
                <div style={{
                    padding: '20px 60px',
                    borderTop: '1px solid #f1f5f9',
                    fontSize: '12px',
                    color: '#94a3b8',
                    textAlign: 'center',
                }}>
                    © 2025 Autocrat Engineers. All rights reserved.
                </div>
            </div>

            {/* Force-takeover modal: shown when server returns 409 SESSION_BUSY */}
            {busyPrompt && (
                <div style={{
                    position: 'fixed', inset: 0, zIndex: 1000,
                    background: 'rgba(15, 23, 42, 0.65)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    padding: '24px',
                }}>
                    <div style={{
                        background: 'white', borderRadius: '16px', maxWidth: '480px', width: '100%',
                        padding: '32px', boxShadow: '0 24px 64px rgba(0, 0, 0, 0.4)',
                    }}>
                        <div style={{ display: 'flex', gap: '14px', alignItems: 'flex-start', marginBottom: '16px' }}>
                            <div style={{
                                width: '44px', height: '44px', borderRadius: '12px',
                                background: '#fef3c7', display: 'flex', alignItems: 'center', justifyContent: 'center',
                                flexShrink: 0,
                            }}>
                                <ShieldAlert size={22} style={{ color: '#d97706' }} />
                            </div>
                            <div>
                                <h3 style={{ margin: 0, fontSize: '17px', fontWeight: 700, color: '#0f172a' }}>
                                    Account is busy in another session
                                </h3>
                                <p style={{ margin: '6px 0 0', fontSize: '13px', color: '#475569', lineHeight: 1.5 }}>
                                    A previous sign-in is currently mid-operation. Wait a few seconds for it to finish, or force takeover to abandon it (the takeover will be audit-logged).
                                </p>
                            </div>
                        </div>

                        <div style={{
                            background: '#f8fafc', border: '1px solid #e2e8f0',
                            borderRadius: '10px', padding: '12px 14px', marginBottom: '20px',
                        }}>
                            {busyPrompt.in_flight.length === 0 ? (
                                <div style={{ fontSize: '13px', color: '#64748b' }}>
                                    A live operation lock exists, but no details were reported.
                                </div>
                            ) : busyPrompt.in_flight.map((op, i) => (
                                <div key={i} style={{
                                    display: 'flex', justifyContent: 'space-between', alignItems: 'baseline',
                                    fontSize: '13px', color: '#1e293b',
                                    padding: i === 0 ? '0' : '6px 0 0',
                                }}>
                                    <span style={{ fontWeight: 600 }}>{op.op_label}</span>
                                    <span style={{ fontSize: '12px', color: '#94a3b8' }}>
                                        running {op.age_seconds}s
                                    </span>
                                </div>
                            ))}
                        </div>

                        <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end' }}>
                            <button
                                type="button"
                                onClick={() => setBusyPrompt(null)}
                                disabled={isLoading}
                                style={{
                                    padding: '10px 16px', border: '1px solid #cbd5e1',
                                    borderRadius: '8px', background: 'white', color: '#1e293b',
                                    fontSize: '13px', fontWeight: 600, cursor: isLoading ? 'not-allowed' : 'pointer',
                                }}
                            >
                                Cancel
                            </button>
                            <button
                                type="button"
                                onClick={handleForceTakeover}
                                disabled={isLoading}
                                style={{
                                    padding: '10px 16px', border: 'none',
                                    borderRadius: '8px',
                                    background: isLoading ? '#94a3b8' : 'linear-gradient(135deg, #b91c1c 0%, #dc2626 100%)',
                                    color: 'white', fontSize: '13px', fontWeight: 600,
                                    cursor: isLoading ? 'not-allowed' : 'pointer',
                                    display: 'flex', alignItems: 'center', gap: '8px',
                                }}
                            >
                                {isLoading ? <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} /> : <ShieldAlert size={14} />}
                                Force takeover
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Keyframe animation */}
            <style>{`
        @keyframes spin {
          to { transform: rotate(360deg); }
        }
      `}</style>
        </div>
    );
}

export default LoginPage;
