import React, { CSSProperties } from 'react';

// Enterprise Card Component
interface CardProps {
  children?: React.ReactNode;
  hover?: boolean;
  className?: string;
  style?: CSSProperties;
}

export function Card({ children, hover = false, className = '', style = {} }: CardProps) {
  const [isHovered, setIsHovered] = React.useState(false);

  return (
    <div
      className={className}
      style={{
        backgroundColor: 'var(--card-background)',
        border: '1px solid var(--border-color)',
        borderRadius: 'var(--border-radius-lg)',
        padding: '24px',
        boxShadow: isHovered && hover ? 'var(--shadow-md)' : 'var(--shadow-sm)',
        transition: 'all var(--transition-fast)',
        ...style,
      }}
      onMouseEnter={() => hover && setIsHovered(true)}
      onMouseLeave={() => hover && setIsHovered(false)}
    >
      {children}
    </div>
  );
}

// Enterprise Button Component
interface ButtonProps {
  children: React.ReactNode;
  variant?: 'primary' | 'secondary' | 'tertiary' | 'danger';
  size?: 'sm' | 'md' | 'lg';
  disabled?: boolean;
  onClick?: () => void;
  type?: 'button' | 'submit' | 'reset';
  icon?: React.ReactNode;
  fullWidth?: boolean;
  style?: CSSProperties;
}

export function Button({
  children,
  variant = 'primary',
  size = 'md',
  disabled = false,
  onClick,
  type = 'button',
  icon,
  fullWidth = false,
  style = {},
}: ButtonProps) {
  const [isHovered, setIsHovered] = React.useState(false);

  const variantStyles: Record<string, CSSProperties> = {
    primary: {
      backgroundColor: isHovered && !disabled ? 'var(--enterprise-primary-hover)' : 'var(--enterprise-primary)',
      color: 'white',
      border: 'none',
    },
    secondary: {
      backgroundColor: isHovered && !disabled ? 'rgba(30, 58, 138, 0.05)' : 'transparent',
      color: 'var(--enterprise-primary)',
      border: '1px solid var(--enterprise-primary)',
    },
    tertiary: {
      backgroundColor: isHovered && !disabled ? 'var(--enterprise-gray-200)' : 'var(--enterprise-gray-100)',
      color: 'var(--enterprise-gray-700)',
      border: 'none',
    },
    danger: {
      backgroundColor: isHovered && !disabled ? '#b91c1c' : 'var(--enterprise-error)',
      color: 'white',
      border: 'none',
    },
  };

  const sizeStyles: Record<string, CSSProperties> = {
    sm: {
      padding: '6px 12px',
      fontSize: 'var(--font-size-sm)',
    },
    md: {
      padding: '10px 20px',
      fontSize: 'var(--font-size-base)',
    },
    lg: {
      padding: '14px 28px',
      fontSize: 'var(--font-size-lg)',
    },
  };

  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: '8px',
        borderRadius: 'var(--border-radius-md)',
        fontWeight: 'var(--font-weight-medium)',
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.5 : 1,
        transition: 'all var(--transition-fast)',
        width: fullWidth ? '100%' : 'auto',
        boxShadow: isHovered && !disabled ? 'var(--shadow-md)' : 'none',
        ...variantStyles[variant],
        ...sizeStyles[size],
        ...style,
      }}
    >
      {icon}
      {children}
    </button>
  );
}

// Enterprise Badge Component
interface BadgeProps {
  children: React.ReactNode;
  variant?: 'success' | 'warning' | 'error' | 'info' | 'neutral';
  style?: CSSProperties;
}

