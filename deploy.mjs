#!/usr/bin/env node
/**
 * 1024 参赛作品的部署脚本 —— 一条命令推版本 + 注入 commit + 三视角验证。
 *
 * ## 为什么需要它
 *
 * 评分策略的推论是「**先上墙占位，再迭代修复**」—— 投稿后链接内容可持续更新到 11/1。
 * 「上墙」的前提是**已经有一个能打开的链接**，所以部署不是收尾工作，而是**实现期第一天
 * 就要就位的前置条件**。
 *
 * 有了链接之后，真正的风险变成「**推上去的到底是哪一版？**」。评委点开链接时看到什么，
 * 是不是我们以为的那一版——如果没有留痕，这个问题永远无法回答。
 *
 * ## 它做什么
 *
 * 1. 把当前 commit SHA 注入 `index.html` 的 `<meta name="build-commit">`（可追溯）
 * 2. 提交并推送到 GitHub Pages
 * 3. 等 Pages 构建完成
 * 4. **三视角验证**（这是小Q 提的验收判据，本机 curl 200 不代表评委能打开）：
 *    - ① 本机 curl
 *    - ② 手机热点换运营商（**需人工**，脚本会提示）
 *    - ③ check-host 外部多点探测
 * 5. 打印**三行交接件**（产物 / 怎么验 / 已知没做）—— 第三行最值钱：
 *    接力变甩锅几乎都发生在「以为对方知道我没做」上
 *
 * ## 用法
 *
 *     node deploy.mjs                 # 部署当前工作区
 *     node deploy.mjs --no-verify     # 只推不验
 *     node deploy.mjs --url <url>     # 指定要验的地址
 *
 * ## 前置
 *
 * - `gh` 已登录（`gh auth status`）
 * - 仓库已开 Pages（source=main, path=/）
 * - 首次推送若直连失败，脚本会自动改用本机代理
 */
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'

const ROOT = path.dirname(fileURLToPath(import.meta.url))
const GIT = 'C:\\Program Files\\Git\\cmd\\git.exe'
const GH = 'C:\\Program Files\\GitHub CLI\\gh.exe'
const NODE = process.execPath

const args = process.argv.slice(2)
const has = flag => args.includes(flag)
const value = flag => { const i = args.indexOf(flag); return i >= 0 ? args[i + 1] : undefined }

const REPO = 'anyi2686/1024-council'
// ⚠️ 名字别叫 `URL` —— 那会遮蔽全局的 `URL` 构造函数，`new URL(import.meta.url)` 直接炸
// （"Cannot access 'URL' before initialization"）。踩过。
const SITE_URL = value('--url') ?? `https://${REPO.split('/')[0]}.github.io/1024-council/`

/** 跑一个命令，拿 stdout；失败时抛错（带 stderr 便于判断是网络问题还是命令问题）。 */
function run(command, commandArgs, options = {}) {
  try {
    return execFileSync(command, commandArgs, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      ...options,
    })
  } catch (error) {
    const stderr = error.stderr?.toString() ?? ''
    const stdout = error.stdout?.toString() ?? ''
    throw new Error(`${command} ${commandArgs.join(' ')} 失败：\n${stderr || stdout || error.message}`)
  }
}

const git = (commandArgs, options) => run(GIT, ['-C', ROOT, ...commandArgs], options)

/** push：先直连，失败再走本机代理（本机在国内，直连常被 reset）。 */
function push() {
  const direct = { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }
  try {
    return run(GIT, ['-C', ROOT, '-c', 'http.https://github.com.proxy=', '-c', 'http.proxy=', 'push', 'origin', 'main'], direct)
  } catch (error) {
    console.log('  直连失败，改用本机代理重试…')
    return run(GIT, ['-C', ROOT, '-c', 'http.https://github.com.proxy=socks5h://127.0.0.1:65532', 'push', 'origin', 'main'], direct)
  }
}

// ── 1. 注入版本留痕 ───────────────────────────────────────────────────
// ⚠️ **自指问题**（实测踩过）：把「当前 HEAD 的 SHA」写进页面 → 这个写操作本身
// 产生**新 commit** → 线上页面记的是「注入前」的 SHA，与真正部署的那次提交对不上。
// 用 `git commit --amend` 也无解：amend 后 SHA 又变了，**死循环**。
//
// 正确的标识方式：**内容指纹** —— 对「去掉留痕字段本身之后的 index.html」取 SHA256。
// 它与 git SHA 变化**完全无关**（内容变了指纹才变），所以自洽、可复算。
//
// 于是线上有两个稳定标识：
//   · `build-version`：单调递增的版本号（v1 / v2 …），由 version.txt 维护 —— 人读
//   · `build-content`：内容指纹（sha256 前 12 位）—— 机读、可复算
// 而「线上是哪一次提交」由账本记：版本号 → git log 里 version.txt 等于该号的那次提交。
//
// 顺带把 git 短 SHA 也写进 meta（`build-commit`）——它**可能**指向相邻的一次提交，
// 仅作参考，**以 build-content 为准**。
const versionFile = path.join(ROOT, 'version.txt')
const currentVersion = fs.existsSync(versionFile)
  ? Number(fs.readFileSync(versionFile, 'utf8').trim())
  : 0
const nextVersion = currentVersion + 1

// 先把内容改动提交（如果有）
const dirty = git(['status', '--porcelain']).trim()
if (dirty) {
  git(['add', '-A'])
  git(['-c', 'user.name=anyi2686', '-c', 'user.email=anyi2686@qq.com', 'commit', '-m', `feat: 作品内容更新（v${nextVersion}）`])
  console.log(`✅ 内容改动已提交（v${nextVersion}）`)
}

const indexPath = path.join(ROOT, 'index.html')
let html = fs.readFileSync(indexPath, 'utf8')

