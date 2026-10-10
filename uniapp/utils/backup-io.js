// utils/backup-io.js - 备份文件的落地 / 分享 / 取回（跨端）
//
// 只管"怎么把那串文本搬到另一台手机上"，不管内容（那是 backup.js 的事）。
//
// ---------- 三端的现实差异 ----------
// App（主战场）：plus.io 写文件 + 系统分享面板。
//   系统分享面板才是重点 —— Android 的分享面板里就有 Quick Share / 附近分享，
//   以及小米互传、华为分享、OPPO / vivo 互传（四家已互通，走 Wi-Fi 直连，
//   60~140MB/s）。也就是说**手机对手机无线直传不用我们自己实现**，
//   调起系统分享就等于支持了。
//   ⚠️ 私有目录的文件不能直接塞 file:// 给别的 App：Android 7+ 会抛
//   FileUriExposedException。必须过 FileProvider 换成 content:// ——
//   HBuilderX 云打包内置了 io.dcloud.common.util.DCloud_FileProvider。
//   拿不到它就降级：不分享，只告诉用户文件在哪、并提供"复制内容"兜底。
// H5：Blob + a.download 下载；导入走 <input type="file">。
// 小程序：没有可用的通用文件分享 API，导出/导入都走剪贴板（内容大时可能截断，
//   所以提示里要说清楚）。
//
// 任何一步失败都不许把用户卡死：全部有降级路径，且失败信息要写成"下一步该做什么"。

let PLATFORM = '';

export function platform() {
  if (PLATFORM) return PLATFORM;
  try {
    const info = uni.getSystemInfoSync ? uni.getSystemInfoSync() : {};
    const p = String(info.platform || '').toLowerCase();
    // uni-app 在 App 端还会给 uniPlatform / appName，优先用它判断
    if (info.uniPlatform === 'app' || info.appName) return (PLATFORM = 'app');
    if (info.uniPlatform === 'web' || info.uniPlatform === 'h5') return (PLATFORM = 'h5');
    if (info.uniPlatform && String(info.uniPlatform).indexOf('mp') === 0) return (PLATFORM = 'mp');
    if (typeof plus !== 'undefined' && plus && plus.io) return (PLATFORM = 'app');
    if (typeof document !== 'undefined' && document.createElement) return (PLATFORM = 'h5');
    if (p === 'android' || p === 'ios') return (PLATFORM = 'app');
    return (PLATFORM = 'mp');
  } catch (e) {
    return (PLATFORM = 'unknown');
  }
}

/** 备份放在哪个目录：优先公共下载目录（用户在文件管理里能找到），失败退回私有目录 */
function dirCandidates() {
  // _downloads = plus.io.PUBLIC_DOWNLOADS，_doc = plus.io.PRIVATE_DOC
  return ['_downloads/awword/', '_doc/awword/', '_doc/'];
}

/* ------------------------------------------------------------------ 写文件 */

