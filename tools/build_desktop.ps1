param(
    [switch]$Bundle,
    [string]$TargetDir = "$env:USERPROFILE\mindcard-target"
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$stage = Join-Path $env:TEMP ("mindcard-stage-" + $PID)
$dist = Join-Path $root "dist"

Write-Host "==> 准备 ASCII 暂存目录：$stage"
if (Test-Path $stage) { Remove-Item $stage -Recurse -Force }
New-Item -ItemType Directory -Path $stage | Out-Null

# 中文源码路径会让 MinGW windres/ld 无法处理，先复制到 ASCII 路径。
robocopy (Join-Path $root "app") (Join-Path $stage "app") /E /NFL /NDL /NJH /NJS | Out-Null
if ($LASTEXITCODE -ge 8) { throw "复制 app 失败：$LASTEXITCODE" }
robocopy (Join-Path $root "src-tauri") (Join-Path $stage "src-tauri") /E /XD target gen /NFL /NDL /NJH /NJS | Out-Null
if ($LASTEXITCODE -ge 8) { throw "复制 src-tauri 失败：$LASTEXITCODE" }

# 本机使用 Rust GNU 工具链；正式发布建议改用 MSVC Build Tools。
$cargoBin = "$env:USERPROFILE\.cargo\bin"
if (-not (Test-Path (Join-Path $cargoBin "cargo.exe"))) {
    throw "找不到 cargo，请检查 Rust 是否安装"
}
$env:PATH = "$cargoBin;C:\mingw64\bin;$env:PATH"
$env:CARGO_TARGET_X86_64_PC_WINDOWS_GNU_LINKER = "x86_64-w64-mingw32-gcc"
# 避免依赖的 panic 位置把本机用户名/绝对路径写进 exe。
$userHome = $env:USERPROFILE
$env:RUSTFLAGS = "-C link-self-contained=yes --remap-path-prefix=$userHome\.cargo=/cargo --remap-path-prefix=$userHome=/build"
$env:CARGO_TARGET_DIR = $TargetDir

Set-Location $stage
# 通过 cmd 显式设置 PATH，避免不同 PowerShell 宿主继承 PATH 不一致。
$buildArgs = if ($Bundle) { "build" } else { "build --no-bundle" }
$cmdLine = 'set "PATH=' + $cargoBin + ';C:\mingw64\bin;%PATH%" && npx.cmd --yes @tauri-apps/cli@2 ' + $buildArgs
cmd.exe /d /c $cmdLine
if ($LASTEXITCODE -ne 0) { throw "Tauri 构建失败，退出码 $LASTEXITCODE" }

New-Item -ItemType Directory -Path $dist -Force | Out-Null
$exe = Get-ChildItem -Path $TargetDir -Recurse -Filter "mindcard.exe" -ErrorAction SilentlyContinue |
    Sort-Object LastWriteTime -Descending | Select-Object -First 1
if (-not $exe) { throw "没有找到 mindcard.exe" }
Copy-Item $exe.FullName (Join-Path $dist "MindCard.exe") -Force
$wv = Join-Path $exe.DirectoryName "WebView2Loader.dll"
if (Test-Path $wv) { Copy-Item $wv (Join-Path $dist "WebView2Loader.dll") -Force }
Write-Host "==> exe: $(Join-Path $dist 'MindCard.exe')"

if ($Bundle) {
    $setup = Get-ChildItem -Path $TargetDir -Recurse -Filter "*-setup.exe" -ErrorAction SilentlyContinue |
        Sort-Object LastWriteTime -Descending | Select-Object -First 1
    if ($setup) {
        Copy-Item $setup.FullName (Join-Path $dist "MindCard-setup.exe") -Force
        Write-Host "==> installer: $(Join-Path $dist 'MindCard-setup.exe')"
    }
}