import { useEffect, useState } from 'react';

interface LoginScreenProps {
  onLogin: () => void;
  error: string;
}

const STATS = [
  { label: '200+ Leagues' },
  { label: '24/7 Monitoring' },
];

const FEATURES = [
  {
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/>
      </svg>
    ),
    title: 'Data, Not Guesswork',
    desc: 'Every bet is backed by live stats and AI analysis — no gut feeling.',
  },
  {
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="22 7 13.5 15.5 8.5 10.5 2 17"/><polyline points="16 7 22 7 22 13"/>
      </svg>
    ),
    title: 'Grow Your Bankroll',
    desc: 'Smart stake sizing protects your money and builds steady returns.',
  },
  {
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
      </svg>
    ),
    title: 'No Match Watching',
    desc: 'TFI watches every live match for you. No more sitting through 90 minutes.',
  },
  {
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>
      </svg>
    ),
    title: 'Bet at the Right Moment',
    desc: 'Set triggers on goals, cards, or match time — AI alerts you instantly so you never miss the window.',
  },
  {
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/>
      </svg>
    ),
    title: 'Get Your Time Back',
    desc: 'Stop watching matches. Do what you love — your AI never takes a break.',
  },
];

const TrendIcon = ({ size = 22 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="22 7 13.5 15.5 8.5 10.5 2 17"/>
    <polyline points="16 7 22 7 22 13"/>
  </svg>
);

export function LoginScreen({ onLogin, error }: LoginScreenProps) {
  const [isMobile, setIsMobile] = useState(() => window.innerWidth < 768);

  useEffect(() => {
    const handler = () => setIsMobile(window.innerWidth < 768);
    window.addEventListener('resize', handler);
    return () => window.removeEventListener('resize', handler);
  }, []);

  return (
    <div style={{
      display: 'flex',
      minHeight: '100vh',
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
      background: '#111827',
      flexDirection: isMobile ? 'column' : 'row',
    }}>

      {/* ── LEFT PANEL (hidden on mobile) ─────────────────── */}
      {!isMobile && (
        <div style={{
          flex: '1 1 55%',
          background: '#111827',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          padding: '60px 64px',
          position: 'relative',
          overflow: 'hidden',
          borderRight: '1px solid rgba(255,255,255,0.06)',
        }}>
          {/* Subtle grid */}
          <div style={{
            position: 'absolute', inset: 0,
            backgroundImage: `
              linear-gradient(rgba(255,255,255,0.02) 1px, transparent 1px),
              linear-gradient(90deg, rgba(255,255,255,0.02) 1px, transparent 1px)
            `,
            backgroundSize: '48px 48px',
            pointerEvents: 'none',
          }} />
          {/* Glow */}
          <div style={{
            position: 'absolute', top: '-100px', right: '-60px',
            width: '320px', height: '320px', borderRadius: '50%',
            background: 'radial-gradient(circle, rgba(245,158,11,0.08) 0%, transparent 70%)',
            pointerEvents: 'none',
          }} />

          {/* Headline */}
          <div style={{ position: 'relative', marginBottom: '28px' }}>
            <h1 style={{
              color: '#f9fafb', fontSize: '34px', fontWeight: 800,
              lineHeight: 1.2, letterSpacing: '-0.8px', margin: '0 0 16px',
            }}>
              Stop Watching Matches.<br />
              <span style={{ color: '#f59e0b' }}>Start Profiting.</span>
            </h1>
            <p style={{ color: 'rgba(255,255,255,0.45)', fontSize: '13.5px', lineHeight: 1.6, margin: 0, whiteSpace: 'nowrap' }}>
              AI monitors every match and acts at the right moment — focus on what matters.
            </p>
          </div>

          {/* Stat strip */}
          <div style={{
            position: 'relative', display: 'flex', gap: '8px', flexWrap: 'wrap', marginBottom: '28px',
          }}>
            {STATS.map((s) => (
              <span key={s.label} style={{
                display: 'inline-flex', alignItems: 'center', gap: '5px',
                padding: '4px 10px', borderRadius: '20px',
                background: 'rgba(255,255,255,0.04)',
                border: '1px solid rgba(255,255,255,0.08)',
                color: 'rgba(255,255,255,0.35)', fontSize: '11px', fontWeight: 500,
              }}>
                <span style={{ width: '4px', height: '4px', borderRadius: '50%', background: '#f59e0b', display: 'inline-block', flexShrink: 0 }} />
                {s.label}
              </span>
            ))}
          </div>

          {/* Feature list */}
          <div style={{ position: 'relative', display: 'flex', flexDirection: 'column', gap: '10px' }}>
            {FEATURES.map((f) => (
              <div key={f.title} style={{
                display: 'flex', alignItems: 'flex-start', gap: '14px',
                background: 'rgba(255,255,255,0.03)',
                border: '1px solid rgba(255,255,255,0.06)',
                borderRadius: '10px', padding: '14px 16px',
              }}>
                <div style={{
                  width: '30px', height: '30px', borderRadius: '7px', flexShrink: 0,
                  background: 'rgba(245,158,11,0.1)',
                  border: '1px solid rgba(245,158,11,0.15)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  color: '#f59e0b',
                }}>
                  {f.icon}
                </div>
                <div>
                  <div style={{ color: '#f9fafb', fontWeight: 600, fontSize: '13px', marginBottom: '2px' }}>{f.title}</div>
                  <div style={{ color: 'rgba(255,255,255,0.38)', fontSize: '12px', lineHeight: 1.5 }}>{f.desc}</div>
                </div>
              </div>
            ))}
          </div>

        </div>
      )}

      {/* ── RIGHT PANEL ────────────────────────────────────── */}
      <div style={{
        flex: isMobile ? 'none' : '1 1 45%',
        minHeight: isMobile ? '100vh' : undefined,
        background: '#1f2937',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: isMobile ? '48px 24px' : '60px 48px',
        position: 'relative',
      }}>
        {/* Secure badge */}
        <div style={{
          position: 'absolute', top: '20px', right: '20px',
          display: 'flex', alignItems: 'center', gap: '6px',
          color: '#9ca3af', fontSize: '11.5px',
        }}>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
          </svg>
          Secured by Google OAuth
        </div>

        {/* Login form */}
        <div style={{ width: '100%', maxWidth: '340px' }}>


          <div style={{ marginBottom: '48px', textAlign: 'center' }}>
            {/* Logo */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '10px', marginBottom: '40px' }}>
              <div style={{
                width: '36px', height: '36px', borderRadius: '9px',
                background: '#111827',
                border: '1px solid rgba(255,255,255,0.1)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                color: '#f59e0b', flexShrink: 0,
              }}>
                <TrendIcon size={20} />
              </div>
              <div style={{ textAlign: 'left' }}>
                <div style={{ color: '#f59e0b', fontSize: '13px', fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase' }}>
                  Time for Investment
                </div>
                <div style={{ color: 'rgba(255,255,255,0.3)', fontSize: '11px', letterSpacing: '0.08em' }}>TFI</div>
              </div>
            </div>
            <h2 style={{
              fontSize: '22px', fontWeight: 700, color: '#f9fafb',
              margin: 0, letterSpacing: '-0.3px',
            }}>
              Welcome back
            </h2>
          </div>

          {/* Google button */}
          <button
            onClick={onLogin}
            style={{
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              gap: '10px', width: '100%',
              padding: '14px 20px',
              background: '#111827',
              color: '#f9fafb',
              border: '1px solid rgba(255,255,255,0.1)',
              borderRadius: '10px',
              fontSize: '14.5px', fontWeight: 500,
              cursor: 'pointer',
              transition: 'all 0.15s ease',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = '#0f172a';
              e.currentTarget.style.borderColor = 'rgba(255,255,255,0.2)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = '#111827';
              e.currentTarget.style.borderColor = 'rgba(255,255,255,0.1)';
            }}
          >
            <svg width="18" height="18" viewBox="0 0 48 48">
              <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/>
              <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/>
              <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/>
              <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.18 1.48-4.97 2.31-8.16 2.31-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/>
            </svg>
            Sign in with Google
          </button>

          {/* Error */}
          {error && (
            <div style={{
              marginTop: '16px', padding: '12px 14px',
              background: 'rgba(220,38,38,0.1)', border: '1px solid rgba(220,38,38,0.3)',
              borderRadius: '8px', color: '#fca5a5', fontSize: '13px',
              display: 'flex', gap: '8px', alignItems: 'flex-start',
            }}>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ flexShrink: 0, marginTop: '1px' }}>
                <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
              </svg>
              <span>{error}</span>
            </div>
          )}
        </div>

        {/* Footer */}
        <div style={{
          position: 'absolute', bottom: '24px',
          color: '#9ca3af', fontSize: '12px', fontWeight: 500,
        }}>
          TFI - Time for Investment v1.0, © 2025.
        </div>
      </div>
    </div>
  );
}
