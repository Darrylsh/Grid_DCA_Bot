# Test token from .env file
Write-Host "Loading token from .env file..." -ForegroundColor Yellow

# Read .env file
$envContent = Get-Content -Path "$PSScriptRoot\..\.env" -ErrorAction Stop

# Extract GH_TOKEN
$tokenLine = $envContent | Where-Object { $_ -match '^GH_TOKEN=' }
if (-not $tokenLine) {
    Write-Host "❌ GH_TOKEN not found in .env file" -ForegroundColor Red
    exit 1
}

$token = $tokenLine.Split('=', 2)[1].Trim()
Write-Host "Token extracted (first 8 chars): $($token.Substring(0, [Math]::Min(8, $token.Length)))..." -ForegroundColor Green

# Set environment variable for this session
$env:GH_TOKEN = $token
Write-Host "✅ GH_TOKEN environment variable set for current session" -ForegroundColor Green

# Now run the existing setup script
Write-Host ""
Write-Host "Running setup script..." -ForegroundColor Cyan
& "$PSScriptRoot\setup-github-token.ps1"