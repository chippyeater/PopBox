#include <Arduino.h>
#include <ArduinoJson.h>
#include <M5Unified.h>
#include "mbedtls/base64.h"
#include "esp_camera.h"

static const uint8_t STATE_COUNT = 6;
static const uint8_t MAX_IPS = 8;
static const uint8_t MAX_ASSETS = 48;
static const uint16_t AVATAR_SIZE = 50;
static const uint16_t SCREEN_W = 320;
static const uint16_t SCREEN_H = 240;
static const uint32_t TALK_HOLD_MS = 1400;

static const char* STATES[STATE_COUNT] = {"idle", "talk", "happy", "sad", "angry", "surprised"};

static camera_config_t camera_config = {
  .pin_pwdn = -1,
  .pin_reset = -1,
  .pin_xclk = -1,
  .pin_sscb_sda = 12,
  .pin_sscb_scl = 11,
  .pin_d7 = 47,
  .pin_d6 = 48,
  .pin_d5 = 16,
  .pin_d4 = 15,
  .pin_d3 = 42,
  .pin_d2 = 41,
  .pin_d1 = 40,
  .pin_d0 = 39,
  .pin_vsync = 46,
  .pin_href = 38,
  .pin_pclk = 45,
  .xclk_freq_hz = 20000000,
  .ledc_timer = LEDC_TIMER_0,
  .ledc_channel = LEDC_CHANNEL_0,
  .pixel_format = PIXFORMAT_RGB565,
  .frame_size = FRAMESIZE_QQVGA,
  .jpeg_quality = 0,
  .fb_count = 2,
  .fb_location = CAMERA_FB_IN_PSRAM,
  .grab_mode = CAMERA_GRAB_LATEST,
  .sccb_i2c_port = -1,
};

struct Signature {
  float hue[12];
  float brightness;
};

struct ExpressionAsset {
  String ipId;
  String assetId;
  String role;
  uint16_t width = AVATAR_SIZE;
  uint16_t height = AVATAR_SIZE;
  uint8_t* rgb565 = nullptr;
  size_t byteLength = 0;
  String pendingBase64;
};

struct IpRecord {
  String ipId;
  String name;
  Signature signature;
  String assetByState[STATE_COUNT];
};

IpRecord ipRecords[MAX_IPS];
ExpressionAsset assets[MAX_ASSETS];
uint8_t ipCount = 0;
uint8_t assetCount = 0;
float matchThreshold = 0.72f;
float uniqueGap = 0.06f;
String activeIpId;
String activeState = "idle";
String lastAcceptedIpId;
unsigned long lastScanMs = 0;
unsigned long lastVoiceMs = 0;
bool cameraReady = false;

int stateIndex(const String& state) {
  for (uint8_t i = 0; i < STATE_COUNT; i++) {
    if (state == STATES[i]) return i;
  }
  return 0;
}

void sendStatus(const char* type, const String& extra = "") {
  Serial.print("{\"type\":\"");
  Serial.print(type);
  Serial.print("\"");
  if (extra.length()) {
    Serial.print(",");
    Serial.print(extra);
  }
  Serial.println("}");
}

void drawMessage(const String& line1, const String& line2 = "") {
  M5.Display.fillScreen(TFT_BLACK);
  M5.Display.setTextColor(TFT_WHITE, TFT_BLACK);
  M5.Display.setTextDatum(middle_center);
  M5.Display.drawString(line1, SCREEN_W / 2, SCREEN_H / 2 - 10);
  if (line2.length()) M5.Display.drawString(line2, SCREEN_W / 2, SCREEN_H / 2 + 16);
}

bool initCamera() {
  M5.In_I2C.release();
  esp_err_t err = esp_camera_init(&camera_config);
  if (err != ESP_OK) return false;
  sensor_t* sensor = esp_camera_sensor_get();
  if (sensor) sensor->set_framesize(sensor, FRAMESIZE_QQVGA);
  return true;
}

