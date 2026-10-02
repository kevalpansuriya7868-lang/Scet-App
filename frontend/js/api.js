export async function api(path, { method = 'GET', body } = {}) {
  const r = await fetch(path, {
    method, credentials: 'same-origin',
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
