[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [string]$EmailAddress,
  [string]$CommonName = "Sportfolio iOS Distribution",
  [ValidatePattern("^[A-Z]{2}$")]
  [string]$CountryCode = "US",
  [string]$OutputDir = "$env:USERPROFILE\apple-signing",
  [string]$CerPath,
  [string]$P12Password
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

function Invoke-Tool([string]$CommandName, [string[]]$Arguments) {
  & $CommandName @Arguments
  if ($LASTEXITCODE -ne 0) {
    throw "Command failed: $CommandName $($Arguments -join ' ')"
  }
}

function New-CertReqConfigFile(
  [string]$PathValue,
  [string]$SubjectValue
) {
  $content = @(
    "[Version]"
    "Signature=`"`$Windows NT`$`""
    ""
    "[NewRequest]"
    "Subject = `"$SubjectValue`""
    "KeyAlgorithm = RSA"
    "KeyLength = 2048"
    "HashAlgorithm = sha256"
    "Exportable = TRUE"
    "MachineKeySet = FALSE"
    "RequestType = PKCS10"
    "SMIME = FALSE"
    "PrivateKeyArchive = FALSE"
    "UserProtected = FALSE"
    "UseExistingKeySet = FALSE"
    "ProviderName = `"Microsoft Software Key Storage Provider`""
    "KeyUsage = 0xa0"
  )
  Set-Content -Path $PathValue -Value $content -Encoding ASCII
}

$resolvedOutputDir = Resolve-ExistingPath -PathValue $OutputDir
if (-not $resolvedOutputDir) {
  New-Item -ItemType Directory -Path $OutputDir -Force | Out-Null
  $resolvedOutputDir = Resolve-ExistingPath -PathValue $OutputDir
}

$privateKeyPath = Join-Path $resolvedOutputDir "ios_distribution.key"
$csrPath = Join-Path $resolvedOutputDir "ios_distribution.csr"
$certificatePemPath = Join-Path $resolvedOutputDir "ios_distribution.pem"
$certificateP12Path = Join-Path $resolvedOutputDir "ios_distribution.p12"
$certReqConfigPath = Join-Path $resolvedOutputDir "ios_distribution.inf"

$opensslCommand = Get-Command "openssl" -ErrorAction SilentlyContinue
$certreqCommand = Get-Command "certreq" -ErrorAction SilentlyContinue

if (-not $opensslCommand -and -not $certreqCommand) {
  throw "Could not find OpenSSL or certreq on this machine. Install OpenSSL or run from Windows with certreq available."
}

if ($opensslCommand) {
  if ((-not (Test-Path -LiteralPath $privateKeyPath)) -or (-not (Test-Path -LiteralPath $csrPath))) {
    $subject = "/emailAddress=$EmailAddress/CN=$CommonName/C=$CountryCode"
    Invoke-Tool -CommandName "openssl" -Arguments @(
      "req",
      "-new",
      "-newkey", "rsa:2048",
      "-nodes",
      "-keyout", $privateKeyPath,
      "-out", $csrPath,
      "-subj", $subject
    )
    Write-Host "Generated CSR via OpenSSL: $csrPath"
    Write-Host "Generated private key via OpenSSL: $privateKeyPath"
  } else {
    Write-Host "Reusing existing OpenSSL key + CSR in $resolvedOutputDir"
  }
} else {
  $subject = "CN=$CommonName, E=$EmailAddress, C=$CountryCode"
  New-CertReqConfigFile -PathValue $certReqConfigPath -SubjectValue $subject
  Invoke-Tool -CommandName "certreq" -Arguments @(
    "-new",
    $certReqConfigPath,
    $csrPath
  )
  Write-Host "Generated CSR via certreq: $csrPath"
  Write-Host "Private key stored in CurrentUser certificate key store."
}

if ($CerPath) {
  if (-not $P12Password) {
    throw "When -CerPath is provided, -P12Password is required."
  }

  $resolvedCerPath = Resolve-ExistingPath -PathValue $CerPath
  if (-not $resolvedCerPath) {
    throw "Certificate file not found: $CerPath"
  }

  if ($opensslCommand) {
    Invoke-Tool -CommandName "openssl" -Arguments @(
      "x509",
      "-inform", "DER",
      "-in", $resolvedCerPath,
      "-out", $certificatePemPath
    )

    Invoke-Tool -CommandName "openssl" -Arguments @(
      "pkcs12",
      "-export",
      "-inkey", $privateKeyPath,
      "-in", $certificatePemPath,
      "-out", $certificateP12Path,
      "-passout", "pass:$P12Password"
    )
  } else {
    $imported = Import-Certificate -FilePath $resolvedCerPath -CertStoreLocation "Cert:\CurrentUser\My"
    $securePassword = ConvertTo-SecureString -String $P12Password -AsPlainText -Force
    Export-PfxCertificate `
      -Cert "Cert:\CurrentUser\My\$($imported.Thumbprint)" `
      -FilePath $certificateP12Path `
      -Password $securePassword | Out-Null
  }

  Write-Host "Generated P12 file: $certificateP12Path"
}

Write-Host ""
Write-Host "Next:"
Write-Host "1) Upload CSR to Apple: $csrPath"
Write-Host "2) Download .cer from Apple"
Write-Host "3) Re-run this script with -CerPath <downloaded.cer> -P12Password <password> to generate .p12"
