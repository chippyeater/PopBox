#pragma once
#include <Arduino.h>
#include "../config.h"

class AudioRecorder {
public:
    AudioRecorder();
    ~AudioRecorder();

    bool begin();
    void pauseMic();
    bool resumeMic();

    // ── 连续监听模式（语音唤醒） ──
    void startListening();
    void stopListening();
    bool isListening() const { return _listening; }

    // 语音活动检测：true 表示检测到有人在说话
    bool isSpeaking()   const { return _speaking; }
    // 当前音频电平 0-100（用于声波动画）
    int  getAudioLevel() const;
    // 一次性标志：语音刚刚结束（ChatUI 消费后自动复位）
    bool speechJustEnded();

    // 传统按钮录音接口（兼容保留）
    void startRecording();
    void stopRecording();
    bool isRecording()  const { return _recording; }
    bool hasData()      const { return _sampleCount > 0; }

    const int16_t* getBuffer()     const { return _buffer; }
    size_t         getSampleCount() const { return _sampleCount; }
    size_t         getByteCount()   const { return _sampleCount * sizeof(int16_t); }

    void clearBuffer();
    void update();

private:
    int16_t* _buffer;
    size_t   _sampleCount;
    bool     _recording;

    // VAD 监听状态
    bool     _listening;
    bool     _speaking;
    bool     _speechEnded;       // 一次性标志，update 中置位，speechJustEnded() 消费
    int      _voiceCount;        // 连续有声帧计数
    int      _silenceCount;      // 连续无声帧计数（说话中）
    int      _totalSpeechFrames; // 本次说话总帧数（排除短噪音）
    int16_t  _preRollBuf[512];   // 预卷缓冲 ~32ms，避免语音开头被截断
    size_t   _preRollLen;

    static constexpr size_t CHUNK_SAMPLES    = 256;
    static constexpr int    VAD_THRESHOLD    = VAD_RMS_THRESHOLD;   // RMS 能量阈值
    static constexpr int    VAD_ON_FRAMES    = 2;      // 连续几帧有声判定说话开始
    static constexpr int    VAD_OFF_FRAMES   = 60;     // 连续几帧无声判定结束（~960ms）
    static constexpr int    MIN_SPEECH_FRAMES = 30;    // 最少有声帧数才视为有效语音（~480ms）
    static constexpr int    MAX_SPEECH_FRAMES = VAD_MAX_SPEECH_FRAMES;

    int16_t _chunk[CHUNK_SAMPLES];
    int32_t _lastRms;        // 最新一帧 RMS，供 UI 动画使用

    int32_t _calcRms(const int16_t* data, size_t len);
};
