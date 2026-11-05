#!/usr/bin/env node
// 规格清单与校验：npm run specs / npm run spec:check
import { readdirSync, readFileSync, existsSync, statSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
export const SPECS_DIR = join(ROOT, 'specs')

export const STATUSES = ['draft', 'approved', 'in-progress', 'implemented', 'verified', 'dropped']
const REQUIRED = ['id', 'title', 'status', 'owner', 'updated']
const FILES = ['spec.md', 'plan.md', 'tasks.md']

export function parseFrontmatter(text) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text)
  if (!m) return null
  const out = {}
  for (const line of m[1].split(/\r?\n/)) {
    const hit = /^([A-Za-z0-9_-]+)\s*:\s*(.*)$/.exec(line.trim())
    if (hit) out[hit[1]] = hit[2].trim().replace(/^["']|["']$/g, '')
  }
  return out
}

export function listSpecDirs(dir = SPECS_DIR) {
  return readdirSync(dir)
    .filter((name) => /^\d{3}-/.test(name) && statSync(join(dir, name)).isDirectory())
    .sort()
}

export function readSpec(name, dir = SPECS_DIR) {
  const base = join(dir, name)
  const specPath = join(base, 'spec.md')
  const problems = []
  for (const f of FILES) {
    if (!existsSync(join(base, f))) problems.push(`${name}: 缺少 ${f}`)
  }
  if (!existsSync(specPath)) return { name, meta: null, problems }
  const meta = parseFrontmatter(readFileSync(specPath, 'utf8'))
  if (!meta) problems.push(`${name}: spec.md 缺少 frontmatter`)
  else {
    for (const key of REQUIRED) {
      if (!meta[key]) problems.push(`${name}: frontmatter 缺少 ${key}`)
    }
    if (meta.status && !STATUSES.includes(meta.status)) {
      problems.push(`${name}: status "${meta.status}" 不在 ${STATUSES.join('/')} 中`)
    }
    const num = name.slice(0, 3)
    if (meta.id && meta.id !== num) problems.push(`${name}: id "${meta.id}" 与目录编号 ${num} 不一致`)
    if (meta.updated && !/^\d{4}-\d{2}-\d{2}$/.test(meta.updated)) {
      problems.push(`${name}: updated 应为 YYYY-MM-DD`)
    }
  }
  return { name, meta, problems }
}

export function collectSpecs(dir = SPECS_DIR) {
  const specs = listSpecDirs(dir).map((name) => readSpec(name, dir))
  const seen = new Set()
  for (const s of specs) {
    if (s.meta && s.meta.id) {
      if (seen.has(s.meta.id)) s.problems.push(`${s.name}: id ${s.meta.id} 重复`)
      seen.add(s.meta.id)
    }
  }
  return specs
}

function pad(s, n) {
  const width = [...String(s)].reduce((w, ch) => w + (ch.charCodeAt(0) > 0x7f ? 2 : 1), 0)
  return String(s) + ' '.repeat(Math.max(0, n - width))
}

function main(argv) {
  const cmd = argv[2] || 'list'
  const specs = collectSpecs()
  if (!specs.length) {
    console.error('specs/ 里没有规格')
    return 1
  }
  const broken = specs.filter((s) => s.problems.length)
  if (cmd === 'check') {
    for (const s of broken) for (const p of s.problems) console.error('✗ ' + p)
    console.log(broken.length ? `\n${broken.length}/${specs.length} 份规格有问题` : `✓ ${specs.length} 份规格全部通过`)
    return broken.length ? 1 : 0
  }
  for (const s of specs) {
    const meta = s.meta || {}
    console.log(`${pad(s.name, 30)} ${pad(meta.status || '?', 14)} ${meta.title || ''}`)
  }
  if (broken.length) {
    console.log(`\n${broken.length} 份有格式问题：npm run spec:check`)
    return 2
  }
  return 0
}

if (process.argv[1] && process.argv[1].endsWith('specs.mjs')) {
  process.exit(main(process.argv))
}
