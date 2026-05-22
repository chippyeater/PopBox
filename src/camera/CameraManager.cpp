#include "CameraManager.h"
#include "img_converters.h"
#include <M5Unified.h>

bool CameraManager::begin() {
    // 官方示例：M5.In_I2C.release() 释放 I2C 总线给相机 SCCB 使用
    M5.In_I2C.release();

    camera_config_t cfg = {};
    cfg.pin_pwdn      = -1;
    cfg.pin_reset     = -1;
    cfg.pin_xclk      = CAM_PIN_XCLK;
    cfg.pin_sccb_sda  = 12;
    cfg.pin_sccb_scl  = 11;
    cfg.pin_d7        = 47;
    cfg.pin_d6        = 48;
    cfg.pin_d5        = 16;
    cfg.pin_d4        = 15;
    cfg.pin_d3        = 42;
    cfg.pin_d2        = 41;
    cfg.pin_d1        = 40;
    cfg.pin_d0        = 39;
    cfg.pin_vsync     = 46;
    cfg.pin_href      = 38;
    cfg.pin_pclk      = 45;

    cfg.xclk_freq_hz  = 20000000;
    cfg.ledc_timer    = LEDC_TIMER_0;
    cfg.ledc_channel  = LEDC_CHANNEL_0;
    cfg.pixel_format  = PIXFORMAT_RGB565;  // GC0308 原生输出
    cfg.frame_size    = FRAMESIZE_QVGA;
    cfg.jpeg_quality  = 0;
    cfg.fb_count      = 2;
    cfg.fb_location   = CAMERA_FB_IN_PSRAM;
    cfg.grab_mode     = CAMERA_GRAB_WHEN_EMPTY;
    cfg.sccb_i2c_port = -1;

    esp_err_t err = esp_camera_init(&cfg);
    if (err != ESP_OK) {
        Serial.printf("[Camera] 初始化失败: 0x%x\n", err);
        _ready = false;
        return false;
    }

    sensor_t* s = esp_camera_sensor_get();
    if (s) s->set_framesize(s, FRAMESIZE_QVGA);

    _ready = true;
    Serial.println("[Camera] 初始化成功");
    return true;
}

void CameraManager::end() {
    if (_ready) {
        esp_camera_deinit();
        _ready = false;
        Serial.println("[Camera] 已释放");
    }
}

CameraFrame CameraManager::capture() {
    CameraFrame frame;
    if (!_ready) return frame;

    // 丢弃前几帧让 AEC/AWB 稳定（官方做法）
    for (int i = 0; i < 5; i++) {
        camera_fb_t* w = esp_camera_fb_get();
        if (w) esp_camera_fb_return(w);
        ::delay(30);
    }

    camera_fb_t* fb = esp_camera_fb_get();
    if (!fb) {
        Serial.println("[Camera] 拍照失败");
        return frame;
    }

    // RGB565 → JPEG
    uint8_t* jpegBuf = nullptr;
    size_t   jpegLen = 0;
    bool ok = fmt2jpg(fb->buf, fb->len, fb->width, fb->height,
                      PIXFORMAT_RGB565, 80, &jpegBuf, &jpegLen);
    esp_camera_fb_return(fb);

    if (!ok || !jpegBuf) {
        Serial.println("[Camera] JPEG 转换失败");
        return frame;
    }

    frame._jpegBuf = jpegBuf;
    frame.data     = jpegBuf;
    frame.len      = jpegLen;
    frame.valid    = true;
    Serial.printf("[Camera] 拍照成功: %zu 字节\n", jpegLen);
    return frame;
}

bool CameraManager::preview(uint32_t durationMs) {
    if (!_ready) return false;

    uint32_t start = millis();
    bool drewFrame = false;

    while (millis() - start < durationMs) {
        drewFrame = previewFrame() || drewFrame;
        ::delay(30);
    }

    return drewFrame;
}

bool CameraManager::previewFrame() {
    if (!_ready) return false;

    camera_fb_t* fb = esp_camera_fb_get();
    if (!fb) {
        Serial.println("[Camera] preview frame failed");
        return false;
    }

    M5.Display.pushImage(0, 0, M5.Display.width(), M5.Display.height(),
                         reinterpret_cast<uint16_t*>(fb->buf));
    esp_camera_fb_return(fb);
    return true;
}
