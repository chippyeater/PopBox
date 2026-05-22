#pragma once
#include <Arduino.h>
#include "../config.h"

// ─────────────────────────────────────────────────────────────
// AudioRecorder — 使用 CoreS3 内置麦克风录音
// 录制格式：PCM16，单声道，16kHz
// 录音数据存入 PSRAM 以节省内部 RAM
// ─────────────────────────────────────────────────────────────
class AudioRecorder {
public:
    AudioRecorder();
    ~AudioRecorder();

    bool begin();
    void pauseMic();
    bool resumeMic();

    // 开始录音（非阻塞，配合 update() 使用）
    void startRecording();

    // 停止录音
    void stopRecording();

    // 在 loop() 中调用，持续写入音频数据
    void update();

    bool isRecording()  const { return _recording; }
    bool hasData()      const { return _sampleCount > 0; }

    // 返回录音缓冲区指针（int16_t PCM 数据）
    const int16_t* getBuffer()     const { return _buffer; }
    size_t         getSampleCount() const { return _sampleCount; }
    size_t         getByteCount()   const { return _sampleCount * sizeof(int16_t); }

    void clearBuffer();

private:
    int16_t* _buffer;
    size_t   _sampleCount;
    bool     _recording;

    static constexpr size_t CHUNK_SAMPLES = 256;
    int16_t _chunk[CHUNK_SAMPLES];
};
