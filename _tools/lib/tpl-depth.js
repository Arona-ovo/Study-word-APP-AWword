// _tools/lib/tpl-depth.js - 严格嵌套检查：栈式扫描，抓闭合顺序错误
// 要点：
//   · 先剥离 HTML 注释（<!-- -->），避免注释代码干扰
//   · 整段扫描（不按行），支持属性换行的多行标签
//   · 行号按换行符计数还原，方便定位
// 返回 { depth, unclosed, negative }
//   depth = 扫描结束后仍留在栈里的标签数（应为 0）
//   unclosed = 没被闭合的开始标签
//   negative = 闭合顺序错误（why: 'mismatch'）或多余的结束标签（why: 'no-open'）
function lineOf(str, idx) {
  let n = 1;
  for (let i = 0; i < idx && i < str.length; i++) {
    if (str.charCodeAt(i) === 10) n++;
  }
  return n;
}

function scanTemplate(tpl) {
  const clean = String(tpl).replace(/<!--[\s\S]*?-->/g, '');
  const stack = [];
  const negative = [];
  // 属性值允许跨行（引号内可以有换行与 >）
  const re = /<(\/?)([a-zA-Z][\w-]*)((?:"[^"]*"|'[^']*'|[^>])*?)>/g;
  let m;
  while ((m = re.exec(clean))) {
    const closing = !!m[1];
    const tag = m[2];
    const attrs = m[3] || '';
    const self = /\/\s*$/.test(attrs); // <xxx ... /> 自闭合
    if (self) continue;
    const line = lineOf(clean, m.index);
    if (!closing) {
      stack.push({ tag, line });
    } else if (!stack.length) {
      negative.push({ line, tag, why: 'no-open' });
    } else {
      const top = stack.pop();
      if (top.tag !== tag) {
        negative.push({ line, tag, why: 'mismatch', expected: top.tag, at: top.line });
      }
    }
  }
  return { depth: stack.length, unclosed: stack.slice(), negative };
}

/**
 * v-else / v-else-if 的**配对**检查（栈式，只看同一层的相邻兄弟）。
 *
 * 事故：给 practice.vue 加 <confusion-card> 时，把它插在了 `v-if="!empty"` 的容器
 * 和 `v-else` 的空状态之间 —— 兄弟序列里插进来一个不带 v-if 的元素，
 * v-else 就"没有相邻的 v-if"了，vite 直接编译失败：
 *   [vite:vue] v-else/v-else-if has no adjacent v-if or v-else-if
 * 注释会被剥掉（不算兄弟），但任何**真实元素**（含自闭合组件）都会拆散配对。
 *
 * @returns [{ line, tag, kind, prev }] —— kind='else'/'elseif'，prev 是前一个兄弟的分支类型
 */
function branchAttr(attrs) {
  const a = ' ' + String(attrs || '') + ' ';
  // 末尾也认 `/`：<view v-else/>、<view v-if="a"/> 这种自闭合写法同样算分支
  if (/(^|\s)v-if(\s|=)/.test(a)) return 'if';
  if (/(^|\s)v-else-if(\s|=)/.test(a)) return 'elseif';
  if (/(^|\s)v-else(\s|\/|$)/.test(a)) return 'else';
  return '';
}

function scanVElse(tpl) {
  const clean = String(tpl).replace(/<!--[\s\S]*?-->/g, '');
  const re = /<(\/?)([a-zA-Z][\w-]*)((?:"[^"]*"|'[^']*'|[^>])*?)>/g;
  // 虚拟根：模板顶层的兄弟关系也挂在它下面
  const stack = [{ last: '' }];
  const bad = [];
  let m;
  while ((m = re.exec(clean))) {
    const closing = !!m[1];
    const tag = m[2];
    const attrs = m[3] || '';
    const self = /\/\s*$/.test(attrs);
    if (closing) {
      if (stack.length > 1) stack.pop();
      continue;
    }
    const kind = branchAttr(attrs);
    const parent = stack[stack.length - 1];
    if ((kind === 'else' || kind === 'elseif') && parent.last !== 'if' && parent.last !== 'elseif') {
      bad.push({ line: lineOf(clean, m.index), tag: tag, kind: kind, prev: parent.last || 'none' });
    }
    parent.last = kind;
    if (!self) stack.push({ last: '' });
  }
  return bad;
}

module.exports = { scanTemplate, scanVElse };
