param(
  [Parameter(Mandatory = $true)]
  [string]$Port,
  [string]$ArduinoCli = "arduino-cli"
)

$ErrorActionPreference = "Stop"
$fqbn = "m5stack:esp32:m5stack_sticks3"
$sketchDirectory = Join-Path $PSScriptRoot "sketch"

if ($ArduinoCli -eq "arduino-cli") {
  $bundledCli = Join-Path $env:LOCALAPPDATA "Programs\arduino-ide\resources\app\lib\backend\resources\arduino-cli.exe"
  if (Test-Path $bundledCli) { $ArduinoCli = $bundledCli }
}

& $ArduinoCli compile --fqbn $fqbn --port $Port --upload $sketchDirectory
if ($LASTEXITCODE -ne 0) { throw "烧录失败，退出码：$LASTEXITCODE" }
