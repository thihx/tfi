import { useEffect, useState } from 'react';

interface LoginScreenProps {
  onLogin: () => void;
  error: string;
}

const STATS = ['200+ leagues', 'Live monitoring', 'Structured picks'];

const FEATURES = [
  {
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <line x1="18" y1="20" x2="18" y2="10" /><line x1="12" y1="20" x2="12" y2="4" /><line x1="6" y1="20" x2="6" y2="14" />
      </svg>
    ),
    title: 'Data-backed analysis',
    desc: 'Recommendations use live stats and structured prompts—not gut calls.',
  },
  {
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <polyline points="22 7 13.5 15.5 8.5 10.5 2 17" /><polyline points="16 7 22 7 22 13" />
      </svg>
    ),
    title: 'Bankroll discipline',
    desc: 'Stake sizing and tracking built for steady, measured decisions.',
  },
  {
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
      </svg>
    ),
    title: 'Alerts when it matters',
    desc: 'Triggers on goals, cards, or match time—act without watching full games.',
  },
];

function TrendIcon({ size = 22 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <polyline points="22 7 13.5 15.5 8.5 10.5 2 17" />
      <polyline points="16 7 22 7 22 13" />
    </svg>
  );
}

export function LoginScreen({ onLogin, error }: LoginScreenProps) {
  const [isMobile, setIsMobile] = useState(() =>
    typeof window !== 'undefined' ? window.innerWidth < 768 : false,
  );

  useEffect(() => {
    const handler = () => setIsMobile(window.innerWidth < 768);
    window.addEventListener('resize', handler);
    return () => window.removeEventListener('resize', handler);
  }, []);

  return (
    <div className={`login-page${isMobile ? ' login-page--mobile' : ''}`}>
      <aside className="login-page__story" aria-hidden={isMobile}>
        <div className="login-page__story-grid" />
        <div className="login-page__story-glow" />
        <div className="login-page__story-inner">
          <p className="login-page__eyebrow">
            <span className="login-page__eyebrow-mark" />
            Time for Investment
          </p>
          <h1 className="login-page__headline">
            Scout matches.
            <br />
            <span className="login-page__headline-accent">Invest with structure.</span>
          </h1>
          <p className="login-page__lede">
            TFI monitors fixtures, surfaces recommendations, and keeps your workflow in one workspace.
          </p>
          <div className="login-page__stats">
            {STATS.map((label) => (
              <span key={label} className="login-page__stat">
                {label}
              </span>
            ))}
          </div>
          <ul className="login-page__features">
            {FEATURES.map((f) => (
              <li key={f.title} className="login-page__feature">
                <div className="login-page__feature-icon">{f.icon}</div>
                <div>
                  <p className="login-page__feature-title">{f.title}</p>
                  <p className="login-page__feature-desc">{f.desc}</p>
                </div>
              </li>
            ))}
          </ul>
        </div>
      </aside>

      <main className="login-page__panel">
        <div className="login-page__secure">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
            <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
          </svg>
          Secured with Google OAuth
        </div>

        <div className="login-page__card">
          <div className="login-page__brand">
            <div className="login-page__brand-mark">
              <TrendIcon size={22} />
            </div>
            <div>
              <div className="login-page__brand-name">TFI</div>
              <div className="login-page__brand-tag">Time for Investment</div>
            </div>
          </div>

          <h2 className="login-page__title">Welcome back</h2>
          <p className="login-page__subtitle">Sign in to open your dashboard and live tools.</p>

          <button type="button" className="login-page__btn-google" onClick={onLogin}>
            <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden>
              <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
              <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
              <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
              <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.18 1.48-4.97 2.31-8.16 2.31-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
            </svg>
            Sign in with Google
          </button>

          {error ? (
            <div className="login-page__error" role="alert">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
                <circle cx="12" cy="12" r="10" />
                <line x1="12" y1="8" x2="12" y2="12" />
                <line x1="12" y1="16" x2="12.01" y2="16" />
              </svg>
              <span>{error}</span>
            </div>
          ) : null}
        </div>

        <footer className="login-page__footer">TFI · Time for Investment · © 2025</footer>
      </main>
    </div>
  );
}
