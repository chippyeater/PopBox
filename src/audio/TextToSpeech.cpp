#include "TextToSpeech.h"
#include "../config.h"
#include <M5Unified.h>
#include <HTTPClient.h>
#include <ArduinoJson.h>

static uint8_t* allocAudioBuffer(size_t len) {
    uint8_t* p = (uint8_t*)heap_caps_malloc(len, MALLOC_CAP_SPIRAM | MALLOC_CAP_8BIT);
    if (!p) p = (uint8_t*)malloc(len);
    return p;
}

bool TextToSpeech::speak(const String& text) {
    if (text.isEmpty()) return false;

    JsonDocument req;
    req["text"] = text;
    String body;
    serializeJson(req, body);

    HTTPClient http;
    http.begin(String(BACKEND_URL) + "/api/tts");
    http.addHeader("Content-Type", "application/json");
    http.setTimeout(30000);

    int code = http.POST(body);
    if (code != 200) {
        Serial.printf("[TTS] backend error: %d - %s\n", code, http.getString().c_str());
        http.end();
        return false;
    }

    int contentLen = http.getSize();
    const size_t MAX_AUDIO_BYTES = 1536 * 1024;
    if (contentLen > 0 && (size_t)contentLen > MAX_AUDIO_BYTES) {
        Serial.printf("[TTS] audio too large: %d bytes\n", contentLen);
        http.end();
        return false;
    }

    uint8_t* audio = allocAudioBuffer(MAX_AUDIO_BYTES);
    if (!audio) {
        Serial.println("[TTS] audio buffer allocation failed");
        http.end();
        return false;
    }

    WiFiClient* stream = http.getStreamPtr();
    size_t received = 0;
    uint32_t lastDataAt = millis();
    while (http.connected() && received < MAX_AUDIO_BYTES) {
        int avail = stream->available();
        if (avail > 0) {
            size_t toRead = min((size_t)avail, MAX_AUDIO_BYTES - received);
            int n = stream->readBytes(audio + received, toRead);
            if (n > 0) {
                received += n;
                lastDataAt = millis();
            }
            if (contentLen > 0 && received >= (size_t)contentLen) break;
        } else {
            if (contentLen > 0 && received >= (size_t)contentLen) break;
            if (millis() - lastDataAt > 5000) break;
            delay(10);
        }
    }
    http.end();

    if (received < 44 || memcmp(audio, "RIFF", 4) != 0) {
        Serial.printf("[TTS] invalid WAV, bytes=%u header=%02X %02X %02X %02X\n",
                      (unsigned)received, audio[0], audio[1], audio[2], audio[3]);
        free(audio);
        return false;
    }

    M5.Speaker.begin();
    M5.Speaker.setVolume(180);
    bool ok = M5.Speaker.playWav(audio, received, 1, 0, true);
    if (!ok) {
        Serial.println("[TTS] playWav failed");
        M5.Speaker.end();
        free(audio);
        return false;
    }

    while (M5.Speaker.isPlaying(0)) {
        M5.update();
        delay(10);
    }
    M5.Speaker.end();
    free(audio);
    return true;
}
