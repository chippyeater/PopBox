#pragma once
#include <Arduino.h>

// ─────────────────────────────────────────────────────────────
// SpeechToText — 调用 Google Cloud Speech-to-Text REST API
// 输入：PCM16 音频字节流
// 输出：识别出的文字字符串
//
// [EXTENSION POINT] 后续可替换为其他 STT 服务（如 Azure、讯飞）
// 只需实现相同的 recognize() 接口即可
// ─────────────────────────────────────────────────────────────
class SpeechToText {
public:
    // 将 PCM16 音频发送至 Google STT，返回识别文本
    // 失败返回空字符串
    String recognize(const int16_t* pcmData, size_t sampleCount,
                     int sampleRate = 16000);

private:
    String _base64Encode(const uint8_t* data, size_t len);
};
