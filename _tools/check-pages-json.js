// 临时校验：pages.json（HBuilderX 会写 JSON5 注释，先剥注释再 parse）
const fs = require('fs')
const path = require('path')
const file = path.join(__dirname, '..', 'uniapp', 'pages.json')
const raw = fs.readFileSync(file, 'utf8')

// ⚠️ 别用 `line.replace(/\/\/.*$/, '')` 剥行注释 —— 工作区文件是 CRLF，
// 行尾那个 `\r` 是 JS 正则的**行终止符**（`.` 不匹配它），于是 `.*$` 到不了字符串末尾、
// 整条正则匹配失败、`// 模式配置` 一个字都剥不掉 → JSON.parse 直接炸。
// （2026-10-11：HBuilderX 往末尾追加了 condition 块，正好踩出来。）
// 所以这里用状态机逐字符扫，顺带保证不会误伤字符串里的 `http://`。
function stripJsonComments(s) {
  let out = ''
  let inStr = false
  let quote = ''
  let esc = false
  for (let i = 0; i < s.length; i++) {
    const c = s[i]
    if (inStr) {
      out += c
      if (esc) esc = false
      else if (c === '\\') esc = true
      else if (c === quote) inStr = false
      continue
    }
    if (c === '"' || c === "'") { inStr = true; quote = c; out += c; continue }
    if (c === '/' && s[i + 1] === '/') {
      while (i < s.length && s[i] !== '\n') i++
      out += '\n'
      continue
    }
    if (c === '/' && s[i + 1] === '*') {
      i += 2
      while (i < s.length && !(s[i] === '*' && s[i + 1] === '/')) {
        if (s[i] === '\n') out += '\n'
        i++
      }
      i++
      continue
    }
    out += c
  }
  return out
}

const cleaned = stripJsonComments(raw)
try {
  const o = JSON.parse(cleaned)
  console.log('pages.json OK  pages=' + o.pages.length)
  console.log('globalStyle   =', JSON.stringify(o.globalStyle))

  // 软键盘模式：必须是 adjustResize。
  // 默认的 adjustPan 会把**整个 window 往上推**，position:fixed 的顶栏 / 悬浮胶囊是相对
  // window 定位的 → 跟着整窗上移跑出屏幕（真机现象：一打开输入法顶栏就"卡 bug 看不见了"）。
  // adjustResize 压的是 webview 可视区高度，window 不动，fixed 留在原地。
  const mode = (o.globalStyle || {})['app-plus'] && (o.globalStyle['app-plus'] || {}).softinputMode
  if (mode === 'adjustResize') console.log('softinputMode = adjustResize OK')
  else {
    console.error('softinputMode 必须是 adjustResize（当前 ' + mode + '）→ 键盘弹出会把 fixed 顶栏顶出屏幕')
    process.exitCode = 1
  }

  const bad = []
  o.pages.forEach(p => {
    if (!fs.existsSync(path.join(__dirname, '..', 'uniapp', p.path + '.vue'))) bad.push(p.path)
  })
  console.log('missing files =', bad.length ? bad.join(', ') : 'none')
} catch (e) {
  console.log('pages.json FAIL:', e.message)
  process.exitCode = 1
}
