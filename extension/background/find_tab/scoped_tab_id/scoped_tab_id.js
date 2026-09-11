export function scoped_tab_id(connector_id = '', scope = '') {
  const connector = String(connector_id || '').trim();
  const normalized_scope = String(scope || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return normalized_scope ? `${connector}:${normalized_scope}` : connector;
}
