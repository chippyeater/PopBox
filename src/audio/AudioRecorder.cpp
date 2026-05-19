#include "AudioRecorder.h"
#include <M5Unified.h>

AudioRecorder::AudioRecorder()
    : _buffer(nullptr), _sampleCount(0), _recording(false) {}

AudioRecorder::~AudioRecorder() {
    if (_buffer) heap_caps_free(_buffer);
}

bool AudioRecorder::begin() {
    // 分配到 PSRAM 以节省内部 RAM（CoreS3 有 8MB PSRAM）
    _buffer = (int16_t*)heap_caps_malloc(
        AUDIO_BUFFER_SAMPLES * sizeof(int16_t),
        MALLOC_CAP_SPIRAM | MALLOC_CAP_8BIT
    );
    if (!_buffer) {
        Serial.println("[Audio] PSRAM 分配失败，尝试内部 RAM");
        _buffer = (int16_t*)malloc(AUDIO_BUFFER_SAMPLES * sizeof(int16_t));
        if (!_buffer) {
            Serial.println("[Audio] 缓冲区分配失败");
            return false;
        }
    }

    // 配置麦克风：单声道 16kHz
    auto cfg = M5.Mic.config();
    cfg.sample_rate  = AUDIO_SAMPLE_RATE;
    cfg.stereo       = false;
    cfg.magnification = 4;   // 适当放大麦克风增益
    M5.Mic.config(cfg);

    bool ok = M5.Mic.begin();
    Serial.printf("[Audio] 麦克风初始化 %s\n", ok ? "成功" : "失败");
    return ok;
}

void AudioRecorder::startRecording() {
    clearBuffer();
    _recording = true;
    Serial.println("[Audio] 开始录音");
}

void AudioRecorder::stopRecording() {
    _recording = false;
    Serial.printf("[Audio] 停止录音，共 %zu 采样（%.1f 秒）\n",
                  _sampleCount, (float)_sampleCount / AUDIO_SAMPLE_RATE);
}

void AudioRecorder::update() {
    if (!_recording) return;
    if (_sampleCount >= AUDIO_BUFFER_SAMPLES) {
        // 缓冲区已满，自动停止
        stopRecording();
        return;
    }

    size_t remaining = AUDIO_BUFFER_SAMPLES - _sampleCount;
    size_t toRead    = min(remaining, (size_t)CHUNK_SAMPLES);

    if (M5.Mic.record(_chunk, toRead)) {
        memcpy(_buffer + _sampleCount, _chunk, toRead * sizeof(int16_t));
        _sampleCount += toRead;
    }
}

void AudioRecorder::clearBuffer() {
    _sampleCount = 0;
    if (_buffer) memset(_buffer, 0, AUDIO_BUFFER_SAMPLES * sizeof(int16_t));
}
