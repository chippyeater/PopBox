/**
 * MiniMax 音色克隆脚本
 *
 * 用法:
 *   1. 把角色原声 MP3 放到 D:/Projects/PopBox/clone_audio/ 目录下
 *   2. 修改下方 AUDIO_FILE 和 VOICE_ID
 *   3. node clone_voice.js
 *
 * 流程: 上传音频 → 克隆音色 → 拿到 voice_id
 */

const fs = require("fs");
const path = require("path");
const https = require("https");

// ═════ 修改这里 ══════════════════
const AUDIO_FILE = "qifei.mp3";   // 放在 clone_audio/ 目录下的音频文件名
const VOICE_ID   = "qifei_v2";       // 起个英文名，之后填到 MINIMAX_VOICE_MAP 里
// ═════════════════════════════════

const AUDIO_PATH = path.join(__dirname, "clone_audio", AUDIO_FILE);

// 从 .env 读 API Key
const API_KEY = (() => {
  try {
    const env = fs.readFileSync(path.join(__dirname, ".env"), "utf-8");
    const m = env.match(/MINIMAX_API_KEY=(.+)/);
    return m ? m[1].trim() : null;
  } catch { return null; }
})();

if (!API_KEY) { console.error("❌ 找不到 MINIMAX_API_KEY"); process.exit(1); }
console.log(`🔑 API Key: ${API_KEY.slice(0, 8)}...${API_KEY.slice(-4)}`);

if (!fs.existsSync(AUDIO_PATH)) {
  console.error(`❌ 音频文件不存在: ${AUDIO_PATH}`);
  console.log("📁 请先创建 D:/Projects/PopBox/web/clone_audio/ 目录，把音频放进去");
  process.exit(1);
}

// 简单的 HTTP 请求
function api(method, urlPath, body, contentType) {
  return new Promise((resolve, reject) => {
    const opts = {
      hostname: "api.minimaxi.com",
      path: urlPath,
      method,
      headers: { Authorization: `Bearer ${API_KEY}` },
    };
    if (contentType) opts.headers["Content-Type"] = contentType;

    const req = https.request(opts, (res) => {
      let data = "";
      res.on("data", (c) => (data += c));
      res.on("end", () => {
        try { resolve({ status: res.statusCode, data: JSON.parse(data) }); }
        catch { resolve({ status: res.statusCode, data }); }
      });
    });
    req.on("error", reject);
    if (body) req.write(body);
    req.end();
  });
}

async function main() {
  // ── Step 1: 上传音频 ──
  console.log(`\n📤 上传音频: ${AUDIO_FILE}`);
  const boundary = "----" + Math.random().toString(36).slice(2);
  const fileBuf = fs.readFileSync(AUDIO_PATH);

  const head = Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="purpose"\r\n\r\nvoice_clone\r\n` +
    `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${AUDIO_FILE}"\r\n` +
    `Content-Type: application/octet-stream\r\n\r\n`
  );
  const tail = Buffer.from(`\r\n--${boundary}--\r\n`);
  const body = Buffer.concat([head, fileBuf, tail]);

  const uploadRes = await api("POST", "/v1/files/upload", body, `multipart/form-data; boundary=${boundary}`);
  if (uploadRes.status !== 200 || uploadRes.data?.base_resp?.status_code !== 0) {
    throw new Error(`上传失败: ${JSON.stringify(uploadRes.data)}`);
  }
  const fileId = uploadRes.data.file.file_id;
  console.log(`✅ 上传成功, file_id: ${fileId}`);

  // ── Step 2: 音色克隆 ──
  console.log(`\n🎤 音色克隆中... (VOICE_ID = ${VOICE_ID})`);

  const cloneBody = JSON.stringify({
    file_id: fileId,
    voice_id: VOICE_ID,
    model: "speech-2.8-hd",
    need_noise_reduction: true,
    need_volume_normalization: true,
  });

  const cloneRes = await api("POST", "/v1/voice_clone", cloneBody, "application/json");
  if (cloneRes.status !== 200 || cloneRes.data?.base_resp?.status_code !== 0) {
    throw new Error(`克隆失败: ${JSON.stringify(cloneRes.data)}`);
  }

  console.log(`\n🎉 音色克隆成功！`);
  console.log(`\n📌 voice_id: ${VOICE_ID}`);
  console.log(`\n把这个 voice_id 填到 server.js 的 MINIMAX_VOICE_MAP 里即可。`);
  console.log(`例如: MINIMAX_VOICE_MAP['姓名'] = '${VOICE_ID}';`);
}

main().catch((err) => console.error(`\n❌ ${err.message}`));
