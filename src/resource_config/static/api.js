// The backend API. Every call is same-origin and carries the session cookie.
async function request(method, path, body) {
  const options = { method, headers: {} };
  if (body !== undefined) { options.headers['Content-Type'] = 'application/json'; options.body = JSON.stringify(body); }
  const response = await fetch(path, options);
  if (response.status === 401 && path !== '/api/login') { window.dispatchEvent(new CustomEvent('rc:unauthorized')); }
  let payload = null;
  const text = await response.text();
  try { payload = text ? JSON.parse(text) : null; } catch { payload = text; }
  if (!response.ok) {
    const detail = payload && payload.detail !== undefined ? payload.detail : payload;
    const error = new Error(typeof detail === 'string' ? detail : JSON.stringify(detail));
    error.status = response.status; error.detail = detail;
    throw error;
  }
  return payload;
}
export const api = {
  get: (path) => request('GET', path),
  put: (path, body) => request('PUT', path, body),
  post: (path, body) => request('POST', path, body),
  del: (path) => request('DELETE', path),
  login: (username, password) => request('POST', '/api/login', { username, password }),
  logout: () => request('POST', '/api/logout'),
  session: () => request('GET', '/api/session'),
  model: (refresh = false) => request('GET', `/api/model${refresh ? '?refresh=true' : ''}`),
  catalog: () => request('GET', '/api/catalog'),
  entry: (identity, name) => request('GET', `/api/store/${encodeURIComponent(identity)}/${name}`),
  putEntry: (identity, name, body) => request('PUT', `/api/store/${encodeURIComponent(identity)}/${name}`, body),
  deleteEntry: (identity, name) => request('DELETE', `/api/store/${encodeURIComponent(identity)}/${name}`),
  resolve: (uai, as_format, direction = 'read') => request('POST', '/api/interop/resolve', { uai, as_format, direction }),
  chainReport: (input_format, output_format, fields) => request('POST', '/api/interop/chain_report', { input_format, output_format, fields }),
  describeTransform: (input_format, output_format) => request('POST', '/api/interop/describe_transform', { input_format, output_format }),
  compilePattern: (pattern, input_format) => request('POST', '/api/interop/compile_pattern', { pattern, input_format }),
  discover: (protocol, options) => request('POST', '/api/discover', { protocol, options }),
  lifecycle: (identity, action) => request('POST', `/api/agents/${encodeURIComponent(identity)}/${action}`),
  pending: () => request('GET', '/api/pending'),
  addPending: (entries) => request('POST', '/api/pending', entries),
  applyPending: () => request('POST', '/api/pending/apply'),
  discardPending: () => request('DELETE', '/api/pending'),
  discardPendingEntry: (identity, name) => request('DELETE', `/api/pending/${encodeURIComponent(identity)}/${name}`),
  events(onMessage) {
    const protocol = location.protocol === 'https:' ? 'wss' : 'ws';
    let socket, closed = false;
    const connect = () => {
      socket = new WebSocket(`${protocol}://${location.host}/ws`);
      socket.onmessage = (e) => { try { onMessage(JSON.parse(e.data)); } catch { /* ignore */ } };
      socket.onclose = () => { if (!closed) setTimeout(connect, 3000); };
    };
    connect();
    return () => { closed = true; socket && socket.close(); };
  },
};
