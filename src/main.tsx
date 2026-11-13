import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';
import { App } from './App';
import { AuthProvider } from './lib/auth';
import { getToken, setToken } from './lib/api';

/**
 * Demo-Domains (demo-*) öffnen sich mit dem Beispielkonto, ohne Registrierung.
 * Der Endpunkt liefert ein fertiges Token; es wird nur gesetzt, wenn keins vorliegt,
 * damit ein eigener Login auf der Demo-Domain nicht überschrieben wird.
 */
async function bootstrapDemo(): Promise<void> {
  if (!location.hostname.startsWith('demo-')) return;
  if (getToken()) return;
  try {
    const res = await fetch('/api/auth/demo', { credentials: 'same-origin' });
    if (!res.ok) return;
    const data = (await res.json()) as { token?: string };
    if (data.token) setToken(data.token);
  } catch {
    /* Demo bleibt dann auf der Anmeldeseite */
  }
}

const root = createRoot(document.getElementById('root')!);

function render() {
  root.render(
    <StrictMode>
      <AuthProvider>
        <App />
      </AuthProvider>
    </StrictMode>,
  );
}

void bootstrapDemo().finally(render);
