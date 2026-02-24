import { useEffect, useState } from 'react';
import { Check } from 'lucide-react';
import { useAIPanelStore } from '@/renderer/ai-panel-store';

type Provider = 'openai' | 'anthropic' | 'ollama' | 'custom';

const PRESETS: Record<Provider, { label: string; baseUrl: string; model: string }> = {
  openai: { label: 'OpenAI', baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini' },
  anthropic: { label: 'Anthropic', baseUrl: 'https://api.anthropic.com/v1', model: 'claude-sonnet-4-20250514' },
  ollama: { label: 'Ollama', baseUrl: 'http://localhost:11434/v1', model: 'llama3.2' },
  custom: { label: 'Custom', baseUrl: '', model: '' },
};

function detectProvider(baseUrl: string): Provider {
  if (baseUrl.includes('api.openai.com')) return 'openai';
  if (baseUrl.includes('api.anthropic.com')) return 'anthropic';
  if (baseUrl.includes('localhost:11434')) return 'ollama';
  return 'custom';
}

export function AISettings() {
  const aiEnabled = useAIPanelStore((s) => s.aiEnabled);
  const setAIEnabled = useAIPanelStore((s) => s.setAIEnabled);
  const [baseUrl, setBaseUrl] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [model, setModel] = useState('');
  const [provider, setProvider] = useState<Provider>('openai');
  const [saved, setSaved] = useState(false);
  const [loading, setLoading] = useState(true);

  // Load settings on mount
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [urlRes, keyRes, modelRes] = await Promise.all([
        window.lychee.invoke('settings.get', { key: 'ai_base_url' }),
        window.lychee.invoke('settings.get', { key: 'ai_api_key' }),
        window.lychee.invoke('settings.get', { key: 'ai_model' }),
      ]);
      if (cancelled) return;
      const url = urlRes.value || '';
      const key = keyRes.value || '';
      const m = modelRes.value || '';
      setBaseUrl(url);
      setApiKey(key);
      setModel(m);
      setProvider(url ? detectProvider(url) : 'openai');
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, []);

  const handleToggleAI = async () => {
    const newValue = !aiEnabled;
    setAIEnabled(newValue);
    await window.lychee.invoke('settings.set', { key: 'ai_enabled', value: String(newValue) });
  };

  const handleProviderChange = (p: Provider) => {
    setProvider(p);
    const preset = PRESETS[p];
    setBaseUrl(preset.baseUrl);
    if (preset.model) setModel(preset.model);
  };

  const handleSave = async () => {
    await Promise.all([
      window.lychee.invoke('settings.set', { key: 'ai_base_url', value: baseUrl }),
      window.lychee.invoke('settings.set', { key: 'ai_api_key', value: apiKey }),
      window.lychee.invoke('settings.set', { key: 'ai_model', value: model }),
    ]);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  if (loading) return null;

  return (
    <div>
      <h3 className="text-sm font-semibold mb-1">AI</h3>
      <p className="text-sm text-[hsl(var(--muted-foreground))] mb-4">
        Connect to any OpenAI-compatible API.
      </p>

      {/* Enable/disable toggle */}
      <div className="flex items-center justify-between mb-4">
        <label className="text-sm text-[hsl(var(--foreground))]">Enable AI features</label>
        <button
          type="button"
          role="switch"
          aria-checked={aiEnabled}
          onClick={handleToggleAI}
          className={
            'relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))] ' +
            (aiEnabled ? 'bg-[hsl(var(--primary))]' : 'bg-[hsl(var(--muted))]')
          }
        >
          <span
            className={
              'pointer-events-none inline-block h-4 w-4 rounded-full bg-white shadow-sm transition-transform duration-200 ' +
              (aiEnabled ? 'translate-x-4' : 'translate-x-0')
            }
          />
        </button>
      </div>

      {aiEnabled && (
        <>
          {/* Provider preset */}
          <label className="text-xs font-medium text-[hsl(var(--muted-foreground))] mb-2 block">
            Provider
          </label>
          <div className="inline-flex rounded-lg border border-[hsl(var(--border))] p-0.5 mb-4">
            {(Object.keys(PRESETS) as Provider[]).map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => handleProviderChange(p)}
                className={
                  'rounded-md px-3 py-1.5 text-sm transition-colors ' +
                  (provider === p
                    ? 'bg-[hsl(var(--accent))] text-[hsl(var(--accent-foreground))] font-medium'
                    : 'text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))]')
                }
              >
                {PRESETS[p].label}
              </button>
            ))}
          </div>

          {/* Base URL — only shown for custom provider */}
          {provider === 'custom' && (
            <>
              <label className="text-xs font-medium text-[hsl(var(--muted-foreground))] mb-1.5 block">
                Base URL
              </label>
              <input
                type="text"
                value={baseUrl}
                onChange={(e) => setBaseUrl(e.target.value)}
                placeholder="https://api.example.com/v1"
                className="mb-3 block w-full rounded-md border border-[hsl(var(--border))] bg-transparent px-3 py-1.5 text-sm text-[hsl(var(--foreground))] placeholder:text-[hsl(var(--muted-foreground))]/50 focus:outline-none focus:ring-1 focus:ring-[hsl(var(--ring))]"
              />
            </>
          )}

          {/* API Key */}
          <label className="text-xs font-medium text-[hsl(var(--muted-foreground))] mb-1.5 block">
            API Key
          </label>
          <input
            type="password"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder={provider === 'ollama' ? 'Not required for Ollama' : provider === 'custom' ? 'API key (if required)' : 'sk-...'}
            className="mb-3 block w-full rounded-md border border-[hsl(var(--border))] bg-transparent px-3 py-1.5 text-sm text-[hsl(var(--foreground))] placeholder:text-[hsl(var(--muted-foreground))]/50 focus:outline-none focus:ring-1 focus:ring-[hsl(var(--ring))]"
          />

          {/* Model */}
          <label className="text-xs font-medium text-[hsl(var(--muted-foreground))] mb-1.5 block">
            Model
          </label>
          <input
            type="text"
            value={model}
            onChange={(e) => setModel(e.target.value)}
            placeholder="gpt-4o-mini"
            className="mb-4 block w-full rounded-md border border-[hsl(var(--border))] bg-transparent px-3 py-1.5 text-sm text-[hsl(var(--foreground))] placeholder:text-[hsl(var(--muted-foreground))]/50 focus:outline-none focus:ring-1 focus:ring-[hsl(var(--ring))]"
          />

          {/* Save */}
          <button
            type="button"
            onClick={handleSave}
            className="inline-flex items-center gap-1.5 rounded-md bg-[hsl(var(--primary))] px-3 py-1.5 text-sm font-medium text-[hsl(var(--primary-foreground))] transition-colors hover:opacity-90"
          >
            {saved ? <Check className="h-3.5 w-3.5" /> : null}
            {saved ? 'Saved' : 'Save'}
          </button>
        </>
      )}
    </div>
  );
}
