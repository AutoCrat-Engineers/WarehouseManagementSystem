# WMS Auth Local Startup - Native Deno/Node only (no Docker)
$ErrorActionPreference = "Stop"

$DENO = "C:\Users\shash\.deno\bin\deno.exe"
$ROOT = Split-Path -Parent $MyInvocation.MyCommand.Path
$LOG_DIR = Join-Path $ROOT "run-logs"

$Ports = @{
    Frontend = 5173
    AuthLogin = 8001
    AuthLogout = 8002
    SessionManager = 8005
    AuthValidateSession = 8004
    Proxy = 54321
}

function Set-EnvFromFile {
    param([string]$Path)

    if (-not (Test-Path $Path)) {
        return
    }

    Get-Content $Path | ForEach-Object {
        if ($_ -match "^\s*([^#=][^=]*)=(.*)$") {
            $name = $matches[1].Trim().Trim('"')
            $value = $matches[2].Trim().Trim('"')
            [System.Environment]::SetEnvironmentVariable($name, $value, "Process")
        }
    }
}

function Stop-PortProcess {
    param([int]$Port)

    $connections = Get-NetTCPConnection -LocalPort $Port -ErrorAction SilentlyContinue |
        Select-Object -ExpandProperty OwningProcess -Unique

    foreach ($processId in $connections) {
        if ($processId) {
            try {
                Stop-Process -Id $processId -Force -ErrorAction Stop
                Write-Host "Stopped process on port $Port (PID $processId)" -ForegroundColor Yellow
            } catch {
                Write-Warning ("Failed to stop PID {0} on port {1}: {2}" -f $processId, $Port, $_.Exception.Message)
            }
        }
    }
}

