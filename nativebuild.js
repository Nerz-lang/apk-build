// ═══════════════════════════════════════════════════════════════════════════
//  nativebuild.js — BUILD NATIVE (Android Java WebView) untuk Web To APK
//
//  Diadaptasi dari "aaaaaa_example_code_rich" (assets/android-native-template-safe
//  + worker/projectPrep.js). Bedanya dengan mode Flutter:
//    • Tidak butuh Flutter SDK -> build lebih cepat & APK lebih kecil (~ 2-3 MB).
//    • Bot menyiapkan project Gradle (URL, nama app, package id, ikon) lalu
//      meng-ZIP-nya; worker GitHub hanya menjalankan `gradlew assemble<Type>`.
//
//  prepare() -> { zipPath, packageName, cleanup() }
// ═══════════════════════════════════════════════════════════════════════════
const fs = require("fs");
const os = require("os");
const path = require("path");
const AdmZip = require("adm-zip");

let sharp = null;
try { sharp = require("sharp"); } catch (_) { sharp = null; }

const TEMPLATE_DIR = path.join(__dirname, "assets", "android-native-template-safe");

const ICON_SPECS = [
  ["mipmap-mdpi", 48], ["mipmap-hdpi", 72], ["mipmap-xhdpi", 96], ["mipmap-xxhdpi", 144], ["mipmap-xxxhdpi", 192],
];

const escapeXml = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "\\'");
const escapeJava = (s) => String(s ?? "").replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\r?\n/g, " ");
// URL disamarkan: dibalik lalu Base64 (sesuai decodeUrl() di MainActivity template)
const encodeUrl = (url) => Buffer.from(String(url || "").split("").reverse().join(""), "utf8").toString("base64");

/** Package id valid dari nama app: com.danzmodss.<slug><angka> */
function makePackageName(appName, seed = Date.now()) {
  const slug = String(appName || "app").normalize("NFKD").toLowerCase().replace(/[^a-z0-9]+/g, "").replace(/^[0-9]+/, "").slice(0, 14) || "app";
  return `com.danzmodss.${slug}${String(seed).slice(-4)}`;
}
const validPackage = (p) => /^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*){2,}$/.test(String(p || ""));

function copyDir(src, dst) {
  fs.mkdirSync(dst, { recursive: true });
  for (const ent of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, ent.name), d = path.join(dst, ent.name);
    if (ent.isDirectory()) copyDir(s, d); else fs.copyFileSync(s, d);
  }
}

function patchFile(file, fn) {
  if (!fs.existsSync(file)) return false;
  const before = fs.readFileSync(file, "utf8");
  const after = fn(before);
  if (after !== before) fs.writeFileSync(file, after, "utf8");
  return true;
}

async function applyIcon(projectDir, iconPath) {
  if (!sharp || !iconPath || !fs.existsSync(iconPath)) return false;
  try {
    const meta = await sharp(iconPath).metadata();
    if (!meta?.format) return false;
  } catch (_) { return false; }
  for (const [dir, size] of ICON_SPECS) {
    const base = path.join(projectDir, "app", "src", "main", "res", dir);
    fs.mkdirSync(base, { recursive: true });
    const square = await sharp(iconPath).resize(size, size, { fit: "cover" }).png().toBuffer();
    fs.writeFileSync(path.join(base, "ic_launcher.png"), square);
    const mask = Buffer.from(`<svg width="${size}" height="${size}"><circle cx="${size / 2}" cy="${size / 2}" r="${size / 2}" fill="#fff"/></svg>`);
    const round = await sharp(square).composite([{ input: mask, blend: "dest-in" }]).png().toBuffer();
    fs.writeFileSync(path.join(base, "ic_launcher_round.png"), round);
  }
  return true;
}

/**
 * Siapkan project native.
 * @param {{appName:string,url:string,packageName?:string,iconPath?:string,themeColor?:string}} opt
 */
async function prepare(opt) {
  if (!fs.existsSync(TEMPLATE_DIR)) throw new Error("Template Android native tidak ditemukan (assets/android-native-template-safe).");
  const appName = String(opt.appName || "Web App").slice(0, 60);
  const url = String(opt.url || "");
  try { new URL(url); } catch { throw new Error("URL website tidak valid."); }
  const packageName = validPackage(opt.packageName) ? opt.packageName : makePackageName(appName);

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "native-"));
  const proj = path.join(dir, "project");
  copyDir(TEMPLATE_DIR, proj);
  const main = path.join(proj, "app", "src", "main");

  // nama aplikasi
  patchFile(path.join(main, "res", "values", "strings.xml"), (t) =>
    t.replace(/<string name="app_name">.*?<\/string>/, `<string name="app_name">${escapeXml(appName)}</string>`));

  // URL tujuan
  const mainAct = path.join(main, "java", "com", "web2apk", "app", "MainActivity.java");
  if (!patchFile(mainAct, (t) =>
    t.replace(/ENCODED_URL_PLACEHOLDER/g, encodeUrl(url))
      .replace(/private static final String FALLBACK_URL = ".*";/, `private static final String FALLBACK_URL = "${escapeJava(url)}";`))) {
    throw new Error("MainActivity.java template tidak ditemukan.");
  }

  // package id unik (applicationId saja; namespace tetap agar kode Java tidak berubah)
  patchFile(path.join(proj, "app", "build.gradle"), (t) =>
    t.replace(/applicationId\s+"[^"]+"/, `applicationId "${packageName}"`));

  // warna tema (opsional, #RRGGBB)
  if (/^#[0-9a-f]{6}$/i.test(opt.themeColor || "")) {
    patchFile(path.join(main, "res", "values", "colors.xml"), (t) =>
      t.replace(/(<color name="colorPrimary">)#[0-9a-fA-F]{6,8}/, `$1${opt.themeColor}`).replace(/(<color name="colorAccent">)#[0-9a-fA-F]{6,8}/, `$1${opt.themeColor}`));
  }

  // kestabilan build: buang BOM di wrapper properties & izinkan compileSdk 36 pada AGP 8.7
  patchFile(path.join(proj, "gradle", "wrapper", "gradle-wrapper.properties"), (t) => t.replace(/^\uFEFF/, ""));
  patchFile(path.join(proj, "gradle.properties"), (t) => {
    let out = t.replace(/\r/g, "");
    if (!/android\.suppressUnsupportedCompileSdk/.test(out)) out += "\nandroid.suppressUnsupportedCompileSdk=36\n";
    return out;
  });

  const iconOk = await applyIcon(proj, opt.iconPath).catch(() => false);

  const zip = new AdmZip();
  zip.addLocalFolder(proj);
  const zipPath = path.join(dir, `native-${Date.now()}.zip`);
  zip.writeZip(zipPath);

  return { zipPath, packageName, iconApplied: iconOk, cleanup: () => fs.rmSync(dir, { recursive: true, force: true }) };
}

module.exports = { prepare, makePackageName, validPackage, TEMPLATE_DIR };
