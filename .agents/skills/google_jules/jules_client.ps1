<#
.SYNOPSIS
Google Jules API PowerShell Client for Antigravity IDE
#>

param(
    [Parameter(Position=0)]
    [string]$Action = "status",

    [Parameter(Position=1)]
    [string]$Arg1,

    [Parameter(Position=2)]
    [string]$Arg2,

    [Parameter(Position=3)]
    [string]$Arg3,

    [Parameter(Position=4)]
    [string]$Arg4
)

function Get-JulesApiKey {
    $envFile = Join-Path $PSScriptRoot ".env"
    if (Test-Path $envFile) {
        Get-Content $envFile | ForEach-Object {
            if ($_ -match '^JULES_API_KEY=(.*)$') {
                return $matches[1].Trim()
            }
        }
    }
    return $env:JULES_API_KEY
}

$apiKey = Get-JulesApiKey
if (-not $apiKey) {
    Write-Error "❌ Error: Jules API Key not found in .env or environment variable."
    exit 1
}

$headers = @{
    "X-Goog-Api-Key" = $apiKey
    "Content-Type"   = "application/json"
}

$baseUrl = "https://jules.googleapis.com/v1alpha"

switch ($Action.ToLower()) {
    "status" {
        Write-Host "🤖 Google Jules Client Status" -ForegroundColor Cyan
        Write-Host "🔑 API Key Prefix: $($apiKey.Substring(0, 8))..." -ForegroundColor Green
        try {
            $sources = Invoke-RestMethod -Uri "$baseUrl/sources?key=$apiKey" -Headers $headers -Method Get
            Write-Host "📦 Connected Sources:" -ForegroundColor Yellow
            $sources | ConvertTo-Json -Depth 4 | Write-Host
            
            $sessions = Invoke-RestMethod -Uri "$baseUrl/sessions?key=$apiKey" -Headers $headers -Method Get
            Write-Host "📋 Active Sessions:" -ForegroundColor Yellow
            $sessions | ConvertTo-Json -Depth 4 | Write-Host
        } catch {
            Write-Error "Failed to query Jules API: $($_.Exception.Message)"
        }
    }
    "sources" {
        $sources = Invoke-RestMethod -Uri "$baseUrl/sources?key=$apiKey" -Headers $headers -Method Get
        $sources | ConvertTo-Json -Depth 4 | Write-Host
    }
    "sessions" {
        $sessions = Invoke-RestMethod -Uri "$baseUrl/sessions?key=$apiKey" -Headers $headers -Method Get
        $sessions | ConvertTo-Json -Depth 4 | Write-Host
    }
    "get" {
        if (-not $Arg1) {
            Write-Error "Usage: .\jules_client.ps1 get <sessionId>"
            exit 1
        }
        $session = Invoke-RestMethod -Uri "$baseUrl/sessions/$Arg1?key=$apiKey" -Headers $headers -Method Get
        $session | ConvertTo-Json -Depth 4 | Write-Host
    }
    "create" {
        $source = $Arg1
        $branch = if ($Arg2) { $Arg2 } else { "main" }
        $prompt = $Arg3
        $title  = if ($Arg4) { $Arg4 } else { $prompt.Substring(0, [Math]::Min(50, $prompt.Length)) }

        if (-not $source -or -not $prompt) {
            Write-Error "Usage: .\jules_client.ps1 create <source> <branch> <prompt> [title]"
            exit 1
        }

        $body = @{
            prompt = $prompt
            title  = $title
            sourceContext = @{
                source = $source
                githubRepoContext = @{
                    startingBranch = $branch
                }
            }
        } | ConvertTo-Json -Depth 5

        $res = Invoke-RestMethod -Uri "$baseUrl/sessions?key=$apiKey" -Headers $headers -Method Post -Body $body
        Write-Host "🚀 Jules Cloud Session Created:" -ForegroundColor Green
        $res | ConvertTo-Json -Depth 4 | Write-Host
    }
    default {
        Write-Host "Available actions: status, sources, sessions, get <id>, create <source> <branch> <prompt> [title]"
    }
}
