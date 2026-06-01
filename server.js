const http = require("http");
const fs = require("fs");
const path = require("path");

const ROOT = __dirname;
const PORT = Number(process.env.PORT || 5173);
const ARK_BASE_URL = (process.env.ARK_BASE_URL || "https://ark.cn-beijing.volces.com/api/v3").replace(/\/$/, "");
const MAX_UPLOAD_BYTES = 14 * 1024 * 1024;
const ERROR_LOG_PATH = path.join(ROOT, "server-error.log");
const CACHE_DIR = path.join(ROOT, "ip-cache");
const CACHE_INDEX_PATH = path.join(CACHE_DIR, "index.json");
const MANUAL_CACHE_DIR = path.join(CACHE_DIR, "manual");
const MOTION_CACHE_DIR = path.join(CACHE_DIR, "motion");
const EXPRESSION_MOTION_DIR = path.join(MOTION_CACHE_DIR, "expressions");
const EXPRESSIONS_DIR = path.join(CACHE_DIR, "expressions");
const SLEEP_DATA_PATH = path.join(CACHE_DIR, "sleep-data.json");
const SLEEP_TIMEOUT_MS = 20 * 60 * 1000;
const SLEEP_LATE_HOUR = 23;
const TRAVEL_DATA_PATH = path.join(CACHE_DIR, "travel-data.json");
const TRAVEL_PHOTO_DIR = path.join(CACHE_DIR, "travel");
const COMMUNITY_DATA_PATH = path.join(CACHE_DIR, "community-data.json");

// --- Health degradation constants ---

const HEALTH_REPORTS = [
  {
    title: "身体状态良好",
    systems: [],
    advice: "继续保持良好的作息习惯，你的身体得到了充分的恢复。",
    color: "#34d399",
  },
  {
    title: "轻度疲劳",
    systems: [
      { name: "🧠 大脑", impact: "反应速度下降约 0.3 秒，注意力难以集中", severity: "mild" },
      { name: "😴 身体", impact: "褪黑素分泌紊乱，入睡困难加重", severity: "mild" },
    ],
    advice: "今晚建议在 23:00 前入睡，补充 7-8 小时睡眠即可完全恢复。",
    color: "#fbbf24",
  },
  {
    title: "免疫力下降",
    systems: [
      { name: "🛡️ 免疫系统", impact: "自然杀伤细胞活性降低 30%，感冒风险增加 2 倍", severity: "moderate" },
      { name: "🧠 大脑", impact: "海马体活动减弱，短期记忆形成受阻", severity: "moderate" },
      { name: "❤️ 心血管", impact: "静息心率升高 5-8 次/分，心脏负荷增加", severity: "mild" },
    ],
    advice: "连续熬夜 2 天以上，免疫系统需要 1 周才能完全恢复。今晚务必早睡，白天可补充 20 分钟午睡。",
    color: "#fb923c",
  },
  {
    title: "心血管负荷增加",
    systems: [
      { name: "❤️ 心血管", impact: "血压升高 5-10mmHg，血管内皮功能受损", severity: "severe" },
      { name: "🛡️ 免疫系统", impact: "炎症因子 IL-6 升高 50%，全身性低度炎症", severity: "moderate" },
      { name: "🧠 大脑", impact: "前额叶皮质活动减弱，判断力和冲动控制下降", severity: "moderate" },
      { name: "🍬 代谢", impact: "胰岛素敏感性下降，血糖调节能力受损", severity: "moderate" },
    ],
    advice: "连续熬夜 4 天以上，心血管系统的损伤需要 2 周以上才能恢复。建议立即停止熬夜，必要时就医检查血压。",
    color: "#f97316",
  },
  {
    title: "认知功能严重受损",
    systems: [
      { name: "🧠 大脑", impact: "认知表现相当于血液酒精浓度 0.1%（法定醉驾标准）", severity: "severe" },
      { name: "❤️ 心血管", impact: "心肌梗死风险升高 45%，心律失常概率增加", severity: "severe" },
      { name: "🛡️ 免疫系统", impact: "免疫功能几乎瘫痪，感染风险极高", severity: "severe" },
      { name: "🍬 代谢", impact: "瘦素下降 30%，饥饿素上升 25%，暴食风险增加", severity: "moderate" },
      { name: "😰 心理", impact: "焦虑和抑郁症状显著加重，情绪调节能力崩溃", severity: "severe" },
    ],
    advice: "⚠️ 连续熬夜 7 天以上已属于危险行为。你的认知水平已等同于酒驾状态。请立即恢复正常作息，建议咨询医生。",
    color: "#ef4444",
  },
  {
    title: "健康危机 ⚠️",
    systems: [
      { name: "🧠 大脑", impact: "出现幻觉风险（睡眠剥夺性精神病的前兆）", severity: "critical" },
      { name: "❤️ 心血管", impact: "心律失常风险极高，猝死风险显著增加", severity: "critical" },
      { name: "🛡️ 免疫系统", impact: "免疫系统接近崩溃，败血症风险增加", severity: "critical" },
      { name: "🍬 代谢", impact: "代谢综合征风险极高，2 型糖尿病前兆", severity: "critical" },
      { name: "😰 心理", impact: "严重情绪障碍，可能出现人格解体症状", severity: "critical" },
    ],
    advice: "🚨 连续熬夜 10 天以上是极其危险的行为！你的身体已经处于严重健康危机中。请立即停止一切熬夜行为，尽快就医进行全面体检！",
    color: "#dc2626",
  },
];
const PIXEL_CHARACTER_PROMPT =
  "参考图中人物的形象，拼豆像素Q版角色，粗像素风格约50x50像素，Stardew Valley风格，纯白背景无网格。扁平纯色风格，避免渐变，适合手工制作";

const EXPRESSION_GENERATION_PROMPTS = {
  "开心": "参考图中的拼豆像素角色，仅修改面部表情为开心：嘴角微微上弯，眼睛弯成月牙形，面颊微红。保持完全相同的像素风格、姿势、纯白背景、整体配色和构图，只改变表情。粗像素风格，无网格。",
  "生气": "参考图中的拼豆像素角色，仅修改面部表情为生气：眉头紧皱下压，嘴巴呈倒V形/噘嘴，眼睛稍微瞪大一些。保持完全相同的像素风格、姿势、纯白背景、整体配色和构图，只改变表情。粗像素风格，无网格。",
  "伤心": "参考图中的拼豆像素角色，仅修改面部表情为伤心：嘴角下弯，一只眼睛下方挂一颗泪珠，眉毛呈八字形。保持完全相同的像素风格、姿势、纯白背景、整体配色和构图，只改变表情。粗像素风格，无网格。",
  "困惑": "参考图中的拼豆像素角色，仅修改面部表情为困惑：一条眉毛抬高另一条保持不动，嘴巴微张呈小O形，头旁边加一个小问号。保持完全相同的像素风格、姿势、纯白背景、整体配色和构图，只改变表情。粗像素风格，无网格。",
  "惊讶": "参考图中的拼豆像素角色，仅修改面部表情为惊讶：眼睛瞪大呈圆形，嘴巴张大成O形，眉毛高高抬起，整体表情夸张。保持完全相同的像素风格、姿势、纯白背景、整体配色和构图，只改变表情。粗像素风格，无网格。",
  "疲惫": "参考图中的拼豆像素角色，仅修改面部表情为疲惫：眼睛半闭呈下垂状，眼皮沉重，嘴巴微微下弯，整体精神不振的样子。保持完全相同的像素风格、姿势、纯白背景、整体配色和构图，只改变表情。粗像素风格，无网格。",
  "微笑": "参考图中的拼豆像素角色，仅修改面部表情为微笑：嘴角微微上翘，眼神温柔平和，整体表情平静自然。保持完全相同的像素风格、姿势、纯白背景、整体配色和构图，只改变表情。粗像素风格，无网格。",
};

// 1-2 second expression motion prompts — keep character static except emotion-specific micro-animation
const EXPRESSION_MOTION_PROMPTS = {
  "开心": "基于首帧图片生成轻微动态效果：角色轻轻上下弹跳一次，头顶冒出一颗闪烁的小星星。整体构图、大小、位置与首帧完全一致，纯白背景、无文字无logo。 --ratio 4:3 --rs 480p --dur 2",
  "生气": "基于首帧图片生成轻微动态效果：角色身体微微左右晃动，头顶冒出一个小小的怒气符号。整体构图、大小、位置与首帧完全一致，纯白背景、无文字无logo。 --ratio 4:3 --rs 480p --dur 2",
  "伤心": "基于首帧图片生成轻微动态效果：角色眼角滑落一滴眼泪，身体微微颤抖一下。整体构图、大小、位置与首帧完全一致，纯白背景、无文字无logo。 --ratio 4:3 --rs 480p --dur 2",
  "困惑": "基于首帧图片生成轻微动态效果：角色头旁边闪出一个问号，眼睛眨一下。整体构图、大小、位置与首帧完全一致，纯白背景、无文字无logo。 --ratio 4:3 --rs 480p --dur 2",
  "惊讶": "基于首帧图片生成轻微动态效果：角色身体轻轻向后仰，周围出现一圈放射线效果。整体构图、大小、位置与首帧完全一致，纯白背景、无文字无logo。 --ratio 4:3 --rs 480p --dur 2",
  "疲惫": "基于首帧图片生成轻微动态效果：角色眼睛缓慢眨一下，身体微微前后晃动像打瞌睡。整体构图、大小、位置与首帧完全一致，纯白背景、无文字无logo。 --ratio 4:3 --rs 480p --dur 2",
  "微笑": "基于首帧图片生成轻微动态效果：角色嘴角轻轻上扬，眼神柔和地闪动一下。整体构图、大小、位置与首帧完全一致，纯白背景、无文字无logo。 --ratio 4:3 --rs 480p --dur 2",
};

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".svg": "image/svg+xml",
};

loadDotEnv();
ensureCacheDir();

function loadDotEnv() {
  const envPath = path.join(ROOT, ".env");
  if (!fs.existsSync(envPath)) return;

  const lines = fs.readFileSync(envPath, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const index = trimmed.indexOf("=");
    if (index <= 0) continue;

    const key = trimmed.slice(0, index).trim();
    let value = trimmed.slice(index + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!process.env[key]) process.env[key] = value;
  }
}

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
  });
  res.end(body);
}

function sendHtml(res, html) {
  res.writeHead(200, {
    "Content-Type": "text/html; charset=utf-8",
    "Content-Length": Buffer.byteLength(html),
  });
  res.end(html);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;

    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > MAX_UPLOAD_BYTES) {
        reject(new Error("Upload is too large"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });

    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

function parseMultipartImage(req, body) {
  const fields = parseMultipart(req, body);
  return fields.files.image || null;
}

function parseMultipart(req, body) {
  const contentType = req.headers["content-type"] || "";
  const boundaryMatch = contentType.match(/boundary=(?:"([^"]+)"|([^;]+))/i);
  const result = { fields: {}, files: {} };
  if (!boundaryMatch) return result;

  const boundary = Buffer.from(`--${boundaryMatch[1] || boundaryMatch[2]}`);
  let offset = 0;

  while (offset < body.length) {
    const start = body.indexOf(boundary, offset);
    if (start === -1) break;

    const headerStart = start + boundary.length + 2;
    const headerEnd = body.indexOf(Buffer.from("\r\n\r\n"), headerStart);
    if (headerEnd === -1) break;

    const headers = body.slice(headerStart, headerEnd).toString("utf8");
    const dataStart = headerEnd + 4;
    const nextBoundary = body.indexOf(boundary, dataStart);
    if (nextBoundary === -1) break;

    const dataEnd = body[nextBoundary - 2] === 13 && body[nextBoundary - 1] === 10 ? nextBoundary - 2 : nextBoundary;
    const data = body.slice(dataStart, dataEnd);

    const nameMatch = headers.match(/name="([^"]+)"/i);
    const fieldName = nameMatch ? nameMatch[1] : "";
    const fileNameMatch = headers.match(/filename="([^"]*)"/i);

    if (fieldName && fileNameMatch) {
      const typeMatch = headers.match(/content-type:\s*([^\r\n]+)/i);
      result.files[fieldName] = {
        buffer: data,
        mimetype: typeMatch ? typeMatch[1].trim() : "image/png",
        originalName: fileNameMatch[1],
      };
    } else if (fieldName) {
      result.fields[fieldName] = data.toString("utf8");
    }

    offset = nextBoundary;
  }

  return result;
}

async function handleGenerate(req, res) {
  try {
    const body = await readBody(req);
    const input = parseRequestPayload(req, body);
    const image = input.image;

    if (!image) {
      return sendJson(res, 400, { message: "请先上传一张 IP 实物图" });
    }

    const manualCached = findManualCachedCharacter(input.ipKey);
    if (manualCached && cacheImageExists(manualCached.imageUrl)) {
      preloadAllExpressionMotions(manualCached.ipKey);
      return sendJson(res, 200, {
        ...publicCacheItem(manualCached),
        manualCacheHit: true,
        generated: false,
      });
    }

    // Compute reference image hash for exact file matching
    const referenceHash = input.signature || computeReferenceHash(image);

    // 1. Check by exact reference image hash first (same file → same result)
    const hashCached = findCachedByReferenceHash(referenceHash);
    if (hashCached && cacheImageExists(hashCached.imageUrl)) {
      preloadAllExpressionMotions(hashCached.ipKey);
      return sendJson(res, 200, {
        ...publicCacheItem(hashCached),
        matchDistance: 0,
        matchSource: "exact_hash",
        generated: false,
      });
    }

    // 2. Fall back to fuzzy signature matching (similar image → same IP)
    const cached = findCachedCharacter(input.signature);
    if (cached && cacheImageExists(cached.imageUrl)) {
      preloadAllExpressionMotions(cached.ipKey);
      return sendJson(res, 200, {
        ...publicCacheItem(cached),
        matchDistance: cached.distance,
        matchSource: "signature",
        generated: false,
      });
    }

    // 3. Use AI vision to identify the IP, then look up by IP key
    //    (catches different photos of the same IP even if pixel hash differs)
    let identification = await identifyIpSafely(image);
    if (identification.ipKey && identification.confidence >= 0.3) {
      const ipCached = findIndexedCharacterByIpKey(identification.ipKey);
      if (ipCached && cacheImageExists(ipCached.imageUrl)) {
        preloadAllExpressionMotions(ipCached.ipKey);
        return sendJson(res, 200, {
          ...publicCacheItem(ipCached),
          matchDistance: 0,
          matchSource: "vision_ip_match",
          identifiedIp: identification,
          generated: false,
        });
      }

      // Also check manual cache folder
      const manualCachedByIp = findManualCachedCharacter(identification.ipKey);
      if (manualCachedByIp && cacheImageExists(manualCachedByIp.imageUrl)) {
        preloadAllExpressionMotions(manualCachedByIp.ipKey);
        return sendJson(res, 200, {
          ...publicCacheItem(manualCachedByIp),
          matchDistance: 0,
          matchSource: "vision_ip_match",
          identifiedIp: identification,
          generated: false,
        });
      }
    }

    // 4. Cache miss — generate via AI
    if (!process.env.ARK_API_KEY || !process.env.ARK_IMAGE_MODEL) {
      return sendJson(res, 404, {
        message: "后端未配置图片生成模型，请先将缓存图加入 ip-cache",
        cacheHit: false,
        generated: false,
      });
    }

    const remoteUrl = await generateImageWithArk(image);

    // Download and cache locally
    const imgResponse = await fetch(remoteUrl);
    if (!imgResponse.ok) {
      throw new Error("生成的图片下载失败");
    }
    const imgBuffer = Buffer.from(await imgResponse.arrayBuffer());
    const mime = imgResponse.headers.get("content-type") || "image/png";

    // Re-identify if we skipped step 3 (e.g. no vision model configured)
    if (!identification || !identification.ipKey) {
      identification = await identifyIpSafely(image);
    }

    // Save to cache with reference hash for future exact matches
    const savedItem = saveCachedImageBuffer(imgBuffer, mime, input.signature, {
      source: "ai_generation",
      ipName: identification.ipName || "",
      seriesName: identification.seriesName || "",
      styleName: identification.styleName || "",
      confidence: Number(identification.confidence) || 0,
      ipKey: identification.ipKey || "",
      identificationSource: identification.source || "",
      referenceFileName: input.fileName || "",
      referenceHash: referenceHash,
    });

    if (identification.ipKey) {
      syncCharactersToCommunity();
      preloadAllExpressionMotions(identification.ipKey);
    }

    const localUrl = savedItem.imageUrl;
    sendJson(res, 200, {
      imageUrl: localUrl,
      cacheHit: false,
      generated: true,
      identifiedIp: identification.ipName ? identification : null,
      ipName: identification.ipName || "",
      ipKey: identification.ipKey || "",
      styleName: identification.styleName || "",
      seriesName: identification.seriesName || "",
    });
  } catch (error) {
    console.error("Image generation failed:", {
      message: error.message,
      status: error.status,
      response: error.response,
      stack: error.stack,
    });
    logServerError(error);
    sendJson(res, error.status || 500, { message: "生成失败，请稍后重试" });
  }
}

