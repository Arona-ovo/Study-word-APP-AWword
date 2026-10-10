// data/build-info.js - 内置语料规模快照（**自动生成，请勿手改**）
// 生成脚本：_vocab/build.js（node _vocab/build.js）
//
// 存在意义：设置页（分包 pkgManage）的彩蛋要显示这些数字，但不能 import 语料本身
// —— 那会把 100KB+ 的语料再复制一份进分包。这里只存几个数字，几百字节。
//
// version 是对外显示的版本号（设置 › 关于 › 版本），改它同时要改 manifest.json
// 的 versionName，两处保持一致（check-version-egg.js 会盯）。
export const BUILD_INFO = {
  version: '1.1 Beta',
  lexCount: 3893,
  coreCount: 640,
  bookCount: 6,
  sentenceCount: 626,
  builtAt: '2026-10-09'
}
