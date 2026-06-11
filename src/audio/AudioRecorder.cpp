#include "AudioRecorder.h"
#include <M5Unified.h>
#include <cmath>

AudioRecorder::AudioRecorder()
    : _buffer(nullptr), _sampleCount(0), _recording(false),
      _listening(false), _speaking(false), _speechEnded(false),
      _voiceCount(0), _silenceCount(0), _totalSpeechFrames(0), _preRollLen(0), _lastRms(0) {}

AudioRecorder::~AudioRecorder() {
    if (_buffer) heap_caps_free(_buffer);
}

bool AudioRecorder::begin() {
    if (_buffer) return resumeMic();

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

    return resumeMic();
}

void AudioRecorder::pauseMic() {
    if (_recording) {
        _recording = false;
        Serial.printf("[Audio] 暂停时停止录音，%zu 采样\n", _sampleCount);
    }
    _listening = false;
    _speaking  = false;
    M5.Mic.end();
}

bool AudioRecorder::resumeMic() {
    auto cfg = M5.Mic.config();
    cfg.sample_rate    = AUDIO_SAMPLE_RATE;
    cfg.input_channel  = m5::input_only_left;
    cfg.magnification  = 8;
    M5.Mic.config(cfg);

    M5.Speaker.end();
    bool ok = M5.Mic.begin();
    Serial.printf("[Audio] 麦克风初始化 %s\n", ok ? "成功" : "失败");
    return ok;
}

// ── VAD 监听 ────────────────────────────────────────────────────────

void AudioRecorder::startListening() {
    clearBuffer();
    _listening   = true;
    _speaking    = false;
    _speechEnded = false;
    _voiceCount  = 0;
    _silenceCount = 0;
    _totalSpeechFrames = 0;
    _preRollLen  = 0;
    _recording   = false;
    Serial.println("[Audio] 语音监听已启动");
}

void AudioRecorder::stopListening() {
    _listening   = false;
    _speaking    = false;
    _recording   = false;
    _speechEnded = false;
    Serial.println("[Audio] 语音监听已停止");
}

bool AudioRecorder::speechJustEnded() {
    if (_speechEnded) {
        _speechEnded = false;
        return true;
    }
    return false;
}

int AudioRecorder::getAudioLevel() const {
    // VAD_THRESHOLD=1500 → 最小有声音量，峰值约 15000
    if (_lastRms < 200) return 0;
    int lvl = map(_lastRms, 0, 15000, 0, 100);
    return constrain(lvl, 0, 100);
}

// ── 手动录音 ────────────────────────────────────────────────────────

void AudioRecorder::startRecording() {
    if (_listening) stopListening();
    clearBuffer();
    _recording = true;
    Serial.println("[Audio] 手动开始录音");
}

void AudioRecorder::stopRecording() {
    _recording = false;
    Serial.printf("[Audio] 停止录音，%zu 采样（%.1f 秒）\n",
                  _sampleCount, (float)_sampleCount / AUDIO_SAMPLE_RATE);
    if (_sampleCount > 0) {
        int16_t mn = 32767, mx = -32768;
        for (size_t i = 0; i < _sampleCount; i++) {
            if (_buffer[i] < mn) mn = _buffer[i];
            if (_buffer[i] > mx) mx = _buffer[i];
        }
        Serial.printf("[Audio] 振幅范围: %d ~ %d %s\n", mn, mx,
                      (mx - mn < 500) ? "⚠ 疑似静音" : "✓ 有声音");
    }
}

// ── 核心更新 ────────────────────────────────────────────────────────

void AudioRecorder::update() {
    if (!_listening && !_recording) return;

    // 缓冲区满 → 自动停止
    if (_recording && _sampleCount >= AUDIO_BUFFER_SAMPLES) {
        Serial.println("[Audio] 缓冲区满");
        _recording = false;
        _speaking  = false;
        _speechEnded = true;
        return;
    }

    size_t toRead = _recording
        ? min((size_t)CHUNK_SAMPLES, AUDIO_BUFFER_SAMPLES - _sampleCount)
        : (size_t)CHUNK_SAMPLES;
    if (toRead == 0) return;

    if (!M5.Mic.record(_chunk, toRead)) return;

    // ── VAD 处理（仅在监听模式下）──
    if (_listening) {
        int32_t rms = _calcRms(_chunk, toRead);
        _lastRms = rms;  // 供 UI 动画使用

        if (rms > VAD_THRESHOLD) {
            _silenceCount = 0;
            _voiceCount++;
            if (_speaking) _totalSpeechFrames++;

            if (_speaking && _totalSpeechFrames >= MAX_SPEECH_FRAMES) {
                _speaking = false;
                _recording = false;
                _speechEnded = true;
                Serial.printf("[Audio] 语音达到最大时长，强制结束，%zu 帧/%zu 采样 rms=%ld\n",
                              _totalSpeechFrames, _sampleCount, (long)rms);
                return;
            }
        } else {
            _voiceCount = 0;

            if (_speaking) {
                _silenceCount++;
                if (_silenceCount >= VAD_OFF_FRAMES) {
                    if (_totalSpeechFrames >= MIN_SPEECH_FRAMES) {
                        // 有效语音结束
                        _speaking  = false;
                        _recording = false;
                        _speechEnded = true;
                        Serial.printf("[Audio] 语音结束，%zu 帧/%zu 采样\n",
                                      _totalSpeechFrames, _sampleCount);
                        return;
                    }
                    // 太短（噪音/误触），静默丢弃
                    _speaking  = false;
                    _recording = false;
                    clearBuffer();
                    Serial.println("[Audio] 丢弃短噪音");
                    return;
                }
            }
        }

        // 检测到语音开始（能量连续超过阈值）
        if (!_speaking && _voiceCount >= VAD_ON_FRAMES) {
            _speaking  = true;
            _recording = true;
            _silenceCount = 0;
            _totalSpeechFrames = 1;  // 当前帧算第一帧
            // 将预卷缓冲中的音频倒入主缓冲
            if (_preRollLen > 0) {
                size_t room = AUDIO_BUFFER_SAMPLES - _sampleCount;
                size_t copy = min(_preRollLen, room);
                memcpy(_buffer + _sampleCount, _preRollBuf, copy * sizeof(int16_t));
                _sampleCount += copy;
                Serial.printf("[Audio] 语音唤醒 + pre-roll %zu 采样\n", copy);
            } else {
                Serial.println("[Audio] 语音唤醒");
            }
        }

        // 监听模式下，始终保存到预卷缓冲（循环覆盖）
        memcpy(_preRollBuf, _chunk, toRead * sizeof(int16_t));
        _preRollLen = min(_preRollLen + toRead, (size_t)512);
    }

    // ── 写入主缓冲（录音中）──
    if (_recording) {
        size_t room = AUDIO_BUFFER_SAMPLES - _sampleCount;
        size_t copy = min(room, (size_t)toRead);
        if (copy > 0) {
            memcpy(_buffer + _sampleCount, _chunk, copy * sizeof(int16_t));
            _sampleCount += copy;
        }
    }
}

void AudioRecorder::clearBuffer() {
    _sampleCount = 0;
    if (_buffer) memset(_buffer, 0, AUDIO_BUFFER_SAMPLES * sizeof(int16_t));
}

// ── 私有方法 ────────────────────────────────────────────────────────

int32_t AudioRecorder::_calcRms(const int16_t* data, size_t len) {
    if (len == 0) return 0;
    int64_t sum = 0;
    for (size_t i = 0; i < len; i++) {
        int32_t s = data[i];
        sum += s * s;
    }
    return (int32_t)sqrt((double)(sum / len));
}
