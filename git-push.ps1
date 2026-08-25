<#
  git-push.ps1 - one-click commit & push to GitHub (RockPaperScissors)

  Usage:
    .\git-push.ps1                        # commit all changes and push
    .\git-push.ps1 -CommitMsg "msg"       # with custom commit message
    .\git-push.ps1 -OnlyStatus            # just show status, no commit
    .\git-push.ps1 -PullFirst             # pull remote before push

  Notes:
    - Locates project dir via $PSScriptRoot (works with CJK paths).
    - Temp debug files (_*.mjs / _*.py ...) are ignored via .gitignore.
#>
[CmdletBinding()]
param(
    [string]$CommitMsg = '',
    [switch]$OnlyStatus,
    [switch]$PullFirst
)

$ErrorActionPreference = 'Continue'
$root = $PSScriptRoot
Set-Location -LiteralPath $root

Write-Host "Workdir: $root" -ForegroundColor Cyan

if (-not (Test-Path -LiteralPath (Join-Path $root '.git'))) {
    Write-Error "Not a git repo: $root"
    exit 1
}

$status = git status --short
if (-not $status) {
    Write-Host "Working tree clean. Nothing to push." -ForegroundColor Green
    exit 0
}
Write-Host "`nChanges to commit:" -ForegroundColor Yellow
Write-Host $status

if ($OnlyStatus) { exit 0 }

if ($PullFirst) {
    Write-Host "`nPulling remote..." -ForegroundColor Cyan
    git pull --rebase origin master
    if ($LASTEXITCODE -ne 0) { Write-Error "pull failed. Aborting."; exit 1 }
}

if (-not $CommitMsg) {
    $CommitMsg = "feat: auto-commit $(Get-Date -Format 'yyyy-MM-dd HH:mm')"
}
$subject = $CommitMsg -split "`n" | Select-Object -First 1
$body    = ($CommitMsg -split "`n" | Select-Object -Skip 1) -join "`n"

Write-Host "`nCommitting..." -ForegroundColor Cyan
git add -A
if ($body) {
    git commit -m $subject -m $body
} else {
    git commit -m $subject
}

if ($LASTEXITCODE -ne 0) {
    Write-Error "git commit failed."
    exit 1
}
$commitHash = git rev-parse --short HEAD
Write-Host "Committed: $commitHash $subject" -ForegroundColor Green

Write-Host "`nPushing to origin/master ..." -ForegroundColor Cyan
git push origin master
if ($LASTEXITCODE -ne 0) {
    Write-Error "push failed. Check network or GitHub credentials."
    exit 1
}

Write-Host "`nPush successful!" -ForegroundColor Green
git --no-pager log --oneline -3
