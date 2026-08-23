param(
    [string]$Source = (Join-Path $PSScriptRoot '..\assets\icon.png'),
    [string]$Destination = (Join-Path $PSScriptRoot '..\assets\appx')
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

$sourcePath = [System.IO.Path]::GetFullPath($Source)
$destinationPath = [System.IO.Path]::GetFullPath($Destination)
if (-not (Test-Path -LiteralPath $sourcePath -PathType Leaf)) {
    throw "Source icon does not exist: $sourcePath"
}
[System.IO.Directory]::CreateDirectory($destinationPath) | Out-Null

$targets = @{
    'StoreLogo.png' = @(50, 50)
    'Square44x44Logo.png' = @(44, 44)
    'Square150x150Logo.png' = @(150, 150)
    'Wide310x150Logo.png' = @(310, 150)
}

$sourceImage = [System.Drawing.Image]::FromFile($sourcePath)
try {
    foreach ($entry in $targets.GetEnumerator()) {
        $width = $entry.Value[0]
        $height = $entry.Value[1]
        $canvas = New-Object System.Drawing.Bitmap($width, $height)
        try {
            $canvas.SetResolution(96, 96)
            $graphics = [System.Drawing.Graphics]::FromImage($canvas)
            try {
                $graphics.Clear([System.Drawing.Color]::Transparent)
                $graphics.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
                $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
                $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality

                $scale = [Math]::Min($width / $sourceImage.Width, $height / $sourceImage.Height)
                $drawWidth = [Math]::Max(1, [int][Math]::Round($sourceImage.Width * $scale))
                $drawHeight = [Math]::Max(1, [int][Math]::Round($sourceImage.Height * $scale))
                $x = [int](($width - $drawWidth) / 2)
                $y = [int](($height - $drawHeight) / 2)
                $graphics.DrawImage($sourceImage, $x, $y, $drawWidth, $drawHeight)
            } finally {
                $graphics.Dispose()
            }
            $outputPath = Join-Path $destinationPath $entry.Key
            $canvas.Save($outputPath, [System.Drawing.Imaging.ImageFormat]::Png)
        } finally {
            $canvas.Dispose()
        }
    }
} finally {
    $sourceImage.Dispose()
}

Write-Host "Generated AppX assets in $destinationPath"
