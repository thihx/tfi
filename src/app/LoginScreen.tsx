import { useState, type KeyboardEvent } from 'react';

interface LoginScreenProps {
  onLogin: (password: string) => Promise<void>;
  error: string;
}

export function LoginScreen({ onLogin, error }: LoginScreenProps) {
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);

  const handleLogin = async () => {
    if (!password || loading) return;
    setLoading(true);
    try {
      await onLogin(password);
    } finally {
      setLoading(false);
    }
  };

  const handleKeyPress = (e: KeyboardEvent) => {
    if (e.key === 'Enter') handleLogin();
  };

  return (
    <div className="login-container">
      <div className="login-box">
        <h1>📈 Time for Investment</h1>
        <p>AI-Powered Investment Analysis</p>
        <input
          type="password"
          placeholder="Enter password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          onKeyDown={handleKeyPress}
          autoFocus
        />
        <button onClick={handleLogin} disabled={loading}>
          {loading ? 'Logging in...' : 'Login'}
        </button>
        {error && <div className="login-error">{error}</div>}
      </div>
    </div>
  );
}