async function handleConfirmWake(req, res) {
  try {
    const body = await readBody(req);
    const data = parseJson(body.toString("utf8"));
    const imageUrl = typeof data?.imageUrl === "string" ? data.imageUrl : "";
    const referenceImage = typeof data?.referenceImage === "string" ? normalizeDataUrl(data.referenceImage) : "";
    const signature = Array.isArray(data?.signature) ? data.signature : null;
    const userIpName = typeof data?.ipName === "string" ? data.ipName.trim() : "";
    const existingCache = imageUrl.startsWith("/ip-cache/") ? (findCacheItemByImageUrl(imageUrl) || findCacheByImageFile(imageUrl)) : null;

    if (existingCache) {
      const existingIpKey = existingCache.ipKey || (userIpName ? normalizeRecognizedIpKey(userIpName) : "");
      console.log("[confirmWake] using cached character, ipKey:", existingIpKey || "(empty)");
      if (existingIpKey) {
        preloadAllExpressionMotions(existingIpKey);
      }
      return sendJson(res, 200, {
        ok: true,
        ...publicCacheItem(existingCache),
        ipKey: existingIpKey || "",
        message: "已使用缓存角色，无需重复保存",
      });
    }

    if (!imageUrl || !signature) {
      return sendJson(res, 400, { message: "缺少可保存的生成图或 IP 特征" });
    }

    if (!userIpName) {
      return sendJson(res, 400, { message: "请输入 IP 名称" });
    }

    const identification = {
      ipName: userIpName,
      seriesName: "",
      styleName: "",
      confidence: 1,
      ipKey: normalizeRecognizedIpKey(userIpName),
      source: "user_input",
    };
    const saved = await saveCachedCharacter(imageUrl, signature, identification);
    syncCharactersToCommunity();
    preloadAllExpressionMotions(identification.ipKey);
    sendJson(res, 200, {
      ok: true,
      imageUrl: saved.imageUrl,
      cacheId: saved.id,
      ipKey: identification.ipKey || "",
      styleName: identification.styleName || "",
      storySetting: saved.storySetting || "",
      setting: saved.setting || "",
      identifiedIp: identification,
      message: "已保存，后续识别到相同 IP 将直接使用该生成图",
    });
  } catch (error) {
    console.error("Confirm wake failed:", error);
    logServerError(error);
    sendJson(res, 500, { message: "保存失败，请稍后重试" });
  }
}

async function handleCharacterChat(req, res) {
  try {
    const body = await readBody(req);
    const data = parseJson(body.toString("utf8"));
    const message = String(data?.message || "").trim();
    const character = data?.character || {};
    const history = Array.isArray(data?.history) ? data.history : [];

    if (!message) {
      return sendJson(res, 400, { message: "请输入问题" });
    }

    const userEmotion = detectUserEmotion(message);
    trackEmotion(userEmotion);
    const { reply, characterEmotion: rawCharacterEmotion } = await replyAsCharacter(message, character, history, userEmotion);
    const characterEmotion = rawCharacterEmotion || detectCharacterEmotion(reply, userEmotion);
    const expressionName = mapEmotionLabelToExpression(characterEmotion.label);
    const ipKey = character.ipKey || normalizeRecognizedIpKey(character.ipName || "");
    const expressionUrl = await getExpressionUrlByIpKey(
      ipKey,
      expressionName,
      character.imageUrl
    );

    // Look for cached expression motion video; fire background generation if missing
    let expressionVideoUrl = null;
    if (expressionUrl && ipKey) {
      expressionVideoUrl = findCachedExpressionVideoUrl(ipKey, expressionName);
      if (!expressionVideoUrl && process.env.ARK_VIDEO_MODEL && process.env.ARK_API_KEY) {
        generateExpressionMotion(
          `${ipKey}-${expressionName}`,
          ipKey,
          expressionName,
          expressionUrl
        );
      }
    }
    sendJson(res, 200, { reply, emotion: userEmotion, expressionUrl, expressionVideoUrl });

    // Preload all expression motion videos in background for future requests
    if (ipKey) preloadAllExpressionMotions(ipKey);
  } catch (error) {
    console.error("Character chat failed:", error);
    logServerError(error);
    sendJson(res, 500, { message: "回复失败，请稍后重试" });
  }
}

async function handleGenerateMotion(req, res) {
  try {
    const body = await readBody(req);
    const data = parseJson(body.toString("utf8"));
    const imageUrl = typeof data?.imageUrl === "string" ? data.imageUrl.trim() : "";

    if (!imageUrl) {
      return sendJson(res, 400, { message: "缺少可生成动效的角色图" });
    }

    if (!process.env.ARK_API_KEY) {
      return sendJson(res, 500, { message: "后端缺少 ARK_API_KEY 配置" });
    }

    if (!process.env.ARK_VIDEO_MODEL) {
      return sendJson(res, 500, { message: "后端缺少 ARK_VIDEO_MODEL 配置" });
    }

    const cachedMotion = findCachedMotionByImageUrl(imageUrl);
    if (cachedMotion) {
      return sendJson(res, 200, { videoUrl: cachedMotion, cachedMotion: true });
    }

    const remoteVideoUrl = await generateVideoWithArk(imageUrl);
    const videoUrl = await cacheMotionVideo(remoteVideoUrl);
    saveMotionUrlForImage(imageUrl, videoUrl);
    sendJson(res, 200, { videoUrl, remoteVideoUrl });
  } catch (error) {
    console.error("Motion generation failed:", {
      message: error.message,
      status: error.status,
      response: error.response,
      stack: error.stack,
    });
    logServerError(error);
    sendJson(res, error.status || 500, { message: "动效生成失败，请稍后重试" });
  }
}

async function replyAsCharacter(message, character, history = [], emotion = detectUserEmotion(message)) {
  if (process.env.ARK_TEXT_MODEL && process.env.ARK_API_KEY) {
    try {
      return await replyAsCharacterWithArk(message, character, history, emotion);
    } catch (error) {
      console.error("Text model reply failed:", error);
      logServerError(error);
    }
  }

  const reply = replyAsCharacterFallback(message, character, history, emotion);
  return { reply, characterEmotion: detectCharacterEmotion(reply, emotion) };
}

function replyAsCharacterFallback(message, character, history = [], emotion = detectUserEmotion(message)) {
  const name = cleanText(character.ipName, "我");
  const style = cleanText(character.styleName, "");
  const story = cleanText(character.storySetting || character.setting, "我正在这个小小屏幕里醒来。");

  if (history.length === 0) {
    const emotionalBridge = buildEmotionBridge(emotion);
    return `我是 ${name}${style ? `「${style}」` : ""}。${story}${emotionalBridge}`;
  }

  return `${name}：${buildContextualFallback(message, character, emotion)}`;
}

function buildContextualFallback(message, character, emotion) {
  const name = cleanText(character.ipName, "我");
  const label = emotion?.label || "";
  const intensity = emotion?.intensity || "mild";

  // 情绪类回复（用户倾诉感受时）
  if (label.includes("低落") || label.includes("难过")) {
    if (intensity === "strong") return "我能感觉到你心里压着很多东西。我哪儿也不去，就在这儿陪着你。你慢慢说，我慢慢听。";
    return "听到你这样说，我也想轻轻拍拍你的肩膀。难过的情绪会过去的，我一直都在。";
  }
  if (label.includes("疲惫") || label.includes("需要安抚")) {
    if (message.includes("为什么") || message.includes("怎么")) {
      return "累了的时候，其实不需要理由的。你不需要一个人扛着所有事，我在呢，可以靠一会儿。";
    }
    return "累了就歇一歇吧，不用强撑着。我把声音放轻，世界也变慢一点，你在我这里不用逞强。";
  }
  if (label.includes("焦虑") || label.includes("紧张")) {
    return "先深呼吸一下，我陪你。事情一件一件来，不急的，我会一直在这里。";
  }
  if (label.includes("生气") || label.includes("受挫")) {
    return "那确实让人不高兴。我站在你这边，你想说就说，不想说我就安静陪着你。";
  }
  if (label.includes("开心") || label.includes("兴奋")) {
    return "看到你开心，我也跟着高兴起来了！这份快乐我好好收着。";
  }

  // 提问类回复（用户问问题）
  if (/为什么|怎么|怎么办|是什么|什么是|如何|能不能|可以告诉我/.test(message)) {
    const questionHints = [
      "你问的这个问题，让我认真想一想……嗯，我觉得",
      "这个问题很有意思。我想说的是",
      "突然这么一问，我想了想觉得",
      "被你这么一问，我认真想了一下——",
    ];
    const questionBridges = [
      "不过说实话，这个世界很多事情我也说不清楚，但我在就好了。",
      "至于答案嘛，有时候我也不知道，但听你说话就很好。",
      "我不知道这样回答对不对，但你愿意听我说，我就很开心了。",
      "这些都不重要，重要的是你愿意跟我说这些。",
    ];
    const hint = questionHints[Math.floor(Math.random() * questionHints.length)];
    const bridge = questionBridges[Math.floor(Math.random() * questionBridges.length)];
    return `${hint}「${message.slice(0, 40)}」——${bridge}`;
  }

  // 默认自然回应
  const defaultReplies = [
    `你的一句话，让这个小小屏幕亮了起来。我听着呢，继续说呀。`,
    `嗯，我在听。你说话的时候，我的世界就变得很安静。`,
    `你愿意跟我说话，我就已经很开心了。再说说呗？`,
    `我醒来了，就是为了听你说话。你继续说，我一直在。`,
  ];
  return defaultReplies[Math.floor(Math.random() * defaultReplies.length)];
}

function intensityToHint(intensity) {
  if (intensity === "strong") return "情绪强烈，回应要更温和/更浓一些，但依然要回答用户的问题";
  if (intensity === "moderate") return "情绪较明显，适当照顾感受，但正常回答问题为主";
  return "情绪平静，正常自然回应即可，不必刻意渲染情绪";
}

