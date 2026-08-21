[CmdletBinding()]
param(
    [switch]$InspectOnly,
    [string]$BuildDirectory,
    [string]$PublicOrigin = 'https://www.planetcreations.net'
)

$ErrorActionPreference = 'Stop'
if ([string]::IsNullOrWhiteSpace($BuildDirectory)) {
    $BuildDirectory = Join-Path $PSScriptRoot '..\build'
}
$expectedEd25519Fingerprint =
    'SHA256:1gx2w8Rtv3wCgi7Jh8myf/KVd72cRQbow03UP8P095Q'
$openSshDirectory = 'C:\Windows\System32\OpenSSH'
$sftpPath = Join-Path $openSshDirectory 'sftp.exe'
$sshKeyscanPath = Join-Path $openSshDirectory 'ssh-keyscan.exe'
$sshKeygenPath = Join-Path $openSshDirectory 'ssh-keygen.exe'
$fileZillaDirectory = Join-Path $env:APPDATA 'FileZilla'
$recentServersPath = Join-Path $fileZillaDirectory 'recentservers.xml'

foreach ($requiredPath in @(
    $sftpPath,
    $sshKeyscanPath,
    $sshKeygenPath,
    $recentServersPath
)) {
    if (-not (Test-Path -LiteralPath $requiredPath)) {
        throw "Required deployment dependency is missing: $requiredPath"
    }
}

[xml]$recentServers = Get-Content -LiteralPath $recentServersPath
$server = @($recentServers.FileZilla3.RecentServers.Server) |
    Where-Object {
        [string]$_.Protocol -eq '1' -and
        [string]$_.Host -like '*.webspace-host.com' -and
        -not [string]::IsNullOrWhiteSpace([string]$_.User) -and
        $null -ne $_.Pass
    } |
    Select-Object -First 1

if (-not $server) {
    throw 'The stored IONOS SFTP connection was not found in FileZilla.'
}

$hostName = [string]$server.Host
$port = [int]$server.Port
$userName = [string]$server.User
$encodedPassword = [string]$server.Pass.InnerText
$password = if ([string]$server.Pass.encoding -eq 'base64') {
    [Text.Encoding]::UTF8.GetString(
        [Convert]::FromBase64String($encodedPassword)
    )
} else {
    $encodedPassword
}

if ([string]::IsNullOrWhiteSpace($password)) {
    throw 'The stored IONOS SFTP password is empty.'
}

$systemTempRoot = [IO.Path]::GetFullPath([IO.Path]::GetTempPath())
$temporaryDirectory = Join-Path $systemTempRoot (
    'pcn-ionos-deploy-' + [guid]::NewGuid().ToString('N')
)
$null = New-Item -ItemType Directory -Path $temporaryDirectory
$knownHostsPath = Join-Path $temporaryDirectory 'known_hosts'
$askPassPath = Join-Path $temporaryDirectory 'pcn-askpass.exe'

function Get-Sha256Hex {
    param([byte[]]$Bytes)

    $sha256 = [Security.Cryptography.SHA256]::Create()
    try {
        return ([BitConverter]::ToString($sha256.ComputeHash($Bytes))).Replace('-', '').ToLowerInvariant()
    } finally {
        $sha256.Dispose()
    }
}

function Assert-PublicFileMatches {
    param(
        [string]$Url,
        [byte[]]$LocalBytes,
        [string]$Label
    )

    $localHash = Get-Sha256Hex $LocalBytes
    $lastPublicHash = $null
    for ($attempt = 1; $attempt -le 6; $attempt += 1) {
        $separator = if ($Url.Contains('?')) { '&' } else { '?' }
        $requestUrl = "$Url${separator}deployVerify=$([guid]::NewGuid().ToString('N'))"
        $webClient = New-Object Net.WebClient
        $webClient.Headers['Cache-Control'] = 'no-cache'
        try {
            $publicBytes = $webClient.DownloadData($requestUrl)
            $lastPublicHash = Get-Sha256Hex $publicBytes
            if ($lastPublicHash -eq $localHash) {
                return
            }
        } finally {
            $webClient.Dispose()
        }
        if ($attempt -lt 6) {
            # IONOS/Cloudflare edges can briefly disagree immediately after an
            # overwrite even though SFTP already returns the new bytes.
            Start-Sleep -Seconds 2
        }
    }
    throw "$Label does not match after CDN propagation retries " +
        "(local $localHash, public $lastPublicHash)."
}

