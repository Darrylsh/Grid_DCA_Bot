<#
.SYNOPSIS
Setup and test GitHub token for Algobot auto-updater publishing.

.DESCRIPTION
This script helps configure the GH_TOKEN environment variable needed for 
publishing new releases with electron-builder. It also tests GitHub API access.

.PARAMETER Token
The GitHub Personal Access Token (optional). If not provided, will use existing env var.

.EXAMPLE
.\setup-github-token.ps1 -Token "ghp_your_token_here"

.EXAMPLE
.\setup-github-token.ps1  # Tests existing token
#>

param(
    [string]$Token
)

Write-Host "=== Algobot GitHub Token Setup ===" -ForegroundColor Cyan
Write-Host ""

# Set token if provided
if ($Token) {
    Write-Host "Setting GH_TOKEN environment variable for current session..." -ForegroundColor Yellow
    $env:GH_TOKEN = $Token
    Write-Host "✅ Token set: $($Token.Substring(0, [Math]::Min(8, $Token.Length)))..." -ForegroundColor Green
} else {
    Write-Host "Using existing GH_TOKEN environment variable (if set)..." -ForegroundColor Yellow
}

# Check if token is set in process environment
if (-not $env:GH_TOKEN) {
    # Try to get from system environment variables
    $systemToken = [System.Environment]::GetEnvironmentVariable('GH_TOKEN', 'Machine')
    if ($systemToken) {
        Write-Host "Found GH_TOKEN in system environment variables..." -ForegroundColor Yellow
        $env:GH_TOKEN = $systemToken
    } else {
        # Also check user environment
        $userToken = [System.Environment]::GetEnvironmentVariable('GH_TOKEN', 'User')
        if ($userToken) {
            Write-Host "Found GH_TOKEN in user environment variables..." -ForegroundColor Yellow
            $env:GH_TOKEN = $userToken
        }
    }
}

# Final check after trying system/user environment
if (-not $env:GH_TOKEN) {
    Write-Host "❌ GH_TOKEN is not set!" -ForegroundColor Red
    Write-Host ""
    Write-Host "To set it:" -ForegroundColor Yellow
    Write-Host "1. Generate token at: https://github.com/settings/tokens" -ForegroundColor White
    Write-Host "   - Required scope: 'repo' (full control of private repositories)" -ForegroundColor White
    Write-Host "2. Run this script with token: .\setup-github-token.ps1 -Token 'ghp_...'" -ForegroundColor White
    Write-Host "3. Or set manually: `$env:GH_TOKEN='ghp_...'" -ForegroundColor White
    Write-Host ""
    exit 1
}

# Show token preview
$tokenPreview = $env:GH_TOKEN.Substring(0, [Math]::Min(8, $env:GH_TOKEN.Length))
Write-Host "Token preview: ${tokenPreview}..." -ForegroundColor Gray
Write-Host ""

# Test GitHub API
Write-Host "Testing GitHub API access..." -ForegroundColor Yellow
$headers = @{
    'Authorization' = "token $env:GH_TOKEN"
    'Accept' = 'application/vnd.github.v3+json'
}

try {
    # Test user authentication
    $userResponse = Invoke-RestMethod -Uri 'https://api.github.com/user' -Headers $headers
    Write-Host "✅ Authentication successful!" -ForegroundColor Green
    Write-Host "   User: $($userResponse.login)" -ForegroundColor White
    Write-Host "   Name: $($userResponse.name)" -ForegroundColor White
    
    # Test repository access
    $repoResponse = Invoke-RestMethod -Uri 'https://api.github.com/repos/Darrylsh/Grid_DCA_Bot' -Headers $headers
    Write-Host "✅ Repository access verified!" -ForegroundColor Green
    Write-Host "   Repository: $($repoResponse.full_name)" -ForegroundColor White
    Write-Host "   Visibility: $($repoResponse.visibility)" -ForegroundColor White
    Write-Host "   Private: $($repoResponse.private)" -ForegroundColor White
    
    # Check token scopes
    $scopeResponse = Invoke-WebRequest -Uri 'https://api.github.com/user' -Headers $headers -Method Head
    $scopes = $scopeResponse.Headers['X-OAuth-Scopes']
    if ($scopes -like '*repo*') {
        Write-Host "✅ Token has 'repo' scope (required for publishing)" -ForegroundColor Green
    } else {
        Write-Host "⚠️  Token missing 'repo' scope. Required for publishing releases." -ForegroundColor Yellow
        Write-Host "   Current scopes: $scopes" -ForegroundColor White
    }
    
} catch {
    Write-Host "❌ GitHub API error: $($_.Exception.Message)" -ForegroundColor Red
    if ($_.Exception.Response) {
        $statusCode = $_.Exception.Response.StatusCode.value__
        Write-Host "   Status code: $statusCode" -ForegroundColor White
        
        if ($statusCode -eq 401) {
            Write-Host "   Token is invalid or expired" -ForegroundColor Red
        } elseif ($statusCode -eq 403) {
            Write-Host "   Token lacks required permissions or rate limit exceeded" -ForegroundColor Red
        } elseif ($statusCode -eq 404) {
            Write-Host "   Repository not found or inaccessible" -ForegroundColor Red
        }
    }
    exit 1
}

Write-Host ""
Write-Host "=== Publishing Test ===" -ForegroundColor Cyan

# Test electron-builder configuration
Write-Host "Checking electron-builder configuration..." -ForegroundColor Yellow
if (Test-Path "electron-builder.yml") {
    $config = Get-Content "electron-builder.yml" -Raw
    if ($config -match 'provider:\s+github') {
        Write-Host "✅ electron-builder configured for GitHub publishing" -ForegroundColor Green
    } else {
        Write-Host "⚠️  electron-builder not configured for GitHub" -ForegroundColor Yellow
    }
} else {
    Write-Host "❌ electron-builder.yml not found" -ForegroundColor Red
}

Write-Host ""
Write-Host "=== Next Steps ===" -ForegroundColor Cyan
Write-Host "1. To publish a new release:" -ForegroundColor White
Write-Host "   npm run version:ui:minor  # Bump version" -ForegroundColor Gray
Write-Host "   npm run publish:win       # Build and publish" -ForegroundColor Gray
Write-Host ""
Write-Host "2. For permanent token storage (optional):" -ForegroundColor White
Write-Host "   [System.Environment]::SetEnvironmentVariable('GH_TOKEN', 'your_token', [System.EnvironmentVariableTarget]::User)" -ForegroundColor Gray
Write-Host "   # Restart PowerShell after running this" -ForegroundColor Gray
Write-Host ""
Write-Host "3. Current token is set for this session only." -ForegroundColor Yellow
Write-Host "   Run this script again in new PowerShell sessions or set permanently." -ForegroundColor Yellow

Write-Host ""
Write-Host "✅ Setup complete!" -ForegroundColor Green