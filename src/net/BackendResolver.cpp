#include "BackendResolver.h"
#include "../config.h"
#include <WiFi.h>
#include <HTTPClient.h>

namespace {
    String g_baseUrl;
    bool g_resolved = false;

    String fallbackBaseUrl() {
        String url = BACKEND_URL;
        while (url.endsWith("/")) url.remove(url.length() - 1);
        return url;
    }

    void notifyBackendDiscovered() {
        if (WiFi.status() != WL_CONNECTED || g_baseUrl.length() == 0) return;

        HTTPClient http;
        http.begin(g_baseUrl + "/api/hello");
        http.addHeader("X-PopBox-Device", "CoreS3");
        http.setTimeout(1500);
        int code = http.GET();
        if (code > 0) {
            Serial.printf("[Backend] 已通知后端发现成功: HTTP %d\n", code);
        } else {
            Serial.printf("[Backend] 通知后端发现失败: %s\n",
                          http.errorToString(code).c_str());
        }
        http.end();
    }
}

namespace BackendResolver {

bool resolve(uint32_t) {
    if (g_resolved && g_baseUrl.length() > 0) return true;

    g_baseUrl = fallbackBaseUrl();
    g_resolved = true;
    Serial.printf("[Backend] 使用配置的 URL: %s\n", g_baseUrl.c_str());
    notifyBackendDiscovered();
    return false;
}

void reset() {
    g_baseUrl = "";
    g_resolved = false;
}

String baseUrl() {
    if (!g_resolved || g_baseUrl.length() == 0) resolve();
    return g_baseUrl;
}

String url(const String& path) {
    String base = baseUrl();
    if (path.length() == 0) return base;
    if (path[0] == '/') return base + path;
    return base + "/" + path;
}

}
