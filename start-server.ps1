param([switch]$NoBrowser, [int]$Port = 8765)

$ErrorActionPreference = "Stop"
$appRoot = [System.IO.Path]::GetFullPath($PSScriptRoot)
$address = "http://localhost:$Port/"
$mimeTypes = @{
    ".html" = "text/html; charset=utf-8"
    ".css" = "text/css; charset=utf-8"
    ".js" = "application/javascript; charset=utf-8"
    ".json" = "application/json; charset=utf-8"
    ".webmanifest" = "application/manifest+json; charset=utf-8"
    ".svg" = "image/svg+xml"
    ".png" = "image/png"
    ".txt" = "text/plain; charset=utf-8"
}

$listener = New-Object System.Net.Sockets.TcpListener -ArgumentList ([System.Net.IPAddress]::Loopback, $Port)

try {
    $listener.Start()
    if (-not $NoBrowser) { Start-Process $address }
    Write-Host ""
    Write-Host "Idea Cooling is running: $address" -ForegroundColor Green
    Write-Host "Keep this window open. Close it to stop the app." -ForegroundColor DarkGray
    Write-Host ""

    while ($true) {
        $client = $listener.AcceptTcpClient()
        try {
            $stream = $client.GetStream()
            $reader = New-Object System.IO.StreamReader($stream, [System.Text.Encoding]::ASCII, $false, 1024, $true)
            $requestLine = $reader.ReadLine()
            while (($headerLine = $reader.ReadLine()) -ne "" -and $null -ne $headerLine) { }
            $target = ($requestLine -split " ")[1]
            $cleanTarget = ($target -split "\?")[0]
            $requestPath = [Uri]::UnescapeDataString($cleanTarget.TrimStart("/"))
            if ([string]::IsNullOrWhiteSpace($requestPath)) { $requestPath = "index.html" }
            $requestedFile = [System.IO.Path]::GetFullPath((Join-Path $appRoot $requestPath))

            if (-not $requestedFile.StartsWith($appRoot, [System.StringComparison]::OrdinalIgnoreCase) -or -not (Test-Path -LiteralPath $requestedFile -PathType Leaf)) {
                $status = "404 Not Found"
                $contentType = "text/plain; charset=utf-8"
                $bytes = [System.Text.Encoding]::UTF8.GetBytes("Not Found")
            } else {
                $status = "200 OK"
                $extension = [System.IO.Path]::GetExtension($requestedFile).ToLowerInvariant()
                $contentType = $(if ($mimeTypes.ContainsKey($extension)) { $mimeTypes[$extension] } else { "application/octet-stream" })
                $bytes = [System.IO.File]::ReadAllBytes($requestedFile)
            }

            $responseHeader = "HTTP/1.1 $status`r`nContent-Type: $contentType`r`nContent-Length: $($bytes.Length)`r`nCache-Control: no-cache`r`nConnection: close`r`n`r`n"
            $headerBytes = [System.Text.Encoding]::ASCII.GetBytes($responseHeader)
            $stream.Write($headerBytes, 0, $headerBytes.Length)
            $stream.Write($bytes, 0, $bytes.Length)
            $stream.Flush()
        } catch {
            # Browsers may cancel speculative requests; keep serving the app.
        } finally {
            $client.Close()
        }
    }
} catch {
    Write-Host "Unable to start: $($_.Exception.Message)" -ForegroundColor Red
    Read-Host "Press Enter to close"
} finally {
    $listener.Stop()
}
