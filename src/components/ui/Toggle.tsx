interface ToggleProps {
  on: boolean;
  onChange: (value: boolean) => void;
  disabled?: boolean;
  label?: string;
}

export function Toggle({ on, onChange, disabled, label }: ToggleProps) {
  return (
    <button
      onClick={() => !disabled && onChange(!on)}
      disabled={disabled}
      aria-label={label}
      aria-pressed={on}
      style={{
        width: 40,
        height: 22,
        borderRadius: '999px',
        border: 'none',
        cursor: disabled ? 'not-allowed' : 'pointer',
        background: on ? '#2563eb' : 'var(--gray-300)',
        position: 'relative',
        flexShrink: 0,
        transition: 'background 0.2s',
        opacity: disabled ? 0.5 : 1,
      }}
    >
      <span
        style={{
          position: 'absolute',
          top: 2,
          left: on ? 20 : 2,
          width: 18,
          height: 18,
          borderRadius: '50%',
          background: '#fff',
          boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
          transition: 'left 0.2s',
        }}
      />
    </button>
  );
}
