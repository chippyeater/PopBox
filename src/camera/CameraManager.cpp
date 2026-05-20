#include "CameraManager.h"

bool CameraManager::begin() {
    camera_config_t cfg = {};
    cfg.pin_pwdn      = CAM_PIN_PWDN;
    cfg.pin_reset     = CAM_PIN_RESET;
    cfg.pin_xclk      = CAM_PIN_XCLK;
    cfg.pin_sccb_sda  = CAM_PIN_SIOD;
    cfg.pin_sccb_scl  = CAM_PIN_SIOC;
    cfg.pin_d7        = CAM_PIN_D7;
    cfg.pin_d6        = CAM_PIN_D6;
    cfg.pin_d5        = CAM_PIN_D5;
    cfg.pin_d4        = CAM_PIN_D4;
    cfg.pin_d3        = CAM_PIN_D3;
    cfg.pin_d2        = CAM_PIN_D2;
    cfg.pin_d1        = CAM_PIN_D1;
    cfg.pin_d0        = CAM_PIN_D0;
    cfg.pin_vsync     = CAM_PIN_VSYNC;
    cfg.pin_href      = CAM_PIN_HREF;
    cfg.pin_pclk      = CAM_PIN_PCLK;

    cfg.xclk_freq_hz  = 20000000;
    cfg.ledc_timer    = LEDC_TIMER_0;
    cfg.ledc_channel  = LEDC_CHANNEL_0;
    cfg.pixel_format  = PIXFORMAT_JPEG;
    cfg.frame_size    = FRAMESIZE_QVGA;  // 320x240，适合网络传输
    cfg.jpeg_quality  = 12;              // 0-63，值越小质量越高
    cfg.fb_count      = 1;
    cfg.fb_location   = CAMERA_FB_IN_PSRAM;
    cfg.grab_mode     = CAMERA_GRAB_WHEN_EMPTY;

    esp_err_t err = esp_camera_init(&cfg);
    if (err != ESP_OK) {
        Serial.printf("[Camera] 初始化失败: 0x%x\n", err);
        _ready = false;
        return false;
    }

    // 调整传感器参数（提高人像/角色图识别质量）
    sensor_t* s = esp_camera_sensor_get();
    if (s) {
        s->set_brightness(s, 1);
        s->set_contrast(s, 1);
        s->set_saturation(s, 0);
        s->set_whitebal(s, 1);
        s->set_awb_gain(s, 1);
        s->set_exposure_ctrl(s, 1);
        s->set_aec2(s, 1);
    }

    _ready = true;
    Serial.println("[Camera] 初始化成功");
    return true;
}

CameraFrame CameraManager::capture() {
    CameraFrame frame;
    if (!_ready) {
        Serial.println("[Camera] 未初始化");
        return frame;
    }

    // 先拍一帧丢弃（让 AEC 稳定曝光）
    camera_fb_t* warmup = esp_camera_fb_get();
    if (warmup) esp_camera_fb_return(warmup);
    ::delay(100);

    camera_fb_t* fb = esp_camera_fb_get();
    if (!fb) {
        Serial.println("[Camera] 拍照失败");
        return frame;
    }

    frame._fb  = fb;
    frame.data  = fb->buf;
    frame.len   = fb->len;
    frame.valid = true;
    Serial.printf("[Camera] 拍照成功: %zu 字节\n", fb->len);
    return frame;
}