float compareSignature(const Signature& a, const Signature& b) {
  float colorDistance = 0.0f;
  for (uint8_t i = 0; i < 12; i++) {
    colorDistance += fabsf(a.hue[i] - b.hue[i]);
  }
  float lightDistance = fabsf(a.brightness - b.brightness);
  float score = 1.0f - colorDistance * 0.72f - lightDistance * 0.34f;
  if (score < 0.0f) return 0.0f;
  if (score > 1.0f) return 1.0f;
  return score;
}

Signature signatureFromFrame(camera_fb_t* fb) {
  Signature sig = {};
  float brightness = 0.0f;
  float total = 0.0f;
  const uint16_t* pixels = reinterpret_cast<const uint16_t*>(fb->buf);
  const size_t count = fb->len / 2;

  for (size_t i = 0; i < count; i += 5) {
    uint16_t px = pixels[i];
    uint8_t r = ((px >> 11) & 0x1F) << 3;
    uint8_t g = ((px >> 5) & 0x3F) << 2;
    uint8_t b = (px & 0x1F) << 3;
    uint8_t maxv = max(r, max(g, b));
    uint8_t minv = min(r, min(g, b));
    float delta = max(1, maxv - minv);
    float h = 0.0f;
    if (maxv == r) h = ((float(g) - b) / delta + (g < b ? 6.0f : 0.0f)) / 6.0f;
    if (maxv == g) h = ((float(b) - r) / delta + 2.0f) / 6.0f;
    if (maxv == b) h = ((float(r) - g) / delta + 4.0f) / 6.0f;
    uint8_t bucket = min(11, int(h * 12.0f));
    sig.hue[bucket] += delta / 255.0f;
    total += delta / 255.0f;
    brightness += (float(r) + g + b) / 3.0f / 255.0f;
  }

  float samples = max(1.0f, float((count + 4) / 5));
  for (uint8_t i = 0; i < 12; i++) sig.hue[i] = total > 0.0f ? sig.hue[i] / total : 0.0f;
  sig.brightness = brightness / samples;
  return sig;
}

ExpressionAsset* findAsset(const String& assetId) {
  for (uint8_t i = 0; i < assetCount; i++) {
    if (assets[i].assetId == assetId) return &assets[i];
  }
  return nullptr;
}

void clearAssets() {
  for (uint8_t i = 0; i < assetCount; i++) {
    if (assets[i].rgb565) {
      free(assets[i].rgb565);
      assets[i].rgb565 = nullptr;
    }
    assets[i].pendingBase64 = "";
  }
  assetCount = 0;
}

IpRecord* findIp(const String& ipId) {
  for (uint8_t i = 0; i < ipCount; i++) {
    if (ipRecords[i].ipId == ipId) return &ipRecords[i];
  }
  return nullptr;
}

uint16_t readRgb565Pixel(ExpressionAsset* asset, uint16_t x, uint16_t y) {
  size_t index = (size_t(y) * asset->width + x) * 2;
  if (!asset || !asset->rgb565 || index + 1 >= asset->byteLength) return TFT_BLACK;
  return uint16_t(asset->rgb565[index]) | (uint16_t(asset->rgb565[index + 1]) << 8);
}

void drawScaledAsset(ExpressionAsset* asset, int16_t x, int16_t y, uint8_t scale) {
  if (!asset || !asset->rgb565) return;
  for (uint16_t py = 0; py < asset->height; py++) {
    for (uint16_t px = 0; px < asset->width; px++) {
      uint16_t color = readRgb565Pixel(asset, px, py);
      M5.Display.fillRect(x + px * scale, y + py * scale, scale, scale, color);
    }
  }
}

String fallbackAssetId(IpRecord* ip) {
  if (!ip) return "";
  int idx = stateIndex(activeState);
  if (ip->assetByState[idx].length()) return ip->assetByState[idx];
  return ip->assetByState[stateIndex("idle")];
}

