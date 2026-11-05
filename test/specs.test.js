const test = require('node:test')
const assert = require('node:assert/strict')

test('specs：所有规格 frontmatter 合法且文件齐全', async () => {
  const { collectSpecs } = await import('../scripts/specs.mjs')
  const specs = collectSpecs()
  assert.ok(specs.length >= 1, '至少要有一份规格')
  const problems = specs.flatMap((s) => s.problems)
  assert.deepEqual(problems, [], '规格格式问题：\n' + problems.join('\n'))
})

test('specs：编号唯一且与目录一致', async () => {
  const { collectSpecs } = await import('../scripts/specs.mjs')
  const ids = collectSpecs().map((s) => s.meta.id)
  assert.equal(new Set(ids).size, ids.length)
})

test('specs：状态值在允许集合内', async () => {
  const { collectSpecs, STATUSES } = await import('../scripts/specs.mjs')
  for (const s of collectSpecs()) assert.ok(STATUSES.includes(s.meta.status), s.name)
})
