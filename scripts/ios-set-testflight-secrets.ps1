[CmdletBinding()]
param(
  [string]$Repo = "michaelhmiv/Sportfolio",
  [Parameter(Mandatory = $true)]
  [string]$P12Path,
  [Parameter(Mandatory = $true)]
  [string]$P12Password,
  [Parameter(Mandatory = $true)]
  [string]$MobileProvisionPath,
  [Parameter(Mandatory = $true)]
  [string]$AppStoreConnectP8Path,
  [Parameter(Mandatory = $true)]
  [string]$AppStoreConnectKeyId,
  [Parameter(Mandatory = $true)]
  [string]$AppStoreConnectIssuerId,
  [Parameter(Mandatory = $true)]
  [string]$KeychainPassword
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Resolve-ExistingPath([string]$PathValue) {
  $resolved = Resolve-Path -LiteralPath $PathValue -ErrorAction SilentlyContinue
  if ($resolved) {
    return $resolved.Path
  }
  return $null
}

function Assert-Command([string]$CommandName) {
  if (-not (Get-Command $CommandName -ErrorAction SilentlyContinue)) {
    throw "Missing required command '$CommandName'. Install it and try again."
  }
}

function Resolve-FilePathOrThrow([string]$PathValue) {
  $resolved = Resolve-ExistingPath -PathValue $PathValue
  if (-not $resolved) {
    throw "File not found: $PathValue"
  }
  return $resolved
}

function Get-FileBase64([string]$PathValue) {
  $bytes = [System.IO.File]::ReadAllBytes($PathValue)
  return [Convert]::ToBase64String($bytes)
}

function Set-RepoSecret([string]$Name, [string]$Value, [string]$TargetRepo) {
  gh secret set $Name --repo $TargetRepo --body $Value | Out-Null
  if ($LASTEXITCODE -ne 0) {
    throw "Failed to set secret $Name on $TargetRepo."
  }
  Write-Host "Set secret: $Name"
}

Assert-Command "gh"

$resolvedP12 = Resolve-FilePathOrThrow -PathValue $P12Path
$resolvedProfile = Resolve-FilePathOrThrow -PathValue $MobileProvisionPath
$resolvedP8 = Resolve-FilePathOrThrow -PathValue $AppStoreConnectP8Path

$p12Base64 = Get-FileBase64 -PathValue $resolvedP12
$profileBase64 = Get-FileBase64 -PathValue $resolvedProfile
$p8Base64 = Get-FileBase64 -PathValue $resolvedP8

Set-RepoSecret -Name "BUILD_CERTIFICATE_BASE64" -Value $p12Base64 -TargetRepo $Repo
Set-RepoSecret -Name "P12_PASSWORD" -Value $P12Password -TargetRepo $Repo
Set-RepoSecret -Name "BUILD_PROVISION_PROFILE_BASE64" -Value $profileBase64 -TargetRepo $Repo
Set-RepoSecret -Name "KEYCHAIN_PASSWORD" -Value $KeychainPassword -TargetRepo $Repo
Set-RepoSecret -Name "APP_STORE_CONNECT_KEY_ID" -Value $AppStoreConnectKeyId -TargetRepo $Repo
Set-RepoSecret -Name "APP_STORE_CONNECT_ISSUER_ID" -Value $AppStoreConnectIssuerId -TargetRepo $Repo
Set-RepoSecret -Name "APP_STORE_CONNECT_API_KEY_BASE64" -Value $p8Base64 -TargetRepo $Repo

Write-Host ""
Write-Host "All iOS TestFlight secrets are set on $Repo."