function Start-LoggedProcess {
    param(
        [string]$Name,
        [string]$FilePath,
        [string[]]$ArgumentList,
        [string]$StdOutPath,
        [string]$StdErrPath,
        [string]$WorkingDirectory
    )

    $process = Start-Process `
        -FilePath $FilePath `
        -ArgumentList $ArgumentList `
        -WorkingDirectory $WorkingDirectory `
        -RedirectStandardOutput $StdOutPath `
        -RedirectStandardError $StdErrPath `
        -PassThru `
        -WindowStyle Hidden

    Write-Host ("Started {0} (PID {1})" -f $Name, $process.Id) -ForegroundColor Green
    return $process
}

New-Item -ItemType Directory -Force -Path $LOG_DIR | Out-Null

Set-EnvFromFile -Path (Join-Path $ROOT "supabase\.env.local")
Set-EnvFromFile -Path (Join-Path $ROOT ".env")

$viteAnon = [System.Environment]::GetEnvironmentVariable("VITE_SUPABASE_ANON_KEY", "Process")
if ($viteAnon) {
    [System.Environment]::SetEnvironmentVariable("SUPABASE_ANON_KEY", $viteAnon, "Process")
}

foreach ($port in $Ports.Values) {
    Stop-PortProcess -Port $port
}

$logFiles = @(
    "vite.out.log",
    "vite.err.log",
    "auth-login.out.log",
    "auth-login.err.log",
    "auth-logout.out.log",
    "auth-logout.err.log",
    "session-manager.out.log",
    "session-manager.err.log",
    "auth-validate-session.out.log",
    "auth-validate-session.err.log",
    "proxy.out.log",
    "proxy.err.log"
)

foreach ($file in $logFiles) {
    $path = Join-Path $LOG_DIR $file
    if (-not (Test-Path $path)) {
        New-Item -ItemType File -Path $path | Out-Null
        continue
    }

    try {
        Clear-Content -Path $path -ErrorAction Stop
    } catch {
        Write-Warning ("Could not clear log file {0}: {1}" -f $path, $_.Exception.Message)
    }
}

Write-Host ""
Write-Host "==========================================" -ForegroundColor Cyan
Write-Host " WMS Auth Local Stack -- Native Only" -ForegroundColor Cyan
Write-Host "==========================================" -ForegroundColor Cyan

$frontend = Start-LoggedProcess `
    -Name "frontend" `
    -FilePath "npm.cmd" `
    -ArgumentList @("run", "dev", "--", "--host", "127.0.0.1", "--port", "$($Ports.Frontend)") `
    -StdOutPath (Join-Path $LOG_DIR "vite.out.log") `
    -StdErrPath (Join-Path $LOG_DIR "vite.err.log") `
    -WorkingDirectory $ROOT

$proxy = Start-LoggedProcess `
    -Name "proxy" `
    -FilePath $DENO `
    -ArgumentList @("run", "--allow-all", (Join-Path $ROOT "supabase\functions\proxy.ts")) `
    -StdOutPath (Join-Path $LOG_DIR "proxy.out.log") `
    -StdErrPath (Join-Path $LOG_DIR "proxy.err.log") `
    -WorkingDirectory $ROOT

$authLogin = Start-LoggedProcess `
    -Name "auth-login" `
    -FilePath "powershell" `
    -ArgumentList @("-NoProfile", "-Command", "`$env:PORT='$($Ports.AuthLogin)'; & '$DENO' run --allow-all '$ROOT\supabase\functions\auth-login\index.ts'") `
    -StdOutPath (Join-Path $LOG_DIR "auth-login.out.log") `
    -StdErrPath (Join-Path $LOG_DIR "auth-login.err.log") `
    -WorkingDirectory $ROOT

$authLogout = Start-LoggedProcess `
    -Name "auth-logout" `
    -FilePath "powershell" `
    -ArgumentList @("-NoProfile", "-Command", "`$env:PORT='$($Ports.AuthLogout)'; & '$DENO' run --allow-all '$ROOT\supabase\functions\auth-logout\index.ts'") `
    -StdOutPath (Join-Path $LOG_DIR "auth-logout.out.log") `
    -StdErrPath (Join-Path $LOG_DIR "auth-logout.err.log") `
    -WorkingDirectory $ROOT

$sessionManager = Start-LoggedProcess `
    -Name "session-manager" `
    -FilePath "powershell" `
    -ArgumentList @("-NoProfile", "-Command", "`$env:PORT='$($Ports.SessionManager)'; & '$DENO' run --allow-all '$ROOT\supabase\functions\session-manager\index.ts'") `
    -StdOutPath (Join-Path $LOG_DIR "session-manager.out.log") `
    -StdErrPath (Join-Path $LOG_DIR "session-manager.err.log") `
    -WorkingDirectory $ROOT

$authValidate = Start-LoggedProcess `
    -Name "auth-validate-session" `
    -FilePath "powershell" `
    -ArgumentList @("-NoProfile", "-Command", "`$env:PORT='$($Ports.AuthValidateSession)'; & '$DENO' run --allow-all '$ROOT\supabase\functions\auth-validate-session\index.ts'") `
    -StdOutPath (Join-Path $LOG_DIR "auth-validate-session.out.log") `
    -StdErrPath (Join-Path $LOG_DIR "auth-validate-session.err.log") `
    -WorkingDirectory $ROOT

Start-Sleep -Seconds 5

Write-Host ""
Write-Host "Local auth stack started." -ForegroundColor Green
Write-Host "  Frontend    -> http://localhost:$($Ports.Frontend)"
Write-Host "  Proxy       -> http://localhost:$($Ports.Proxy)"
Write-Host "  auth-login  -> http://localhost:$($Ports.AuthLogin)"
Write-Host "  auth-logout -> http://localhost:$($Ports.AuthLogout)"
Write-Host "  session-manager -> http://localhost:$($Ports.SessionManager)"
Write-Host "  auth-validate-session -> http://localhost:$($Ports.AuthValidateSession)"
Write-Host ""
Write-Host "Logs:" -ForegroundColor Cyan
Write-Host "  $(Join-Path $LOG_DIR 'vite.out.log')"
Write-Host "  $(Join-Path $LOG_DIR 'auth-login.out.log')"
Write-Host "  $(Join-Path $LOG_DIR 'auth-logout.out.log')"
Write-Host "  $(Join-Path $LOG_DIR 'session-manager.out.log')"
Write-Host "  $(Join-Path $LOG_DIR 'auth-validate-session.out.log')"
Write-Host "  $(Join-Path $LOG_DIR 'proxy.out.log')"
