#pragma once
#include <Arduino.h>

class TextToSpeech {
public:
    bool speak(const String& text);
};
