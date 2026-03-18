interface LoginScreenProps {
  onLogin: () => void;
  error: string;
}

const FEATURES = [
  {
    icon: '⚡',
    title: 'Live AI Analysis',
    desc: 'Real-time match intelligence powered by AI — odds, stats, and momentum in one view.',
  },
  {
    icon: '🎯',
    title: 'Smart Recommendations',
    desc: 'Condition-based alerts and AI-generated investment recommendations with confidence scoring.',
  },
  {
    icon: '📊',
    title: 'Full Performance Tracking',
    desc: 'Track every investment, recommendation and P&L across all markets with automated settlement.',
  },
];

export function LoginScreen({ onLogin, error }: LoginScreenProps) {
  return (
    <div style={{
      display: 'flex',
      minHeight: '100vh',
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
    }}>
      {/* ── LEFT PANEL ─────────────────────────────────────── */}
      <div style={{
        flex: '1 1 55%',
        background: 'linear-gradient(135deg, #0f172a 0%, #1e3a5f 50%, #1a2744 100%)',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        padding: '60px 64px',
        position: 'relative',
        overflow: 'hidden',
      }}>
        {/* Background grid pattern */}
        <div style={{
          position: 'absolute', inset: 0,
          backgroundImage: `
            linear-gradient(rgba(255,255,255,0.03) 1px, transparent 1px),
            linear-gradient(90deg, rgba(255,255,255,0.03) 1px, transparent 1px)
          `,
          backgroundSize: '48px 48px',
          pointerEvents: 'none',
        }} />

        {/* Glowing orb */}
        <div style={{
          position: 'absolute', top: '-80px', right: '-80px',
          width: '360px', height: '360px', borderRadius: '50%',
          background: 'radial-gradient(circle, rgba(59,130,246,0.25) 0%, transparent 70%)',
          pointerEvents: 'none',
        }} />
        <div style={{
          position: 'absolute', bottom: '-60px', left: '20%',
          width: '280px', height: '280px', borderRadius: '50%',
          background: 'radial-gradient(circle, rgba(16,185,129,0.15) 0%, transparent 70%)',
          pointerEvents: 'none',
        }} />

        {/* Logo */}
        <div style={{ position: 'relative', marginBottom: '48px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <div style={{
              width: '40px', height: '40px', borderRadius: '10px',
              background: 'linear-gradient(135deg, #3b82f6, #10b981)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: '20px', flexShrink: 0,
            }}>
              📈
            </div>
            <div>
              <div style={{ color: '#fff', fontSize: '17px', fontWeight: 700, letterSpacing: '-0.3px', lineHeight: 1.2 }}>
                Time for Investment
              </div>
              <div style={{ color: 'rgba(255,255,255,0.4)', fontSize: '12px', letterSpacing: '0.5px' }}>
                TFI
              </div>
            </div>
          </div>
        </div>

        {/* Headline */}
        <div style={{ position: 'relative', marginBottom: '48px' }}>
          <h1 style={{
            color: '#fff', fontSize: '40px', fontWeight: 800,
            lineHeight: 1.15, letterSpacing: '-1px', margin: '0 0 16px',
          }}>
            Football Intelligence<br />
            <span style={{
              background: 'linear-gradient(90deg, #3b82f6, #10b981)',
              WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent',
            }}>
              Powered by AI
            </span>
          </h1>
          <p style={{ color: 'rgba(255,255,255,0.55)', fontSize: '16px', lineHeight: 1.6, margin: 0, maxWidth: '420px' }}>
            Monitor live matches, get AI-driven recommendations, and track your investment performance — all in one platform.
          </p>
        </div>

        {/* Feature cards */}
        <div style={{ position: 'relative', display: 'flex', flexDirection: 'column', gap: '16px' }}>
          {FEATURES.map((f) => (
            <div key={f.title} style={{
              display: 'flex', alignItems: 'flex-start', gap: '16px',
              background: 'rgba(255,255,255,0.05)',
              border: '1px solid rgba(255,255,255,0.08)',
              borderRadius: '12px', padding: '16px 20px',
              backdropFilter: 'blur(8px)',
            }}>
              <div style={{
                width: '36px', height: '36px', borderRadius: '8px', flexShrink: 0,
                background: 'rgba(59,130,246,0.15)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: '18px',
              }}>
                {f.icon}
              </div>
              <div>
                <div style={{ color: '#fff', fontWeight: 600, fontSize: '14px', marginBottom: '4px' }}>
                  {f.title}
                </div>
                <div style={{ color: 'rgba(255,255,255,0.5)', fontSize: '13px', lineHeight: 1.5 }}>
                  {f.desc}
                </div>
              </div>
            </div>
          ))}
        </div>

      </div>

      {/* ── RIGHT PANEL ────────────────────────────────────── */}
      <div style={{
        flex: '1 1 45%',
        background: '#fff',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '60px 48px',
        position: 'relative',
      }}>
        {/* Top-right: secure badge */}
        <div style={{
          position: 'absolute', top: '28px', right: '32px',
          display: 'flex', alignItems: 'center', gap: '6px',
          color: '#6b7280', fontSize: '12px',
        }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
          </svg>
          Secured by Google OAuth
        </div>

        {/* Login form */}
        <div style={{ width: '100%', maxWidth: '340px' }}>
          {/* Logo small */}
          <div style={{ marginBottom: '40px', textAlign: 'center' }}>
            <div style={{
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              width: '52px', height: '52px', borderRadius: '14px',
              background: 'linear-gradient(135deg, #3b82f6, #10b981)',
              fontSize: '26px', marginBottom: '16px',
            }}>
              📈
            </div>
            <h2 style={{
              fontSize: '24px', fontWeight: 700, color: '#111827',
              margin: '0 0 6px', letterSpacing: '-0.4px',
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
              padding: '13px 20px',
              background: '#fff',
              color: '#3c4043',
              border: '1.5px solid #dadce0',
              borderRadius: '10px',
              fontSize: '15px', fontWeight: 500,
              cursor: 'pointer',
              boxShadow: '0 1px 3px rgba(0,0,0,0.08)',
              transition: 'all 0.15s ease',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.boxShadow = '0 2px 8px rgba(0,0,0,0.12)';
              e.currentTarget.style.borderColor = '#b0bec5';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.boxShadow = '0 1px 3px rgba(0,0,0,0.08)';
              e.currentTarget.style.borderColor = '#dadce0';
            }}
          >
            <svg width="20" height="20" viewBox="0 0 48 48">
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
              background: '#fef2f2', border: '1px solid #fecaca',
              borderRadius: '8px', color: '#dc2626', fontSize: '13px',
              display: 'flex', gap: '8px', alignItems: 'flex-start',
            }}>
              <span>⚠️</span>
              <span>{error}</span>
            </div>
          )}

        </div>

        {/* Bottom copyright */}
        <div style={{
          position: 'absolute', bottom: '28px',
          color: '#9ca3af', fontSize: '12px',
          fontWeight: 500,
        }}>
          TFI - Time for Investment v1.0, © 2025.
        </div>
      </div>
    </div>
  );
}
