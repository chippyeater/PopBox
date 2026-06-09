#pragma once
#include <Arduino.h>

namespace BackendResolver {
    bool resolve(uint32_t timeoutMs = 5000);
    void reset();
    String baseUrl();
    String url(const String& path);
}