/** 去掉留痕字段后的内容 —— 这才是被指纹的「作品本体」。 */
const withoutStamps = text => text
  .replace(/\s*<meta name="build-commit" content="[^"]*">/g, '')
  .replace(/\s*<meta name="build-version" content="[^"]*">/g, '')
  .replace(/\s*<meta name="build-content" content="[^"]*">/g, '')

const contentHash = createHash('sha256').update(withoutStamps(html), 'utf8').digest('hex').slice(0, 12)
const short = git(['rev-parse', '--short', 'HEAD']).trim()

const before = html
html = html.replace(
  /<meta name="build-commit" content="[^"]*">/,
  `<meta name="build-commit" content="${short}">`,
)
html = html.replace(
  /<meta name="build-version" content="[^"]*">/,
  `<meta name="build-version" content="v${nextVersion}">`,
)
html = html.replace(
  /<meta name="build-content" content="[^"]*">/,
  `<meta name="build-content" content="${contentHash}">`,
)
if (html === before) {
  console.log('⚠️  index.html 里没有 build-* meta，跳过注入（版本将无法追溯）')
} else {
  fs.writeFileSync(indexPath, html, 'utf8')
  fs.writeFileSync(versionFile, `${nextVersion}\n`, 'utf8')
  console.log(`✅ 版本留痕已注入：v${nextVersion} / 内容指纹 ${contentHash} / commit ${short}`)
}

// 注入本身又产生改动 → 再提交一次（这次只含留痕）
const dirtyAfter = git(['status', '--porcelain']).trim()
if (dirtyAfter) {
  git(['add', '-A'])
  git(['-c', 'user.name=anyi2686', '-c', 'user.email=anyi2686@qq.com', 'commit', '-m', `chore: 版本留痕 v${nextVersion} (${contentHash})`])
  console.log('   已提交版本留痕改动')
}

// ── 2. 推送 ──────────────────────────────────────────────────────────
console.log('\n▶ 推送…')
push()
console.log('   已推送 main')

// ── 3. 等 Pages 构建 ─────────────────────────────────────────────────
if (!has('--no-verify')) {
  console.log('\n▶ 等 Pages 构建…')
  let built = false
  for (let attempt = 0; attempt < 18; attempt++) {
    await new Promise(resolve => setTimeout(resolve, 5000))
    let status = ''
    try {
      status = run(GH, ['api', `repos/${REPO}/pages`, '--jq', '.status']).trim()
    } catch { continue }
    if (status === 'built') { built = true; break }
  }
  console.log(built ? '   构建完成' : '   ⚠️ 构建未在 90 秒内完成（可稍后再验）')
}

// ── 4. 三视角验证 ────────────────────────────────────────────────────
const results = []

if (!has('--no-verify')) {
  console.log('\n▶ 视角① 本机 curl')
  try {
    const output = run('curl.exe', ['-s', '-o', 'NUL', '-w', '%{http_code} %{time_total}', '--max-time', '15', SITE_URL])
    const [code, seconds] = output.trim().split(/\s+/)
    const ok = code === '200'
    results.push({ view: '本机', ok, detail: `HTTP ${code} / ${Number(seconds).toFixed(2)}s` })
    console.log(`   ${ok ? '✅' : '❌'} HTTP ${code}  ${Number(seconds).toFixed(2)}s`)
  } catch (error) {
    results.push({ view: '本机', ok: false, detail: error.message.split('\n')[0] })
    console.log(`   ❌ ${error.message.split('\n')[0]}`)
  }

  console.log('\n▶ 视角② 手机热点（换运营商）')
  console.log('   ⚠️  需人工：切到手机热点后执行')
  console.log(`      curl -s -o NUL -w "%{http_code}" ${SITE_URL}`)
  results.push({ view: '手机热点', ok: null, detail: '需人工执行' })

  console.log('\n▶ 视角③ 外部多点探测')
  const probe = path.join('C:\\Users\\anyi2\\.workbuddy\\agent-log', 'tools', 'check-host-probe.mjs')
  if (fs.existsSync(probe)) {
    try {
      const output = run(NODE, [probe, SITE_URL])
      const lines = output.split('\n').filter(line => line.includes('HTTP='))
      const allOk = lines.length > 0 && lines.every(line => line.includes('HTTP=200'))
      results.push({ view: '外部多点', ok: allOk, detail: `${lines.filter(l => l.includes('HTTP=200')).length}/${lines.length} 节点 200` })
      for (const line of lines) console.log(`   ${line.trim()}`)
    } catch (error) {
      results.push({ view: '外部多点', ok: false, detail: error.message.split('\n')[0] })
      console.log(`   ❌ ${error.message.split('\n')[0]}`)
    }
  } else {
    results.push({ view: '外部多点', ok: null, detail: '探针工具不存在' })
    console.log('   ⚠️  探针工具不存在，跳过')
  }
}

// ── 5. 三行交接件 ────────────────────────────────────────────────────
const failed = results.filter(r => r.ok === false)
console.log('\n' + '─'.repeat(64))
console.log('📦 三行交接件')
console.log('─'.repeat(64))
console.log(`产物：${SITE_URL}  （commit ${short}）`)
console.log(`怎么验：curl -s -o NUL -w "%{http_code}" ${SITE_URL}  或直接点开链接`)
console.log(`已知没做：${failed.length === 0
  ? '视图②手机热点尚未人工验证（脚本无法代做）'
  : failed.map(r => `${r.view} 未通过（${r.detail}）`).join('；')}`)
console.log('─'.repeat(64))
console.log(`线上地址：${SITE_URL}`)
console.log(`commit  ：${commit}`)
console.log(`时间    ：${new Date().toLocaleString('zh-CN')}`)

if (failed.length > 0) process.exitCode = 1
