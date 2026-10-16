param([Parameter(Mandatory=$true)][string]$StateFile)
$ErrorActionPreference = 'Stop'
$taskState = Get-Content -LiteralPath $StateFile -Raw | ConvertFrom-Json
$taskProcessId = [int]$taskState.pid
$taskProcess = Get-CimInstance Win32_Process -Filter "ProcessId = $taskProcessId"
if (-not $taskProcess) { exit 0 }
if (-not [string]::Equals($taskProcess.ExecutablePath, $taskState.executable, [StringComparison]::OrdinalIgnoreCase) -or
    -not $taskProcess.CommandLine.Contains($taskState.entry)) {
    throw 'The process does not match this Quota Burn installation.'
}
& "$env:WINDIR/System32/taskkill.exe" /PID $taskProcessId /T /F | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'Could not stop the verified process.' }
