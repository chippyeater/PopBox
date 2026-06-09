#pragma once
#include <Arduino.h>

class TextToSpeech {
public:
    bool speak(const String& text, const String& voice = "", float vol = 1.0f);
};
