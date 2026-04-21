# WMS — Supabase Edge Functions Deployment Script
# Run this from the project root: .\deploy.ps1
#
# Prerequisites:
#   1. Install Supabase CLI: npm install -g supabase
#   2. Login: supabase login
#   3. Link project (first time only): supabase link --project-ref sugvmurszfcneaeyoagv

$PROJECT_REF = "sugvmurszfcneaeyoagv"
$ROOT = Split-Path -Parent $MyInvocation.MyCommand.Path

function Merge-EnvFile {
    param(
        [string]$Path,
        [hashtable]$Target
    )

    if (-not (Test-Path $Path)) {
        return
    }

    Get-Content $Path | ForEach-Object {
        if ($_ -match "^\s*([^#=][^=]*)=(.*)$") {
            $name = $matches[1].Trim().Trim('"')
            $value = $matches[2].Trim().Trim('"')
            $Target[$name] = $value
        }
    }
}

function Set-SupabaseSecret {
    param(
        [string]$Name,
        [string]$Value
    )

    if (-not $Value) {
        Write-Host "  Skipping empty secret: $Name" -ForegroundColor Yellow
        return
    }

    Write-Host "  Setting secret: $Name" -ForegroundColor DarkGray
    $Value | supabase secrets set $Name --project-ref $PROJECT_REF
    if ($LASTEXITCODE -ne 0) {
        throw "Failed to set secret: $Name"
    }
}

Write-Host ""
Write-Host "=============================================" -ForegroundColor Cyan
Write-Host " WMS — Supabase Edge Functions Deployment" -ForegroundColor Cyan
Write-Host "=============================================" -ForegroundColor Cyan
Write-Host ""

# Step 1: Verify Supabase CLI is installed
if (-not (Get-Command supabase -ErrorAction SilentlyContinue)) {
    Write-Host "ERROR: Supabase CLI not found. Run: npm install -g supabase" -ForegroundColor Red
    exit 1
}
Write-Host "OK: Supabase CLI found" -ForegroundColor Green

# Step 2: Push database migrations
Write-Host ""
Write-Host "Pushing database migrations..." -ForegroundColor Magenta
Set-Location $ROOT
supabase db push
if ($LASTEXITCODE -ne 0) {
    Write-Host "FAILED: database migration push failed" -ForegroundColor Red
    exit 1
}
Write-Host "OK: Database migrations pushed" -ForegroundColor Green

# Step 3: Deploy auth-login
Write-Host ""
Write-Host "Deploying auth-login..." -ForegroundColor Magenta
supabase functions deploy auth-login --project-ref $PROJECT_REF
if ($LASTEXITCODE -ne 0) {
    Write-Host "FAILED: auth-login deployment failed" -ForegroundColor Red
    exit 1
}
Write-Host "OK: auth-login deployed" -ForegroundColor Green

# Step 4: Deploy auth-logout
Write-Host ""
Write-Host "Deploying auth-logout..." -ForegroundColor Magenta
supabase functions deploy auth-logout --project-ref $PROJECT_REF
if ($LASTEXITCODE -ne 0) {
    Write-Host "FAILED: auth-logout deployment failed" -ForegroundColor Red
    exit 1
}
Write-Host "OK: auth-logout deployed" -ForegroundColor Green

# Step 5: Deploy auth-validate-session
Write-Host ""
Write-Host "Deploying auth-validate-session..." -ForegroundColor Magenta
supabase functions deploy auth-validate-session --project-ref $PROJECT_REF
if ($LASTEXITCODE -ne 0) {
    Write-Host "FAILED: auth-validate-session deployment failed" -ForegroundColor Red
    exit 1
}
Write-Host "OK: auth-validate-session deployed" -ForegroundColor Green

# Step 6: Deploy session-manager
Write-Host ""
Write-Host "Deploying session-manager..." -ForegroundColor Magenta
supabase functions deploy session-manager --project-ref $PROJECT_REF
if ($LASTEXITCODE -ne 0) {
    Write-Host "FAILED: session-manager deployment failed" -ForegroundColor Red
    exit 1
}
Write-Host "OK: session-manager deployed" -ForegroundColor Green

# Step 7: Set environment secrets on Supabase
Write-Host ""
Write-Host "Setting environment secrets..." -ForegroundColor Magenta

try {
    $secretValues = @{}
    Merge-EnvFile -Path (Join-Path $ROOT "supabase\.env.local") -Target $secretValues
    Merge-EnvFile -Path (Join-Path $ROOT ".env.production") -Target $secretValues
    Merge-EnvFile -Path (Join-Path $ROOT ".env") -Target $secretValues

    if (-not $secretValues.ContainsKey("SUPABASE_ANON_KEY") -and $secretValues.ContainsKey("VITE_SUPABASE_ANON_KEY")) {
        $secretValues["SUPABASE_ANON_KEY"] = $secretValues["VITE_SUPABASE_ANON_KEY"]
    }

    Set-SupabaseSecret -Name "SUPABASE_URL" -Value $secretValues["SUPABASE_URL"]
    Set-SupabaseSecret -Name "SUPABASE_ANON_KEY" -Value $secretValues["SUPABASE_ANON_KEY"]
    Set-SupabaseSecret -Name "SUPABASE_SERVICE_ROLE_KEY" -Value $secretValues["SUPABASE_SERVICE_ROLE_KEY"]
    Set-SupabaseSecret -Name "SUPABASE_JWT_SECRET" -Value $secretValues["SUPABASE_JWT_SECRET"]
    Write-Host "OK: Secrets set" -ForegroundColor Green
} catch {
    Write-Host "WARNING: Secrets were not fully set. Configure them manually in Supabase Dashboard if needed." -ForegroundColor Yellow
    Write-Host "  $($_.Exception.Message)" -ForegroundColor Yellow
}

# Step 8: Build frontend for production
Write-Host ""
Write-Host "Building frontend..." -ForegroundColor Blue
Set-Location $ROOT
npm run build
if ($LASTEXITCODE -ne 0) {
    Write-Host "FAILED: Frontend build failed" -ForegroundColor Red
    exit 1
}
Write-Host "OK: Frontend built to ./build" -ForegroundColor Green

Write-Host ""
Write-Host "=============================================" -ForegroundColor Green
Write-Host " DEPLOYMENT COMPLETE" -ForegroundColor Green
Write-Host "=============================================" -ForegroundColor Green
Write-Host ""
Write-Host " Edge Functions live at:"
Write-Host "   auth-login  -> https://$PROJECT_REF.supabase.co/functions/v1/auth-login"
Write-Host "   auth-logout -> https://$PROJECT_REF.supabase.co/functions/v1/auth-logout"
Write-Host "   auth-validate-session -> https://$PROJECT_REF.supabase.co/functions/v1/auth-validate-session"
Write-Host "   session-manager -> https://$PROJECT_REF.supabase.co/functions/v1/session-manager"
Write-Host ""
Write-Host " Next step: Upload the ./build folder to your hosting provider"
Write-Host "   (Vercel, Netlify, Azure Static Web Apps, etc.)"
Write-Host ""
