const isLocal = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
const API_BASE_URL = isLocal
  ? (window.location.port === '3000' ? '' : 'http://localhost:3000')
  : 'https://scet-hardware-app.onrender.com';

export async function api(path, { method = 'GET', body } = {}) {
  // Prepend the backend base URL if path starts with '/'
  const url = path.startsWith('/') ? `${API_BASE_URL}${path}` : path;
  
  const r = await fetch(url, {
    method, 
    credentials: 'include', // Include credentials for cross-domain requests between Firebase and Render
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

export const openFile = (path) => {
  const url = path.startsWith('/') ? `${API_BASE_URL}${path}` : path;
  window.open(url, '_blank');
};