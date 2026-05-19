# PopBox — 桌面陪伴盲盒原型

基于 **M5Stack CoreS3** 的桌面陪伴盲盒。用户通过语音与角色交互，角色根据自身人设和世界观生成个性化文本回应。

> **没有硬件？** 先跑网页版模拟器，功能调好后再烧录到设备。→ 见 [网页版快速启动](#网页版快速启动)

---

## 目录

- [网页版快速启动](#网页版快速启动)
- [硬件要求](#硬件要求)
- [项目结构](#项目结构)
- [API 配置](#api-配置)
- [运行说明（硬件版）](#运行说明)
- [角色模板](#角色模板)
- [后续扩展规划](#后续扩展规划)

---

## 网页版快速启动

无需硬件，在浏览器中模拟 CoreS3 屏幕，**只需 Gemini API Key**。

```bash
# 1. 进入 web 目录
cd web

# 2. 安装依赖
npm install

# 3. 配置 API Key
copy .env.example .env
# 用编辑器打开 .env，填入 GEMINI_API_KEY=你的key

# 4. 启动服务器
npm start
```

然后用 **Chrome 浏览器**打开 `http://localhost:3000`

**语音输入**：需要 Chrome 浏览器，首次使用会请求麦克风权限，允许即可。
**文字输入**：页面底部有文字输入框，在任何浏览器中都可用。

> 网页版不需要 Google STT Key，使用浏览器内置的 Web Speech API（免费）。

---

## 硬件要求

| 设备 | 说明 |
|------|------|
| M5Stack CoreS3 | 主控（ESP32-S3，内置麦克风、320×240 触摸屏、8MB PSRAM） |
| USB-C 数据线 | 用于烧录固件 |
| WiFi 网络 | 用于调用云端 API |

> 无需额外硬件，CoreS3 内置麦克风和触摸屏已满足 MVP 需求。

---

## 项目结构

```
PopBox/
├── platformio.ini              # PlatformIO 项目配置
├── data/                       # SPIFFS 文件（需单独上传）
│   ├── character.json          # 角色人设数据
│   └── avatar.jpg              # 角色头像（需自行提供）
├── src/
│   ├── main.cpp                # 主入口
│   ├── config.h                # WiFi 和 API Key 配置（不提交 git）
│   ├── character/
│   │   ├── Character.h/.cpp    # 角色数据模型
│   │   └── CharacterManager.h/.cpp  # 角色加载管理
│   ├── audio/
│   │   ├── AudioRecorder.h/.cpp     # 麦克风录音
│   │   └── SpeechToText.h/.cpp      # Google STT 调用
│   ├── ai/
│   │   └── LLMClient.h/.cpp         # Gemini API 调用
│   └── ui/
│       ├── DisplayManager.h/.cpp    # 屏幕布局绘制
│       └── ChatUI.h/.cpp            # 交互状态机
└── Readme.md
```

---

## API 配置

### 1. Gemini API（LLM 回复生成）

1. 访问 [Google AI Studio](https://aistudio.google.com/)
2. 登录 Google 账号 → 点击 **Get API key** → **Create API key**
3. 复制 API Key
4. 填入 `src/config.h`：
   ```cpp
   #define GEMINI_API_KEY "your_key_here"
   ```

> 免费额度：每天 **1500 次**请求，每分钟 15 次（Gemini 2.0 Flash）

---

### 2. Google Cloud Speech-to-Text API（语音识别）

1. 访问 [Google Cloud Console](https://console.cloud.google.com/)
2. 新建项目（或选择已有项目）
3. 搜索并启用 **Cloud Speech-to-Text API**
4. 进入 **API 和服务 → 凭据 → 创建凭据 → API 密钥**
5. 复制 API Key
6. 填入 `src/config.h`：
   ```cpp
   #define GOOGLE_STT_API_KEY "your_key_here"
   ```

> 免费额度：每月 **60 分钟**语音识别（Standard 模型）

---

### 3. WiFi 配置

在 `src/config.h` 中填写：
```cpp
#define WIFI_SSID     "你的WiFi名称"
#define WIFI_PASSWORD "你的WiFi密码"
```

---

## 运行说明

### 环境准备

1. 安装 [VS Code](https://code.visualstudio.com/) 和 [PlatformIO 插件](https://platformio.org/install/ide?install=vscode)
2. 克隆本项目并用 VS Code 打开

### 步骤

**第一步：准备头像图片**
- 将角色头像保存为 `data/avatar.jpg`
- 建议尺寸：**90×90 像素**，文件大小 < 30KB

**第二步：填写配置**
- 编辑 `src/config.h`，填入 WiFi 名称、WiFi 密码、Gemini API Key、Google STT API Key

**第三步：上传 SPIFFS 文件**
- 在 PlatformIO 侧边栏点击 **Upload Filesystem Image**
- 或使用命令：`pio run --target uploadfs`

**第四步：编译并烧录**
- 点击 PlatformIO 底部工具栏的 **Upload** 按钮（→ 图标）
- 或使用命令：`pio run --target upload`

**第五步：使用**
- 设备启动后屏幕显示角色头像
- 点击屏幕底部按钮开始说话
- 再次点击停止录音
- 等待片刻，角色回复将显示在屏幕上

---

## 屏幕布局

```
┌─────────────────────────────────────┐  320px
│ [头像]    小铃                       │
│           ● 待机                    │  ← 头部（108px）
├─────────────────────────────────────┤
│                                     │
│   角色回复文字显示在这里              │  ← 聊天区（~100px）
│                                     │
├─────────────────────────────────────┤
│            [ ● 点击说话 ]           │  ← 底部按钮（30px）
└─────────────────────────────────────┘
                                    240px
```

---

## 角色模板

角色数据存储在 `data/character.json`，可直接修改替换为任意角色：

```json
{
  "id":           "角色唯一ID（英文）",
  "name":         "角色显示名",
  "avatar":       "/avatar.jpg",
  "catchphrases": ["口头禅1", "口头禅2"],
  "personality":  "性格描述",
  "worldview":    "世界观描述",
  "background":   "背景故事",
  "reply_style":  "回复风格说明"
}
```

---

## 后续扩展规划

代码中已标注 `[EXTENSION POINT]` 注释，对应以下功能接入位置：

| 功能 | 涉及文件 | 开关宏 |
|------|---------|--------|
| 拍照识别角色 | `CharacterManager.h` → `loadFromRecognition()` | `FEATURE_PHOTO_RECOGNITION` |
| 网络搜索补全角色资料 | `CharacterManager.h` → `enrichFromWeb()` | — |
| 对话记忆持久化 | `ChatUI.cpp` → `_processAndReply()` 末尾 | `FEATURE_CHARACTER_MEMORY` |
| 旅行日志 | `Character.h` → `CharacterMemory` 扩展 | `FEATURE_TRAVEL_LOG` |
| 多角色切换 | `CharacterManager.h` → `switchCharacter()` | — |

---

## 注意事项

- `src/config.h` 包含敏感信息，已加入 `.gitignore`（如使用 git 请确认）
- MVP 使用 `client.setInsecure()` 跳过 HTTPS 证书验证，生产版本需替换为正式 CA 证书
- Google STT 免费额度为每月 60 分钟，注意控制使用频率
