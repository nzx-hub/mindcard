# Windows SmartScreen 与代码签名

## 为什么每次更新后都会提示

`MindCard.exe` 当前没有数字签名。Windows SmartScreen 对**没有信誉记录的未签名 exe** 会显示：

> Windows 已保护你的电脑  
> Microsoft Defender SmartScreen 阻止了无法识别的应用启动。

每次重新构建，exe 的文件哈希都会变化，SmartScreen 会把它当成一个新的、没有信誉的文件，所以不是“上次允许过就永久放行”。

这和卡组/代码逻辑无关，也不是 Defender 报毒。可以用 PowerShell 确认：

```powershell
Get-AuthenticodeSignature .\MindCard.exe
# Status: NotSigned
```

## 只在本机使用

### 方法 A：直接放行当前文件

1. 点击提示里的 **“更多信息”**；
2. 出现 **“仍要运行”** 后点击；
3. 如果文件来自压缩包，先解压，不要直接在压缩包里运行。

### 方法 B：解除“来自其他计算机”的锁定

如果文件属性里有“此文件来自其他计算机，可能被阻止”：

```powershell
Unblock-File .\MindCard.exe
```

如果是压缩包：

```powershell
Unblock-File .\MindCard-0.1.0-portable.zip
```

先解除压缩包锁定，再解压；或者解压后对整个目录执行：

```powershell
Get-ChildItem .\MindCard -Recurse -File | Unblock-File
```

这只是去掉 Mark-of-the-Web，**不会让 exe 变成已签名文件**；某些机器仍会显示 SmartScreen。

### 方法 C：本地开发证书（仅本机）

可以用自签名代码签名证书消除本机的“未知发布者”，但**其他用户仍然不会信任它**，不适合公开发布。

```powershell
$cert = New-SelfSignedCertificate `
  -Type CodeSigningCert `
  -Subject "CN=MindCard Dev" `
  -CertStoreLocation Cert:\CurrentUser\My

# 让当前用户信任这个证书
Export-Certificate -Cert $cert -FilePath "$env:TEMP\mindcard-dev.cer" | Out-Null
Import-Certificate -FilePath "$env:TEMP\mindcard-dev.cer" -CertStoreLocation Cert:\CurrentUser\Root | Out-Null
Import-Certificate -FilePath "$env:TEMP\mindcard-dev.cer" -CertStoreLocation Cert:\CurrentUser\TrustedPublisher | Out-Null

Set-AuthenticodeSignature `
  -FilePath .\dist\MindCard.exe `
  -Certificate $cert `
  -TimestampServer "http://timestamp.digicert.com"
```

注意：

- 每次重新构建后都要重新签名；
- 自签名证书只适合自己测试；
- 公开分发时，别人不会自动信任你的自签名证书。

## 公开给别人使用

要真正减少/消除 SmartScreen 提示，需要**受信任的代码签名证书**：

| 方案 | 效果 |
| --- | --- |
| OV 代码签名证书 | 显示发布者名称；信誉需要时间积累 |
| EV 代码签名证书 | 通常能更快建立 SmartScreen 信誉 |
| Azure Trusted Signing | 微软云签名服务，适合持续集成 |
| 自签名证书 | 只适合本机测试，不适合公开分发 |

签名时同时签 exe 和安装包，并使用时间戳服务器：

```powershell
signtool sign /fd SHA256 /tr http://timestamp.digicert.com /td SHA256 /a .\dist\MindCard.exe
```

如果使用 PFX 文件：

```powershell
signtool sign /fd SHA256 /f .\cert.pfx /p "<password>" `
  /tr http://timestamp.digicert.com /td SHA256 `
  .\dist\MindCard.exe
```

签名后可以验证：

```powershell
Get-AuthenticodeSignature .\dist\MindCard.exe
```

## 不要做什么

- 不建议为了省事全局关闭 SmartScreen；
- 不建议关闭 Defender 实时保护；
- 不建议让用户长期使用“添加排除目录”的方式绕过；
- 不要把自签名证书说成“已通过微软认证”。

## 最快的当前方案

如果你只是自己用：

1. 解压便携包；
2. 解压后点“更多信息 → 仍要运行”；
3. 或者先 `Unblock-File`。

如果要发给别人、又不想每次看到警告：申请代码签名证书，或在网页版/单文件 HTML 版里使用，不走 exe 分发。