function Invoke-SftpCommands {
    param([string[]]$Commands)

    $arguments = @(
        '-o', 'StrictHostKeyChecking=yes',
        '-o', "UserKnownHostsFile=$knownHostsPath",
        '-o', 'PreferredAuthentications=password',
        '-o', 'PubkeyAuthentication=no',
        '-P', [string]$port,
        "$userName@$hostName"
    )
    $previousErrorActionPreference = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    $output = @($Commands | & $sftpPath @arguments 2>&1)
    $sftpExitCode = $LASTEXITCODE
    $ErrorActionPreference = $previousErrorActionPreference
    if ($sftpExitCode -ne 0) {
        throw "SFTP failed:`n$($output -join [Environment]::NewLine)"
    }
    return $output
}

try {
    $previousErrorActionPreference = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    $keyLines = @(& $sshKeyscanPath -p $port -t ed25519 $hostName 2>$null)
    $keyscanExitCode = $LASTEXITCODE
    $ErrorActionPreference = $previousErrorActionPreference
    if ($keyscanExitCode -ne 0) {
        throw "IONOS host-key lookup failed with exit code $keyscanExitCode."
    }
    if ($keyLines.Count -eq 0) {
        throw 'IONOS did not return an Ed25519 host key.'
    }
    [IO.File]::WriteAllLines(
        $knownHostsPath,
        $keyLines,
        (New-Object Text.UTF8Encoding($false))
    )
    $fingerprintOutput = @(& $sshKeygenPath -lf $knownHostsPath)
    if (-not ($fingerprintOutput -match [regex]::Escape(
        $expectedEd25519Fingerprint
    ))) {
        throw "IONOS host-key mismatch: $($fingerprintOutput -join ' ')"
    }

    $askPassSource = @'
using System;
public static class PcnSftpAskPass
{
    public static int Main()
    {
        Console.WriteLine(Environment.GetEnvironmentVariable("PCN_SFTP_PASSWORD"));
        return 0;
    }
}
'@
    Add-Type -TypeDefinition $askPassSource -Language CSharp `
        -OutputAssembly $askPassPath -OutputType ConsoleApplication

    $env:DISPLAY = 'pcn-sftp'
    $env:SSH_ASKPASS = $askPassPath
    $env:SSH_ASKPASS_REQUIRE = 'force'
    $env:PCN_SFTP_PASSWORD = $password

    $inspection = Invoke-SftpCommands @('pwd', 'ls -la', 'quit')
    if ($InspectOnly) {
        $inspection | ForEach-Object { Write-Output $_ }
        Write-Output "Verified host key: $expectedEd25519Fingerprint"
        exit 0
    }

    $buildRoot = [IO.Path]::GetFullPath($BuildDirectory).TrimEnd('\')
    if (-not (Test-Path -LiteralPath (Join-Path $buildRoot 'index.html'))) {
        throw "Production build is missing index.html: $buildRoot"
    }
    if (-not (($inspection -join "`n") -match '(?m)\bindex\.html\b') -or
        -not (($inspection -join "`n") -match '(?m)\bassets\b')) {
        throw 'The SFTP home is not the established PlanetCreations web root.'
    }

    $files = @(Get-ChildItem -LiteralPath $buildRoot -Recurse -File -Force)
    $relativeFiles = $files | ForEach-Object {
        [pscustomobject]@{
            FullName = $_.FullName
            RelativePath = $_.FullName.Substring($buildRoot.Length).TrimStart('\').Replace('\', '/')
        }
    }
    $indexFile = $relativeFiles | Where-Object RelativePath -eq 'index.html'
    $contentFiles = $relativeFiles |
        Where-Object RelativePath -ne 'index.html' |
        Sort-Object RelativePath

    $uploadCommands = @()
    foreach ($file in $contentFiles) {
        $localPath = $file.FullName.Replace('\', '/')
        $uploadCommands += "put `"$localPath`" `"$($file.RelativePath)`""
    }
    # The app shell is deliberately the final upload so it can never reference
    # hashed assets that have not reached the server yet.
    $indexLocalPath = $indexFile.FullName.Replace('\', '/')
    $uploadCommands += "put `"$indexLocalPath`" `"index.html`""
    $uploadCommands += 'quit'
    $null = Invoke-SftpCommands $uploadCommands

    $verificationRoot = Join-Path $temporaryDirectory 'verification'
    $null = New-Item -ItemType Directory -Path $verificationRoot
    foreach ($directory in @($relativeFiles.RelativePath | ForEach-Object {
        [IO.Path]::GetDirectoryName($_.Replace('/', '\'))
    } | Where-Object { $_ } | Sort-Object -Unique)) {
        $null = New-Item -ItemType Directory `
            -Path (Join-Path $verificationRoot $directory) -Force
    }
    $downloadCommands = @()
    foreach ($file in $relativeFiles) {
        $verifyPath = (Join-Path $verificationRoot $file.RelativePath).Replace('\', '/')
        $downloadCommands += "get `"$($file.RelativePath)`" `"$verifyPath`""
    }
    $downloadCommands += 'quit'
    $null = Invoke-SftpCommands $downloadCommands

    foreach ($file in $relativeFiles) {
        $localHash = Get-Sha256Hex ([IO.File]::ReadAllBytes($file.FullName))
        $verifiedPath = Join-Path $verificationRoot $file.RelativePath
        $remoteHash = Get-Sha256Hex ([IO.File]::ReadAllBytes($verifiedPath))
        if ($localHash -ne $remoteHash) {
            throw "Remote hash mismatch: $($file.RelativePath)"
        }
    }

    $localIndexBytes = [IO.File]::ReadAllBytes($indexFile.FullName)
    Assert-PublicFileMatches `
        -Url "$($PublicOrigin.TrimEnd('/'))/" `
        -LocalBytes $localIndexBytes `
        -Label 'Public index.html'

    $indexText = [Text.Encoding]::UTF8.GetString($localIndexBytes)
    $assetPaths = @([regex]::Matches(
        $indexText,
        '(?:src|href)="\.?/?(assets/[^"]+\.(?:js|css))"'
    ) | ForEach-Object { $_.Groups[1].Value } | Sort-Object -Unique)
    foreach ($assetPath in $assetPaths) {
        $localAssetBytes = [IO.File]::ReadAllBytes(
            (Join-Path $buildRoot $assetPath)
        )
        Assert-PublicFileMatches `
            -Url "$($PublicOrigin.TrimEnd('/'))/$assetPath" `
            -LocalBytes $localAssetBytes `
            -Label "Public asset $assetPath"
    }

    Write-Output "IONOS deployment verified: $($relativeFiles.Count) files"
    Write-Output "Host key: $expectedEd25519Fingerprint"
    Write-Output "Public origin: $PublicOrigin"
} finally {
    $env:PCN_SFTP_PASSWORD = $null
    $env:SSH_ASKPASS = $null
    $env:SSH_ASKPASS_REQUIRE = $null
    $env:DISPLAY = $null
    $password = $null

    $resolvedTemporaryDirectory = [IO.Path]::GetFullPath($temporaryDirectory)
    if ($resolvedTemporaryDirectory.StartsWith(
        $systemTempRoot,
        [StringComparison]::OrdinalIgnoreCase
    ) -and (Test-Path -LiteralPath $resolvedTemporaryDirectory)) {
        Remove-Item -LiteralPath $resolvedTemporaryDirectory -Recurse -Force
    }
}
