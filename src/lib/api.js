const API_BASE = import.meta.env.VITE_API_BASE_URL || '';
let authTokenGetter = null;
const generationPollInterval = 2500;
const generationTimeout = 900000;

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
  const url = `${API_BASE}${path}`;
  let response;
  try {
    response = await fetch(url, { credentials: 'include', ...options, headers });
  } catch (error) {
    throw new Error(`Unable to reach API at ${url}. ${error.message}`);
  }
  if (!response.ok) {
    const contentType = response.headers.get('content-type') || '';
    if (contentType.includes('application/json')) {
      const error = await response.json().catch(() => ({ error: 'Request failed.' }));
      throw new Error(error.error || `Request failed with ${response.status}.`);
    }
    const body = await response.text().catch(() => '');
    const cleanedBody = body.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 160);
    if (response.status === 503) {
      throw new Error('The server is temporarily unavailable. Try again in a minute.');
    }
    throw new Error(`Request failed with ${response.status}${cleanedBody ? `: ${cleanedBody}` : ''}`);
  }
  if (response.status === 204) return null;
  return response.json();
}

export function getCurrentUser() {
  return request('/api/auth/me');
}

export function getSessionStatus() {
  return request('/api/auth/session', { headers: {} });
}

export function getArticles(params = {}) {
  const query = new URLSearchParams(Object.entries(params).filter(([, value]) => value !== '' && value != null));
  return request(`/api/articles?${query.toString()}`, { headers: {} });
}

export function getArticle(slug, preview = false) {
  return request(`/api/articles/${slug}${preview ? '?preview=true' : ''}`, { headers: {} });
}

export function generateArticle(payload, onProgress) {
  return request('/api/generate-article', {
    method: 'POST',
    body: JSON.stringify(payload)
  }).then((result) => result.article ? result : waitForGenerationJob(result.jobId, onProgress));
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForGenerationJob(jobId, onProgress) {
  if (!jobId) throw new Error('Article generation did not start.');
  const startedAt = Date.now();
  while (Date.now() - startedAt < generationTimeout) {
    await sleep(generationPollInterval);
    const result = await request(`/api/generation-jobs/${jobId}`);
    onProgress?.(result.job);
    if (result.job.status === 'completed') return { article: result.job.article, job: result.job };
    if (result.job.status === 'failed') throw new Error(result.job.error || 'Article generation failed.');
  }
  throw new Error('Article generation is taking longer than expected. Refresh your article list in a minute.');
}

export function updateArticle(id, payload) {
  return request(`/api/articles/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(payload)
  });
}

export function regenerateArticle(id, onProgress) {
  return request(`/api/articles/${id}/regenerate`, {
    method: 'POST',
    body: JSON.stringify({})
  }).then((result) => waitForGenerationJob(result.jobId, onProgress));
}

export function deleteArticle(id) {
  return request(`/api/articles/${id}`, { method: 'DELETE' });
}
