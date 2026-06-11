#include "BackendResolver.h"
#include "../config.h"
#include <WiFi.h>
#include <ESPmDNS.h>
#include <HTTPClient.h>

namespace {
    static constexpr const char* SERVICE_TYPE = "http";
    static constexpr const char* SERVICE_PROTO = "tcp";
    static constexpr const char* TXT_APP_KEY = "app";
    static constexpr const char* TXT_APP_VALUE = "popbox";

    String g_baseUrl;
    bool g_resolved = false;

    String fallbackBaseUrl() {
        String url = BACKEND_URL;
        while (url.endsWith("/")) url.remove(url.length() - 1);
        return url;
    }

    uint16_t fallbackPort() {
        String url = fallbackBaseUrl();
        int slashSlash = url.indexOf("://");
        int hostStart = slashSlash >= 0 ? slashSlash + 3 : 0;
        int colon = url.indexOf(':', hostStart);
        if (colon < 0) return 3000;
        int pathStart = url.indexOf('/', colon + 1);
        String portStr = url.substring(colon + 1, pathStart > 0 ? pathStart : url.length());
        int port = portStr.toInt();
        return port > 0 ? (uint16_t)port : 3000;
    }

    bool isPopBoxService(int index, uint16_t port) {
        if (MDNS.hasTxt(index, TXT_APP_KEY)) {
            String app = MDNS.txt(index, TXT_APP_KEY);
            if (app.equalsIgnoreCase(TXT_APP_VALUE)) return true;
        }
        return port == fallbackPort();
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

bool resolve(uint32_t timeoutMs) {
    if (g_resolved && g_baseUrl.length() > 0) return true;

    if (WiFi.status() != WL_CONNECTED) {
        g_baseUrl = fallbackBaseUrl();
        g_resolved = true;
        Serial.printf("[Backend] WiFi 未连接，回退到 %s\n", g_baseUrl.c_str());
        return false;
    }

    uint32_t start = millis();
    while (millis() - start < timeoutMs) {
        int count = MDNS.queryService(SERVICE_TYPE, SERVICE_PROTO);
        Serial.printf("[Backend] mDNS 查询 _%s._%s: %d 个服务\n",
                      SERVICE_TYPE, SERVICE_PROTO, count);

        for (int i = 0; i < count; i++) {
            String name = MDNS.hostname(i);
            IPAddress ip = MDNS.IP(i);
            uint16_t port = MDNS.port(i);
            String app = MDNS.hasTxt(i, TXT_APP_KEY) ? MDNS.txt(i, TXT_APP_KEY) : "";
            Serial.printf("[Backend] mDNS 服务: %s -> %s:%u app=%s\n",
                          name.c_str(), ip.toString().c_str(), port, app.c_str());

            if (isPopBoxService(i, port) && port > 0 && ip != IPAddress(0, 0, 0, 0)) {
                g_baseUrl = "http://" + ip.toString() + ":" + String(port);
                g_resolved = true;
                Serial.printf("[Backend] 已发现 PopBox 后端: %s\n", g_baseUrl.c_str());
                notifyBackendDiscovered();
                return true;
            }
        }
        delay(500);
    }

    g_baseUrl = fallbackBaseUrl();
    g_resolved = true;
    Serial.printf("[Backend] mDNS 未发现 PopBox，回退到 %s\n", g_baseUrl.c_str());
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
