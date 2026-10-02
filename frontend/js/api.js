const API_BASE_URL = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1' 
  ? '' 
  : 'https://scet-hrdware-app.onrender.com';

export async function api(path, { method = 'GET', body } = {}) {
  const url = path.startsWith('/') ? `${API_BASE_URL}${path}` : path;
  
  const r = await fetch(url, {
    method, 
    credentials: 'include',
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  let data = null;
  try { data = await r.json(); } catch { /* non-JSON */ }
  if (!r.ok) {
    const e = new Error(data?.error || `Request failed (${r.status})`);
    e.status = r.status; e.code = data?.code;
    if (e.code === 'IP_NOT_ALLOWED') document.dispatchEvent(new CustomEvent('ip-blocked', { detail: e.message }));
    throw e;
  }
  return data;
}

export const openFile = (path) => window.open(path, '_blank');