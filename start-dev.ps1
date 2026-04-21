# WMS Dev Startup Script - Starts all servers natively (no Docker)
$DENO = "C:\Users\shash\.deno\bin\deno.exe"
$ROOT = Split-Path -Parent $MyInvocation.MyCommand.Path

# Load env vars from supabase/.env.local
$envFile = Join-Path $ROOT "supabase\.env.local"
if (Test-Path $envFile) {
    Get-Content $envFile | ForEach-Object {
        if ($_ -match "^\s*([^#=][^=]*)=(.*)$") {
            $n = $matches[1].Trim().Trim('"')
            $v = $matches[2].Trim().Trim('"')
            [System.Environment]::SetEnvironmentVariable($n, $v, "Process")
            Write-Host "  Loaded: $n" -ForegroundColor DarkGray
        }
    }
    Write-Host "OK: Env vars loaded from supabase/.env.local" -ForegroundColor Green
}

# Load VITE env vars from .env
$viteEnvFile = Join-Path $ROOT ".env"
if (Test-Path $viteEnvFile) {
    Get-Content $viteEnvFile | ForEach-Object {
        if ($_ -match "^\s*([^#=][^=]*)=(.*)$") {
            $n = $matches[1].Trim().Trim('"')
            $v = $matches[2].Trim().Trim('"')
            [System.Environment]::SetEnvironmentVariable($n, $v, "Process")
        }
    }
    Write-Host "OK: Vite env vars loaded from .env" -ForegroundColor Green
}

$SB_URL        = [System.Environment]::GetEnvironmentVariable("SUPABASE_URL", "Process")
$SB_SRK        = [System.Environment]::GetEnvironmentVariable("SUPABASE_SERVICE_ROLE_KEY", "Process")
$SB_JWT        = [System.Environment]::GetEnvironmentVariable("SUPABASE_JWT_SECRET", "Process")
$SB_ANON       = [System.Environment]::GetEnvironmentVariable("VITE_SUPABASE_ANON_KEY", "Process")

if ($SB_ANON) {
    [System.Environment]::SetEnvironmentVariable("SUPABASE_ANON_KEY", $SB_ANON, "Process")
}

Write-Host ""
Write-Host "==========================================" -ForegroundColor Cyan
Write-Host " WMS Dev Stack -- Native Deno (No Docker)" -ForegroundColor Cyan
Write-Host "==========================================" -ForegroundColor Cyan

# 1. Frontend Vite
Write-Host "Starting Frontend (Vite) on http://localhost:5173" -ForegroundColor Blue
Start-Process powershell -ArgumentList "-NoExit -Command `"cd '$ROOT'; npm run dev`"" -WindowStyle Normal
Start-Sleep -Seconds 1

# 2. auth-login :8001
Write-Host "Starting auth-login on http://localhost:8001" -ForegroundColor Magenta
Start-Process powershell -ArgumentList "-NoExit -Command `"`$env:PORT='8001'; & '$DENO' run --allow-all '$ROOT\supabase\functions\auth-login\index.ts'`"" -WindowStyle Normal
Start-Sleep -Seconds 1

# 3. auth-logout :8002
Write-Host "Starting auth-logout on http://localhost:8002" -ForegroundColor Magenta
Start-Process powershell -ArgumentList "-NoExit -Command `"`$env:PORT='8002'; & '$DENO' run --allow-all '$ROOT\supabase\functions\auth-logout\index.ts'`"" -WindowStyle Normal
Start-Sleep -Seconds 1

# 4. make-server :8003
Write-Host "Starting make-server on http://localhost:8003" -ForegroundColor Magenta
Start-Process powershell -ArgumentList "-NoExit -Command `"`$env:PORT='8003'; & '$DENO' run --allow-all '$ROOT\supabase\functions\make-server-9c637d11\index.ts'`"" -WindowStyle Normal

# 5. auth-validate-session :8004
Write-Host "Starting auth-validate-session on http://localhost:8004" -ForegroundColor Magenta
Start-Process powershell -ArgumentList "-NoExit -Command `"`$env:PORT='8004'; & '$DENO' run --allow-all '$ROOT\supabase\functions\auth-validate-session\index.ts'`"" -WindowStyle Normal

# 6. session-manager :8005
Write-Host "Starting session-manager on http://localhost:8005" -ForegroundColor Magenta
Start-Process powershell -ArgumentList "-NoExit -Command `"`$env:PORT='8005'; & '$DENO' run --allow-all '$ROOT\supabase\functions\session-manager\index.ts'`"" -WindowStyle Normal

# 7. Local Native Proxy :54321
Write-Host "Starting Proxy on http://localhost:54321" -ForegroundColor Cyan
Start-Process powershell -ArgumentList "-NoExit -Command `"& '$DENO' run --allow-all '$ROOT\supabase\functions\proxy.ts'`"" -WindowStyle Normal

Write-Host ""
Write-Host "All servers launched!" -ForegroundColor Green
Write-Host "  Frontend    -> http://localhost:5173"
Write-Host "  Proxy       -> http://localhost:54321"
Write-Host "  auth-login  -> http://localhost:8001"
Write-Host "  auth-logout -> http://localhost:8002"
Write-Host "  make-server -> http://localhost:8003"
Write-Host "  auth-validate-session -> http://localhost:8004"
Write-Host "  session-manager -> http://localhost:8005"
