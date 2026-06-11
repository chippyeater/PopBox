#pragma once
#include <Arduino.h>

class TextToSpeech {
public:
    using TickCallback = void (*)(void*);
    bool speak(const String& text, const String& voice = "", float vol = 1.0f,
               TickCallback tick = nullptr, void* tickCtx = nullptr);
};