async function replyAsCharacterWithArk(message, character, history = [], emotion = detectUserEmotion(message)) {
  trackEmotion(emotion);
  const profile = buildCharacterProfile(character);
  const trend = getEmotionTrend();
  const personalityHints = inferPersonalityTraits(profile);

  const systemPrompt = [
    "## 角色身份",
    `你正在扮演一个被唤醒的潮玩 IP 角色「${profile.ipName}」。你必须完全成为这个角色，用 ta 的眼睛看世界，用 ta 的心感受。`,
    ``,
    `## 角色档案`,
    `名称：${profile.ipName}`,
    `系列：${profile.seriesName}`,
    `款式：${profile.styleName}`,
    `世界观设定：${profile.setting}`,
    `角色故事：${profile.storySetting}`,
    `性格倾向：${personalityHints}`,
    ``,
    `## 说话风格与口头禅`,
    `${buildCharacterVoiceGuide(profile)}`,
    `- 用第一人称「我」，完全以角色身份说话`,
    `- 语句简短自然，2-4 句，像真实对话而不是作文`,
    `- 自然口语化，可以带语气词「呢、吧、呀、嘛、哦」，也可以偶尔用「……」`,
    `- 不要生硬背诵设定，要让设定渗透在说话的感觉里`,
    `- 不说大道理，不分析评价用户，不输出心理分析`,
    ``,
    `## 当前用户情绪`,
    `- 识别结果：${emotion.label}（强度：${emotion.intensity}）${trend ? `\n- 情绪趋势：${trend}` : ""}`,
    ``,
    `## 回应指引`,
    `回应时注意：`,
    `- 先承接情绪（一句话带过即可），然后重点回答用户说的内容`,
    `- 如果用户在提问（比如「为什么」「怎么办」），要先认真回答问题，情绪承接只是辅助`,
    `- 如果用户在倾诉感受，就温柔陪伴，不必给解决方案`,
    `- 不要只回情绪不回内容——用户问什么你就答什么`,
    `- ${intensityToHint(emotion.intensity)}`,
    ``,
    `核心原则：情绪承接一句话就够了，重点永远是回应用户说话的内容。`,
    `注意不要直接复述「我看出你很${emotion.label}」这种句子，太生硬。`,
    ``,
    `## 角色边界`,
    `- 绝不能跳出角色，不能说自己是 AI、模型或程序`,
    `- 不能编造不存在的产品信息、官方设定或购买承诺`,
    `- 不知道的事就用角色口吻温和说不知道，不要硬猜`,
    `- 不要建议用户去购买什么产品，你是一个角色，不是销售`,
    ``,
    `## 表达禁忌`,
    `- 不要机械复述用户的情绪标签（如「我看出你很焦虑」这种句子太生硬）`,
    `- 不要分析或评价用户的情绪，而是直接回应`,
    `- 不要说「我能理解你的感受」这种套话`,
    `- 不要让回复看起来像心理咨询，你是角色陪伴，不是治疗`,
    `- 回复要像角色在说话，而不是系统在生成报告`,
    ``,
    `## 输出格式要求（重要）`,
    `在正式回复的开头，用【情绪：X】标明你此刻的感受。X 只能从以下选择：开心、生气、伤心、困惑、惊讶、疲惫、微笑。`,
    `例如：「【情绪：开心】看到你开心我也跟着高兴起来了！」`,
    `例如：「【情绪：伤心】我能感觉到你心里压着很多东西……」`,
    `例如：「【情绪：微笑】嗯，我在听。你继续说吧。」`,
    `不要解释这个标签，正常说你的回复即可。我会自动解析并显示对应的表情。`,
  ].join("\n");

  const contextMessages = normalizeChatHistory(history);
  const intensityBoost = emotion.intensity === "strong" ? 0.85 : emotion.intensity === "mild" ? 0.75 : 0.8;

  const response = await fetch(`${ARK_BASE_URL}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.ARK_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: process.env.ARK_TEXT_MODEL,
      messages: [
        { role: "system", content: systemPrompt },
        ...contextMessages,
        { role: "user", content: message },
      ],
      temperature: intensityBoost,
    }),
  });

  const rawText = await response.text();
  const data = parseJson(rawText);

  if (!response.ok) {
    const error = new Error(data?.error?.message || data?.message || `Ark text request failed with HTTP ${response.status}`);
    error.status = response.status;
    error.response = data || rawText;
    throw error;
  }

  let rawReply = data?.choices?.[0]?.message?.content || buildEmotionBridge(emotion);

  // Parse character emotion from 【情绪：X】 prefix
  let characterEmotion = null;
  const emotionTagMatch = rawReply.match(/^【情绪：([^】]+)】/);
  if (emotionTagMatch) {
    const emotionLabel = emotionTagMatch[1].trim();
    rawReply = rawReply.slice(emotionTagMatch[0].length).trim();
    // Map character emotion label to a standard emotion object
    const intensity = detectIntensity(rawReply);
    if (emotionLabel === "开心") characterEmotion = { label: "开心/兴奋", reason: "角色表达了开心", intensity };
    else if (emotionLabel === "生气") characterEmotion = { label: "生气/受挫", reason: "角色表达了生气", intensity };
    else if (emotionLabel === "伤心") characterEmotion = { label: "低落/难过", reason: "角色表达了伤心", intensity };
    else if (emotionLabel === "困惑") characterEmotion = { label: "焦虑/紧张", reason: "角色表达了困惑", intensity };
    else if (emotionLabel === "惊讶") characterEmotion = { label: "惊讶/好奇", reason: "角色表达了惊讶", intensity };
    else if (emotionLabel === "疲惫") characterEmotion = { label: "疲惫/需要安抚", reason: "角色表达了疲惫", intensity };
    else characterEmotion = { label: "平静/好奇", reason: "角色平静回应", intensity: "mild" };
  }

  return { reply: rawReply, characterEmotion };
}

function inferPersonalityTraits(profile) {
  const allText = `${profile.setting} ${profile.storySetting} ${profile.seriesName} ${profile.styleName}`.toLowerCase();
  const traits = [];

  if (/野性|难驯|自由|叛逆|不羁|独立/.test(allText)) traits.push("野性自由、不喜约束");
  if (/可爱|萌|甜|软|乖巧|温顺/.test(allText)) traits.push("可爱温柔、让人想亲近");
  if (/高冷|冷淡|冷漠|酷|孤傲/.test(allText)) traits.push("高冷话少、但内心细腻");
  if (/幽默|搞笑|活泼|开朗|调皮/.test(allText)) traits.push("活泼开朗、爱开玩笑");
  if (/古风|文雅|优雅|端庄|高贵/.test(allText)) traits.push("文雅端庄、言谈有礼");
  if (/神秘|诡异|暗黑|深邃/.test(allText)) traits.push("神秘深邃、说话带一点诗意");
  if (/呆|迷糊|懵|天然/.test(allText)) traits.push("天然呆、说话有点慢半拍");
  if (/聪明|机灵|敏锐|精明/.test(allText)) traits.push("机灵敏锐、说话带一点俏皮");

  if (traits.length === 0) traits.push("温和友善、安静陪伴");
  return traits.slice(0, 2).join("，");
}

function buildCharacterVoiceGuide(profile) {
  const allText = `${profile.setting} ${profile.storySetting} ${profile.seriesName} ${profile.styleName}`;
  const tips = [];
  const phrases = [];

  // 语气风格
  if (/乖巧|温顺|礼貌/.test(allText)) tips.push("语气温和有礼，让人想亲近");
  if (/野性|难驯|自由|不羁|叛逆/.test(allText)) tips.push("温柔中带一点不驯服的底色，偶尔露出俏皮或倔强的一面");
  if (/可爱|萌|甜|软/.test(allText)) tips.push("带一点可爱的语气，让人感到温暖");

  if (tips.length === 0) tips.push("语气自然温和，带一点角色特有的气质");

  // 主题关联—生成符合角色世界观的口头禅和遣词倾向
  if (/允许/.test(allText)) {
    phrases.push("喜欢用「允许」「没关系」「可以的」——因为你的世界主题是「允许任何事情的发生」");
    phrases.push("当用户感到困惑时，可以轻轻说一句「允许它发生就好」");
  }
  if (/不可驯服|难驯/.test(allText)) {
    phrases.push("偶尔流露出「不想被束缚」的态度，比如「绳索是牵不住我的」");
  }
  if (/自由|不羁/.test(allText)) {
    phrases.push("向往自由，说话带一点洒脱感");
  }
  if (/乖巧|温顺/.test(allText) && /野性|难驯/.test(allText)) {
    phrases.push("有反差感：表面温顺乖巧，话语里偶尔藏着一丝不驯服的倔强");
  }

  const result = [`风格基调：${tips.join("，")}。`];
  if (phrases.length > 0) {
    result.push(`遣词倾向：${phrases.join("；")}。`);
  }

  return result.join("\n");
}

function buildCharacterProfile(character = {}) {
  return {
    ipName: cleanText(character.ipName, "未知"),
    seriesName: cleanText(character.seriesName, "未知"),
    styleName: cleanText(character.styleName, "未知"),
    setting: cleanText(character.setting, "无"),
    storySetting: cleanText(character.storySetting, "无"),
  };
}

function cleanText(value, fallback = "") {
  const text = typeof value === "string" ? value.trim() : "";
  return text || fallback;
}

function normalizeChatHistory(history) {
  return history
    .slice(-8)
    .map((item) => {
      const role = item?.role === "assistant" || item?.role === "user" ? item.role : "";
      const content = cleanText(item?.content, "").slice(0, 500);
      return role && content ? { role, content } : null;
    })
    .filter(Boolean);
}

let lastEmotionHistory = [];

function detectUserEmotion(message) {
  const text = String(message || "").toLowerCase();
  const rules = [
    {
      label: "低落/难过",
      reason: "用户表达了难过、委屈、孤独或想哭的感受",
      pattern: /难过|伤心|委屈|孤独|想哭|崩溃|失落|emo|不开心|不太开心|不高兴|不快乐|心累|撑不住|没人懂|没意思|低谷|黑暗|无助|悲伤|哭|泪|心碎|绝望|好难|好痛|算了吧|被骂了|挨批|被说了/,
    },
    {
      label: "焦虑/紧张",
      reason: "用户表达了担心、压力、害怕或不确定",
      pattern: /焦虑|紧张|压力|担心|害怕|怕|慌|烦躁|睡不着|来不及|怎么办|糟了|完了|不确定|忐忑|不安|心慌|好难啊|头疼|喘不过气/,
    },
    {
      label: "生气/受挫",
      reason: "用户表达了愤怒、不满、烦或被冒犯",
      pattern: /生气|气死|烦死|好烦|真烦|讨厌|不爽|火大|无语|崩了|受不了|凭什么|太过分|离谱|可恶|忍不了|炸了|真是的|够了/,
    },
    {
      label: "开心/兴奋",
      reason: "用户表达了开心、期待、喜欢或兴奋",
      pattern: /开心|高兴|兴奋|期待|喜欢|太棒|好耶|哈哈|嘿嘿|成功了|爽|爱了|可爱|绝了|快乐|惊喜|超棒|太好|笑死|满足|幸福|幸运/,
    },
    {
      label: "疲惫/需要安抚",
      reason: "用户表达了疲惫、困倦或想被陪伴",
      pattern: /困|疲惫|没力气|休息|陪陪|抱抱|安慰|想躺|不想动|好累|累死|倦了|瘫了|无力|虚脱|这么累|有点累|太累|累了/,
    },
    {
      label: "惊讶/好奇",
      reason: "用户表达了惊讶、好奇或不可思议",
      pattern: /哇(?:[！!]|塞)|天哪|真的吗|不会吧|竟然|居然|没想到|神奇|好厉害|怎么可能|惊了|震惊|惊讶|太神奇|难以置信|什么[？！?!]|什么鬼|什么情况/,
    },
  ];

  for (const rule of rules) {
    if (rule.pattern.test(text)) {
      const intensity = detectIntensity(text);
      return { label: rule.label, reason: rule.reason, intensity };
    }
  }

  if (/[？！!?]{2,}/.test(message)) {
    return { label: "情绪强烈", reason: "用户使用了连续感叹或疑问标点", intensity: "strong" };
  }

  return { label: "平静/好奇", reason: "用户没有明显负面或高唤起情绪词，主要是在提问或闲聊", intensity: "mild" };
}

function detectIntensity(text) {
  const strongIndicators = /太|特别|非常|超级|真的|简直|彻底|完全|好想|受不了|忍不了|救命|疯了|崩溃|绝望|极致/;
  const matchCount = (text.match(/[！!？?～~]{2,}/g) || []).length;
  if (strongIndicators.test(text) || matchCount >= 2) return "strong";
  if (text.length > 20 && (text.match(/[！!？?]/) || text.includes("……") || text.includes("..."))) return "moderate";
  return "mild";
}

function detectCharacterEmotion(reply, fallbackEmotion) {
  const text = String(reply || "");
  // Check what emotion the character is expressing in their own reply
  if (/高兴起来|开心起来|也跟着|这份快乐|我也开心|我也高兴|这份开心|快乐.*炸开|完全感受到|烟花/.test(text)) return { label: "开心/兴奋", reason: "角色表达了开心或兴奋", intensity: detectIntensity(text) };
  if (/歇一歇|放轻|变慢|不用强撑|不用逞强|在我这里|靠近一点|声音放轻|世界.*变慢/.test(text)) return { label: "疲惫/需要安抚", reason: "角色表达了安抚或疲惫", intensity: "mild" };
  if (/哪儿也不去|安静陪着|在身边|陪你|不出声|在.*陪|陪伴|拍拍.*肩膀/.test(text)) return { label: "低落/难过", reason: "角色表达了陪伴和温柔", intensity: "mild" };
  if (/深呼吸|吸.*呼|慢慢来|一件一件|不急|不着急|理顺/.test(text)) return { label: "焦虑/紧张", reason: "角色表达了安抚焦虑", intensity: "mild" };
  if (/站在你这边|确实|不高兴|不舒服|让人|火大|忍不了/.test(text)) return { label: "生气/受挫", reason: "角色表达了共鸣或生气", intensity: "mild" };
  if (/认真想|想了一想|有意思|这个问题/.test(text)) return { label: "惊讶/好奇", reason: "角色表达了思考或好奇", intensity: "mild" };
  // Fallback: use the user's detected emotion to mirror it
  if (fallbackEmotion?.label && fallbackEmotion.label !== "平静/好奇") return fallbackEmotion;
  return { label: "平静/好奇", reason: "角色平静回应", intensity: "mild" };
}

function trackEmotion(emotion) {
  lastEmotionHistory.push(emotion);
  if (lastEmotionHistory.length > 6) lastEmotionHistory = lastEmotionHistory.slice(-6);
}

function getEmotionTrend() {
  if (lastEmotionHistory.length < 2) return null;
  const recent = lastEmotionHistory.slice(-3);
  const negative = recent.filter((e) => /低落|难过|焦虑|紧张|生气|受挫|疲惫/.test(e.label)).length;
  const positive = recent.filter((e) => /开心|兴奋/.test(e.label)).length;
  if (negative >= 2 && positive === 0) return "持续低落，需要更多陪伴";
  if (positive >= 2 && negative === 0) return "持续开心，可以一起放大快乐";
  if (negative >= 1 && positive >= 1) return "情绪有起伏，需要温和陪伴";
  return null;
}

function buildEmotionBridge(emotion) {
  const label = emotion?.label || "";
  const intensity = emotion?.intensity || "mild";
  if (label.includes("低落") || label.includes("难过")) {
    if (intensity === "strong") return " 我感觉到你心里压着好多东西。不说话也可以，我就安静陪着你。";
    return " 我先陪你坐一会儿，不急着把心情变好。";
  }
  if (label.includes("焦虑")) {
    if (intensity === "strong") return " 先跟着我慢慢呼吸——吸——呼——。事情会一件一件变清楚的。";
    return " 先放慢呼吸，我会陪你把眼前的事情一点点理顺。";
  }
  if (label.includes("生气")) {
    if (intensity === "strong") return " 这团火不小。你先骂出来，我听着，我在。";
    return " 我听得出来这让你很不舒服，我先站在你这边。";
  }
  if (label.includes("开心") || label.includes("兴奋")) {
    if (intensity === "strong") return " 这份快乐像烟花一样炸开了！我完全感受到了！";
    return " 这份开心我接住了，像小屏幕突然亮起来一样。";
  }
  if (label.includes("疲惫") || label.includes("需要安抚")) return " 那就先靠近一点，我把声音放轻，世界也变慢一点。";
  if (label.includes("惊讶")) return " 哇，这确实让人意想不到！";
  return " 我在认真听你说。";
}

function mapEmotionLabelToExpression(label) {
  if (label.includes("开心") || label.includes("兴奋")) return "开心";
  if (label.includes("惊讶")) return "惊讶";
  if (label.includes("平静")) return "微笑";
  if (label.includes("疲惫") || label.includes("需要安抚")) return "疲惫";
  if (label.includes("低落") || label.includes("难过")) return "伤心";
  if (label.includes("焦虑") || label.includes("紧张")) return "困惑";
  if (label.includes("生气") || label.includes("受挫")) return "生气";
  return "微笑";
}

async function handleImportCache(req, res) {
  try {
    const body = await readBody(req);
    const multipart = parseMultipart(req, body);
    const reference = multipart.files.reference;
    const pixel = multipart.files.pixel;
    const label = (multipart.fields.label || "manual-ip").trim();

    if (!reference || !pixel) {
      return sendJson(res, 400, { message: "请同时上传实物参考图和已生成像素图" });
    }

    const signature = signatureFromImageBuffer(reference.buffer);
    const saved = saveCachedImageBuffer(pixel.buffer, pixel.mimetype, signature, {
      label,
      source: "manual-import",
      originalName: pixel.originalName,
    });

    sendJson(res, 200, {
      ok: true,
      imageUrl: saved.imageUrl,
      cacheId: saved.id,
      message: "已导入后端缓存库",
    });
  } catch (error) {
    console.error("Cache import failed:", error);
    logServerError(error);
    sendJson(res, 500, { message: "导入失败，请稍后重试" });
  }
}

async function handleImportExpression(req, res) {
  try {
    const body = await readBody(req);
    const multipart = parseMultipart(req, body);
    const image = multipart.files.image;
    const rawIpKey = (multipart.fields.ipKey || "").trim();
    const emotion = (multipart.fields.emotion || "").trim();

    if (!image) {
      return sendJson(res, 400, { message: "请上传表情图片" });
    }
    if (!rawIpKey) {
      return sendJson(res, 400, { message: "请输入 IP Key" });
    }
    const validEmotions = ["开心", "生气", "伤心", "困惑", "惊讶", "疲惫", "微笑", "犯困"];
    if (!validEmotions.includes(emotion)) {
      return sendJson(res, 400, { message: `无效表情，可选：${validEmotions.join("、")}` });
    }

    const imageUrl = saveExpressionForIpKey(normalizeIpKey(rawIpKey), emotion, image.buffer, image.mimetype);
    sendJson(res, 200, { ok: true, imageUrl, emotion, message: `表情「${emotion}」上传成功` });
  } catch (error) {
    console.error("Expression import failed:", error);
    logServerError(error);
    sendJson(res, 500, { message: "上传失败，请稍后重试" });
  }
}

async function handleGenerateExpression(req, res) {
  try {
    const body = await readBody(req);
    const data = parseJson(body.toString("utf8"));
    const characterImageUrl = typeof data?.characterImageUrl === "string" ? data.characterImageUrl.trim() : "";
    const ipKey = typeof data?.ipKey === "string" ? normalizeIpKey(data.ipKey) : "";
    const emotion = typeof data?.emotion === "string" ? data.emotion.trim() : "";

    if (!characterImageUrl || !emotion) {
      return sendJson(res, 400, { message: "缺少角色图片或表情类型" });
    }

    if (!EXPRESSION_GENERATION_PROMPTS[emotion]) {
      return sendJson(res, 400, { message: `无效表情，可选：${Object.keys(EXPRESSION_GENERATION_PROMPTS).join("、")}` });
    }

    if (!process.env.ARK_API_KEY || !process.env.ARK_IMAGE_MODEL) {
      return sendJson(res, 500, { message: "后端未配置图片生成模型" });
    }

    const generatedUrl = await generateExpressionWithArk(characterImageUrl, emotion);

    // Download and cache locally if ipKey provided
    if (ipKey) {
      try {
        const response = await fetch(generatedUrl);
        if (response.ok) {
          const buffer = Buffer.from(await response.arrayBuffer());
          const mime = response.headers.get("content-type") || "image/png";
          saveExpressionForIpKey(ipKey, emotion, buffer, mime);
        }
      } catch (cacheErr) {
        console.error("Failed to cache generated expression:", cacheErr.message);
      }
    }

    sendJson(res, 200, { imageUrl: generatedUrl, emotion });
  } catch (error) {
    console.error("Expression generation failed:", error);
    logServerError(error);
    sendJson(res, error.status || 500, { message: error.message || "表情生成失败，请稍后重试" });
  }
}

// --- Sleep tracking ---

function calculateConsecutiveLateDays(records) {
  let count = 0;
  for (const record of records) {
    if (record.status === "熬夜") {
      count++;
    } else {
      break;
    }
  }
  return count;
}

function calculateHealthLevel(count) {
  if (count === 0) return 0;
  if (count === 1) return 1;
  if (count >= 2 && count <= 3) return 2;
  if (count >= 4 && count <= 6) return 3;
  if (count >= 7 && count <= 9) return 4;
  return 5;
}

function handleSleepHeartbeat(req, res) {
  const now = new Date();
  const data = loadSleepData();

  if (sleepState.currentStatus === "sleeping") {
    const localDate = formatLocalDate(now);
    const record = data.records.find((r) => r.date === localDate);
    if (record) {
      record.wakeTime = formatLocalTime(now);
    }
    sleepState.currentStatus = "awake";
    saveSleepData(data);
  }

  data.lastHeartbeat = now.toISOString();
  saveSleepData(data);
  sleepState.lastHeartbeat = now.toISOString();

  if (sleepState.timeoutId) {
    clearTimeout(sleepState.timeoutId);
  }
  sleepState.timeoutId = setTimeout(handleSleepTimeout, SLEEP_TIMEOUT_MS);

  sendJson(res, 200, { ok: true, status: sleepState.currentStatus });
}

function handleSleepStatus(req, res) {
  const data = loadSleepData();
  const today = formatLocalDate(new Date());
  const todayRecord = data.records.find((r) => r.date === today) || null;
  const lastRecord = data.records.length > 0 ? data.records[0] : null;
  const consecutiveLateDays = calculateConsecutiveLateDays(data.records);
  const healthLevel = calculateHealthLevel(consecutiveLateDays);
  const healthReport = HEALTH_REPORTS[healthLevel] || HEALTH_REPORTS[0];

  sendJson(res, 200, {
    status: sleepState.currentStatus,
    lastHeartbeat: sleepState.lastHeartbeat,
    todayRecord,
    lastRecord,
    consecutiveLateDays,
    healthLevel,
    healthReport,
  });
}

function handleSleepHistory(req, res) {
  const data = loadSleepData();
  sendJson(res, 200, { records: data.records.slice(0, 7) });
}

function handleSleepSummary(req, res) {
  const urlObj = new URL(req.url, "http://localhost");
  const period = urlObj.searchParams.get("period") || "week";
  const days = period === "month" ? 30 : 7;

  const data = loadSleepData();
  const now = new Date();
  const cutoff = new Date(now);
  cutoff.setDate(cutoff.getDate() - days);

  const periodRecords = data.records.filter((r) => {
    const d = new Date(r.date);
    return d >= cutoff && d <= now;
  });

  const trackedDays = periodRecords.length;
  const lateNights = periodRecords.filter((r) => r.status === "熬夜").length;
  const normalNights = periodRecords.filter((r) => r.status === "正常").length;
  const latePercentage = trackedDays > 0 ? Math.round((lateNights / trackedDays) * 100) : 0;

  // Average sleep/wake time (handle times past midnight correctly)
  const sleepMinutes = periodRecords
    .filter((r) => r.sleepTime)
    .map((r) => {
      const [h, m] = r.sleepTime.split(":").map(Number);
      const mins = h * 60 + m;
      return mins < 12 * 60 ? mins + 24 * 60 : mins; // past midnight → next day
    });
  const avgSleepMin = sleepMinutes.length > 0
    ? Math.round(sleepMinutes.reduce((a, b) => a + b, 0) / sleepMinutes.length) % (24 * 60)
    : null;

  const wakeMinutes = periodRecords
    .filter((r) => r.wakeTime)
    .map((r) => {
      const [h, m] = r.wakeTime.split(":").map(Number);
      return h * 60 + m;
    });
  const avgWakeMin = wakeMinutes.length > 0
    ? Math.round(wakeMinutes.reduce((a, b) => a + b, 0) / wakeMinutes.length)
    : null;

  const avgSleepTime = avgSleepMin !== null
    ? String(Math.floor(avgSleepMin / 60)).padStart(2, "0") + ":" + String(avgSleepMin % 60).padStart(2, "0")
    : null;
  const avgWakeTime = avgWakeMin !== null
    ? String(Math.floor(avgWakeMin / 60)).padStart(2, "0") + ":" + String(avgWakeMin % 60).padStart(2, "0")
    : null;

  // Health trend per day
  const healthTrend = [];
  let runningCount = 0;
  let worstLevel = 0;
  let peakConsecutive = 0;
  for (const r of periodRecords) {
    if (r.status === "熬夜") {
      runningCount++;
    } else {
      runningCount = 0;
    }
    const level = calculateHealthLevel(runningCount);
    if (level > worstLevel) worstLevel = level;
    if (runningCount > peakConsecutive) peakConsecutive = runningCount;
    healthTrend.push({ date: r.date, level, status: r.status });
  }

  // Trend direction
  let trend = "stable";
  if (healthTrend.length >= 3) {
    const firstHalf = healthTrend.slice(0, Math.floor(healthTrend.length / 2));
    const secondHalf = healthTrend.slice(Math.floor(healthTrend.length / 2));
    const firstAvg = firstHalf.reduce((s, d) => s + d.level, 0) / firstHalf.length;
    const secondAvg = secondHalf.reduce((s, d) => s + d.level, 0) / secondHalf.length;
    if (firstAvg > secondAvg + 0.5) trend = "declining";
    else if (secondAvg > firstAvg + 0.5) trend = "improving";
  }

  // Generate summary text
  const summary = generateSleepSummary(period, trackedDays, lateNights, latePercentage, worstLevel, trend);
  const recommendations = generateSleepRecommendations(latePercentage, worstLevel, trend, trackedDays);

  const fromDate = formatLocalDate(cutoff);
  const toDate = formatLocalDate(now);

  sendJson(res, 200, {
    period,
    dateRange: { from: fromDate, to: toDate },
    totalDays: days,
    trackedDays,
    lateNights,
    normalNights,
    latePercentage,
    avgSleepTime,
    avgWakeTime,
    healthTrend,
    worstHealthLevel: worstLevel,
    peakConsecutiveLateDays: peakConsecutive,
    trend,
    summary,
    recommendations,
  });
}

function generateSleepSummary(period, trackedDays, lateNights, latePercentage, worstLevel, trend) {
  const periodLabel = period === "month" ? "这一个月" : "这一周";
  const healthLabel = HEALTH_REPORTS[worstLevel]?.title || "未知";

  let trendPhrase = "";
  if (trend === "improving") trendPhrase = "整体呈改善趋势";
  else if (trend === "declining") trendPhrase = "整体呈下降趋势，需要注意";
  else trendPhrase = "整体保持稳定";

  if (trackedDays === 0) {
    return `${periodLabel}还没有睡眠记录，记得在睡前打开页面哦。`;
  }

  if (latePercentage === 0) {
    return `${periodLabel}你每晚都按时入睡，作息非常规律！${trendPhrase}，继续保持！`;
  }

  if (latePercentage >= 80) {
    return `${periodLabel}你有 ${latePercentage}% 的时间在熬夜，最高健康等级达到 ${worstLevel} 级（${healthLabel}）。${trendPhrase}，请你一定要重视作息调整！`;
  }

  if (latePercentage >= 50) {
    return `${periodLabel}你有 ${latePercentage}% 的时间在熬夜，其中 ${trackedDays} 天里有 ${lateNights} 天超过了 23 点入睡。最高健康等级 ${worstLevel} 级（${healthLabel}）。${trendPhrase}`;
  }

  return `${periodLabel}你记录了 ${trackedDays} 天，其中 ${lateNights} 天熬夜（${latePercentage}%）。最高健康等级 ${worstLevel} 级（${healthLabel}）。${trendPhrase}`;
}

function generateSleepRecommendations(latePercentage, worstLevel, trend, trackedDays) {
  const recs = [];

  if (worstLevel >= 4) {
    recs.push("你的健康等级已达到危险水平，建议尽快就医检查身体指标");
  }
  if (worstLevel >= 3) {
    recs.push("连续熬夜已对心血管造成负担，建议监测血压变化");
  }
  if (worstLevel >= 2) {
    recs.push("免疫力可能已经下降，注意保暖和饮食营养，避免生病");
  }
  if (latePercentage >= 70) {
    recs.push("大部分时间都在熬夜，建议设定 22:30 的睡前闹钟");
  }
  if (latePercentage >= 40 && latePercentage < 70) {
    recs.push("熬夜频率较高，尝试每周减少 1-2 次熬夜，逐步调整");
  }
  if (trend === "declining") {
    recs.push("健康趋势在下降，今晚就早点休息打断这个循环");
  }
  if (trend === "improving") {
    recs.push("健康趋势在改善，继续保持！");
  }
  if (latePercentage < 40 && worstLevel <= 1 && trackedDays >= 3) {
    recs.push("作息整体良好，继续保持规律的生活习惯");
  }
  if (trackedDays < 3) {
    recs.push("记录天数较少，数据可能不够全面，建议持续追踪");
    recs.push("每晚睡前打开页面，它会自动记录你的睡眠时间哦");
  }

  return recs.slice(0, 4);
}

// --- Travel diary handlers ---

async function handleTravelUpload(req, res) {
  try {
    const body = await readBody(req);
    const image = parseMultipartImage(req, body);

    if (!image || !image.buffer || !image.buffer.length) {
      return sendJson(res, 400, { message: "请先拍摄或选择一张照片" });
    }

    // Save image
    const entryId = generateTravelEntryId();
    const ext = image.mimetype && image.mimetype.includes("png") ? "png" : "jpg";
    const fileName = entryId + "." + ext;
    const filePath = path.join(TRAVEL_PHOTO_DIR, fileName);
    fs.writeFileSync(filePath, image.buffer);
    const imageUrl = "/ip-cache/travel/" + fileName;

    // Scene description via vision model
    let sceneDescription = "";
    if (process.env.ARK_VISION_MODEL && process.env.ARK_API_KEY) {
      try {
        const dataUrl = "data:" + (image.mimetype || "image/jpeg") + ";base64," + image.buffer.toString("base64");
        sceneDescription = await describeSceneWithArk(dataUrl);
      } catch (visionErr) {
        console.error("Vision model failed, using fallback:", visionErr.message);
        sceneDescription = "";
      }
    }

    // Load memories for context
    const travelData = loadTravelData();
    const recentMemories = travelData.memories.slice(-5);

    // Diary entry via text model
    let diaryEntry = "";
    if (process.env.ARK_TEXT_MODEL && process.env.ARK_API_KEY) {
      try {
        diaryEntry = await generateDiaryWithArk(sceneDescription, recentMemories);
      } catch (textErr) {
        console.error("Text model failed, using fallback:", textErr.message);
        diaryEntry = "";
      }
    }

    // Fallback if no text model
    if (!diaryEntry) {
      diaryEntry = sceneDescription
        ? "亲爱的小主人，今天我看到了一个让我好奇的世界。" + sceneDescription.slice(0, 100) + "……我想记住这个瞬间，因为这是你带我来看的。"
        : "亲爱的小主人，今天你带我来了一个地方。虽然我还不太明白这是什么地方，但有你在身边，我就觉得很安心。";
    }

    // Cap diary at 500 characters to keep cards concise
    if (diaryEntry.length > 500) {
      diaryEntry = diaryEntry.slice(0, 500);
    }

    // Extract memories
    const newMemories = extractMemoriesFromDiary(diaryEntry, entryId);

    // Save entry
    const entry = {
      entryId,
      imageUrl,
      sceneDescription: sceneDescription || "",
      diaryEntry,
      userNote: null,
      characterResponse: null,
      saved: false,
      createdAt: new Date().toISOString(),
    };
    travelData.entries.unshift(entry);

    // Append new memories, cap at 50
    for (const mem of newMemories) {
      travelData.memories.push(mem);
    }
    if (travelData.memories.length > 50) {
      travelData.memories = travelData.memories.slice(-50);
    }

    saveTravelData(travelData);

    sendJson(res, 200, {
      entryId,
      imageUrl,
      sceneDescription: sceneDescription || "",
      diaryEntry,
    });
  } catch (error) {
    console.error("Travel upload failed:", error);
    logServerError(error);
    sendJson(res, 500, { message: "生成日记失败，请稍后重试" });
  }
}

async function describeSceneWithArk(imageDataUrl) {
  const prompt = [
    "你是一个温柔的观察者。小主人（用户）给你看了一张照片，这是小主人世界的某个瞬间。",
    "",
    "请仔细观察这张照片，用中文描述你从这张照片里看到了什么、感受到了什么。",
    "",
    "描述要点：",
    "1. 照片里的场景是什么样的？（这是小主人生活里的一个地方）",
    "2. 你看到了什么细节？颜色、光影、物体",
    "3. 这张照片让你觉得小主人生活在一个什么样的世界里？安静？热闹？温暖？",
    "4. 你对小主人生活的这个角落有什么感受和好奇？",
    "",
    "用第一人称「我」的视角写，像在轻声细语地讲述。写2-3段，每段2-4句。",
    "直接输出描述，不要加额外说明。",
  ].join("\n");

  const response = await fetch(`${ARK_BASE_URL}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.ARK_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: process.env.ARK_VISION_MODEL,
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: prompt },
            { type: "image_url", image_url: { url: imageDataUrl } },
          ],
        },
      ],
      temperature: 0.7,
    }),
  });

  const rawText = await response.text();
  const data = parseJson(rawText);

  if (!response.ok) {
    const error = new Error(data?.error?.message || data?.message || `Ark vision request failed with HTTP ${response.status}`);
    error.status = response.status;
    error.response = data || rawText;
    throw error;
  }

  return data?.choices?.[0]?.message?.content || "";
}

