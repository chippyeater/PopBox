# PopBox — 桌面陪伴盲盒原型

基于 **M5Stack CoreS3** 的桌面陪伴盲盒。用户通过语音与盲盒角色交互，角色根据人设和世界观生成个性化回应；支持拍照识别盲盒角色并自动从网络补全角色资料。

> **没有硬件？** 先跑网页版模拟器验证效果，再烧录到设备。→ [网页版快速启动](#网页版快速启动)

---

## 目录

- [功能概览](#功能概览)
- [系统架构](#系统架构)
- [网页版快速启动](#网页版快速启动)
- [硬件版运行说明](#硬件版运行说明)
- [API 配置](#api-配置)
- [项目结构](#项目结构)
- [角色模板](#角色模板)
- [扩展规划](#扩展规划)

---

## 功能概览

| 功能 | 状态 | 说明 |
|------|------|------|
| 语音对话 | ✅ 已实现 | 录音 → Google STT → Qwen 角色回复 |
| 对话记忆 | ✅ 已实现 | 后端持久化，重启后保留上下文 |
| 拍照识角色 | ✅ 已实现 | 相机拍照 → Qwen VL 识别 → 自动填充人设 |
| 联网搜索补全 | ✅ 已实现 | 识别后用 Qwen + 联网搜索补全角色背景 |
| 旅行日志 | 🔲 规划中 | — |
| 多角色切换 | 🔲 规划中 | — |

---

## 系统架构

```
CoreS3（硬件）
  │  WiFi
  ▼
后端服务器（web/server.js）
  ├── POST /api/stt        ← 原始 PCM 音频 → Google STT → 文字
  ├── POST /api/chat       ← 文字 + 对话历史 → Qwen → 角色回复
  │                           └── 持久化到 web/data/history_<id>.json
  ├── POST /api/recognize  ← JPEG 图片 → Qwen VL → 角色完整人设 JSON
  │                           └── 必要时 Qwen + enable_search 补充搜索
  └── GET  /api/character  ← 返回当前角色信息

浏览器（网页模拟器）
  ├── Web Speech API       ← 浏览器内置 STT，无需 Google Key
  ├── POST /api/chat       ← 与硬件共用同一后端
  └── POST /api/recognize/upload ← 上传图片测试识别
```

---

## 网页版快速启动

无需硬件，浏览器中完整模拟 CoreS3 屏幕。

```bash
cd web
npm install

# 复制配置文件并填入 API Key
copy .env.example .env
# 编辑 .env，至少填写 DASHSCOPE_API_KEY

npm start
```

用 **Chrome** 打开 `http://localhost:3000`

- **语音对话**：点击「点击说话」，首次需允许麦克风权限（Chrome）
- **文字对话**：页面下方输入框，任何浏览器均可用
- **识别角色**：点击「识别角色」，选择角色图片上传

> 网页版使用浏览器内置 Web Speech API，**无需** Google STT Key。

---

## 硬件版运行说明

### 环境要求

- [VS Code](https://code.visualstudio.com/) + [PlatformIO 插件](https://platformio.org/install/ide?install=vscode)
- M5Stack CoreS3（ESP32-S3，内置麦克风 + 320×240 触摸屏 + 前置相机）
- USB-C 数据线
- 与后端服务器在**同一局域网**的 WiFi

### 步骤

**1. 启动后端服务器**（先于硬件运行）

```bash
cd web && npm start
# 终端会打印局域网 IP，例如：
# CoreS3 填写: http://192.168.1.5:3000
```

**2. 填写硬件配置**

编辑 `src/config.h`（此文件不提交 git）：

```cpp
#define WIFI_SSID    "你的WiFi名称"
#define WIFI_PASSWORD "你的WiFi密码"
#define BACKEND_URL  "http://192.168.1.5:3000"  // 上一步打印的 IP
```

**3. 准备头像**

将角色头像放到 `data/avatar.jpg`，建议 90×90px，< 30KB。

**4. 上传文件系统**

```bash
pio run --target uploadfs
```

**5. 编译并烧录**

```bash
pio run --target upload
```

**6. 使用**

```
┌──────────────────────────────────────┐  320px
│ [头像]    角色名                      │
│           ● 待机                     │  ← 头部（108px）
├──────────────────────────────────────┤
│                                      │
│   角色回复文字                        │  ← 聊天区（~100px）
│                                      │
├──────────────────────────────────────┤
│  [ ● 点击说话 ]    [ 识别角色 ]      │  ← 底部双按钮（30px）
└──────────────────────────────────────┘
                                     240px
```

- **左按钮**：点击开始录音 → 再点停止 → 等待角色回复
- **右按钮**：拍照 → 自动识别盲盒角色 → 更新人设

---

## API 配置

所有 Key 配置在 `web/.env` 文件（从 `.env.example` 复制）。

### 阿里云 DashScope（必填）

聊天 + 角色识别均使用此 Key。

1. 访问 [DashScope 控制台](https://dashscope.console.aliyun.com/apiKey)
2. 创建 API Key
3. 填入 `.env`：
   ```
   DASHSCOPE_API_KEY=sk-xxxxxxxxx
   QWEN_CHAT_MODEL=qwen-turbo        # 聊天用，轻量快速
   QWEN_VL_MODEL=qwen3.6-plus        # 角色识别用，支持视觉 + 联网搜索
   QWEN_SEARCH_MODEL=qwen-plus       # 补充搜索用
   ```

### Google Cloud Speech-to-Text（硬件语音识别用）

网页版用浏览器内置 STT，此 Key 仅硬件端需要。

1. 访问 [Google Cloud Console](https://console.cloud.google.com/)
2. 启用 **Cloud Speech-to-Text API**
3. 创建 API Key 并填入 `.env`：
   ```
   GOOGLE_STT_API_KEY=your_key_here
   ```

> 免费额度：每月 60 分钟语音识别。

---

## 项目结构

```
PopBox/
├── platformio.ini              # PlatformIO 硬件项目配置
├── data/                       # SPIFFS 文件（烧录到设备闪存）
│   ├── character.json          # 当前角色人设
│   └── avatar.jpg              # 角色头像
├── src/                        # CoreS3 固件源码（C++/Arduino）
│   ├── main.cpp
│   ├── config.h                # 敏感配置（不提交 git）
│   ├── character/
│   │   ├── Character.h/.cpp         # 角色数据模型
│   │   ├── CharacterManager.h/.cpp  # 角色加载 + 识别流程
│   │   └── RecognitionClient.h/.cpp # 向后端发图、接收角色 JSON
│   ├── camera/
│   │   └── CameraManager.h/.cpp     # CoreS3 前置相机
│   ├── audio/
│   │   ├── AudioRecorder.h/.cpp     # 麦克风录音（PSRAM 缓冲）
│   │   └── SpeechToText.h/.cpp      # 发送 PCM 到后端 STT
│   ├── ai/
│   │   └── LLMClient.h/.cpp         # 发消息到后端 /api/chat
│   └── ui/
│       ├── DisplayManager.h/.cpp    # 屏幕布局（efontCN 简体中文字体）
│       └── ChatUI.h/.cpp            # 交互状态机
└── web/                        # 后端服务器 + 网页模拟器
    ├── server.js               # Express 后端（STT / Chat / 角色识别）
    ├── .env.example            # 配置模板
    ├── data/                   # 对话历史持久化（不提交 git）
    │   └── history_<id>.json
    └── public/                 # 网页模拟器前端
        ├── index.html
        ├── style.css
        └── app.js
```

---

## 角色模板

角色数据存储在 `data/character.json`，可手动编辑或通过拍照识别自动生成：

```json
{
  "id":           "角色唯一ID（英文下划线）",
  "name":         "角色显示名",
  "series":       "所属作品/IP",
  "avatar":       "/avatar.jpg",
  "catchphrases": ["口头禅1", "口头禅2"],
  "personality":  "性格描述",
  "worldview":    "世界观描述",
  "background":   "背景故事",
  "reply_style":  "回复风格说明"
}
```

---

## 扩展规划

代码中已标注 `[EXTENSION POINT]` 注释，对应以下功能接入位置：

| 功能 | 接口位置 | 开关宏 |
|------|---------|--------|
| 旅行日志 | `Character.h` → `CharacterMemory` | `FEATURE_TRAVEL_LOG` |
| 多角色切换 | `CharacterManager.h` → `switchCharacter()` | — |
| 富文本/气泡显示 | `DisplayManager.cpp` → `_drawChatArea()` | — |
| 对话历史摘要压缩 | `web/server.js` → `appendTurn()` | — |
| 长期记忆 RAG | `web/server.js` → `/api/chat` 上下文构建 | — |
| IMU 体感互动 | `src/main.cpp` → `update()` 或独立 `ImuManager` | `FEATURE_IMU` |

### 长期记忆 RAG（待实现）

**目标**：让角色在长期使用中对用户形成持续记忆，而不仅限于当天的对话窗口。

**存储方式**

- 当天对话实时写入 `history_<charId>_<YYYY-MM-DD>.json`（以天归档，替代当前的单文件滚动）
- 每条记录保留 `{ role, content, timestamp }` 三元组

**上下文构建策略**

每次用户发送消息时，上下文由两部分拼接而成：

1. **今日完整聊天记录**（当天 `history_<id>_<date>.json` 全文）
2. **历史 Top-K 相关片段**：从所有历史日期文件中检索与当前消息最相关的 K 条对话，作为长期记忆补充注入

**检索方式（性价比优先）**

推荐两阶段轻量实现，无需向量数据库：

| 阶段 | 方法 | 说明 |
|------|------|------|
| 粗筛 | 关键词 TF-IDF 或 jieba 分词后倒排索引 | 秒级，纯本地，过滤掉大量无关记录 |
| 精排 | 字符串级相似度（如 BM25 或简单 Jaccard） | 对粗筛结果打分，取 Top-K |

如后期性能要求提升，可替换为轻量本地向量模型（如 `@xenova/transformers` 的 `bge-small-zh`）生成 embedding，改用余弦相似度排序；接口不变，仅替换检索模块。

**接入位置**：`web/server.js` → `/api/chat` handler，在调用 LLM 前构建 `memoryContext` 并注入 system prompt。

---

### IMU 体感互动（待实现）

CoreS3 内置 BMI270 六轴 IMU（加速度计 + 陀螺仪），可以感知设备的姿态、运动和冲击，为角色互动增加物理维度。

**核心手势与对应交互**

| 手势 / 姿态 | 检测方式 | 角色反应 |
|---|---|---|
| **摇一摇** | 加速度突变超过阈值 | 角色被"晃醒"，说一句随机口头禅或抱怨 |
| **轻拍顶部** | 短促的 Z 轴冲击（tap detection） | 触发"摸头"反应，切换 happy 表情 |
| **翻转朝下** | pitch ≈ 180°，屏幕向下 | 角色进入"睡觉"状态，切换 idle 并静音 |
| **倾斜左/右** | roll 超过 ±45° 持续 1s | 切换到上一个/下一个收藏角色 |
| **长时间静置** | 加速度方差极小，持续 5min+ | 角色主动发起对话（"你还在吗？"） |
| **自由落体** | 加速度接近 0g，持续 > 80ms | 角色惊叫，落地后表情切换为 thinking |

**情绪状态机扩展思路**

IMU 数据可以作为角色"情绪"的持续输入，而不仅仅是触发单次反应。比如：
- 设备一天内被拿起放下的次数 → 影响角色的"被需要感"，反映在对话语气上
- 持续轻微晃动（如走路）→ 角色知道用户"带着我出门了"，可以有不同的问候语
- 睡前检测到长时间静置后第二天首次拿起 → 角色说"早上好"

**实现建议**

- 在 `src/main.cpp` 的 `loop()` 中以固定间隔（如 50ms）读取 `M5.Imu`，将加速度数据传入 `ImuManager::update()`
- `ImuManager` 内部维护滑动窗口，输出枚举事件（`IMU_SHAKE`、`IMU_TAP`、`IMU_FLIP` 等）
- `ChatUI::update()` 监听 `ImuManager` 事件，与触摸事件同级处理，互不干扰
- 宏 `FEATURE_IMU` 控制编译，关闭时零开销

---

## 注意事项

- `src/config.h` 含 WiFi 密码和后端地址，已加入 `.gitignore`
- `web/.env` 含 API Key，已加入 `.gitignore`
- `web/data/history_*.json` 含对话历史，已加入 `.gitignore`
- 硬件端使用 `client.setInsecure()` 跳过 HTTPS 证书验证（MVP），生产版本需配置 CA 证书
- 后端服务器需与 CoreS3 在**同一局域网**，或通过内网穿透暴露