function writeViaPlus(relPath, text) {
  return new Promise((resolve) => {
    try {
      if (typeof plus === 'undefined' || !plus.io) return resolve(null);
      plus.io.requestFileSystem(plus.io.PRIVATE_DOC, () => {
        plus.io.resolveLocalFileSystemURL(
          relPath.replace(/\/[^/]+$/, '/'),
          (dir) => {
            dir.getFile(
              relPath.replace(/^.*\//, ''),
              { create: true },
              (entry) => {
                entry.createWriter(
                  (writer) => {
                    // 注意返回**传入的相对路径**而不是 entry.fullPath：
                    // 目录不存在时下面会降级到另一个目录，实际写入的位置已经不是 relPath 了，
                    // 但递归调用传的是新路径 —— 调用方必须拿到"真正写到了哪"，
                    // 否则分享时按旧路径找文件会找不到。
                    writer.onwrite = () => resolve(relPath);
                    writer.onerror = () => resolve(null);
                    writer.write(text);
                  },
                  () => resolve(null)
                );
              },
              () => resolve(null)
            );
          },
          // 目录不存在：先建目录再重试一次
          () => {
            try {
              plus.io.resolveLocalFileSystemURL('_doc/', (root) => {
                root.getDirectory(
                  'awword',
                  { create: true },
                  (d) => {
                    const p = (d.fullPath || '_doc/awword/').replace(/\/+$/, '') + '/' + relPath.replace(/^.*\//, '');
                    writeViaPlus(p, text).then(resolve);
                  },
                  () => resolve(null)
                );
              }, () => resolve(null));
            } catch (e) {
              resolve(null);
            }
          }
        );
      }, () => resolve(null));
    } catch (e) {
      resolve(null);
    }
  });
}

/**
 * 把备份写成文件。返回 { ok, path, dir }
 * path 是相对路径（_doc/xxx / _downloads/xxx），分享时要先转成绝对路径。
 */
export async function writeBackup(text, fileName) {
  const p = platform();
  if (p === 'app') {
    // 先试公共下载目录：用户能在"文件管理 → 下载"里翻到它。
    // 拿 writeViaPlus 返回的路径，不要拿自己拼的 rel —— 降级时两者不一样。
    for (const dir of dirCandidates()) {
      const got = await writeViaPlus(dir + fileName, text);
      if (got) return { ok: true, path: got, dir: got.replace(/\/[^/]+$/, '/') };
    }
    return { ok: false, path: '', dir: '', reason: 'WRITE_FAILED' };
  }
  if (p === 'h5') {
    try {
      const blob = new Blob([text], { type: 'application/json;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = fileName;
      a.style.display = 'none';
      document.body.appendChild(a);
      a.click();
      setTimeout(() => {
        try {
          document.body.removeChild(a);
          URL.revokeObjectURL(url);
        } catch (e) { /* 清理失败不影响下载 */ }
      }, 1000);
      return { ok: true, path: fileName, dir: 'download' };
    } catch (e) {
      return { ok: false, path: '', dir: '', reason: 'WRITE_FAILED' };
    }
  }
  return { ok: false, path: '', dir: '', reason: 'NO_FILE_API' };
}

/* ------------------------------------------------------------------ 分享 */

/**
 * 调起系统分享面板（App）。
 * 走 FileProvider 换 content:// —— 直接把私有目录的 file:// 交给别的 App，
 * Android 7+ 会直接崩（FileUriExposedException）。
 */
export function shareFile(relPath) {
  return new Promise((resolve) => {
    try {
      if (typeof plus === 'undefined' || !plus.android) return resolve(false);
      const main = plus.android.runtimeMainActivity();
      const Intent = plus.android.importClass('android.content.Intent');
      const File = plus.android.importClass('java.io.File');
      const abs = toAbsolutePath(relPath);
      const file = new File(abs);

      // HBuilderX 云打包内置的 FileProvider；不同基座版本类名可能不同，逐个试
      const pkg = String(plus.android.invoke(main, 'getPackageName') || '');
      let uri = null;
      const providers = [
        ['io.dcloud.common.util.DCloud_FileProvider', pkg + '.dc.fileprovider'],
        ['android.support.v4.content.FileProvider', pkg + '.fileprovider'],
        ['androidx.core.content.FileProvider', pkg + '.fileprovider']
      ];
      for (const pair of providers) {
        try {
          const FP = plus.android.importClass(pair[0]);
          uri = FP.getUriForFile(main, pair[1], file);
          if (uri) break;
        } catch (e) { /* 换下一个 */ }
      }
      if (!uri) return resolve(false);

      const intent = new Intent(Intent.ACTION_SEND);
      // 微信对 type 很挑：用 ContentResolver 问出来的真实类型最稳
      let type = 'application/json';
      try {
        const t = plus.android.invoke(main.getContentResolver(), 'getType', uri);
        if (t) type = String(t);
      } catch (e) { /* 用默认的 */ }
      intent.setType(type || '*/*');
      intent.putExtra(Intent.EXTRA_STREAM, uri);
      intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
      main.startActivity(Intent.createChooser(intent, '导出备份'));
      resolve(true);
    } catch (e) {
      resolve(false);
    }
  });
}

/** 相对路径（_doc/x、_downloads/x）→ 绝对文件路径 */
export function toAbsolutePath(relPath) {
  try {
    if (typeof plus !== 'undefined' && plus.io && plus.io.convertLocalFileSystemURL) {
      const url = plus.io.convertLocalFileSystemURL(String(relPath || ''));
      if (url && String(url).indexOf('file://') === 0) return String(url).replace(/^file:\/\//, '');
    }
  } catch (e) { /* 退回下面 */ }
  return String(relPath || '');
}

/* ------------------------------------------------------------------ 剪贴板 */

export function copyToClipboard(text) {
  return new Promise((resolve) => {
    try {
      uni.setClipboardData({
        data: String(text || ''),
        success: () => resolve(true),
        fail: () => resolve(false)
      });
    } catch (e) {
      resolve(false);
    }
  });
}

export function readClipboard() {
  return new Promise((resolve) => {
    try {
      uni.getClipboardData({
        success: (r) => resolve(String((r && r.data) || '')),
        fail: () => resolve('')
      });
    } catch (e) {
      resolve('');
    }
  });
}

/* ------------------------------------------------------------------ 扫描（导入用） */

function listDir(relDir) {
  return new Promise((resolve) => {
    try {
      if (typeof plus === 'undefined' || !plus.io) return resolve([]);
      plus.io.resolveLocalFileSystemURL(
        relDir,
        (dir) => {
          const reader = dir.createReader();
          reader.readEntries(
            (entries) => {
              const out = [];
              (entries || []).forEach(e => {
                const name = String(e.name || '');
                if (!/^awword-backup-.*\.json$/i.test(name)) return;
                out.push({ name: name, path: relDir.replace(/\/+$/, '') + '/' + name });
              });
              resolve(out);
            },
            () => resolve([])
          );
        },
        () => resolve([])
      );
    } catch (e) {
      resolve([]);
    }
  });
}

/** 扫出手机上已有的备份文件（App）。导入时列出来让用户一键选，比让他翻目录强得多。 */
export async function scanBackups() {
  const p = platform();
  if (p !== 'app') return [];
  const seen = {};
  const out = [];
  for (const dir of dirCandidates()) {
    const list = await listDir(dir);
    (list || []).forEach(f => {
      if (seen[f.path]) return;
      seen[f.path] = true;
      out.push(f);
    });
  }
  // 新到旧：文件名自带日期，倒序排一下
  out.sort((a, b) => (a.name < b.name ? 1 : (a.name > b.name ? -1 : 0)));
  return out;
}

export function readFile(relPath) {
  return new Promise((resolve) => {
    try {
      if (typeof plus === 'undefined' || !plus.io) return resolve('');
      plus.io.resolveLocalFileSystemURL(
        relPath,
        (entry) => {
          entry.file(
            (file) => {
              const reader = new plus.io.FileReader();
              reader.onloadend = (e) => resolve(String((e && e.target && e.target.result) || ''));
              reader.onerror = () => resolve('');
              reader.readAsText(file, 'utf-8');
            },
            () => resolve('')
          );
        },
        () => resolve('')
      );
    } catch (e) {
      resolve('');
    }
  });
}

/**
 * H5 / 小程序：让用户选一个文件（H5 用 input file，小程序没有通用选择器，返回 null）。
 * 返回文件文本，取不到返回 ''。
 */
export function pickFile() {
  const p = platform();
  if (p !== 'h5') return Promise.resolve('');
  return new Promise((resolve) => {
    try {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = '.json,application/json';
      input.style.display = 'none';
      input.onchange = () => {
        const f = input.files && input.files[0];
        if (!f) return resolve('');
        const fr = new FileReader();
        fr.onload = () => resolve(String(fr.result || ''));
        fr.onerror = () => resolve('');
        fr.readAsText(f, 'utf-8');
      };
      document.body.appendChild(input);
      input.click();
      setTimeout(() => {
        try {
          document.body.removeChild(input);
        } catch (e) { /* 清理失败无所谓 */ }
      }, 3000);
    } catch (e) {
      resolve('');
    }
  });
}

/** 这一端能不能读写文件（决定设置页显示"文件"还是"剪贴板"的措辞） */
export function fileCapable() {
  const p = platform();
  return p === 'app' || p === 'h5';
}
