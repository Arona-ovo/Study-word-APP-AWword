// _tools/check-tpl-depth.js - 严格嵌套检查：栈式扫描所有 .vue 模板，抓闭合顺序错误
// 背景：check-tpl-balance.js 只数开/闭数量，遇到"总数相同但嵌套错位"会漏报
//       （本次 home.vue 多了一个 </view>，vite 报 Invalid end tag，就是这种）
const fs = require('fs');
const path = require('path');
const { scanTemplate, scanVElse } = require('./lib/tpl-depth');

const ROOT = path.resolve(__dirname, '..', 'uniapp');

function walk(dir, out) {
  fs.readdirSync(dir).forEach(name => {
    const p = path.join(dir, name);
    const st = fs.statSync(p);
    if (st.isDirectory()) {
      if (name === 'node_modules' || name === 'unpackage' || name === '.hbuilderx') return;
      walk(p, out);
    } else if (p.endsWith('.vue')) {
      out.push(p);
    }
  });
  return out;
}

const files = walk(ROOT, []);
let bad = 0;

files.forEach(f => {
  const src = fs.readFileSync(f, 'utf8');
  const start = src.indexOf('<template>');
  const lastEnd = src.lastIndexOf('</template>');
  if (start < 0 || lastEnd <= start) return;
  const tpl = src.slice(start, lastEnd + '</template>'.length);
  const r = scanTemplate(tpl);
  const rel = path.relative(ROOT, f);
  const vbad = scanVElse(tpl);
  if (r.depth === 0 && r.negative.length === 0 && vbad.length === 0) return;
  bad++;
  console.error('✗ ' + rel);
  vbad.slice(0, 3).forEach(x => {
    console.error('    第 ' + x.line + ' 行：<' + x.tag + '> 的 v-' + x.kind +
      ' 前面没有相邻的 v-if（前一个兄弟的分支类型 = ' + x.prev +
      '，多半是在 v-if / v-else 之间插了别的元素）');
  });
  if (r.negative.length) {
    r.negative.slice(0, 3).forEach(x => {
      console.error('    第 ' + x.line + ' 行：</' + x.tag + '>' +
        (x.expected ? ' 但栈顶是 <' + x.expected + '>' : ' 没有可匹配的开始标签'));
    });
  }
  if (r.depth > 0) {
    r.unclosed.slice(-3).forEach(x => {
      console.error('    未闭合：<' + x.tag + '>（第 ' + x.line + ' 行开始）');
    });
  }
});

/* ---------------- 自检：scanVElse 自己别退化成"永远绿" ---------------- */
// 真出事那次（practice.vue 插 <confusion-card> 拆散 v-else）全是 GREEN，
// 因为自闭合的 <view v-else/> 没被认成分支 —— 断言形同虚设。所以这里把
// 该红 / 该绿的各钉几条，断言本身也要被校验。
const SELF = [
  [1, 'v-if 与 v-else 之间插了自闭合组件', '<template><view v-if="a"/><confusion-card\n :show="x"\n/><view v-else/></template>'],
  [1, 'v-if 与 v-else 之间插了带内容的组件', '<template><view v-if="!empty">a</view><confusion-card\n :show="x"\n/><view v-else class="empty">b</view></template>'],
  [1, 'v-else 前面什么都没有', '<template><view v-else>x</view></template>'],
  [1, '嵌套层里被无关元素拆散', '<template><view><text v-if="a">1</text><text>2</text><text v-else>3</text></view></template>'],
  [0, '注释不算兄弟（不拆散配对）', '<template><view v-if="a">a</view><!-- 说明 --><view v-else>b</view></template>'],
  [0, 'v-if / v-else-if / v-else 链', '<template><view v-if="a">1</view><view v-else-if="b">2</view><view v-else>3</view></template>'],
  [0, '组件放在 v-else 之后（正确修法）', '<template><view v-if="!empty">a</view><view v-else>b</view><confusion-card :show="x" /></template>']
];
let selfBad = 0;
SELF.forEach(function (c) {
  const got = scanVElse(c[2]).length;
  if (got > 0 !== c[0] > 0) {
    selfBad++;
    console.error('✗ 自检不符预期：' + c[1] + '（期望 ' + (c[0] ? '报错' : '通过') + '）');
  }
});
console.log(selfBad === 0
  ? 'v-else 配对检查自检通过 ✓（' + SELF.length + ' 条：该红的红、该绿的绿）'
  : 'v-else 配对检查自检失败 ' + selfBad + ' 条 ✗');

console.log('');
const total = bad + selfBad;
console.log(total === 0
  ? ('嵌套检查通过 ✓（' + files.length + ' 个 .vue）')
  : ('发现 ' + total + ' 处异常 ✗'));
process.exit(total === 0 ? 0 : 1);