export function Badge({ children, variant = 'neutral', style = {} }: BadgeProps) {
  const variantStyles: Record<string, CSSProperties> = {
    success: {
      backgroundColor: 'var(--enterprise-success-bg)',
      color: 'var(--enterprise-success)',
    },
    warning: {
      backgroundColor: 'var(--enterprise-warning-bg)',
      color: 'var(--enterprise-warning)',
    },
    error: {
      backgroundColor: 'var(--enterprise-error-bg)',
      color: 'var(--enterprise-error)',
    },
    info: {
      backgroundColor: 'var(--enterprise-info-bg)',
      color: 'var(--enterprise-info)',
    },
    neutral: {
      backgroundColor: 'var(--enterprise-gray-100)',
      color: 'var(--enterprise-gray-700)',
    },
  };

  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        padding: '4px 12px',
        borderRadius: '12px',
        fontSize: 'var(--font-size-xs)',
        fontWeight: 'var(--font-weight-semibold)',
        textTransform: 'uppercase',
        letterSpacing: '0.5px',
        ...variantStyles[variant],
        ...style,
      }}
    >
      {children}
    </span>
  );
}

// Enterprise Input Component
interface InputProps {
  type?: string;
  value: string | number;
  onChange?: (e: React.ChangeEvent<HTMLInputElement>) => void;
  placeholder?: string;
  required?: boolean;
  disabled?: boolean;
  min?: number;
  max?: number;
  step?: number;
  style?: CSSProperties;
}

export function Input({
  type = 'text',
  value,
  onChange,
  placeholder,
  required = false,
  disabled = false,
  min,
  max,
  step,
  style = {},
}: InputProps) {
  const [isFocused, setIsFocused] = React.useState(false);

  return (
    <input
      type={type}
      value={value}
      onChange={onChange}
      placeholder={placeholder}
      required={required}
      disabled={disabled}
      min={min}
      max={max}
      step={step}
      onFocus={() => setIsFocused(true)}
      onBlur={() => setIsFocused(false)}
      style={{
        width: '100%',
        padding: '8px 12px',
        fontSize: 'var(--font-size-base)',
        fontWeight: 'var(--font-weight-normal)',
        color: 'var(--foreground)',
        backgroundColor: 'var(--background)',
        border: `1px solid ${isFocused ? 'var(--enterprise-primary)' : 'var(--border-color)'}`,
        borderRadius: 'var(--border-radius-md)',
        outline: 'none',
        transition: 'all var(--transition-fast)',
        boxShadow: isFocused ? '0 0 0 3px rgba(30, 58, 138, 0.1)' : 'none',
        ...style,
      }}
    />
  );
}

// Enterprise Select Component
interface SelectProps {
  value: string;
  onChange: (e: React.ChangeEvent<HTMLSelectElement>) => void;
  children: React.ReactNode;
  required?: boolean;
  disabled?: boolean;
  style?: CSSProperties;
}

export function Select({
  value,
  onChange,
  children,
  required = false,
  disabled = false,
  style = {},
}: SelectProps) {
  const [isFocused, setIsFocused] = React.useState(false);

  return (
    <select
      value={value}
      onChange={onChange}
      required={required}
      disabled={disabled}
      onFocus={() => setIsFocused(true)}
      onBlur={() => setIsFocused(false)}
      style={{
        width: '100%',
        padding: '8px 12px',
        fontSize: 'var(--font-size-base)',
        fontWeight: 'var(--font-weight-normal)',
        color: 'var(--foreground)',
        backgroundColor: 'var(--background)',
        border: `1px solid ${isFocused ? 'var(--enterprise-primary)' : 'var(--border-color)'}`,
        borderRadius: 'var(--border-radius-md)',
        outline: 'none',
        transition: 'all var(--transition-fast)',
        boxShadow: isFocused ? '0 0 0 3px rgba(30, 58, 138, 0.1)' : 'none',
        cursor: 'pointer',
        ...style,
      }}
    >
      {children}
    </select>
  );
}

// Enterprise Textarea Component
interface TextareaProps {
  value: string;
  onChange: (e: React.ChangeEvent<HTMLTextAreaElement>) => void;
  placeholder?: string;
  rows?: number;
  required?: boolean;
  disabled?: boolean;
  style?: CSSProperties;
}

