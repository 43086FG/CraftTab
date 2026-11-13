# CraftTab 打包脚本：src -> dist/MCNewTab -> dist/MCNewTab.zip
# 可选签名 crx3（需 npx crx3，私钥不入库）：
#   npx crx3 -p privatekey.pem -o dist/MCNewTab.crx dist/MCNewTab
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$src = Join-Path $root 'src'
$dist = Join-Path $root 'dist'
$app = Join-Path $dist 'MCNewTab'

if (Test-Path $dist) { Remove-Item $dist -Recurse -Force }
New-Item -ItemType Directory -Force -Path $app | Out-Null

Copy-Item (Join-Path $src '*') $app -Recurse -Force

# 只保留源码实际引用到的贴图
$textExt = @('.js', '.css', '.html', '.md', '.json', '.lang', '.txt')
$corpus = ''
Get-ChildItem $app -Recurse -File | Where-Object { $textExt -contains $_.Extension.ToLower() } | ForEach-Object {
  $corpus += (Get-Content $_.FullName -Raw)
}
$pruned = 0
Get-ChildItem (Join-Path $app 'assets') -Recurse -File -Filter *.png | ForEach-Object {
  if ($corpus -notmatch [regex]::Escape($_.BaseName)) {
    Remove-Item $_.FullName -Force
    $pruned++
  }
}

$zip = Join-Path $dist 'MCNewTab.zip'
Compress-Archive -Path (Join-Path $app '*') -DestinationPath $zip -CompressionLevel Optimal

Write-Output "Package ready: $app"
Write-Output "Zip: $zip"
Write-Output "Pruned textures: $pruned"
