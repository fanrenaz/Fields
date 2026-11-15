# StickS3 Call 烧录包

这是一个源码烧录包，不含过期的预编译二进制或本机 Wi-Fi / Terminal 凭据。它默认
连接生产入口 `wss://fields.example.com/embodiment/ws`，并校验该域名的 TLS 证书。

## 在另一台 Windows 电脑烧录

1. 安装 Arduino IDE 2，并在 Board Manager 中安装 **M5Stack** 开发板包；安装
   `M5Unified`、`M5GFX`、`ArduinoJson` 和 `WebSockets` 2.7.2 或更新版本。
2. 复制 `sketch/config.example.h` 为 `sketch/config.h`，只填写本地 Wi-Fi。保留空的
   `STICKS3_TERMINAL_TOKEN`，设备首次启动会显示配对码以获取正式终端凭据。
3. 用 USB 连接 StickS3；若没有出现串口，长按侧面 Reset 约 2 秒，看到绿灯
   闪烁后松开，进入下载模式。
4. 在 PowerShell 中解压后进入本目录，执行：

```powershell
Set-ExecutionPolicy -Scope Process Bypass
.\flash_with_arduino_cli.ps1 -Port COMx
```

将 `COMx` 替换成设备管理器显示的 StickS3 串口，例如 `COM4`。

若 Arduino CLI 不在 PATH，可显式指定路径：

```powershell
.\flash_with_arduino_cli.ps1 -Port COM4 -ArduinoCli "C:\path\to\arduino-cli.exe"
```

## Arduino IDE 方式

打开 `sketch/StickS3_Call.ino`，选择开发板 **M5StickS3** 和对应 COM 口，点击
Upload。设备连上 Wi-Fi 后会先校准时间，再建立到生产 Runtime 的受证书验证连接。

## 版本信息

- FQBN: `m5stack:esp32:m5stack_sticks3`
- Runtime: `wss://fields.example.com/embodiment/ws`
- 包类型: 源码编译与上传