export function Textarea({
  value,
  onChange,
  placeholder,
  rows = 3,
  required = false,
  disabled = false,
  style = {},
}: TextareaProps) {
  const [isFocused, setIsFocused] = React.useState(false);

  return (
    <textarea
      value={value}
      onChange={onChange}
      placeholder={placeholder}
      rows={rows}
      required={required}
      disabled={disabled}
      onFocus={() => setIsFocused(true)}
      onBlur={() => setIsFocused(false)}
      style={{
        width: '100%',
        padding: '8px 12px',
        fontSize: 'var(--font-size-base)',
        fontWeight: 'var(--font-weight-normal)',
        color: 'var(--foreground)',
        backgroundColor: 'var(--background)',
        border: `1px solid ${isFocused ? 'var(--enterprise-primary)' : 'var(--border-color)'}`,
        borderRadius: 'var(--border-radius-md)',
        outline: 'none',
        transition: 'all var(--transition-fast)',
        boxShadow: isFocused ? '0 0 0 3px rgba(30, 58, 138, 0.1)' : 'none',
        resize: 'vertical',
        fontFamily: 'var(--font-family-primary)',
        ...style,
      }}
    />
  );
}

// Enterprise Label Component
interface LabelProps {
  children: React.ReactNode;
  required?: boolean;
  style?: CSSProperties;
}

export function Label({ children, required = false, style = {} }: LabelProps) {
  return (
    <label
      style={{
        display: 'block',
        fontSize: 'var(--font-size-sm)',
        fontWeight: 'var(--font-weight-medium)',
        color: 'var(--enterprise-gray-700)',
        marginBottom: '8px',
        ...style,
      }}
    >
      {children}
      {required && <span style={{ color: 'var(--enterprise-error)', marginLeft: '4px' }}>*</span>}
    </label>
  );
}

// Enterprise Modal Component
interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  maxWidth?: string;
}

export function Modal({ isOpen, onClose, title, children, maxWidth = '600px' }: ModalProps) {
  if (!isOpen) return null;

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        backgroundColor: 'rgba(0, 0, 0, 0.5)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1000,
        padding: '16px',
      }}
      onClick={onClose}
    >
      <div
        style={{
          backgroundColor: 'var(--card-background)',
          borderRadius: 'var(--border-radius-lg)',
          boxShadow: 'var(--shadow-xl)',
          maxWidth,
          width: '100%',
          maxHeight: '90vh',
          overflow: 'auto',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div
          style={{
            padding: '24px',
            borderBottom: '1px solid var(--border-color)',
            position: 'sticky',
            top: 0,
            backgroundColor: 'var(--card-background)',
          }}
        >
          <h2
            style={{
              fontSize: 'var(--font-size-2xl)',
              fontWeight: 'var(--font-weight-semibold)',
              color: 'var(--enterprise-gray-900)',
              margin: 0,
            }}
          >
            {title}
          </h2>
        </div>
        <div style={{ padding: '24px' }}>{children}</div>
      </div>
    </div>
  );
}

