'use strict';

const { jsonRequest } = require('./http');

const DEFAULT_BASE_URL = 'https://api.deepseek.com';
// 官方现役模型名。旧名 deepseek-v4-flash-vision-exp 已被路由到同一模型，不要再写死旧名。
const DEFAULT_MODEL = 'deepseek-flash';

function chatUrl(baseUrl) {
  const b = String(baseUrl || DEFAULT_BASE_URL).replace(/\/+$/, '');
  if (/\/chat\/completions$/.test(b)) return b;
  return `${b}/chat/completions`;
}

function isOfficialHost(baseUrl) {
  try {
    return new URL(baseUrl).hostname.endsWith('deepseek.com');
  } catch (e) {
    return false;
  }
}

/** 容错解析：模型偶尔会包一层 ```json 或加一句前言 */
function parseJsonLoose(text) {
  if (typeof text !== 'string' || !text.trim()) throw new Error('模型返回为空');
  let s = text.trim();
  const fence = /```(?:json)?\s*([\s\S]*?)```/i.exec(s);
  if (fence) s = fence[1].trim();
  const first = Math.min(...['{', '['].map((c) => (s.indexOf(c) === -1 ? Infinity : s.indexOf(c))));
  if (first === Infinity) throw new Error('模型返回里找不到 JSON');
  const lastObj = s.lastIndexOf('}');
  const lastArr = s.lastIndexOf(']');
  const last = Math.max(lastObj, lastArr);
  if (last <= first) throw new Error('模型返回的 JSON 不完整');
  s = s.slice(first, last + 1);
  try {
    return JSON.parse(s);
  } catch (e) {
    // 常见小毛病：尾随逗号
    try {
      return JSON.parse(s.replace(/,\s*([}\]])/g, '$1'));
    } catch (e2) {
      throw new Error('模型返回的 JSON 无法解析: ' + e2.message);
    }
  }
}

/**
 * @param {object} opts
 * @param {string} opts.baseUrl  形如 https://api.deepseek.com 或 https://xxx/v1
 * @param {string} opts.apiKey
 * @param {string} [opts.model]
 * @param {Array}  opts.messages  OpenAI 兼容 messages
 * @param {boolean} [opts.jsonMode]
 * @param {number} [opts.maxTokens]
 * @param {number} [opts.timeoutMs]
 */
async function chat(opts) {
  const {
    baseUrl = DEFAULT_BASE_URL,
    apiKey,
    model = DEFAULT_MODEL,
    messages,
    jsonMode,
    maxTokens = 2048,
    timeoutMs = 45000,
    temperature = 0.2,
  } = opts || {};

  if (!apiKey) {
    const err = new Error('未配置 API Key');
    err.code = 'E_NO_KEY';
    throw err;
  }
  const useJson = jsonMode === undefined ? isOfficialHost(baseUrl) : Boolean(jsonMode);

  const body = {
    model,
    messages,
    max_tokens: maxTokens,
    temperature,
    stream: false,
  };
  if (useJson) body.response_format = { type: 'json_object' };

  const res = await jsonRequest({
    url: chatUrl(baseUrl),
    method: 'POST',
    timeoutMs,
    headers: { Authorization: `Bearer ${apiKey}` },
    body,
  });

  if (res.status !== 200) {
    const detail = (res.json && res.json.error && (res.json.error.message || res.json.error.type)) || String(res.text).slice(0, 200);
    const err = new Error(`上游模型返回 ${res.status}：${detail}`);
    err.code = res.status === 401 || res.status === 403 ? 'E_BAD_KEY' : 'E_UPSTREAM';
    throw err;
  }
  const choice = res.json && res.json.choices && res.json.choices[0];
  const content = choice && choice.message ? choice.message.content : '';
  return {
    content,
    finishReason: choice ? choice.finish_reason : null,
    usage: (res.json && res.json.usage) || null,
    model: (res.json && res.json.model) || model,
    raw: res.json,
  };
}

module.exports = { chat, parseJsonLoose, chatUrl, DEFAULT_MODEL, DEFAULT_BASE_URL, isOfficialHost };
