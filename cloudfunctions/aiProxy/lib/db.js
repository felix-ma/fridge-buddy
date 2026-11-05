'use strict';

const { jsonRequest } = require('./http');

/**
 * Supabase PostgREST 客户端（service_role）。
 * 只用 REST，不引 @supabase/supabase-js：云函数环境不保证 Node 18+，
 * SDK 的 realtime / ws 依赖在这里全是负担。
 */
function createDb({ url, key, timeoutMs = 10000 }) {
  if (!url || !key) throw new Error('SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY 未配置');
  const base = String(url).replace(/\/+$/, '');

  async function request(method, path, { body, headers = {} } = {}) {
    const res = await jsonRequest({
      url: `${base}/rest/v1/${path}`,
      method,
      body,
      timeoutMs,
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        Prefer: 'return=representation',
        ...headers,
      },
    });
    if (res.status >= 200 && res.status < 300) return res.json;
    const err = new Error(`Supabase ${res.status} ${method} ${path} → ${String(res.text).slice(0, 300)}`);
    err.code = 'E_DB';
    err.status = res.status;
    throw err;
  }

  return {
    select(table, query = '') {
      return request('GET', table + (query ? `?${query}` : ''));
    },
    insert(table, rows, { onConflict, resolution } = {}) {
      let q = '';
      if (onConflict) q += `on_conflict=${encodeURIComponent(onConflict)}`;
      return request('POST', table + (q ? `?${q}` : ''), {
        body: rows,
        headers: resolution ? { Prefer: `resolution=${resolution},return=representation` } : {},
      });
    },
    async upsert(table, rows, conflictColumn) {
      const out = await this.insert(table, rows, { onConflict: conflictColumn, resolution: 'merge-duplicates' });
      return out;
    },
    patch(table, query, patch) {
      return request('PATCH', `${table}?${query}`, { body: patch });
    },
    remove(table, query) {
      return request('DELETE', `${table}?${query}`);
    },
  };
}

/** openid → 内部 uuid，不存在则创建 */
async function ensureUser(db, openid) {
  if (!openid) throw new Error('缺少 OPENID');
  const found = await db.select('app_users', `openid=eq.${encodeURIComponent(openid)}&select=id`);
  if (Array.isArray(found) && found.length) return found[0].id;
  const created = await db.insert('app_users', [{ openid }], { onConflict: 'openid', resolution: 'merge-duplicates' });
  if (Array.isArray(created) && created.length) return created[0].id;
  const again = await db.select('app_users', `openid=eq.${encodeURIComponent(openid)}&select=id`);
  if (Array.isArray(again) && again.length) return again[0].id;
  throw new Error('创建用户失败');
}

module.exports = { createDb, ensureUser };
