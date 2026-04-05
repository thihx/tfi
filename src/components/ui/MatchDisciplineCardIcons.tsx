import type { CSSProperties } from 'react';

const ABSOLUTE_MAX_ICONS = 24;

/** Shown chips before "+N" — avoids long yellow/red strips when count is high */
const DEFAULT_MAX_VISIBLE = 5;

function MiniCardIcon({ variant }: { variant: 'yellow' | 'red' }) {
  return (
    <span
      style={{
        display: 'inline-block',
        width: 8,
        height: 10,
        borderRadius: 2,
        background: variant === 'yellow' ? '#f5c518' : '#e53935',
        flexShrink: 0,
        boxShadow: '0 0 0 1px rgba(0,0,0,0.06)',
      }}
      aria-hidden
    />
  );
}

export type DisciplineCardIconsProps = {
  variant: 'yellow' | 'red';
  count: number;
  /** Generation counter from live flash map; drives remount + flash class */
  flashGen: number;
  style?: CSSProperties;
  /** Max chip icons before showing "+N" (default 5) */
  maxVisible?: number;
};

/**
 * One small card-shaped chip per card, up to maxVisible; overflow as "+N".
 * Full count stays in title/aria-label.
 */
export function DisciplineCardIcons({ variant, count, flashGen, style, maxVisible = DEFAULT_MAX_VISIBLE }: DisciplineCardIconsProps) {
  const total = Math.max(0, Math.min(count, ABSOLUTE_MAX_ICONS));
  if (total === 0) return null;
  const cap = Math.min(total, Math.max(1, maxVisible));
  const overflow = total > cap ? total - cap : 0;
  const label = `${count} ${variant === 'yellow' ? 'yellow' : 'red'} card(s)`;
  return (
    <span
      className={flashGen ? (variant === 'yellow' ? 'flash-yellow-card' : 'flash-red-card') : undefined}
      title={label}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 2,
        flexWrap: 'nowrap',
        maxWidth: '100%',
        ...style,
      }}
      aria-label={label}
    >
      {Array.from({ length: cap }, (_, i) => (
        <MiniCardIcon key={i} variant={variant} />
      ))}
      {overflow > 0 ? (
        <span
          style={{
            fontSize: 9,
            fontWeight: 700,
            color: 'var(--gray-500)',
            lineHeight: 1,
            marginLeft: 1,
            flexShrink: 0,
          }}
          aria-hidden
        >
          +
          {overflow}
        </span>
      ) : null}
    </span>
  );
}
