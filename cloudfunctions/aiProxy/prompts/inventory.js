'use strict';

/**
 * 观测 prompt：要求"跨图对齐后的统一清单"，而不是逐图描述。
 * 注意 DeepSeek json mode 要求 prompt 中必须出现 "json" 字样，这里刻意保留。
 */

const ZONE_DEFAULT = ['正面全景', '上层', '中层', '下层', '果蔬盒', '冰箱门'];

function buildInventoryPrompt({ zones = [], existingLabels = [], imageCount = 0 } = {}) {
  const zoneList = (zones.length ? zones : ZONE_DEFAULT).join('、');
  const known = existingLabels.length
    ? `\n已登记食材（优先复用这些名称，避免"鸡蛋/鲜鸡蛋"这类同物异名）：${existingLabels.slice(0, 60).join('、')}。`
    : '';

  const text = `你是冰箱盘点助手。本次共收到 ${imageCount} 张同一台冰箱的照片，请跨图对齐后输出一份统一清单，不要逐图描述。

区域命名只能从下列词中选：${zoneList}。photos 顺序即拍摄顺序，第 1 张为正面全景，其余为分层/分区。
${known}

要求：
1. 同一食材在多张照片中出现，只输出一条，appears_in 记录出现的图序号（从 1 开始）。
2. 只有确实看清才给 high；被遮挡、模糊、只露一角给 medium 或 low。
3. 拿不准的东西放进 uncertain 数组，不要为了凑数强行给 high。宁缺毋滥。
4. quantity_estimate 是可见数量，看不清就填 null，不要猜。
5. 完全看不清或不像食材的画面，返回空数组。

只输出 json，结构固定如下：
{
  "items": [
    {"label": "牛奶", "appears_in": [2, 3], "zone_hint": "中层", "confidence": "high", "quantity_estimate": 2}
  ],
  "uncertain": [
    {"label": "疑似酱料瓶", "zone_hint": "冰箱门", "quantity": null}
  ]
}`;
  return { type: 'text', text };
}

module.exports = { buildInventoryPrompt, ZONE_DEFAULT };