// Enterprise Loading Spinner
export function LoadingSpinner({ size = 48, message }: { size?: number; message?: string }) {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: '200px',
        gap: '16px',
      }}
    >
      <div
        style={{
          width: `${size}px`,
          height: `${size}px`,
          border: '4px solid var(--enterprise-gray-200)',
          borderTopColor: 'var(--enterprise-primary)',
          borderRadius: '50%',
          animation: 'spin 1s linear infinite',
        }}
      />
      {message && (
        <p style={{
          fontSize: '14px',
          fontWeight: 500,
          color: 'var(--enterprise-gray-600)',
          margin: 0,
        }}>
          {message}
        </p>
      )}
      <style>{`
        @keyframes spin {
          to { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
}

// Module-specific Premium Loading State
// Shows a branded loader with module name, shimmer skeletons, and fade-in animation
interface ModuleLoaderProps {
  moduleName: string;
  icon?: React.ReactNode;
}

export function ModuleLoader({ moduleName, icon }: ModuleLoaderProps) {
  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      gap: '24px',
      animation: 'moduleLoaderFadeIn 0.3s ease-out',
    }}>
      <style>{`
        @keyframes moduleLoaderFadeIn {
          from { opacity: 0; transform: translateY(8px); }
          to { opacity: 1; transform: translateY(0); }
        }
        @keyframes moduleLoaderSpin {
          to { transform: rotate(360deg); }
        }
        @keyframes moduleLoaderShimmer {
          0% { background-position: -200% 0; }
          100% { background-position: 200% 0; }
        }
        @keyframes moduleLoaderPulse {
          0%, 100% { opacity: 0.6; }
          50% { opacity: 1; }
        }
      `}</style>

      {/* Summary Card Skeletons */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '16px' }}>
        {[0, 1, 2, 3].map(i => (
          <div key={i} style={{
            backgroundColor: 'var(--card-background, white)',
            border: '1px solid var(--enterprise-gray-200, #e5e7eb)',
            borderRadius: '12px',
            padding: '20px 24px',
            boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
          }}>
            <div style={{
              height: '12px',
              width: '60%',
              borderRadius: '6px',
              marginBottom: '12px',
              background: 'linear-gradient(90deg, var(--enterprise-gray-100, #f3f4f6) 25%, var(--enterprise-gray-200, #e5e7eb) 50%, var(--enterprise-gray-100, #f3f4f6) 75%)',
              backgroundSize: '200% 100%',
              animation: `moduleLoaderShimmer 1.5s ease-in-out infinite`,
              animationDelay: `${i * 0.15}s`,
            }} />
            <div style={{
              height: '28px',
              width: '40%',
              borderRadius: '6px',
              background: 'linear-gradient(90deg, var(--enterprise-gray-100, #f3f4f6) 25%, var(--enterprise-gray-200, #e5e7eb) 50%, var(--enterprise-gray-100, #f3f4f6) 75%)',
              backgroundSize: '200% 100%',
              animation: `moduleLoaderShimmer 1.5s ease-in-out infinite`,
              animationDelay: `${i * 0.15 + 0.1}s`,
            }} />
          </div>
        ))}
      </div>

      {/* Filter Bar Skeleton */}
      <div style={{
        backgroundColor: 'var(--card-background, white)',
        border: '1px solid var(--enterprise-gray-200, #e5e7eb)',
        borderRadius: '12px',
        padding: '16px 20px',
        display: 'flex',
        gap: '12px',
        alignItems: 'center',
      }}>
        <div style={{
          height: '36px',
          flex: 1,
          maxWidth: '300px',
          borderRadius: '8px',
          background: 'linear-gradient(90deg, var(--enterprise-gray-100, #f3f4f6) 25%, var(--enterprise-gray-200, #e5e7eb) 50%, var(--enterprise-gray-100, #f3f4f6) 75%)',
          backgroundSize: '200% 100%',
          animation: 'moduleLoaderShimmer 1.5s ease-in-out infinite 0.2s',
        }} />
        {[0, 1, 2].map(i => (
          <div key={i} style={{
            height: '36px',
            width: '100px',
            borderRadius: '8px',
            background: 'linear-gradient(90deg, var(--enterprise-gray-100, #f3f4f6) 25%, var(--enterprise-gray-200, #e5e7eb) 50%, var(--enterprise-gray-100, #f3f4f6) 75%)',
            backgroundSize: '200% 100%',
            animation: `moduleLoaderShimmer 1.5s ease-in-out infinite ${0.3 + i * 0.1}s`,
          }} />
        ))}
      </div>

      {/* Table Skeleton + Loading Message */}
      <div style={{
        backgroundColor: 'var(--card-background, white)',
        border: '1px solid var(--enterprise-gray-200, #e5e7eb)',
        borderRadius: '12px',
        overflow: 'hidden',
        boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
      }}>
        {/* Table Header Skeleton */}
        <div style={{
          display: 'flex',
          gap: '0',
          padding: '14px 20px',
          backgroundColor: 'var(--enterprise-gray-50, #f9fafb)',
          borderBottom: '2px solid var(--enterprise-gray-200, #e5e7eb)',
        }}>
          {[120, 90, 180, 150, 80, 110].map((w, i) => (
            <div key={i} style={{
              height: '12px',
              width: `${w}px`,
              marginRight: '24px',
              borderRadius: '4px',
              background: 'linear-gradient(90deg, var(--enterprise-gray-200, #e5e7eb) 25%, var(--enterprise-gray-300, #d1d5db) 50%, var(--enterprise-gray-200, #e5e7eb) 75%)',
              backgroundSize: '200% 100%',
              animation: `moduleLoaderShimmer 1.5s ease-in-out infinite ${0.4 + i * 0.08}s`,
            }} />
          ))}
        </div>

        {/* Loading Indicator */}
        <div style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '60px 20px',
          gap: '16px',
        }}>
          <div style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: '56px',
            height: '56px',
            borderRadius: '16px',
            backgroundColor: 'rgba(30, 58, 138, 0.06)',
            animation: 'moduleLoaderPulse 2s ease-in-out infinite',
          }}>
            {icon || (
              <div style={{
                width: '28px',
                height: '28px',
                border: '3px solid var(--enterprise-gray-200, #e5e7eb)',
                borderTopColor: 'var(--enterprise-primary, #1e3a8a)',
                borderRadius: '50%',
                animation: 'moduleLoaderSpin 0.8s linear infinite',
              }} />
            )}
          </div>
          <div style={{ textAlign: 'center' }}>
            <p style={{
              fontSize: '15px',
              fontWeight: 600,
              color: 'var(--enterprise-gray-800, #1f2937)',
              margin: '0 0 4px 0',
            }}>
              Loading {moduleName}…
            </p>
            <p style={{
              fontSize: '13px',
              color: 'var(--enterprise-gray-500, #6b7280)',
              margin: 0,
            }}>
              Fetching latest data from the server
            </p>
          </div>
        </div>

        {/* Row Skeletons */}
        {[0, 1, 2, 3, 4].map(i => (
          <div key={i} style={{
            display: 'flex',
            gap: '0',
            padding: '14px 20px',
            borderTop: '1px solid var(--enterprise-gray-100, #f3f4f6)',
            opacity: 1 - i * 0.15,
          }}>
            {[100, 70, 160, 130, 60, 90].map((w, j) => (
              <div key={j} style={{
                height: '14px',
                width: `${w}px`,
                marginRight: '24px',
                borderRadius: '4px',
                background: 'linear-gradient(90deg, var(--enterprise-gray-100, #f3f4f6) 25%, var(--enterprise-gray-200, #e5e7eb) 50%, var(--enterprise-gray-100, #f3f4f6) 75%)',
                backgroundSize: '200% 100%',
                animation: `moduleLoaderShimmer 1.5s ease-in-out infinite ${0.5 + i * 0.1 + j * 0.05}s`,
              }} />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

// Enterprise Empty State
interface EmptyStateProps {
  icon: React.ReactNode;
  title: string;
  description?: string;
  action?: {
    label: string;
    onClick: () => void;
  };
}

export function EmptyState({ icon, title, description, action }: EmptyStateProps) {
  return (
    <div
      style={{
        textAlign: 'center',
        padding: '48px 24px',
      }}
    >
      <div style={{ marginBottom: '16px', color: 'var(--enterprise-gray-400)' }}>
        {icon}
      </div>
      <h3
        style={{
          fontSize: 'var(--font-size-lg)',
          fontWeight: 'var(--font-weight-semibold)',
          color: 'var(--enterprise-gray-900)',
          marginBottom: '8px',
        }}
      >
        {title}
      </h3>
      {description && (
        <p
          style={{
            fontSize: 'var(--font-size-base)',
            color: 'var(--enterprise-gray-600)',
            marginBottom: action ? '16px' : 0,
          }}
        >
          {description}
        </p>
      )}
      {action && (
        <Button onClick={action.onClick} variant="primary">
          {action.label}
        </Button>
      )}
    </div>
  );
}
