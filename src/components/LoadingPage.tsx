// ============================================================================
// LOADING PAGE COMPONENT
// Single line supply chain journey - outline style - Full width
// Factory → Truck → Port → Ship/Plane → Warehouse
// ============================================================================

import React, { useEffect, useState } from 'react';

interface LoadingPageProps {
    minDuration?: number;
}

export function LoadingPage({ minDuration = 4000 }: LoadingPageProps) {
    const [progress, setProgress] = useState(0);

    useEffect(() => {
        const interval = setInterval(() => {
            setProgress(prev => {
                if (prev >= 100) {
                    clearInterval(interval);
                    return 100;
                }
                return prev + 0.5;
            });
        }, minDuration / 200);
        return () => clearInterval(interval);
    }, [minDuration]);

    // Calculate positions based on progress
    const truckPos = Math.min(progress * 0.75, 75); // Truck goes 0% to 75%
    const shipPos = progress > 35 ? Math.min((progress - 35) * 0.8, 50) : 0;
    const planePos = progress > 40 ? Math.min((progress - 40) * 1.2, 70) : 0;
    const planeHeight = progress > 40 ? Math.min((progress - 40) * 0.8, 50) : 0;

    return (
        <div style={{
            position: 'fixed',
            inset: 0,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            background: 'linear-gradient(180deg, #f8fafc 0%, #f1f5f9 100%)',
            zIndex: 9999,
            fontFamily: '"Inter", "Segoe UI", system-ui, sans-serif',
        }}>
            <style>{`
        @keyframes smoke {
          0% { transform: translateY(0) scale(1); opacity: 0.5; }
          100% { transform: translateY(-12px) scale(1.4); opacity: 0; }
        }
        @keyframes wheelSpin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
        @keyframes wave {
          0%, 100% { transform: translateY(0); }
          50% { transform: translateY(-2px); }
        }
        @keyframes cloudDrift {
          0%, 100% { transform: translateX(0); opacity: 0.6; }
          50% { transform: translateX(8px); opacity: 0.8; }
        }
        @keyframes factoryPulse {
          0%, 100% { opacity: 0.8; }
          50% { opacity: 1; }
        }
        @keyframes bob {
          0%, 100% { transform: translateY(0) rotate(0deg); }
          25% { transform: translateY(-2px) rotate(1deg); }
          75% { transform: translateY(-1px) rotate(-1deg); }
        }
      `}</style>

            {/* Title */}
            <h1 style={{
                fontSize: '26px',
                fontWeight: 600,
                color: '#1e293b',
                marginBottom: '50px',
                letterSpacing: '-0.5px',
            }}>
                Warehouse Management System
            </h1>

            {/* Main Animation Container - Full Width */}
            <div style={{
                position: 'relative',
                width: '95vw',
                maxWidth: '1400px',
                height: '140px',
                padding: '0 20px',
            }}>
                {/* Base line / Road */}
                <div style={{
                    position: 'absolute',
                    bottom: '35px',
                    left: '20px',
                    right: '20px',
                    height: '2px',
                    background: 'linear-gradient(90deg, #94a3b8, #64748b, #94a3b8)',
                }} />

                {/* Road dashes */}
                <div style={{
                    position: 'absolute',
                    bottom: '38px',
                    left: '20px',
                    right: '20px',
                    height: '1px',
                    background: 'repeating-linear-gradient(90deg, transparent, transparent 20px, #cbd5e1 20px, #cbd5e1 40px)',
                }} />

                {/* ===== FACTORY (Left - Fixed) ===== */}
                <div style={{ position: 'absolute', left: '20px', bottom: '35px', animation: 'factoryPulse 3s ease-in-out infinite' }}>
                    <svg width="60" height="70" viewBox="0 0 60 70" fill="none" stroke="#475569" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                        {/* Building */}
                        <rect x="5" y="30" width="50" height="40" rx="2" />
                        {/* Roof sections */}
                        <path d="M5 30 L20 15 L35 30" />
                        <path d="M25 30 L40 15 L55 30" />
                        {/* Chimney */}
                        <rect x="42" y="5" width="10" height="25" />
                        {/* Door */}
                        <rect x="22" y="50" width="16" height="20" />
                        {/* Windows */}
                        <rect x="10" y="38" width="10" height="10" />
                        <rect x="40" y="38" width="10" height="10" />
                        {/* Smoke puffs */}
                        <circle cx="47" cy="0" r="4" fill="none" style={{ animation: 'smoke 1.5s ease-out infinite' }} />
                        <circle cx="50" cy="-5" r="3" fill="none" style={{ animation: 'smoke 2s ease-out infinite', animationDelay: '0.4s' }} />
                        <circle cx="44" cy="-3" r="3" fill="none" style={{ animation: 'smoke 1.8s ease-out infinite', animationDelay: '0.8s' }} />
                    </svg>
                </div>

                {/* ===== TRUCK (Moving LEFT to RIGHT - cab faces right) ===== */}
                <div style={{
                    position: 'absolute',
                    left: `calc(80px + ${truckPos}%)`,
                    bottom: '35px',
                    transition: 'left 0.15s linear',
                }}>
                    <svg width="55" height="35" viewBox="0 0 55 35" fill="none" stroke="#475569" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                        {/* Cargo container (back/left side) */}
                        <rect x="2" y="5" width="32" height="20" rx="2" />
                        {/* Cabin (front/right side - direction of travel) */}
                        <path d="M34 8 L34 25 L50 25 L50 15 L45 8 Z" />
                        {/* Windshield */}
                        <path d="M45 10 L50 15 L50 20 L45 20 Z" fill="none" />
                        {/* Headlight */}
                        <circle cx="49" cy="22" r="2" />
                        {/* Wheels - spinning when moving */}
                        <g style={{ transformOrigin: '12px 30px', animation: progress > 0 && progress < 80 ? 'wheelSpin 0.25s linear infinite' : 'none' }}>
                            <circle cx="12" cy="30" r="6" />
                            <circle cx="12" cy="30" r="2" />
                            <line x1="12" y1="24" x2="12" y2="36" />
                            <line x1="6" y1="30" x2="18" y2="30" />
                        </g>
                        <g style={{ transformOrigin: '42px 30px', animation: progress > 0 && progress < 80 ? 'wheelSpin 0.25s linear infinite' : 'none' }}>
                            <circle cx="42" cy="30" r="6" />
                            <circle cx="42" cy="30" r="2" />
                            <line x1="42" y1="24" x2="42" y2="36" />
                            <line x1="36" y1="30" x2="48" y2="30" />
                        </g>
                        {/* Exhaust smoke (behind truck - left side) */}
                        {progress > 0 && progress < 80 && (
                            <>
                                <circle cx="-2" cy="22" r="3" fill="none" style={{ animation: 'smoke 0.6s ease-out infinite' }} />
                                <circle cx="-5" cy="20" r="2" fill="none" style={{ animation: 'smoke 0.8s ease-out infinite', animationDelay: '0.2s' }} />
                            </>
                        )}
                    </svg>
                </div>

                {/* ===== PORT / DOCK (Center) ===== */}
                <div style={{ position: 'absolute', left: '42%', bottom: '35px' }}>
                    <svg width="80" height="60" viewBox="0 0 80 60" fill="none" stroke="#475569" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                        {/* Dock platform */}
                        <rect x="0" y="45" width="80" height="8" />
                        {/* Crane tower */}
                        <rect x="35" y="5" width="6" height="40" />
                        {/* Crane arm */}
                        <path d="M5 5 L70 5" />
                        <path d="M8 5 L8 3 L12 3 L12 5" />
                        <path d="M65 5 L65 3 L69 3 L69 5" />
                        {/* Crane cable */}
                        <line x1="20" y1="5" x2="20" y2="28" strokeDasharray="3,2" />
                        <rect x="15" y="28" width="10" height="8" /> {/* Container being lifted */}
                        {/* Stacked containers */}
                        <rect x="5" y="33" width="15" height="12" />
                        <rect x="60" y="33" width="15" height="12" />
                        <rect x="8" y="22" width="12" height="11" />
                    </svg>
                </div>

                {/* ===== SHIP (Moving right from port) ===== */}
                <div style={{
                    position: 'absolute',
                    left: `calc(48% + ${shipPos}px)`,
                    bottom: '20px',
                    transition: 'left 0.2s linear',
                    opacity: progress > 35 ? 1 : 0.3,
                    animation: progress > 35 ? 'bob 2s ease-in-out infinite' : 'none',
                }}>
                    <svg width="60" height="40" viewBox="0 0 60 40" fill="none" stroke="#475569" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                        {/* Hull */}
                        <path d="M5 22 L12 35 L48 35 L55 22 Z" />
                        {/* Deck */}
                        <rect x="12" y="16" width="36" height="7" />
                        {/* Bridge/Cabin */}
                        <rect x="40" y="5" width="10" height="12" />
                        <rect x="42" y="7" width="3" height="3" /> {/* Window */}
                        {/* Containers on deck */}
                        <rect x="14" y="8" width="10" height="9" />
                        <rect x="26" y="8" width="10" height="9" />
                        {/* Funnel with smoke */}
                        <rect x="44" y="0" width="4" height="6" />
                        {progress > 35 && (
                            <>
                                <circle cx="46" cy="-4" r="3" fill="none" style={{ animation: 'smoke 1.2s ease-out infinite' }} />
                                <circle cx="48" cy="-7" r="2" fill="none" style={{ animation: 'smoke 1.5s ease-out infinite', animationDelay: '0.3s' }} />
                            </>
                        )}
                        {/* Water waves below ship */}
                        {progress > 35 && (
                            <g style={{ animation: 'wave 1s ease-in-out infinite' }}>
                                <path d="M0 38 Q8 35 16 38 T32 38 T48 38 T60 38" strokeWidth="1" />
                            </g>
                        )}
                    </svg>
                </div>

                {/* ===== PLANE (Flying up and right) ===== */}
                <div style={{
                    position: 'absolute',
                    left: `calc(52% + ${planePos}px)`,
                    bottom: `${50 + planeHeight}px`,
                    transition: 'all 0.2s linear',
                    opacity: progress > 40 ? 1 : 0.3,
                }}>
                    <svg width="50" height="30" viewBox="0 0 50 30" fill="none" stroke="#475569" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                        {/* Fuselage */}
                        <ellipse cx="25" cy="15" rx="20" ry="5" />
                        {/* Nose */}
                        <path d="M45 15 L50 15" />
                        {/* Cockpit */}
                        <ellipse cx="40" cy="14" rx="4" ry="3" />
                        {/* Wings */}
                        <path d="M18 15 L8 5 L22 5 L28 13" />
                        <path d="M18 15 L8 25 L22 25 L28 17" />
                        {/* Tail */}
                        <path d="M6 15 L2 8 L10 8" />
                        <path d="M7 15 L4 11" />
                        <path d="M7 15 L4 19" />
                        {/* Engines */}
                        <ellipse cx="15" cy="8" rx="4" ry="2" />
                        <ellipse cx="15" cy="22" rx="4" ry="2" />
                    </svg>
                    {/* Clouds */}
                    {progress > 50 && (
                        <svg style={{ position: 'absolute', top: '-10px', right: '-30px', animation: 'cloudDrift 3s ease-in-out infinite' }} width="40" height="20" viewBox="0 0 40 20" fill="none" stroke="#94a3b8" strokeWidth="1">
                            <ellipse cx="20" cy="14" rx="15" ry="6" />
                            <ellipse cx="12" cy="10" rx="8" ry="5" />
                            <ellipse cx="28" cy="10" rx="7" ry="4" />
                        </svg>
                    )}
                </div>

                {/* ===== WAREHOUSE (Right - Fixed) ===== */}
                <div style={{ position: 'absolute', right: '20px', bottom: '35px' }}>
                    <svg width="70" height="65" viewBox="0 0 70 65" fill="none" stroke="#475569" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                        {/* Building */}
                        <rect x="5" y="22" width="60" height="43" rx="2" />
                        {/* Roof */}
                        <path d="M0 22 L35 5 L70 22" />
                        {/* Large roller door */}
                        <rect x="20" y="40" width="30" height="25" />
                        {/* Door horizontal lines */}
                        <line x1="20" y1="48" x2="50" y2="48" />
                        <line x1="20" y1="56" x2="50" y2="56" />
                        {/* WMS Sign */}
                        <rect x="25" y="28" width="20" height="10" rx="1" />
                        <text x="35" y="36" textAnchor="middle" fontSize="7" fill="#475569" stroke="none" fontWeight="600">WMS</text>
                        {/* Loading dock indicator */}
                        {progress > 80 && (
                            <>
                                <rect x="8" y="52" width="8" height="8" strokeWidth="1.5" />
                                <rect x="54" y="52" width="8" height="8" strokeWidth="1.5" />
                                <rect x="10" y="44" width="6" height="6" strokeWidth="1" />
                            </>
                        )}
                    </svg>
                </div>
            </div>

            {/* Progress info */}
            <div style={{ marginTop: '45px', textAlign: 'center' }}>
                <div style={{
                    width: '350px',
                    height: '4px',
                    background: '#e2e8f0',
                    borderRadius: '2px',
                    overflow: 'hidden',
                    marginBottom: '14px',
                }}>
                    <div style={{
                        height: '100%',
                        width: `${progress}%`,
                        background: 'linear-gradient(90deg, #475569, #64748b)',
                        borderRadius: '2px',
                        transition: 'width 0.1s linear',
                    }} />
                </div>
                <p style={{ fontSize: '15px', color: '#64748b' }}>
                    {progress < 20 ? 'Manufacturing...' :
                        progress < 40 ? 'Loading truck...' :
                            progress < 55 ? 'Arrived at port...' :
                                progress < 75 ? 'Shipping cargo...' :
                                    progress < 90 ? 'Delivering to warehouse...' : 'Complete!'}
                    <span style={{ marginLeft: '10px', fontWeight: 600, color: '#334155' }}>{Math.round(progress)}%</span>
                </p>
            </div>

            {/* Bottom branding */}
            <p style={{
                position: 'absolute',
                bottom: '20px',
                fontSize: '11px',
                color: '#94a3b8',
                letterSpacing: '1.5px',
                textTransform: 'uppercase',
            }}>
                Autocrat Engineers • Supply Chain Excellence
            </p>
        </div>
    );
}

export default LoadingPage;