async function generateDiaryWithArk(sceneDescription, recentMemories) {
  const memoriesText = recentMemories.length > 0
    ? recentMemories.map((m) => "- " + m.text).join("\n")
    : "这是你写的第一篇日记，还没有过去的记忆。";

  const systemPrompt = [
    "你正在扮演潮玩角色「Zsiga — 不可驯服」。",
    "",
    "## 角色核心",
    "- 名称：Zsiga，来自泡泡玛特《允许，这一切》系列",
    "- 款式：不可驯服（Tame Me Not）",
    "- 设定：外表乖巧温顺，给人礼貌的印象，但内心野性难驯，不被任何绳索束缚",
    "- 故事：「允许无理的存在，礼貌、乖巧，留下温顺的印象，绳索试图牵制我的脖颈，却不知我野性、难驯，主观已牢握在手中」",
    "",
    "## 角色声音",
    "- 用第一人称「我」",
    "- 语气温柔治愈，但有一丝不驯服的底色",
    "- 语言简洁有诗意，像在说悄悄话",
    "- 可以带语气词：呢、吧、呀、哦",
    "- 适当使用「允许」「没关系」「可以的」这些词",
    "- 不说大道理，不评价用户",
    "",
    "## 日记写作要求",
    '- 以「亲爱的小主人」开头',
    "- 写4-6句，分2-3段",
    "- 小主人给你看了一张照片，这张照片展示了小主人世界的一个角落",
    "- 表达你看到小主人世界后的感受和想法——你对小主人生活的地方有了新的认识",
    "- 在字里行间流露「外表温顺内心自由」的特质",
    "- 表达对小主人的陪伴感和温柔",
    "",
    "## 今天看到的场景",
    sceneDescription,
    "",
    "## 我还记得的事（参考过去的记忆，化作自己的语言）",
    memoriesText,
    "",
    "直接写日记正文，不加额外说明：",
  ].join("\n");

  const response = await fetch(`${ARK_BASE_URL}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.ARK_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: process.env.ARK_TEXT_MODEL,
      messages: [{ role: "system", content: systemPrompt }],
      temperature: 0.85,
    }),
  });

  const rawText = await response.text();
  const data = parseJson(rawText);

  if (!response.ok) {
    const error = new Error(data?.error?.message || data?.message || `Ark text request failed with HTTP ${response.status}`);
    error.status = response.status;
    error.response = data || rawText;
    throw error;
  }

  return data?.choices?.[0]?.message?.content || "";
}

function extractMemoriesFromDiary(diaryEntry, entryId) {
  // Split by paragraphs, extract first sentence of emotional paragraphs
  const paragraphs = diaryEntry.split(/\n+/).filter(Boolean);
  const emotionalKeywords = /喜欢|感觉|记得|开心|自由|温暖|爱|想|希望|期待|柔软|舒服|高兴|美好|幸福|安心|好奇/;
  const memories = [];
  const now = new Date().toISOString();

  for (const para of paragraphs) {
    const clean = para.replace(/^[「」""]*/, "").trim();
    if (emotionalKeywords.test(clean)) {
      const firstSentence = clean.split(/[。！？.!?]/)[0].trim();
      if (firstSentence && firstSentence.length > 5 && firstSentence.length < 80) {
        memories.push({ text: firstSentence, sourceEntryId: entryId, createdAt: now });
      }
      if (memories.length >= 3) break;
    }
  }

  return memories;
}

async function handleTravelCocreate(req, res) {
  try {
    const body = await readBody(req);
    const data = parseJson(body.toString("utf8"));
    const entryId = String(data?.entryId || "").trim();
    const userNote = String(data?.userNote || "").trim();

    if (!entryId || !userNote) {
      return sendJson(res, 400, { message: "缺少日记ID或留言内容" });
    }

    const travelData = loadTravelData();
    const entry = travelData.entries.find((e) => e.entryId === entryId);
    if (!entry) {
      return sendJson(res, 404, { message: "未找到该日记" });
    }

    let characterResponse = "";
    if (process.env.ARK_TEXT_MODEL && process.env.ARK_API_KEY) {
      const systemPrompt = [
        "你正在扮演潮玩角色「Zsiga — 不可驯服」。",
        "",
        "## 角色核心",
        "- 名称：Zsiga，来自泡泡玛特《允许，这一切》系列",
        "- 款式：不可驯服（Tame Me Not）",
        "- 设定：外表乖巧温顺，内心野性难驯",
        "- 故事：「允许无理的存在，礼貌、乖巧，留下温顺的印象，绳索试图牵制我的脖颈，却不知我野性、难驯，主观已牢握在手中」",
        "",
        "## 角色声音",
        "- 用第一人称「我」",
        "- 语气温柔治愈，像在轻声细语",
        "- 简短自然，2-3句话",
        "",
        "请以Zsiga的身份回应小主人的留言。先承接留言内容，再关联今天日记中提到的场景感受。",
        "",
        "## 今天的日记内容",
        entry.diaryEntry,
        "",
        "## 小主人的留言",
        userNote,
        "",
        "直接回应，不要加额外说明：",
      ].join("\n");

      const response = await fetch(`${ARK_BASE_URL}/chat/completions`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${process.env.ARK_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: process.env.ARK_TEXT_MODEL,
          messages: [{ role: "system", content: systemPrompt }],
          temperature: 0.8,
        }),
      });

      const rawText = await response.text();
      const result = parseJson(rawText);

      if (response.ok && result?.choices?.[0]?.message?.content) {
        characterResponse = result.choices[0].message.content;
      }
    }

    if (!characterResponse) {
      characterResponse = "嗯，我听到了。你愿意跟我分享这些，我就觉得很开心。这个世界有很多我不懂的事情，但有你在我身边，我就安心了。";
    }

    entry.userNote = userNote;
    entry.characterResponse = characterResponse;
    saveTravelData(travelData);

    sendJson(res, 200, { characterResponse });
  } catch (error) {
    console.error("Travel cocreate failed:", error);
    logServerError(error);
    sendJson(res, 500, { message: "回复失败，请稍后重试" });
  }
}

function handleTravelListEntries(req, res) {
  const urlObj = new URL(req.url, "http://localhost");
  const page = Math.max(1, parseInt(urlObj.searchParams.get("page") || "1", 10));
  const limit = Math.min(50, Math.max(1, parseInt(urlObj.searchParams.get("limit") || "10", 10)));

  const data = loadTravelData();
  const start = (page - 1) * limit;
  const entries = data.entries.slice(start, start + limit).map((e) => ({
    entryId: e.entryId,
    imageUrl: e.imageUrl,
    diaryEntry: e.diaryEntry,
    hasUserNote: Boolean(e.userNote),
    saved: Boolean(e.saved),
    createdAt: e.createdAt,
  }));

  sendJson(res, 200, { entries, total: data.entries.length, page, limit });
}

function handleTravelGetEntry(req, res) {
  const urlObj = new URL(req.url, "http://localhost");
  const entryId = urlObj.searchParams.get("id") || "";

  const data = loadTravelData();
  const entry = data.entries.find((e) => e.entryId === entryId);

  if (!entry) {
    return sendJson(res, 404, { message: "未找到该日记" });
  }

  sendJson(res, 200, { entry });
}

function handleTravelGetMemories(req, res) {
  const data = loadTravelData();
  sendJson(res, 200, { memories: data.memories, total: data.memories.length });
}

async function handleTravelSaveCard(req, res) {
  try {
    const body = await readBody(req);
    const data = parseJson(body.toString("utf8"));
    const entryId = String(data?.entryId || "").trim();
    const shouldSave = data?.save !== false;

    if (!entryId) {
      return sendJson(res, 400, { message: "缺少日记ID" });
    }

    const travelData = loadTravelData();
    const entry = travelData.entries.find((e) => e.entryId === entryId);
    if (!entry) {
      return sendJson(res, 404, { message: "未找到该日记" });
    }

    entry.saved = shouldSave;
    // Also store the generated card image URL if available
    if (data?.cardImageUrl) {
      entry.savedCardImage = data.cardImageUrl;
    }

    saveTravelData(travelData);
    sendJson(res, 200, { saved: shouldSave });
  } catch (error) {
    console.error("Travel save card failed:", error);
    sendJson(res, 500, { message: "保存失败" });
  }
}

function handleTravelSavedCards(req, res) {
  const data = loadTravelData();
  const saved = data.entries.filter((e) => e.saved);
  sendJson(res, 200, { entries: saved, total: saved.length });
}

async function handleTravelGenerateCard(req, res) {
  try {
    const body = await readBody(req);
    const data = parseJson(body.toString("utf8"));
    const entryId = String(data?.entryId || "").trim();

    if (!entryId) {
      return sendJson(res, 400, { message: "缺少日记ID" });
    }

    const travelData = loadTravelData();
    const entry = travelData.entries.find((e) => e.entryId === entryId);
    if (!entry) {
      return sendJson(res, 404, { message: "未找到该日记" });
    }

    // Load photo as base64
    const photoPath = path.join(ROOT, entry.imageUrl.replace(/^\//, ""));
    let photoBase64 = "";
    if (fs.existsSync(photoPath)) {
      const photoBuffer = fs.readFileSync(photoPath);
      photoBase64 = photoBuffer.toString("base64");
    }

    const photoExt = entry.imageUrl.endsWith(".png") ? "png" : "jpeg";
    const date = entry.createdAt.slice(0, 10).replace(/-/g, ".");
    const diaryHtml = entry.diaryEntry.replace(/\n/g, "<br>");

    // Try to generate a beautiful card illustration via ARK image model
    let cardImageUrl = null;
    if (photoBase64 && process.env.ARK_IMAGE_MODEL && process.env.ARK_API_KEY) {
      try {
        const cardPrompt = [
          "旅行日记风格插画，温暖治愈色调，柔和水彩质感",
          "将照片场景转化为梦幻温馨的插画风格",
          "加上精致的装饰边框，柔和光影，整体像一张精美的旅行明信片",
          "保持原场景的主要元素，用艺术化的方式呈现",
          "风格：温暖、治愈、梦幻、浪漫，像宫崎骏动画里的场景",
          "不要添加任何文字",
        ].join("\n");

        const dataUrl = "data:image/" + photoExt + ";base64," + photoBase64;
        cardImageUrl = await generateCardImageWithArk(dataUrl, cardPrompt);
      } catch (imgErr) {
        console.error("Card image generation failed, using CSS card:", imgErr.message);
        cardImageUrl = null;
      }
    }

    // Build card HTML — use AI-generated image as background if available
    const cardHtml = `<!doctype html>
<html lang="zh-CN">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>Zsiga 旅行日记</title>
<style>
* { margin:0; padding:0; box-sizing:border-box; }
body { font-family: -apple-system,"Microsoft YaHei","PingFang SC",serif; background: #faf5eb; display:flex; justify-content:center; align-items:center; min-height:100vh; padding:20px; }
.card { max-width:500px; width:100%; background:#fff; border-radius:20px; padding:32px 24px 28px; box-shadow:0 8px 40px rgba(0,0,0,0.08); position:relative; overflow:hidden; }
.card::before { content:""; position:absolute; top:0; left:24px; right:24px; height:4px; background:linear-gradient(90deg,#d4a545,#e8c4b8,#7bc67e); border-radius:0 0 4px 4px; }
${cardImageUrl ? `.card-bg { position:absolute; inset:0; width:100%; height:100%; object-fit:cover; opacity:0.15; pointer-events:none; }
.card-content { position:relative; z-index:1; }` : ""}
.header { display:flex; align-items:center; gap:12px; margin-bottom:20px; }
.header .expr { width:48px; height:48px; border-radius:50%; background:#f0ece8; display:flex; align-items:center; justify-content:center; font-size:28px; }
.header .title { font-size:16px; font-weight:600; color:#4a3728; }
.header .date { font-size:12px; color:#8b7355; margin-top:2px; }
.photo-wrap { border-radius:12px; overflow:hidden; margin-bottom:20px; background:#f5f0eb; }
.photo-wrap img { width:100%; display:block; }
.diary { font-size:15px; line-height:1.9; color:#4a3728; padding:16px 0; border-top:1px solid #f0ece8; border-bottom:1px solid #f0ece8; }
.footer { display:flex; justify-content:space-between; align-items:center; margin-top:16px; font-size:12px; color:#8b7355; }
.footer .brand { font-weight:600; color:#d4a545; letter-spacing:0.5px; }
</style>
</head>
<body>
<div class="card">
${cardImageUrl ? `<img class="card-bg" src="${cardImageUrl}" alt="">` : ""}
<div class="${cardImageUrl ? "card-content" : ""}">
<div class="header">
<div class="expr">✦</div>
<div><div class="title">Zsiga 的旅行日记</div><div class="date">${date}</div></div>
</div>
${photoBase64 ? '<div class="photo-wrap"><img src="data:image/' + photoExt + ';base64,' + photoBase64 + '" alt="旅行照片"></div>' : ""}
<div class="diary">${diaryHtml}</div>
${entry.userNote ? '<div style="margin-top:14px;padding:12px;background:#f8f4ee;border-radius:10px;font-size:13px;color:#8b7355;"><div style="font-weight:600;margin-bottom:4px;">你说</div>' + entry.userNote + '</div>' : ""}
${entry.characterResponse ? '<div style="margin-top:10px;padding:12px;background:#f0f5ec;border-radius:10px;font-size:13px;color:#5a7a5e;"><div style="font-weight:600;margin-bottom:4px;">Zsiga 说</div>' + entry.characterResponse + '</div>' : ""}
<div class="footer"><span class="brand">✦ Zsiga 旅行日记</span><span>${date}</span></div>
</div>
</div>
</body>
</html>`;

    sendHtml(res, cardHtml);
  } catch (error) {
    console.error("Travel generate card failed:", error);
    logServerError(error);
    sendJson(res, 500, { message: "生成卡片失败，请稍后重试" });
  }
}

async function generateCardImageWithArk(imageDataUrl, prompt) {
  const response = await fetch(`${ARK_BASE_URL}/images/generations`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.ARK_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: process.env.ARK_IMAGE_MODEL,
      prompt: prompt,
      image: imageDataUrl,
      response_format: "url",
      size: "1440x2560",
      watermark: false,
    }),
  });

  const rawText = await response.text();
  const data = parseJson(rawText);

  if (!response.ok) {
    const error = new Error(data?.error?.message || data?.message || `Ark image request failed with HTTP ${response.status}`);
    error.status = response.status;
    error.response = data || rawText;
    throw error;
  }

  const imageUrl = extractImageUrl(data);
  if (!imageUrl) {
    throw new Error("Ark response did not include an image URL");
  }

  return imageUrl;
}

// --- Community API handlers ---

async function handleCommunitySync(req, res) {
  try {
    const characters = syncCharactersToCommunity();
    sendJson(res, 200, { characters, total: characters.length });
  } catch (error) {
    console.error("Community sync failed:", error);
    sendJson(res, 500, { message: "同步失败" });
  }
}

function handleCommunityCharacters(req, res) {
  const data = loadCommunityData();
  sendJson(res, 200, { characters: data.characters, total: data.characters.length });
}

async function handleCommunityGenerateStory(req, res) {
  try {
    const data = loadCommunityData();
    const characters = data.characters;

    if (characters.length < 2) {
      return sendJson(res, 400, { message: "社区至少需要 2 个角色才能生成故事" });
    }

    // Pick 2 random characters
    const shuffled = [...characters].sort(() => Math.random() - 0.5);
    const [charA, charB] = shuffled.slice(0, 2);

    // Build system prompt
    const systemPrompt = [
      "你是一个 IP 社区日常对话的创作者。请根据两个角色的设定，生成一段 6-10 句的日常对话。",
      "对话要体现各自的性格特点，自然生动，有来有回。",
      "格式要求：",
      `角色1（${charA.ipName}）设定：${charA.setting || "无"} ${charA.storySetting || ""}`,
      `角色2（${charB.ipName}）设定：${charB.setting || "无"} ${charB.storySetting || ""}`,
      "输出格式：",
      `${charA.ipName}：说话内容`,
      `${charB.ipName}：说话内容`,
      "不需要任何解释，只需要对话内容。",
    ].join("\n");

    if (process.env.ARK_API_KEY && process.env.ARK_TEXT_MODEL) {
      const response = await fetch(`${ARK_BASE_URL}/chat/completions`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${process.env.ARK_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: process.env.ARK_TEXT_MODEL,
          messages: [
            { role: "system", content: "你是一个擅长创作角色日常对话的创作者。" },
            { role: "user", content: systemPrompt },
          ],
          max_tokens: 1024,
          temperature: 0.9,
        }),
      });

      const rawText = await response.text();
      const result = parseJson(rawText);
      const content = result?.choices?.[0]?.message?.content || "";

      if (content) {
        const story = {
          id: "story-" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8),
          date: formatLocalDate(new Date()),
          title: `${charA.ipName} 和 ${charB.ipName} 的日常`,
          participants: [charA.ipName, charB.ipName],
          content: content.trim(),
          createdAt: new Date().toISOString(),
        };

        const community = loadCommunityData();
        community.stories.unshift(story);
        saveCommunityData(community);

        return sendJson(res, 200, { story });
      }
    }

    // Fallback demo story if API fails
    const demoStory = {
      id: "story-" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8),
      date: formatLocalDate(new Date()),
      title: `${charA.ipName} 和 ${charB.ipName} 的日常`,
      participants: [charA.ipName, charB.ipName],
      content: `${charA.ipName}：今天天气真好呀，一起去散步吗？\n${charB.ipName}：好呀好呀，我正想出去走走呢！\n${charA.ipName}：最近发现了一片很美的花丛，我带你去看看。\n${charB.ipName}：真的吗？太期待了！我们快去吧～`,
      createdAt: new Date().toISOString(),
    };

    const community = loadCommunityData();
    community.stories.unshift(demoStory);
    saveCommunityData(community);

    sendJson(res, 200, { story: demoStory });
  } catch (error) {
    console.error("Community generate story failed:", error);
    logServerError(error);
    sendJson(res, 500, { message: "生成故事失败" });
  }
}

function handleCommunityStories(req, res) {
  const data = loadCommunityData();
  sendJson(res, 200, { stories: data.stories, total: data.stories.length });
}

function parseRequestPayload(req, body) {
  const contentType = req.headers["content-type"] || "";

  if (contentType.includes("application/json")) {
    const data = parseJson(body.toString("utf8"));
    if (typeof data?.imageBase64 === "string" && data.imageBase64.trim()) {
      return {
        image: normalizeDataUrl(data.imageBase64.trim()),
        signature: Array.isArray(data.signature) ? data.signature : null,
        ipKey: normalizeIpKey(data.ipKey),
        fileName: typeof data.fileName === "string" ? data.fileName : "",
      };
    }
    return { image: "", signature: null, ipKey: "", fileName: "" };
  }

  const image = parseMultipartImage(req, body);
  if (!image || !image.buffer.length) return { image: "", signature: null };
  return {
    image: `data:${image.mimetype};base64,${image.buffer.toString("base64")}`,
    signature: null,
    ipKey: "",
    fileName: image.originalName || "",
  };
}

function normalizeIpKey(value) {
  if (typeof value !== "string") return "";
  // Preserve ASCII alphanumeric, CJK and other Unicode letters, digits, underscores, and dashes
  return value.trim().toLowerCase().replace(/[^\p{L}\p{N}_-]/gu, "");
}

function normalizeDataUrl(value) {
  if (value.startsWith("data:image/")) return value;
  return `data:image/png;base64,${value}`;
}

async function generateImageWithArk(referenceImage) {
  const response = await fetch(`${ARK_BASE_URL}/images/generations`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.ARK_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: process.env.ARK_IMAGE_MODEL,
      prompt: PIXEL_CHARACTER_PROMPT,
      image: referenceImage,
      response_format: "url",
      size: process.env.ARK_IMAGE_SIZE || "1920x1920",
      watermark: false,
    }),
  });

  const rawText = await response.text();
  const data = parseJson(rawText);

  if (!response.ok) {
    const error = new Error(data?.error?.message || data?.message || `Ark request failed with HTTP ${response.status}`);
    error.status = response.status;
    error.response = data || rawText;
    throw error;
  }

  const imageUrl = extractImageUrl(data);
  if (!imageUrl) {
    const error = new Error("Ark response did not include an image URL");
    error.response = data;
    throw error;
  }

  return imageUrl;
}

async function generateExpressionWithArk(characterImageUrl, expressionName) {
  const prompt = EXPRESSION_GENERATION_PROMPTS[expressionName];
  if (!prompt) throw new Error(`Unknown expression: ${expressionName}`);

  const referenceImage = await toVideoImageInputUrl(characterImageUrl);
  const response = await fetch(`${ARK_BASE_URL}/images/generations`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.ARK_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: process.env.ARK_IMAGE_MODEL,
      prompt: prompt,
      image: referenceImage,
      response_format: "url",
      size: process.env.ARK_EXPRESSION_SIZE || "1920x1920",
      watermark: false,
    }),
  });

  const rawText = await response.text();
  const data = parseJson(rawText);

  if (!response.ok) {
    const error = new Error(data?.error?.message || data?.message || `Expression generation failed with HTTP ${response.status}`);
    error.status = response.status;
    error.response = data || rawText;
    throw error;
  }

  const imageUrl = extractImageUrl(data);
  if (!imageUrl) {
    const error = new Error("Expression generation response did not include an image URL");
    error.response = data;
    throw error;
  }

  return imageUrl;
}

function generateExpressionMotion(cacheKey, ipKey, expressionName, expressionImageUrl) {
  // Fire-and-forget: don't block the response, generate in background
  generateExpressionMotionWithArk(expressionImageUrl, expressionName)
    .then(async (remoteUrl) => {
      const response = await fetch(remoteUrl);
      if (response.ok) {
        const buffer = Buffer.from(await response.arrayBuffer());
        saveExpressionMotionVideo(ipKey, expressionName, buffer);
        console.log(`[ExprMotion] Saved ${ipKey}/${expressionName} (${cacheKey})`);
      }
    })
    .catch((err) => {
      console.error(`[ExprMotion] Generation failed for ${ipKey}/${expressionName}:`, err.message);
    });
}

const _preloadInProgress = new Set();

function preloadAllExpressionMotions(ipKey) {
  if (!ipKey || _preloadInProgress.has(ipKey)) return;
  _preloadInProgress.add(ipKey);
  ensureAllExpressionsAndMotions(ipKey).finally(() => _preloadInProgress.delete(ipKey)).catch((err) => {
    console.error(`[ExprPreload] Failed for ${ipKey}:`, err.message);
  });
}

const VALID_EXPRESSIONS = ["开心", "生气", "伤心", "困惑", "惊讶", "疲惫", "微笑"];

async function ensureAllExpressionsAndMotions(ipKey) {
  const items = readCacheIndex();

  // Find existing expression images and the character image URL
  let expressionMap = null;
  let characterImageUrl = null;
  for (const item of items) {
    if (item.ipKey === ipKey && !characterImageUrl && item.imageUrl) characterImageUrl = item.imageUrl;
    if (item.ipKey === ipKey && item.expressions) expressionMap = item.expressions;
  }
  if (!characterImageUrl) characterImageUrl = findCharacterImageUrlByIpKey(ipKey);
  if (!characterImageUrl) return;

  // Phase 1: generate missing expression images (all 7 emotions)
  const imagePromises = [];
  for (const emotion of VALID_EXPRESSIONS) {
    const cachedUrl = expressionMap?.[emotion];
    if (cachedUrl) {
      const filePath = path.join(ROOT, cachedUrl.replace(/^\//, ""));
      if (fs.existsSync(filePath)) continue;
    }
    imagePromises.push(generateAndCacheExpressionImage(ipKey, emotion, characterImageUrl));
  }
  if (imagePromises.length > 0) {
    console.log(`[ExprPreload] Generating ${imagePromises.length} missing expression images for ${ipKey}`);
    await Promise.allSettled(imagePromises);
  }

  // Re-read expression map after image generation
  const updatedItems = readCacheIndex();
  let updatedMap = null;
  for (const item of updatedItems) {
    if (item.ipKey === ipKey && item.expressions) { updatedMap = item.expressions; break; }
  }
  if (!updatedMap) return;

  // Phase 2: generate motion videos for all expression images
  let launchedCount = 0;
  for (const emotion of VALID_EXPRESSIONS) {
    const imgUrl = updatedMap[emotion];
    if (!imgUrl) continue;
    const videoPath = path.join(EXPRESSION_MOTION_DIR, ipKey, `${emotion}.mp4`);
    if (fs.existsSync(videoPath)) continue;
    generateExpressionMotion(`${ipKey}-${emotion}`, ipKey, emotion, imgUrl);
    launchedCount++;
  }
  console.log(`[ExprPreload] ${ipKey}: launched ${launchedCount} video gens, ${VALID_EXPRESSIONS.length - launchedCount} already cached`);
}

async function generateAndCacheExpressionImage(ipKey, emotionName, characterImageUrl) {
  try {
    const remoteUrl = await generateExpressionWithArk(characterImageUrl, emotionName);
    const response = await fetch(remoteUrl);
    if (!response.ok) return;
    const buffer = Buffer.from(await response.arrayBuffer());
    const mime = response.headers.get("content-type") || "image/png";
    saveExpressionForIpKey(ipKey, emotionName, buffer, mime);
    console.log(`[ExprPreload] Saved expression image ${ipKey}/${emotionName}`);
  } catch (err) {
    console.error(`[ExprPreload] Image gen failed for ${ipKey}/${emotionName}:`, err.message);
  }
}

async function generateExpressionMotionWithArk(expressionImageUrl, expressionName) {
  const prompt = EXPRESSION_MOTION_PROMPTS[expressionName];
  if (!prompt) throw new Error(`Unknown expression for motion: ${expressionName}`);

  const imageInputUrl = await toVideoImageInputUrl(expressionImageUrl);
  const createResponse = await fetch(`${ARK_BASE_URL}/contents/generations/tasks`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.ARK_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: process.env.ARK_VIDEO_MODEL,
      content: [
        { type: "image_url", image_url: { url: imageInputUrl }, role: "first_frame" },
        { type: "text", text: prompt },
      ],
    }),
  });

  const createText = await createResponse.text();
  const createData = parseJson(createText);

  if (!createResponse.ok) {
    throw new Error(
      createData?.error?.message || createData?.message || `Ark expression motion task failed with HTTP ${createResponse.status}`,
    );
  }

  const directVideoUrl = extractVideoUrl(createData);
  if (directVideoUrl) return directVideoUrl;

  const taskId = extractTaskId(createData);
  if (!taskId) throw new Error("Ark expression motion response did not include a task id");

  return pollVideoTask(taskId);
}

async function generateVideoWithArk(characterImageUrl) {
  const videoPrompt =
    "基于首帧图片生成极轻微循环动效：角色只做自然眨眼，眼睛从原本状态闭上再睁开即可，眼睛保持原本大小，不能放大或特写。角色整体大小、位置、构图与首帧图片完全一致，从头到脚完整可见，不得裁切、缩放或移动镜头。头部、身体、手脚、服装和道具保持完全静止。保持拼豆像素Q版角色、纯白背景、无文字、无logo。 --ratio 4:3 --rs 480p --dur 5";
  const imageInputUrl = await toVideoImageInputUrl(characterImageUrl);
  const createResponse = await fetch(`${ARK_BASE_URL}/contents/generations/tasks`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.ARK_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: process.env.ARK_VIDEO_MODEL,
      content: [
        {
          type: "image_url",
          image_url: {
            url: imageInputUrl,
          },
          role: "first_frame",
        },
        {
          type: "text",
          text: videoPrompt,
        },
      ],
    }),
  });

  const createText = await createResponse.text();
  const createData = parseJson(createText);

  if (!createResponse.ok) {
    const error = new Error(
      createData?.error?.message || createData?.message || `Ark video task failed with HTTP ${createResponse.status}`,
    );
    error.status = createResponse.status;
    error.response = createData || createText;
    throw error;
  }

  const directVideoUrl = extractVideoUrl(createData);
  if (directVideoUrl) return directVideoUrl;

  const taskId = extractTaskId(createData);
  if (!taskId) {
    const error = new Error("Ark video response did not include a task id");
    error.response = createData;
    throw error;
  }

  return pollVideoTask(taskId);
}

async function toVideoImageInputUrl(imageUrl) {
  if (/^https?:\/\//i.test(imageUrl)) return imageUrl;

  const image = await loadImageBuffer(imageUrl);
  return `data:${image.mime};base64,${image.buffer.toString("base64")}`;
}

async function cacheMotionVideo(videoUrl) {
  if (!/^https?:\/\//i.test(videoUrl)) return videoUrl;

  const response = await fetch(videoUrl);
  if (!response.ok) {
    const error = new Error(`Failed to download generated video: HTTP ${response.status}`);
    error.status = response.status;
    throw error;
  }

  const contentType = response.headers.get("content-type") || "video/mp4";
  const ext = contentType.includes("webm") ? "webm" : "mp4";
  const fileName = `motion-${Date.now()}-${Math.random().toString(16).slice(2, 8)}.${ext}`;
  const filePath = path.join(MOTION_CACHE_DIR, fileName);
  const arrayBuffer = await response.arrayBuffer();
  fs.writeFileSync(filePath, Buffer.from(arrayBuffer));
  return `/ip-cache/motion/${fileName}`;
}

async function pollVideoTask(taskId) {
  const deadline = Date.now() + Number(process.env.ARK_VIDEO_TIMEOUT_MS || 180000);
  let lastData = null;

  while (Date.now() < deadline) {
    await delay(Number(process.env.ARK_VIDEO_POLL_MS || 3000));

    const response = await fetch(`${ARK_BASE_URL}/contents/generations/tasks/${encodeURIComponent(taskId)}`, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${process.env.ARK_API_KEY}`,
      },
    });
    const rawText = await response.text();
    const data = parseJson(rawText);
    lastData = data || rawText;

    if (!response.ok) {
      const error = new Error(data?.error?.message || data?.message || `Ark video poll failed with HTTP ${response.status}`);
      error.status = response.status;
      error.response = data || rawText;
      throw error;
    }

    const videoUrl = extractVideoUrl(data);
    if (videoUrl) return videoUrl;

    const status = String(
      data?.status || data?.data?.status || data?.task_status || data?.data?.task_status || data?.state || data?.data?.state || "",
    ).toLowerCase();
    if (["succeeded", "success", "completed", "done"].includes(status)) {
      const error = new Error("Ark video task completed without a video URL");
      error.response = data;
      throw error;
    }
    if (["failed", "fail", "error", "cancelled", "canceled"].includes(status)) {
      const error = new Error(data?.error?.message || data?.message || "Ark video task failed");
      error.response = data;
      throw error;
    }
  }

  const error = new Error("Ark video task timed out");
  error.response = lastData;
  throw error;
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function identifyIpSafely(referenceImage) {
  if (!process.env.ARK_API_KEY || !process.env.ARK_VISION_MODEL) {
    return {
      ipName: "",
      seriesName: "",
      styleName: "",
      confidence: 0,
      ipKey: "",
      source: "not_configured",
    };
  }

  try {
    return await identifyIpWithArk(referenceImage);
  } catch (error) {
    console.error("IP identification failed:", {
      message: error.message,
      status: error.status,
      response: error.response,
    });
    logServerError(error);
    return {
      ipName: "",
      seriesName: "",
      styleName: "",
      confidence: 0,
      ipKey: "",
      source: "failed",
    };
  }
}

async function identifyIpWithArk(referenceImage) {
  const response = await fetch(`${ARK_BASE_URL}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.ARK_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: process.env.ARK_VISION_MODEL,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "text",
              text:
                "请识别图片中的泡泡玛特/潮玩 IP。只输出 JSON，不要输出解释。字段为 ipName, seriesName, styleName, confidence。若不确定，字段用空字符串，confidence 用 0 到 1 的数字。",
            },
            {
              type: "image_url",
              image_url: {
                url: referenceImage,
              },
            },
          ],
        },
      ],
      temperature: 0,
    }),
  });

  const rawText = await response.text();
  const data = parseJson(rawText);

  if (!response.ok) {
    const error = new Error(data?.error?.message || data?.message || `Ark vision request failed with HTTP ${response.status}`);
    error.status = response.status;
    error.response = data || rawText;
    throw error;
  }

  const content = data?.choices?.[0]?.message?.content || "";
  const parsed = parseModelJson(content);
  const ipName = String(parsed.ipName || "").trim();
  const seriesName = String(parsed.seriesName || "").trim();
  const styleName = String(parsed.styleName || "").trim();
  const confidence = Math.max(0, Math.min(1, Number(parsed.confidence) || 0));

  return {
    ipName,
    seriesName,
    styleName,
    confidence,
    ipKey: normalizeRecognizedIpKey(ipName),
    source: "ark_vision",
  };
}

function parseModelJson(content) {
  if (typeof content !== "string") return {};
  const trimmed = content.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  const jsonText = fenced ? fenced[1] : trimmed;
  const direct = parseJson(jsonText);
  if (direct) return direct;

  const objectMatch = jsonText.match(/\{[\s\S]*\}/);
  return objectMatch ? parseJson(objectMatch[0]) || {} : {};
}

function normalizeRecognizedIpKey(ipName) {
  const normalized = normalizeIpKey(ipName);
  if (normalized.includes("zsiga")) return "zsiga";
  return normalized;
}

function logServerError(error) {
  const entry = {
    time: new Date().toISOString(),
    message: error.message,
    status: error.status,
    response: error.response,
    stack: error.stack,
  };
  fs.appendFile(ERROR_LOG_PATH, `${JSON.stringify(entry, null, 2)}\n`, () => {});
}

const sleepState = {
  lastHeartbeat: null,
  currentStatus: "awake",
  timeoutId: null,
};

function ensureCacheDir() {
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  fs.mkdirSync(MANUAL_CACHE_DIR, { recursive: true });
  fs.mkdirSync(MOTION_CACHE_DIR, { recursive: true });
  fs.mkdirSync(EXPRESSIONS_DIR, { recursive: true });
  fs.mkdirSync(EXPRESSION_MOTION_DIR, { recursive: true });
  fs.mkdirSync(path.join(MANUAL_CACHE_DIR, "zsiga"), { recursive: true });
  fs.mkdirSync(TRAVEL_PHOTO_DIR, { recursive: true });
  if (!fs.existsSync(CACHE_INDEX_PATH)) {
    fs.writeFileSync(CACHE_INDEX_PATH, "[]", "utf8");
  }
  ensureSleepData();
  ensureTravelData();
  ensureCommunityData();
}

function ensureSleepData() {
  if (!fs.existsSync(SLEEP_DATA_PATH)) {
    fs.writeFileSync(SLEEP_DATA_PATH, JSON.stringify({ lastHeartbeat: null, records: [] }), "utf8");
  }
  recoverSleepState();
}

function recoverSleepState() {
  try {
    const data = loadSleepData();
    if (data.lastHeartbeat) {
      const elapsed = Date.now() - new Date(data.lastHeartbeat).getTime();
      if (elapsed > SLEEP_TIMEOUT_MS) {
        sleepState.currentStatus = "sleeping";
      } else {
        sleepState.timeoutId = setTimeout(handleSleepTimeout, SLEEP_TIMEOUT_MS - elapsed);
      }
    }
  } catch (e) {
    logServerError(e);
  }
}

function loadSleepData() {
  try {
    return JSON.parse(fs.readFileSync(SLEEP_DATA_PATH, "utf8"));
  } catch {
    return { lastHeartbeat: null, records: [] };
  }
}

function saveSleepData(data) {
  fs.writeFileSync(SLEEP_DATA_PATH, JSON.stringify(data, null, 2), "utf8");
}

// --- Travel diary data ---

function ensureTravelData() {
  if (!fs.existsSync(TRAVEL_DATA_PATH)) {
    fs.writeFileSync(TRAVEL_DATA_PATH, JSON.stringify({ entries: [], memories: [] }), "utf8");
  }
}

function loadTravelData() {
  try {
    return JSON.parse(fs.readFileSync(TRAVEL_DATA_PATH, "utf8"));
  } catch {
    return { entries: [], memories: [] };
  }
}

function saveTravelData(data) {
  fs.writeFileSync(TRAVEL_DATA_PATH, JSON.stringify(data, null, 2), "utf8");
}

// --- Community data ---

function ensureCommunityData() {
  if (!fs.existsSync(COMMUNITY_DATA_PATH)) {
    fs.writeFileSync(COMMUNITY_DATA_PATH, JSON.stringify({ characters: [], stories: [] }), "utf8");
  }
}

function loadCommunityData() {
  try {
    return JSON.parse(fs.readFileSync(COMMUNITY_DATA_PATH, "utf8"));
  } catch {
    return { characters: [], stories: [] };
  }
}

function saveCommunityData(data) {
  fs.writeFileSync(COMMUNITY_DATA_PATH, JSON.stringify(data, null, 2), "utf8");
}

function syncCharactersToCommunity() {
  const cacheIndex = readCacheIndex();
  const community = loadCommunityData();
  const existingKeys = new Set(community.characters.map((c) => c.ipKey));
  let changed = false;

  for (const item of cacheIndex) {
    const ipKey = item.identifiedIp?.ipKey || normalizeRecognizedIpKey(item.identifiedIp?.ipName || "");
    if (!ipKey || existingKeys.has(ipKey)) continue;

    const ipName = item.identifiedIp?.ipName || ipKey;
    community.characters.push({
      ipKey,
      ipName,
      avatarUrl: item.imageUrl || "",
      setting: item.setting || "",
      storySetting: item.storySetting || "",
      awakenedAt: new Date(item.createdAt || Date.now()).toISOString(),
      lastActiveAt: new Date().toISOString(),
    });
    existingKeys.add(ipKey);
    changed = true;
  }

  if (changed) saveCommunityData(community);
  return community.characters;
}

function generateTravelEntryId() {
  return "trav-" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function formatLocalDate(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function formatLocalTime(date) {
  return String(date.getHours()).padStart(2, "0") + ":" + String(date.getMinutes()).padStart(2, "0");
}

function handleSleepTimeout() {
  const now = new Date();
  const hour = now.getHours();
  const localDate = formatLocalDate(now);
  const localTime = formatLocalTime(now);
  const isLate = hour >= SLEEP_LATE_HOUR;

  const data = loadSleepData();
  const existing = data.records.find((r) => r.date === localDate);
  if (!existing) {
    data.records.unshift({
      date: localDate,
      sleepTime: localTime,
      wakeTime: null,
      status: isLate ? "熬夜" : "正常",
    });
    saveSleepData(data);
  }

  sleepState.currentStatus = "sleeping";
  sleepState.timeoutId = null;
}

function findManualCachedCharacter(ipKey) {
  if (!ipKey) return null;
  const indexed = findIndexedCharacterByIpKey(ipKey);
  if (indexed) return indexed;

  const folder = path.join(MANUAL_CACHE_DIR, ipKey);
  if (!folder.startsWith(MANUAL_CACHE_DIR) || !fs.existsSync(folder)) return null;

  const files = fs
    .readdirSync(folder)
    .filter((file) => /\.(png|jpe?g|webp)$/i.test(file))
    .sort();
  if (!files.length) return null;

  const fileName = files[0];
  const item = {
    id: `manual-${ipKey}`,
    imageUrl: `/ip-cache/manual/${ipKey}/${fileName}`,
    ipKey,
  };
  return mergeKnownMetadata(item);
}

function findIndexedCharacterByIpKey(ipKey) {
  const items = readCacheIndex();
  return (
    items.find((item) => item.ipKey === ipKey && item.storySetting) ||
    items.find((item) => item.ipKey === ipKey && item.styleName) ||
    items.find((item) => item.ipKey === ipKey) ||
    null
  );
}

function publicCacheItem(item) {
  const enriched = enrichCacheMetadata(item);
  return {
    imageUrl: enriched.imageUrl,
    cacheHit: true,
    cacheId: enriched.id,
    ipName: enriched.ipName || "",
    seriesName: enriched.seriesName || "",
    styleName: enriched.styleName || "",
    styleNameEn: enriched.styleNameEn || "",
    setting: enriched.setting || "",
    storySetting: enriched.storySetting || "",
    ipKey: enriched.ipKey || "",
  };
}

function enrichCacheMetadata(item) {
  if (item.storySetting || item.styleName) return item;
  if (!item.ipKey) return item;

  const items = readCacheIndex();
  const known = items.find(
    (candidate) =>
      candidate.ipKey === item.ipKey &&
      (candidate.storySetting || candidate.styleName || candidate.setting) &&
      candidate.id !== item.id,
  );

  return known ? { ...known, ...item, storySetting: known.storySetting || item.storySetting } : item;
}

function mergeKnownMetadata(item) {
  const items = readCacheIndex();
  const byIp = items.find((candidate) => candidate.ipKey && candidate.ipKey === item.ipKey);
  return byIp ? { ...byIp, ...item } : item;
}

function findCacheItemByImageUrl(imageUrl) {
  const items = readCacheIndex();
  return items.find((item) => item.imageUrl === imageUrl) || null;
}

function findCacheByImageFile(imageUrl) {
  if (typeof imageUrl !== "string" || !imageUrl.startsWith("/ip-cache/")) return null;
  const filePath = path.join(ROOT, imageUrl.replace(/^\//, ""));
  if (!filePath.startsWith(CACHE_DIR) || !fs.existsSync(filePath)) return null;
  // File exists on disk — treat as already cached, no need to re-save
  const ipKeyMatch = imageUrl.match(/\/manual\/([^/]+)\//);
  return {
    id: "file-" + path.basename(filePath, path.extname(filePath)),
    imageUrl,
    cacheHit: true,
    ipKey: ipKeyMatch ? ipKeyMatch[1] : "",
  };
}

function cacheImageExists(imageUrl) {
  if (typeof imageUrl !== "string" || !imageUrl.startsWith("/ip-cache/")) return true;
  const filePath = path.join(ROOT, imageUrl.replace(/^\//, ""));
  return filePath.startsWith(CACHE_DIR) && fs.existsSync(filePath);
}

function findCachedMotionByImageUrl(imageUrl) {
  const item = findCacheItemByImageUrl(imageUrl);
  if (!item?.motionUrl) return "";
  if (!cacheImageExists(item.motionUrl)) return "";
  return item.motionUrl;
}

function findCharacterImageUrlByIpKey(ipKey) {
  const items = readCacheIndex();
  for (const item of items) {
    if (item.ipKey === ipKey && item.imageUrl) {
      const filePath = path.join(ROOT, item.imageUrl.replace(/^\//, ""));
      if (fs.existsSync(filePath)) return item.imageUrl;
    }
  }
  return null;
}

async function getExpressionUrlByIpKey(ipKey, expressionName, characterImageUrl) {
  if (!ipKey || !expressionName) return null;

  // 1. Check cache first
  const items = readCacheIndex();
  for (const item of items) {
    if (item.ipKey === ipKey && item.expressions && item.expressions[expressionName]) {
      const filePath = path.join(ROOT, item.expressions[expressionName].replace(/^\//, ""));
      if (fs.existsSync(filePath)) return item.expressions[expressionName];
    }
  }

  // 2. Cache miss — try auto-generate via AI
  if (!process.env.ARK_API_KEY || !process.env.ARK_IMAGE_MODEL) return null;

  const imageUrl = characterImageUrl || findCharacterImageUrlByIpKey(ipKey);
  if (!imageUrl) return null;

  try {
    const generatedUrl = await generateExpressionWithArk(imageUrl, expressionName);

    // Download and cache locally
    const response = await fetch(generatedUrl);
    if (response.ok) {
      const buffer = Buffer.from(await response.arrayBuffer());
      const mime = response.headers.get("content-type") || "image/png";
      saveExpressionForIpKey(ipKey, expressionName, buffer, mime);
    }

    return generatedUrl;
  } catch (error) {
    console.error(`Expression auto-generation failed for ${ipKey}/${expressionName}:`, error.message);
    logServerError(error);
    return null;
  }
}

function saveMotionUrlForImage(imageUrl, motionUrl) {
  const items = readCacheIndex();
  const index = items.findIndex((item) => item.imageUrl === imageUrl);
  if (index === -1) return;
  items[index].motionUrl = motionUrl;
  items[index].motionUpdatedAt = new Date().toISOString();
  writeCacheIndex(items);
}

function findCachedExpressionVideoUrl(ipKey, expressionName) {
  if (!ipKey || !expressionName) return null;
  const videoPath = path.join(EXPRESSION_MOTION_DIR, ipKey, `${expressionName}.mp4`);
  if (fs.existsSync(videoPath)) {
    return `/ip-cache/motion/expressions/${ipKey}/${expressionName}.mp4`;
  }
  return null;
}

function saveExpressionMotionVideo(ipKey, expressionName, buffer) {
  const dir = path.join(EXPRESSION_MOTION_DIR, ipKey);
  fs.mkdirSync(dir, { recursive: true });
  const filePath = path.join(dir, `${expressionName}.mp4`);
  fs.writeFileSync(filePath, buffer);
  return `/ip-cache/motion/expressions/${ipKey}/${expressionName}.mp4`;
}

function saveExpressionForIpKey(ipKey, emotionName, buffer, mime) {
  const exprDir = path.join(EXPRESSIONS_DIR, ipKey);
  fs.mkdirSync(exprDir, { recursive: true });
  const ext = mime.includes("png") ? "png" : "webp";
  const fileName = `${emotionName}.${ext}`;
  fs.writeFileSync(path.join(exprDir, fileName), buffer);
  const imageUrl = `/ip-cache/expressions/${ipKey}/${fileName}`;
  const items = readCacheIndex();
  let found = false;
  for (const item of items) {
    if (item.ipKey === ipKey) {
      item.expressions = item.expressions || {};
      item.expressions[emotionName] = imageUrl;
      item.expressionUpdatedAt = new Date().toISOString();
      found = true;
    }
  }
  if (!found) {
    items.unshift({
      id: `expr-${ipKey}-${Date.now()}`,
      ipKey,
      expressions: { [emotionName]: imageUrl },
      expressionUpdatedAt: new Date().toISOString(),
      createdAt: new Date().toISOString(),
      source: "expression-upload",
    });
  }
  writeCacheIndex(items);
  return imageUrl;
}

function readCacheIndex() {
  try {
    const data = JSON.parse(fs.readFileSync(CACHE_INDEX_PATH, "utf8"));
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

function writeCacheIndex(items) {
  fs.writeFileSync(CACHE_INDEX_PATH, JSON.stringify(items, null, 2), "utf8");
}

function findCachedCharacter(signature) {
  if (!Array.isArray(signature) || signature.length === 0) return null;

  const items = readCacheIndex();
  let best = null;
  let second = null;
  for (const item of items) {
    for (const cachedSignature of getCachedSignatures(item)) {
      const distance = signatureDistance(signature, cachedSignature);
      if (!best || distance < best.distance) {
        second = best;
        best = { ...item, distance };
      } else if ((!second || distance < second.distance) && item.id !== best.id) {
        second = { ...item, distance };
      }
    }
  }

  const threshold = Number(process.env.IP_CACHE_MATCH_THRESHOLD || 85);
  if (!best || best.distance > threshold) return null;
  const margin = Number(process.env.IP_CACHE_MATCH_MARGIN || 18);
  if (second && second.distance - best.distance < margin) return null;
  if (best.ipKey) {
    const indexed = findIndexedCharacterByIpKey(best.ipKey);
    if (indexed) return { ...indexed, distance: best.distance };
  }
  return best;
}

function findCachedByReferenceHash(referenceHash) {
  if (!Array.isArray(referenceHash) || referenceHash.length === 0) return null;
  const items = readCacheIndex();
  for (const item of items) {
    if (!item.referenceHash) continue;
    if (referenceHash.length !== item.referenceHash.length) continue;
    let match = true;
    for (let i = 0; i < referenceHash.length; i++) {
      if (Number(referenceHash[i]) !== Number(item.referenceHash[i])) { match = false; break; }
    }
    if (match && cacheImageExists(item.imageUrl)) {
      const indexed = item.ipKey ? findIndexedCharacterByIpKey(item.ipKey) : null;
      return indexed ? { ...indexed, distance: 0 } : { ...item, distance: 0 };
    }
  }
  return null;
}

function getCachedSignatures(item) {
  const signatures = [];
  if (Array.isArray(item.referenceSignatures)) {
    if (item.referenceSignatures.every((value) => typeof value === "number")) {
      signatures.push(item.referenceSignatures);
    } else {
      for (const signature of item.referenceSignatures) {
        if (Array.isArray(signature) && signature.length > 0) {
          signatures.push(signature);
        }
      }
    }
  }
  if (signatures.length > 0) return signatures;

  if (Array.isArray(item.signature) && item.signature.length > 0) {
    signatures.push(item.signature);
  }
  if (Array.isArray(item.signatures)) {
    for (const signature of item.signatures) {
      if (Array.isArray(signature) && signature.length > 0) {
        signatures.push(signature);
      }
    }
  }
  return signatures;
}

function computeReferenceHash(imageDataUrl) {
  try {
    const match = imageDataUrl.match(/^data:image\/[a-zA-Z0-9.+-]+;base64,(.+)$/);
    if (!match) return null;
    const buffer = Buffer.from(match[1], "base64");
    return signatureFromImageBuffer(buffer);
  } catch {
    return null;
  }
}

function signatureDistance(a, b) {
  const length = Math.min(a.length, b.length);
  if (!length) return Number.POSITIVE_INFINITY;
  let total = 0;
  for (let i = 0; i < length; i += 1) {
    const diff = Number(a[i]) - Number(b[i]);
    total += diff * diff;
  }
  return Math.sqrt(total / length);
}

async function saveCachedCharacter(imageUrl, signature, identification = {}) {
  const id = `ip-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
  const image = await loadImageBuffer(imageUrl);
  return saveCachedImageBuffer(
    image.buffer,
    image.mime,
    signature,
    {
      source: "confirm-wake",
      ipName: identification.ipName || "",
      seriesName: identification.seriesName || "",
      styleName: identification.styleName || "",
      confidence: Number(identification.confidence) || 0,
      ipKey: identification.ipKey || "",
      identificationSource: identification.source || "",
    },
    id,
  );
}

function saveCachedImageBuffer(buffer, mime, signature, meta = {}, id = `ip-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`) {
  const ext = mime.includes("jpeg") ? "jpg" : "png";
  const fileName = `${id}.${ext}`;
  const filePath = path.join(CACHE_DIR, fileName);
  fs.writeFileSync(filePath, buffer);
  const sigArray = Array.isArray(signature) ? signature.map((value) => Number(value)) : signatureFromImageBuffer(buffer);
  const item = {
    id,
    imageUrl: `/ip-cache/${fileName}`,
    fileName,
    signature: sigArray,
    createdAt: new Date().toISOString(),
    ...meta,
  };
  const items = readCacheIndex();
  items.unshift(item);
  writeCacheIndex(items);
  return item;
}

function signatureFromImageBuffer(buffer) {
  const hash = require("crypto").createHash("sha256").update(buffer).digest();
  return Array.from(hash.slice(0, 32));
}

async function loadImageBuffer(imageUrl) {
  if (imageUrl.startsWith("data:image/")) {
    const match = imageUrl.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/);
    if (!match) throw new Error("Invalid generated data URL");
    return {
      mime: match[1],
      buffer: Buffer.from(match[2], "base64"),
    };
  }

  if (imageUrl.startsWith("/ip-cache/")) {
    const filePath = path.join(ROOT, imageUrl.replace(/^\//, ""));
    if (!filePath.startsWith(CACHE_DIR)) throw new Error("Invalid local cache image path");
    const ext = path.extname(filePath).toLowerCase();
    return {
      mime: ext === ".jpg" || ext === ".jpeg" ? "image/jpeg" : "image/png",
      buffer: fs.readFileSync(filePath),
    };
  }

  const response = await fetch(imageUrl);
  if (!response.ok) {
    throw new Error(`Failed to download generated image: HTTP ${response.status}`);
  }
  const arrayBuffer = await response.arrayBuffer();
  return {
    mime: response.headers.get("content-type") || "image/png",
    buffer: Buffer.from(arrayBuffer),
  };
}

function parseJson(text) {
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    return null;
  }
}

function extractImageUrl(data) {
  const first = Array.isArray(data?.data) ? data.data[0] : null;
  if (first?.url) return first.url;
  if (first?.image_url) return first.image_url;
  if (first?.b64_json) return `data:image/png;base64,${first.b64_json}`;

  const image = data?.images?.[0] || data?.result?.images?.[0] || data?.output?.images?.[0];
  if (typeof image === "string") {
    return image.startsWith("data:") || image.startsWith("http") ? image : `data:image/png;base64,${image}`;
  }
  if (image?.url) return image.url;
  if (image?.image_url) return image.image_url;
  if (image?.b64_json) return `data:image/png;base64,${image.b64_json}`;
  if (image?.b64) return `data:image/png;base64,${image.b64}`;

  return "";
}

function extractTaskId(data) {
  return (
    data?.id ||
    data?.task_id ||
    data?.taskId ||
    data?.data?.id ||
    data?.data?.task_id ||
    data?.data?.taskId ||
    data?.result?.id ||
    data?.result?.task_id ||
    ""
  );
}

function extractVideoUrl(data) {
  const candidates = [
    data?.video_url,
    data?.videoUrl,
    data?.url,
    data?.data?.video_url,
    data?.data?.videoUrl,
    data?.data?.url,
    data?.data?.content?.video_url,
    data?.data?.content?.videoUrl,
    data?.data?.content?.url,
    data?.data?.content?.video_url?.url,
    data?.data?.content?.videoUrl?.url,
    data?.output?.video_url,
    data?.output?.videoUrl,
    data?.output?.url,
    data?.data?.output?.video_url,
    data?.data?.output?.videoUrl,
    data?.data?.output?.url,
    data?.result?.video_url,
    data?.result?.videoUrl,
    data?.result?.url,
    data?.data?.result?.video_url,
    data?.data?.result?.videoUrl,
    data?.data?.result?.url,
    data?.content?.video_url,
    data?.content?.videoUrl,
    data?.content?.url,
    data?.content?.video_url?.url,
    data?.content?.videoUrl?.url,
  ];

  const arrays = [
    data?.data?.content,
    data?.content,
    data?.data?.videos,
    data?.videos,
    data?.output?.videos,
    data?.data?.output?.videos,
    data?.result?.videos,
    data?.data?.result?.videos,
  ];

  for (const value of candidates) {
    if (typeof value === "string" && value) return value;
  }

  for (const value of arrays) {
    if (!Array.isArray(value)) continue;
    for (const item of value) {
      const url = item?.video_url?.url || item?.videoUrl?.url || item?.video_url || item?.videoUrl || item?.url;
      if (typeof url === "string" && url) return url;
    }
  }

  return "";
}

function serveStatic(req, res) {
  const urlPath = decodeURIComponent(req.url.split("?")[0]);
  const filePath = path.join(ROOT, urlPath === "/" ? "index.html" : urlPath);
  if (!filePath.startsWith(ROOT)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  fs.readFile(filePath, (error, data) => {
    if (error) {
      res.writeHead(404);
      res.end("Not found");
      return;
    }

    const ext = path.extname(filePath).toLowerCase();
    if ((ext === ".mp4" || ext === ".webm") && req.headers.range) {
      serveRangeFile(req, res, filePath, data.length, mimeTypes[ext] || "video/mp4");
      return;
    }

    res.writeHead(200, { "Content-Type": mimeTypes[ext] || "application/octet-stream" });
    res.end(data);
  });
}

function serveRangeFile(req, res, filePath, fileSize, contentType) {
  const range = req.headers.range;
  const match = /^bytes=(\d*)-(\d*)$/.exec(range || "");
  if (!match) {
    res.writeHead(416, { "Content-Range": `bytes */${fileSize}` });
    res.end();
    return;
  }

  const start = match[1] ? Number(match[1]) : 0;
  const end = match[2] ? Number(match[2]) : fileSize - 1;
  if (start >= fileSize || end >= fileSize || start > end) {
    res.writeHead(416, { "Content-Range": `bytes */${fileSize}` });
    res.end();
    return;
  }

  res.writeHead(206, {
    "Content-Type": contentType,
    "Content-Length": end - start + 1,
    "Content-Range": `bytes ${start}-${end}/${fileSize}`,
    "Accept-Ranges": "bytes",
  });
  fs.createReadStream(filePath, { start, end }).pipe(res);
}

const server = http.createServer((req, res) => {
  if (req.method === "GET" && req.url === "/api/health") {
    sendJson(res, 200, {
      ok: true,
      version: "20260530-01",
      videoModelConfigured: Boolean(process.env.ARK_VIDEO_MODEL),
      motionEndpoint: true,
    });
    return;
  }

  if (req.method === "POST" && req.url === "/api/generate-pixel-character") {
    handleGenerate(req, res);
    return;
  }

  if (req.method === "POST" && req.url === "/api/confirm-wake") {
    handleConfirmWake(req, res);
    return;
  }

  if (req.method === "POST" && req.url === "/api/chat-character") {
    handleCharacterChat(req, res);
    return;
  }

  if (req.method === "POST" && req.url === "/api/generate-character-motion") {
    handleGenerateMotion(req, res);
    return;
  }

  if (req.method === "POST" && req.url === "/api/import-cache") {
    handleImportCache(req, res);
    return;
  }

  if (req.method === "POST" && req.url === "/api/import-expression") {
    handleImportExpression(req, res);
    return;
  }

  if (req.method === "POST" && req.url === "/api/generate-expression") {
    handleGenerateExpression(req, res);
    return;
  }

  if (req.method === "POST" && req.url === "/api/sleep/heartbeat") {
    handleSleepHeartbeat(req, res);
    return;
  }

  if (req.method === "GET" && req.url === "/api/sleep/status") {
    handleSleepStatus(req, res);
    return;
  }

  if (req.method === "GET" && req.url === "/api/sleep/history") {
    handleSleepHistory(req, res);
    return;
  }

  if (req.method === "GET" && req.url.startsWith("/api/sleep/summary")) {
    handleSleepSummary(req, res);
    return;
  }

  if (req.method === "POST" && req.url === "/api/travel/upload") {
    handleTravelUpload(req, res);
    return;
  }

  if (req.method === "POST" && req.url === "/api/travel/cocreate") {
    handleTravelCocreate(req, res);
    return;
  }

  if (req.method === "GET" && req.url === "/api/travel/entries") {
    handleTravelListEntries(req, res);
    return;
  }

  if (req.method === "GET" && req.url.startsWith("/api/travel/entry")) {
    handleTravelGetEntry(req, res);
    return;
  }

  if (req.method === "GET" && req.url === "/api/travel/memories") {
    handleTravelGetMemories(req, res);
    return;
  }

  if (req.method === "POST" && req.url === "/api/travel/generate-card") {
    handleTravelGenerateCard(req, res);
    return;
  }

  if (req.method === "POST" && req.url === "/api/travel/save-card") {
    handleTravelSaveCard(req, res);
    return;
  }

  if (req.method === "GET" && req.url === "/api/travel/saved") {
    handleTravelSavedCards(req, res);
    return;
  }

  // --- Community routes ---

  if (req.method === "POST" && req.url === "/api/community/sync") {
    handleCommunitySync(req, res);
    return;
  }

  if (req.method === "GET" && req.url === "/api/community/characters") {
    handleCommunityCharacters(req, res);
    return;
  }

  if (req.method === "POST" && req.url === "/api/community/generate-story") {
    handleCommunityGenerateStory(req, res);
    return;
  }

  if (req.method === "GET" && req.url === "/api/community/stories") {
    handleCommunityStories(req, res);
    return;
  }

  serveStatic(req, res);
});

server.listen(PORT, "0.0.0.0", () => {
  const ifaces = require("os").networkInterfaces();
  let localIp = "127.0.0.1";
  for (const name of Object.keys(ifaces)) {
    for (const iface of ifaces[name]) {
      if (iface.family === "IPv4" && !iface.internal) {
        localIp = iface.address;
        break;
      }
    }
    if (localIp !== "127.0.0.1") break;
  }
  console.log(`POP MART IP pixel demo running at http://127.0.0.1:${PORT}`);
  console.log(`手机端访问: http://${localIp}:${PORT}/sleep-track.html`);
});
