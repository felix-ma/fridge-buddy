'use strict';

const https = require('https');
const { URL } = require('url');

/**
 * 极简 https JSON 客户端：不引第三方依赖，云函数冷启动更快，也不会被
 * 依赖包的 Node 版本要求绊住（云开发运行时版本受限）。
 */
function jsonRequest({ url, method = 'POST', headers = {}, body, timeoutMs = 60000 }) {
  return new Promise((resolve, reject) => {
    let u;
    try {
      u = new URL(url);
    } catch (e) {
      return reject(new Error('非法 URL: ' + url));
    }
    if (u.protocol !== 'https:') return reject(new Error('仅支持 https：' + url));

    const payload = body === undefined ? null : JSON.stringify(body);
    const req = https.request(
      {
        method,
        hostname: u.hostname,
        port: u.port || 443,
        path: u.pathname + u.search,
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {}),
          ...headers,
        },
      },
      (res) => {
        let text = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => {
          text += chunk;
          if (text.length > 4 * 1024 * 1024) req.destroy(new Error('响应体过大'));
        });
        res.on('end', () => {
          let json = null;
          try {
            json = text ? JSON.parse(text) : null;
          } catch (e) {
            json = null;
          }
          resolve({ status: res.statusCode, headers: res.headers, json, text });
        });
      }
    );

    req.setTimeout(timeoutMs, () => {
      const err = new Error('上游请求超时（' + timeoutMs + 'ms）');
      err.code = 'E_TIMEOUT';
      req.destroy(err);
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

module.exports = { jsonRequest };
