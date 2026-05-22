#pragma once
#include <Arduino.h>
#include <esp_camera.h>

// ─────────────────────────────────────────────────────────────
// CameraManager — CoreS3 内置前置摄像头（GC0308 / OV3660）
// 拍摄 JPEG 图片，供 RecognitionClient 发送至后端识别
// ─────────────────────────────────────────────────────────────

// CoreS3 摄像头引脚定义
#define CAM_PIN_PWDN   -1
#define CAM_PIN_RESET  -1
#define CAM_PIN_XCLK   -1
#define CAM_PIN_SIOD   12   // SDA
#define CAM_PIN_SIOC   11   // SCL
#define CAM_PIN_D7     47
#define CAM_PIN_D6     48
#define CAM_PIN_D5     16
#define CAM_PIN_D4     15
#define CAM_PIN_D3     42
#define CAM_PIN_D2     41
#define CAM_PIN_D1     40
#define CAM_PIN_D0     39
#define CAM_PIN_VSYNC  46
#define CAM_PIN_HREF   38
#define CAM_PIN_PCLK   45

struct CameraFrame {
    uint8_t* data     = nullptr;
    size_t   len      = 0;
    bool     valid    = false;

    void release() {
        if (_jpegBuf) { free(_jpegBuf); _jpegBuf = nullptr; }
        data  = nullptr;
        len   = 0;
        valid = false;
    }

    uint8_t* _jpegBuf = nullptr;
};

class CameraManager {
public:
    bool begin();
    void end();   // 拍完后释放相机，还 I2C 总线给 M5Unified

    // 拍摄一帧 JPEG，调用方用完后必须调用 frame.release()
    CameraFrame capture();
    bool previewFrame();
    bool preview(uint32_t durationMs);

    bool isReady() const { return _ready; }

private:
    bool _ready = false;
};
