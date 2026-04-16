<#
.SYNOPSIS
Publish Algobot release to GitHub using system GH_TOKEN.

.DESCRIPTION
This script ensures GH_TOKEN is set from system environment variables
before running electron-builder publish. It also validates the token
and provides feedback on the publishing process.

.PARAMETER Platform
Target platform: 'win', 'mac', or 'linux'. Default is 'win'.

.EXAMPLE
.\publish-with-token.ps1 -Platform win

.EXAMPLE
.\publish-with-token.ps1 -Platform mac
#>

param(
    [string]$Platform = 'win'
)

Write-Host "=== Algobot Publishing Script ===" -ForegroundColor Cyan
Write-Host ""

# Get GH_TOKEN from system environment
$token = [System.Environment]::GetEnvironmentVariable('GH_TOKEN', 'Machine')
if (-not $token) {
    $token = [System.Environment]::GetEnvironmentVariable('GH_TOKEN', 'User')
}
if (-not $token) {
    Write-Host "❌ GH_TOKEN not found in system or user environment variables!" -ForegroundColor Red
    Write-Host ""
    Write-Host "To set it permanently:" -ForegroundColor Yellow
    Write-Host "1. Generate token at: https://github.com/settings/tokens" -ForegroundColor White
    Write-Host "   - Required scope: 'repo' (full control of private repositories)" -ForegroundColor White
    Write-Host "2. Set system environment variable:" -ForegroundColor White
    Write-Host "   [System.Environment]::SetEnvironmentVariable('GH_TOKEN', 'ghp_...', [System.EnvironmentVariableTarget]::Machine)" -ForegroundColor Gray
    Write-Host "3. Restart PowerShell/terminal after setting" -ForegroundColor White
    exit 1
}

Write-Host "✅ GH_TOKEN found (first 8 chars): $($token.Substring(0, [Math]::Min(8, $token.Length)))..." -ForegroundColor Green

# Set for current process
$env:GH_TOKEN = $token
Write-Host "✅ GH_TOKEN set for current process" -ForegroundColor Green

# Validate token with GitHub API
Write-Host ""
Write-Host "Validating GitHub token..." -ForegroundColor Yellow
$headers = @{
    'Authorization' = "token $token"
    'Accept' = 'application/vnd.github.v3+json'
}

try {
    $userResponse = Invoke-RestMethod -Uri 'https://api.github.com/user' -Headers $headers
    Write-Host "✅ Authentication successful: $($userResponse.login)" -ForegroundColor Green
    
    $repoResponse = Invoke-RestMethod -Uri 'https://api.github.com/repos/Darrylsh/Grid_DCA_Bot' -Headers $headers
    Write-Host "✅ Repository access verified: $($repoResponse.full_name)" -ForegroundColor Green
    
    if ($repoResponse.private -eq $true) {
        Write-Host "⚠️  Repository is private - token requires 'repo' scope" -ForegroundColor Yellow
    }
} catch {
    Write-Host "❌ GitHub API error: $($_.Exception.Message)" -ForegroundColor Red
    if ($_.Exception.Response.StatusCode -eq 401) {
        Write-Host "   Token is invalid or expired" -ForegroundColor Red
    }
    exit 1
}

# Determine publish command
$publishCmd = "npx electron-builder --$Platform --publish always"
Write-Host ""
Write-Host "Publishing command: $publishCmd" -ForegroundColor Cyan
Write-Host ""

# Run npm build first
Write-Host "Running build step..." -ForegroundColor Yellow
npm run build
if ($LASTEXITCODE -ne 0) {
    Write-Host "❌ Build failed!" -ForegroundColor Red
    exit $LASTEXITCODE
}

Write-Host "✅ Build completed successfully" -ForegroundColor Green
Write-Host ""

# Run electron-builder publish
Write-Host "Starting publish process..." -ForegroundColor Yellow
Write-Host "This may take several minutes..." -ForegroundColor Gray

Invoke-Expression $publishCmd
if ($LASTEXITCODE -ne 0) {
    Write-Host "❌ Publish failed with exit code: $LASTEXITCODE" -ForegroundColor Red
    exit $LASTEXITCODE
}

Write-Host ""
Write-Host "✅ Publish completed successfully!" -ForegroundColor Green
Write-Host "Check GitHub Releases: https://github.com/Darrylsh/Grid_DCA_Bot/releases" -ForegroundColor Cyan