void drawAvatarFor(const String& ipId) {
  IpRecord* ip = findIp(ipId);
  String assetId = fallbackAssetId(ip);
  ExpressionAsset* asset = findAsset(assetId);

  M5.Display.fillScreen(TFT_BLACK);
  M5.Display.setTextColor(TFT_WHITE, TFT_BLACK);
  M5.Display.setTextDatum(top_center);
  M5.Display.drawString(ip ? ip->name : "NO MATCH", SCREEN_W / 2, 8);
  M5.Display.drawString(activeState, SCREEN_W / 2, 28);

  if (!asset || !asset->rgb565) {
    M5.Display.drawRect(110, 64, 100, 100, TFT_DARKGREY);
    M5.Display.drawString("NO ASSET", SCREEN_W / 2, 176);
    return;
  }

  drawScaledAsset(asset, 60, 38, 4);
}

void handleLibrary(JsonDocument& doc) {
  JsonObject library = doc["library"];
  matchThreshold = library["threshold"] | 0.72f;
  uniqueGap = library["uniqueGap"] | 0.06f;
  ipCount = 0;
  clearAssets();

  for (JsonObject ip : library["ips"].as<JsonArray>()) {
    if (ipCount >= MAX_IPS) break;
    IpRecord& rec = ipRecords[ipCount++];
    rec.ipId = ip["ipId"].as<String>();
    rec.name = ip["name"].as<String>();
    JsonArray hue = ip["signature"]["hue"];
    for (uint8_t i = 0; i < 12; i++) rec.signature.hue[i] = hue[i] | 0.0f;
    rec.signature.brightness = ip["signature"]["brightness"] | 0.0f;
    for (uint8_t i = 0; i < STATE_COUNT; i++) rec.assetByState[i] = "";
    for (JsonObject exp : ip["expressions"].as<JsonArray>()) {
      int idx = stateIndex(exp["role"].as<String>());
      if (!rec.assetByState[idx].length()) rec.assetByState[idx] = exp["assetId"].as<String>();
    }
  }
  sendStatus("SYNC_OK", "\"stage\":\"library\"");
}

void handleAsset(JsonDocument& doc) {
  String phase = doc["phase"].as<String>();
  String assetId = doc["assetId"].as<String>();
  ExpressionAsset* asset = findAsset(assetId);

  if (phase == "begin") {
    if (!asset && assetCount < MAX_ASSETS) asset = &assets[assetCount++];
    if (!asset) {
      sendStatus("ERROR", "\"message\":\"asset limit\"");
      return;
    }
    if (asset->rgb565) {
      free(asset->rgb565);
      asset->rgb565 = nullptr;
    }
    asset->ipId = doc["ipId"].as<String>();
    asset->assetId = assetId;
    asset->role = doc["role"].as<String>();
    asset->width = doc["width"] | AVATAR_SIZE;
    asset->height = doc["height"] | AVATAR_SIZE;
    asset->pendingBase64 = "";
    sendStatus("SYNC_OK", "\"stage\":\"asset_begin\"");
    return;
  }

  if (!asset) {
    sendStatus("ERROR", "\"message\":\"unknown asset\"");
    return;
  }

  if (phase == "chunk") {
    asset->pendingBase64 += doc["data"].as<String>();
    return;
  }

  if (phase == "end") {
    size_t expectedBytes = asset->width * asset->height * 2;
    asset->rgb565 = reinterpret_cast<uint8_t*>(ps_malloc(expectedBytes));
    if (!asset->rgb565) {
      sendStatus("ERROR", "\"message\":\"psram alloc failed\"");
      return;
    }
    size_t decoded = 0;
    int err = mbedtls_base64_decode(
      asset->rgb565,
      expectedBytes,
      &decoded,
      reinterpret_cast<const unsigned char*>(asset->pendingBase64.c_str()),
      asset->pendingBase64.length()
    );
    if (err != 0 || decoded != expectedBytes) {
      free(asset->rgb565);
      asset->rgb565 = nullptr;
      asset->pendingBase64 = "";
      sendStatus("ERROR", "\"message\":\"base64 decode failed\"");
      return;
    }
    asset->byteLength = decoded;
    asset->pendingBase64 = "";
    sendStatus("SYNC_OK", "\"stage\":\"asset_end\"");
  }
}

