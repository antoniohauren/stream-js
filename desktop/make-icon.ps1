# Original Streamroom artwork: a screen with a play/share mark. No external assets.
param([string]$Output = (Join-Path $PSScriptRoot "app.ico"))
$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Drawing
$images = @()
foreach ($size in @(16, 24, 32, 48, 64, 128, 256)) {
    $bitmap = New-Object System.Drawing.Bitmap 256, 256
    $g = [Drawing.Graphics]::FromImage($bitmap)
    $g.SmoothingMode = [Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $g.Clear([Drawing.Color]::Transparent)
    $gradient = New-Object Drawing.Drawing2D.LinearGradientBrush `
        ([Drawing.Point]::new(20, 20)), ([Drawing.Point]::new(236, 236)), `
        ([Drawing.Color]::FromArgb(37, 99, 235)), ([Drawing.Color]::FromArgb(109, 40, 217))
    $white = New-Object Drawing.SolidBrush ([Drawing.Color]::White)
    $teal = New-Object Drawing.SolidBrush ([Drawing.Color]::FromArgb(94, 234, 212))
    $outline = New-Object Drawing.Pen ([Drawing.Color]::White), 12
    $g.FillEllipse($gradient, 4, 4, 248, 248)
    $g.DrawRectangle($outline, 48, 62, 160, 112)
    $g.FillRectangle($white, 119, 176, 18, 20)
    $g.FillRectangle($white, 92, 196, 72, 10)
    $g.FillPolygon($teal, [Drawing.Point[]]@([Drawing.Point]::new(110, 86), [Drawing.Point]::new(110, 150), [Drawing.Point]::new(161, 118)))
    $small = New-Object Drawing.Bitmap $size, $size
    $sg = [Drawing.Graphics]::FromImage($small)
    $sg.InterpolationMode = [Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $sg.DrawImage($bitmap, 0, 0, $size, $size)
    $stream = New-Object IO.MemoryStream
    $small.Save($stream, [Drawing.Imaging.ImageFormat]::Png)
    $images += ,@{ Size = $size; Bytes = $stream.ToArray() }
    $stream.Dispose(); $sg.Dispose(); $small.Dispose()
    $outline.Dispose(); $teal.Dispose(); $white.Dispose(); $gradient.Dispose(); $g.Dispose(); $bitmap.Dispose()
}
$file = [IO.File]::Create($Output)
$writer = New-Object IO.BinaryWriter $file
try {
    $writer.Write([uint16]0); $writer.Write([uint16]1); $writer.Write([uint16]$images.Count)
    $offset = 6 + 16 * $images.Count
    foreach ($image in $images) {
        $dimension = $image.Size % 256
        $writer.Write([byte]$dimension); $writer.Write([byte]$dimension)
        $writer.Write([byte]0); $writer.Write([byte]0)
        $writer.Write([uint16]1); $writer.Write([uint16]32)
        $writer.Write([uint32]$image.Bytes.Length); $writer.Write([uint32]$offset)
        $offset += $image.Bytes.Length
    }
    foreach ($image in $images) { $writer.Write([byte[]]$image.Bytes) }
} finally { $writer.Dispose(); $file.Dispose() }
