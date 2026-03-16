import { useState, useEffect } from 'react';
import { useAppState } from '@/hooks/useAppState';
import { useToast } from '@/hooks/useToast';

export function SettingsTab() {
  const { state, saveConfig } = useAppState();
  const { showToast } = useToast();
  const { config } = state;

  const [webhookUrl, setWebhookUrl] = useState(config.webhookUrl);
  const [defaultMode, setDefaultMode] = useState(config.defaultMode);
  const [newPassword, setNewPassword] = useState('');

  useEffect(() => {
    setWebhookUrl(config.webhookUrl);
    setDefaultMode(config.defaultMode);
  }, [config]);

  const handleSave = () => {
    saveConfig({ ...config, webhookUrl, defaultMode });
    if (newPassword) {
      showToast('⚠️ Password change requires code update', 'error');
    } else {
      showToast('✅ Settings saved!', 'success');
    }
  };

  return (
    <div className="card">
      <div className="card-header">
        <div className="card-title">⚙️ Settings</div>
      </div>
      <div style={{ padding: '20px' }}>
        <div className="form-group">
          <label>n8n Webhook Base URL:</label>
          <input type="text" value={webhookUrl} onChange={(e) => setWebhookUrl(e.target.value)} />
        </div>
        <div className="form-group">
          <label>Default Betting Mode:</label>
          <select value={defaultMode} onChange={(e) => setDefaultMode(e.target.value)}>
            <option value="A">A - Aggressive</option>
            <option value="B">B - Balanced</option>
            <option value="C">C - Conservative</option>
          </select>
        </div>
        <div className="form-group">
          <label>Change Password:</label>
          <input type="password" placeholder="New password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} />
          <small style={{ color: 'var(--gray-500)', display: 'block', marginTop: '5px' }}>
            Note: Requires code update to change password hash
          </small>
        </div>
        <button className="btn btn-primary" onClick={handleSave}>💾 Save Settings</button>
      </div>
    </div>
  );
}
