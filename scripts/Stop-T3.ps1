param([Parameter(Mandatory=$true)][string]$StateFile)
$ErrorActionPreference = 'Stop'
$taskState = Get-Content -LiteralPath $StateFile -Raw | ConvertFrom-Json
$taskProcessId = [int]$taskState.pid
$taskProcess = Get-CimInstance Win32_Process -Filter "ProcessId = $taskProcessId"
if (-not $taskProcess) {
    Write-Output 'T3 is already stopped.'
    exit 0
}
if (-not [string]::Equals($taskProcess.ExecutablePath, $taskState.executable, [StringComparison]::OrdinalIgnoreCase) -or
    -not $taskProcess.CommandLine.Contains($taskState.baseDir)) {
    throw 'Process identity differs from this local T3 installation; refusing to stop it.'
}
& "$env:WINDIR/System32/taskkill.exe" /PID $taskProcessId /T /F | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'Could not stop the verified local T3 process tree.' }
Wait-Process -Id $taskProcessId -Timeout 10 -ErrorAction SilentlyContinue
Write-Output 'Local T3 stopped. Its project data is preserved.'
