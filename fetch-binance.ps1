param(
    [string]$Symbol = "SOLUSDT",
    [string]$YearMonth = "2026-02",
    [string]$Type = "aggTrades" # Or 'klines'
)

$baseUrl = "https://data.binance.vision/data/spot/monthly/$Type/$Symbol"
$fileName = "$Symbol-$Type-$YearMonth.zip"
$csvName = "$Symbol-$Type-$YearMonth.csv"
$url = "$baseUrl/$fileName"

Write-Host "=========================================" -ForegroundColor Cyan
Write-Host "Downloading $Type for $Symbol ($YearMonth)" -ForegroundColor Cyan
Write-Host "URL: $url"
Write-Host "=========================================" -ForegroundColor Cyan

try {
    Invoke-WebRequest -Uri $url -OutFile $fileName
} catch {
    Write-Host "Failed to download! Ensure you are using uppercase valid pairs (e.g. SOLUSDT) and that Binance has officially published the $YearMonth zip yet." -ForegroundColor Red
    exit 1
}

Write-Host "Download complete. Extracting $fileName ..."
Expand-Archive -Path $fileName -DestinationPath ".\" -Force

Remove-Item $fileName
Write-Host "Success! Created: $csvName" -ForegroundColor Green