void handleSetState(JsonDocument& doc) {
  activeIpId = doc["ipId"].as<String>();
  activeState = doc["state"].as<String>();
  drawAvatarFor(activeIpId);
  sendStatus("STATE_CHANGED", String("\"state\":\"") + activeState + "\"");
}

void handleSerialLine(const String& line) {
  JsonDocument doc;
  DeserializationError err = deserializeJson(doc, line);
  if (err) {
    sendStatus("ERROR", "\"message\":\"bad json\"");
    return;
  }
  String type = doc["type"].as<String>();
  if (type == "PING") sendStatus("READY");
  else if (type == "SYNC_LIBRARY") handleLibrary(doc);
  else if (type == "SYNC_ASSET") handleAsset(doc);
  else if (type == "SET_STATE") handleSetState(doc);
  else sendStatus("ERROR", "\"message\":\"unknown type\"");
}

void pollSerial() {
  static String line;
  while (Serial.available()) {
    char c = Serial.read();
    if (c == '\n') {
      handleSerialLine(line);
      line = "";
    } else if (line.length() < 12000) {
      line += c;
    } else {
      line = "";
      sendStatus("ERROR", "\"message\":\"line too long\"");
    }
  }
}

bool voiceActive() {
  int16_t samples[256];
  if (!M5.Mic.isEnabled()) return false;
  bool ok = M5.Mic.record(samples, 256, 16000);
  if (!ok) return false;
  uint32_t energy = 0;
  for (size_t i = 0; i < 256; i++) energy += abs(samples[i]);
  return (energy / 256) > 850;
}

void scanCamera() {
  if (!cameraReady || !ipCount || millis() - lastScanMs < 700) return;
  lastScanMs = millis();
  camera_fb_t* fb = esp_camera_fb_get();
  if (!fb) return;
  Signature current = signatureFromFrame(fb);
  esp_camera_fb_return(fb);

  float best = 0.0f;
  float second = 0.0f;
  int bestIndex = -1;
  for (uint8_t i = 0; i < ipCount; i++) {
    float score = compareSignature(current, ipRecords[i].signature);
    if (score > best) {
      second = best;
      best = score;
      bestIndex = i;
    } else if (score > second) {
      second = score;
    }
  }

  bool accepted = bestIndex >= 0 && best >= matchThreshold && (best - second) >= uniqueGap;
  Serial.print("{\"type\":\"MATCH_RESULT\",\"accepted\":");
  Serial.print(accepted ? "true" : "false");
  Serial.print(",\"confidence\":");
  Serial.print(best, 3);
  if (accepted) {
    lastAcceptedIpId = ipRecords[bestIndex].ipId;
    Serial.print(",\"ipId\":\"");
    Serial.print(lastAcceptedIpId);
    Serial.print("\"");
    drawAvatarFor(lastAcceptedIpId);
  }
  Serial.println("}");
}

void setup() {
  auto cfg = M5.config();
  M5.begin(cfg);
  Serial.begin(115200);
  M5.Display.setRotation(1);
  drawMessage("CoreS3 AI Demo", "starting");

  cameraReady = initCamera();
  if (!cameraReady) drawMessage("Camera init failed", "check CoreS3 model");
  else drawMessage("READY", "sync IPDB over USB");

  auto micCfg = M5.Mic.config();
  micCfg.sample_rate = 16000;
  M5.Mic.config(micCfg);
  M5.Mic.begin();
  sendStatus("READY");
}

void loop() {
  M5.update();
  pollSerial();
  scanCamera();

  if (voiceActive()) {
    lastVoiceMs = millis();
    if (activeState != "talk") {
      activeState = "talk";
      drawAvatarFor(lastAcceptedIpId.length() ? lastAcceptedIpId : activeIpId);
      sendStatus("STATE_CHANGED", "\"state\":\"talk\"");
    }
  } else if (activeState == "talk" && millis() - lastVoiceMs > TALK_HOLD_MS) {
    activeState = "idle";
    drawAvatarFor(lastAcceptedIpId.length() ? lastAcceptedIpId : activeIpId);
    sendStatus("STATE_CHANGED", "\"state\":\"idle\"");
  }
}
