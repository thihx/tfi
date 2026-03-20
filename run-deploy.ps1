Set-Location c:\tfi
Write-Output "=== GIT STATUS ==="
git status --short
Write-Output ""
Write-Output "=== GIT LOG ==="
git log --oneline -5
Write-Output ""
Write-Output "=== DONE ==="
