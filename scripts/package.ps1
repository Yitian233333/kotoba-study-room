param([string]$OutputPath = '')
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem
$projectPath = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$version = (Get-Content -LiteralPath (Join-Path $projectPath 'package.json') -Raw | ConvertFrom-Json).version
if (-not $OutputPath) { $OutputPath = Join-Path $projectPath "dist\Kotoba-framework-v$version.zip" }
$archivePath = [IO.Path]::GetFullPath($OutputPath)
if (Test-Path -LiteralPath $archivePath) { throw 'Package already exists. Choose a new output path.' }
$rootFiles = @('.gitignore','AGENTS.md','COURSE_AUTHORING.md','LICENSE','package.json','package-lock.json','README.md')
$rootFiles += @(Get-ChildItem -LiteralPath $projectPath -File -Filter '*.cmd' | Select-Object -ExpandProperty Name)
$files = @($rootFiles | ForEach-Object { Get-Item -LiteralPath (Join-Path $projectPath $_) })
foreach ($directory in @('src','public','scripts','test','docs')) {
  $files += @(Get-ChildItem -LiteralPath (Join-Path $projectPath $directory) -File -Recurse | Where-Object { $_.Extension -in @('.mjs','.css','.html','.svg','.png','.ico','.ps1','.vbs','.md') })
}
$files = @($files | Sort-Object FullName)
$manifest = [ordered]@{version=$version;kind='framework-only';files=@()}
foreach ($file in $files) {
  $relativePath = $file.FullName.Substring($projectPath.Length+1).Replace('\','/')
  if ($relativePath -match '(^|/)(data|node_modules|\.git|\.codex|\.agents)/|\.sqlite|\.env|\.log$|\.lnk$') { throw "Excluded file: $relativePath" }
  $manifest.files += [ordered]@{path=$relativePath;sha256=(Get-FileHash -LiteralPath $file.FullName -Algorithm SHA256).Hash.ToLowerInvariant()}
}
[IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($archivePath)) | Out-Null
$stream = [IO.File]::Open($archivePath,[IO.FileMode]::CreateNew)
$zip = New-Object IO.Compression.ZipArchive($stream,[IO.Compression.ZipArchiveMode]::Create,$false)
try {
  foreach ($file in $files) {
    $relativePath=$file.FullName.Substring($projectPath.Length+1).Replace('\','/')
    $entry=$zip.CreateEntry('Kotoba/'+$relativePath,[IO.Compression.CompressionLevel]::Optimal)
    $entry.LastWriteTime=[DateTimeOffset]::Parse('2000-01-01T00:00:00Z')
    $sourceStream=[IO.File]::OpenRead($file.FullName);$entryStream=$entry.Open()
    try { $sourceStream.CopyTo($entryStream) } finally { $sourceStream.Dispose();$entryStream.Dispose() }
  }
} finally { $zip.Dispose();$stream.Dispose() }
$verify=[IO.Compression.ZipFile]::OpenRead($archivePath)
try {
  if ($verify.Entries.Count -ne $files.Count) { throw 'Archive file count mismatch.' }
  foreach ($item in $manifest.files) {
    $entry=$verify.GetEntry('Kotoba/'+$item.path)
    if (-not $entry) { throw "Missing file: $($item.path)" }
    $hash=[Security.Cryptography.SHA256]::Create();$entryStream=$entry.Open()
    try { $actual=[BitConverter]::ToString($hash.ComputeHash($entryStream)).Replace('-','').ToLowerInvariant() }
    finally { $entryStream.Dispose();$hash.Dispose() }
    if ($actual -ne $item.sha256) { throw "Archive content mismatch: $($item.path)" }
  }
} finally { $verify.Dispose() }
$manifestJson=$manifest | ConvertTo-Json -Depth 5
[IO.File]::WriteAllText($archivePath+'.manifest.json',$manifestJson,(New-Object Text.UTF8Encoding($false)))
$checksum=(Get-FileHash -LiteralPath $archivePath -Algorithm SHA256).Hash.ToLowerInvariant()
[IO.File]::WriteAllText($archivePath+'.sha256',$checksum+'  '+[IO.Path]::GetFileName($archivePath)+"`n",(New-Object Text.UTF8Encoding($false)))
[PSCustomObject]@{Name=[IO.Path]::GetFileName($archivePath);Files=$files.Count;Bytes=(Get-Item -LiteralPath $archivePath).Length;SHA256=$checksum} | ConvertTo-Json
