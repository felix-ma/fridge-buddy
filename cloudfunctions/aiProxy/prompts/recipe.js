'use strict';

/** 食谱 prompt：优先消耗临期 / 疑似取出的食材，并标注已有/缺少 */

function buildRecipePrompt({ items = [], upcoming = [], servings = 2 } = {}) {
  const list = items.map((it) => {
    const due = upcoming.some((u) => u.label === it.label) ? '（临期）' : '';
    return `- ${it.label} ×${it.quantity}${due}`;
  });

  const text = `我的冰箱现在有：
${list.join('\n') || '- （空）'}

请基于这些食材给出 3 个${servings}人份家常菜，只输出 json：
{
  "recipes": [
    {
      "name": "番茄炒蛋",
      "reason": "一句话说明为什么推荐（优先用掉临期食材）",
      "uses_existing": ["番茄", "鸡蛋"],
      "missing": ["葱花"],
      "steps": ["步骤1", "步骤2", "步骤3"]
    }
  ]
}

约束：优先用临期食材；missing 里的东西必须是家里常见的调味料或可省略项，不要推荐需要买一堆新食材的菜；步骤每条不超过 30 字；不要编造我没提到的食材。`;

  return { type: 'text', text };
}

module.exports = { buildRecipePrompt };
