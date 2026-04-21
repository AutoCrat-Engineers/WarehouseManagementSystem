$ErrorActionPreference = "Stop"

$ROOT = Split-Path -Parent $MyInvocation.MyCommand.Path
$checks = @(
    @{ Name = "frontend"; Url = "http://127.0.0.1:5173"; Method = "GET" },
    @{ Name = "proxy-auth-login"; Url = "http://127.0.0.1:54321/functions/v1/auth-login"; Method = "OPTIONS" },
    @{ Name = "proxy-auth-logout"; Url = "http://127.0.0.1:54321/functions/v1/auth-logout"; Method = "OPTIONS" },
    @{ Name = "proxy-session-manager"; Url = "http://127.0.0.1:54321/functions/v1/session-manager/create"; Method = "OPTIONS" },
    @{ Name = "proxy-auth-validate-session"; Url = "http://127.0.0.1:54321/functions/v1/auth-validate-session"; Method = "OPTIONS" }
)

Write-Host "Verifying local auth stack..." -ForegroundColor Cyan

foreach ($check in $checks) {
    try {
        $response = Invoke-WebRequest -UseBasicParsing -Method $check.Method -Uri $check.Url -TimeoutSec 10
        Write-Host ("OK  {0} -> {1}" -f $check.Name, $response.StatusCode) -ForegroundColor Green
    } catch {
        Write-Host ("FAIL {0} -> {1}" -f $check.Name, $_.Exception.Message) -ForegroundColor Red
        exit 1
    }
}

Write-Host ""
Write-Host "Recent auth logs:" -ForegroundColor Cyan
$logFiles = @(
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
    $path = Join-Path $ROOT ("run-logs\" + $file)
    if (Test-Path $path) {
        Write-Host ""
        Write-Host ("[{0}]" -f $file) -ForegroundColor Yellow
        Get-Content -Path $path | Select-Object -Last 10
    }
}
