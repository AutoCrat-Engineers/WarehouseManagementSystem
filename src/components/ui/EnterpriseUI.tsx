import React, { CSSProperties } from 'react';

// Enterprise Card Component
interface CardProps {
  children: React.ReactNode;
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
export function LoadingSpinner({ size = 48 }: { size?: number }) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: '200px',
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
      <style>{`
        @keyframes spin {
          to { transform: rotate(360deg); }
        }
      `}</style>
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
