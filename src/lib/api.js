const API_BASE = import.meta.env.VITE_API_BASE_URL || '';
let authTokenGetter = null;

export function setAuthTokenGetter(getter) {
  authTokenGetter = getter;
}

async function authHeaders() {
  const token = authTokenGetter ? await authTokenGetter() : null;
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function request(path, options = {}) {
  const headers = {
    'Content-Type': 'application/json',
    ...(await authHeaders()),
    ...options.headers
  };
  const response = await fetch(`${API_BASE}${path}`, { ...options, headers });
  if (!response.ok) {
    const contentType = response.headers.get('content-type') || '';
    if (contentType.includes('application/json')) {
      const error = await response.json().catch(() => ({ error: 'Request failed.' }));
      throw new Error(error.error || `Request failed with ${response.status}.`);
    }
    const body = await response.text().catch(() => '');
    const cleanedBody = body.replace(/\s+/g, ' ').trim().slice(0, 220);
    throw new Error(`Request failed with ${response.status}${cleanedBody ? `: ${cleanedBody}` : ''}`);
  }
  if (response.status === 204) return null;
  return response.json();
}

export function getCurrentUser() {
  return request('/api/auth/me');
}

export function getArticles(params = {}) {
  const query = new URLSearchParams(Object.entries(params).filter(([, value]) => value !== '' && value != null));
  return request(`/api/articles?${query.toString()}`, { headers: {} });
}

export function getArticle(slug, preview = false) {
  return request(`/api/articles/${slug}${preview ? '?preview=true' : ''}`, { headers: {} });
}

export function generateArticle(payload) {
  return request('/api/generate-article', {
    method: 'POST',
    body: JSON.stringify(payload)
  });
}

export function updateArticle(id, payload) {
  return request(`/api/articles/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(payload)
  });
}

export function deleteArticle(id) {
  return request(`/api/articles/${id}`, { method: 'DELETE' });
}
