$ErrorActionPreference = "Stop"
$root = $PSScriptRoot
$compiler = Join-Path $env:WINDIR "Microsoft.NET\Framework64\v4.0.30319\csc.exe"
if (!(Test-Path $compiler)) { throw "Build on 64-bit Windows with .NET Framework 4.8 (included in Windows 11)." }

$version = "1.0.4258.31"
$expectedHash = "56F7F4B8BF9AEE4B8EFEFBBDD4F67D5F74EBD1B100ED0806DA71BF76AF481AA9"
$cache = Join-Path $root ".cache"
$sdk = Join-Path $cache "webview2-$version"
$archive = Join-Path $cache "webview2-$version.zip"
$dist = Join-Path $root "dist"
New-Item -ItemType Directory -Force $cache, $dist | Out-Null
if (!(Test-Path $archive)) {
    [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
    Invoke-WebRequest "https://api.nuget.org/v3-flatcontainer/microsoft.web.webview2/$version/microsoft.web.webview2.$version.nupkg" -OutFile $archive -UseBasicParsing
}
if ((Get-FileHash $archive -Algorithm SHA256).Hash -ne $expectedHash) {
    throw "WebView2 SDK checksum mismatch. Delete $archive and retry."
}
Expand-Archive $archive -DestinationPath $sdk -Force

# Compress support libraries into the EXE. Managed DLLs load in memory; only the
# native loader must be extracted to a content-addressed local app-data directory.
function Compress-Resource([string]$Source, [string]$Name) {
    $inputFile = [IO.File]::OpenRead($Source)
    $outputFile = [IO.File]::Create((Join-Path $cache $Name))
    $gzip = New-Object IO.Compression.GZipStream $outputFile, ([IO.Compression.CompressionMode]::Compress)
    try { $inputFile.CopyTo($gzip) }
    finally { $gzip.Dispose(); $outputFile.Dispose(); $inputFile.Dispose() }
}
$core = Join-Path $sdk "lib\net462\Microsoft.Web.WebView2.Core.dll"
$forms = Join-Path $sdk "lib\net462\Microsoft.Web.WebView2.WinForms.dll"
Compress-Resource $core "Microsoft.Web.WebView2.Core.dll.gz"
Compress-Resource $forms "Microsoft.Web.WebView2.WinForms.dll.gz"
Compress-Resource (Join-Path $sdk "runtimes\win-x64\native\WebView2Loader.dll") "WebView2Loader.dll.gz"
Compress-Resource (Join-Path $sdk "LICENSE.txt") "WebView2-LICENSE.txt.gz"
Compress-Resource (Join-Path $sdk "NOTICE.txt") "WebView2-NOTICE.txt.gz"
& "$root\make-icon.ps1" -Output (Join-Path $cache "app.ico")

& $compiler /nologo /target:winexe /platform:x64 /optimize+ /debug- /warnaserror+ `
    /main:Bootstrap "/out:$dist\Streamroom.exe" "/win32manifest:$root\app.manifest" "/win32icon:$cache\app.ico" `
    /reference:System.dll /reference:System.Core.dll /reference:System.Drawing.dll /reference:System.Windows.Forms.dll `
    "/reference:$core" "/reference:$forms" `
    "/resource:$cache\Microsoft.Web.WebView2.Core.dll.gz,Microsoft.Web.WebView2.Core.dll.gz" `
    "/resource:$cache\Microsoft.Web.WebView2.WinForms.dll.gz,Microsoft.Web.WebView2.WinForms.dll.gz" `
    "/resource:$cache\WebView2Loader.dll.gz,WebView2Loader.dll.gz" `
    "/resource:$cache\WebView2-LICENSE.txt.gz,WebView2-LICENSE.txt.gz" `
    "/resource:$cache\WebView2-NOTICE.txt.gz,WebView2-NOTICE.txt.gz" `
    "/resource:$cache\app.ico,app.ico" `
    "$root\Bootstrap.cs" "$root\Program.cs" "$root\UrlPolicy.cs"
if ($LASTEXITCODE -ne 0) { throw "Desktop compilation failed." }

& $compiler /nologo /target:exe /platform:x64 /optimize+ /warnaserror+ `
    "/out:$cache\UrlPolicy.Tests.exe" "$root\UrlPolicy.cs" "$root\UrlPolicy.Tests.cs"
if ($LASTEXITCODE -ne 0) { throw "Test compilation failed." }
& "$cache\UrlPolicy.Tests.exe"
if ($LASTEXITCODE -ne 0) { throw "Desktop URL policy tests failed." }

# Test a copy in a fresh directory: no config or sidecar DLL can mask a packaging bug.
$testRoot = Join-Path ([Environment]::GetFolderPath("LocalApplicationData")) "Streamroom\BuildTests"
$testDirectory = Join-Path $testRoot ([Guid]::NewGuid().ToString("N"))
New-Item -ItemType Directory -Force $testDirectory | Out-Null
try {
    $testExe = Join-Path $testDirectory "Streamroom.exe"
    Copy-Item "$dist\Streamroom.exe" $testExe
    $errorLog = Join-Path $cache "startup-test-error.txt"
    $process = Start-Process -FilePath $testExe -ArgumentList "--self-test" -Wait -PassThru -RedirectStandardError $errorLog
    if ($process.ExitCode -ne 0) {
        throw "Single-file startup self-test failed (exit $($process.ExitCode)): $(Get-Content $errorLog -Raw)"
    }
    Write-Host "Single-file startup: embedded assemblies, native loader, and icon passed."
} finally {
    try {
        [IO.File]::Delete((Join-Path $testDirectory "Streamroom.exe"))
        [IO.Directory]::Delete($testDirectory)
    } catch { Write-Warning "Could not clean startup-test directory: $testDirectory" }
}
Get-Item "$dist\Streamroom.exe" | Select-Object FullName, Length
Write-Host "Send Streamroom.exe alone. It always opens https://share.detrouse.com/"
