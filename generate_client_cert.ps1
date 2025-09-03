# generate_client_cert.ps1 - ������ ��� ��������� ���������� ������������ OPC UA
# .\generate_client_cert.ps1 -Hostname Air-Maksim -ClientName OPCUA-Client
# ��� � ��������� �����������:
# .\generate_client_cert.ps1 -h Air-Maksim -n OPCUA-Client

param(
    [Alias("h")]
    [string]$Hostname = "localhost",
    
    [Alias("n")]
    [string]$ClientName = "OPCUA-Client",
    
    [Alias("u")]
    [string]$ApplicationUri = "",
    
    [Alias("o")]
    [string]$OutputDir = "./client_certificates",
    
    [Alias("d")]
    [int]$DaysValid = 365,
    
    [switch]$UseSystemHostname,
    
    [Alias("ShowHelp")]
    [switch]$Help,
    
    [switch]$InstallOpenSSL
)

# �������� ��������� ������
if ($Help) {
    Write-Host "�������������: generate_client_cert.ps1 [���������]"
    Write-Host ""
    Write-Host "���������:"
    Write-Host "  -h, -Hostname HOST           Hostname (�� ���������: localhost)"
    Write-Host "  -n, -ClientName NAME         ��� ������� (�� ���������: OPCUA-Client)"
    Write-Host "  -u, -ApplicationUri URI      Application URI (�� ���������: urn:hostname:clientname)"
    Write-Host "  -o, -OutputDir DIR           ���������� ��� ������������ (�� ���������: ./client_certificates)"
    Write-Host "  -d, -DaysValid DAYS          ���� �������� � ���� (�� ���������: 365)"
    Write-Host "  -UseSystemHostname           ������������ ��������� hostname ������ localhost"
    Write-Host "  -InstallOpenSSL              ������������� ���������� OpenSSL ���� �� �����������"
    Write-Host "  -help                        �������� ��� ������"
    Write-Host ""
    Write-Host "�������:"
    Write-Host "  .\generate_client_cert.ps1"
    Write-Host "  .\generate_client_cert.ps1 -h Air-Maksim -n OPCUA-Client"
    Write-Host "  .\generate_client_cert.ps1 -Hostname myhost -ClientName MyClient"
    Write-Host "  .\generate_client_cert.ps1 -UseSystemHostname -ClientName TestClient"
    Write-Host "  .\generate_client_cert.ps1 -InstallOpenSSL"
    exit 0
}

# ������� ��� ��������� OpenSSL
function Install-OpenSSL {
    Write-Host "������� ��������� OpenSSL..." -ForegroundColor Yellow
    
    # ����������� ������ �������� ��������� ����� winget
    $packages = @(
        "ShiningLight.OpenSSL",
        "OpenSSL.OpenSSL",
        "OpenSSL.libreSSL"
    )
    
    foreach ($package in $packages) {
        Write-Host "������� ��������� ������: $package" -ForegroundColor Cyan
        try {
            winget install --id $package -e --source winget --accept-package-agreements --accept-source-agreements --silent
            if ($LASTEXITCODE -eq 0) {
                Write-Host "OpenSSL ������� ���������� ����� ����� $package!" -ForegroundColor Green
                Add-OpenSSL-To-Path
                return
            }
        } catch {
            Write-Host "�� ������� ���������� ����� $package" -ForegroundColor Red
        }
    }
    
    # ���� winget �� ��������, ���������� ������ ���������
    Write-Host "�������������� ��������� �� �������. ������������� ������ ���������:" -ForegroundColor Red
    Write-Host ""
    Write-Host "1. �������� OpenSSL �:" -ForegroundColor Yellow
    Write-Host "   https://slproweb.com/products/Win32OpenSSL.html" -ForegroundColor Yellow
    Write-Host "2. �������� ���������� ������:" -ForegroundColor Yellow
    Write-Host "   - ��� 64-bit: Win64 OpenSSL v3.x.x Light" -ForegroundColor Yellow
    Write-Host "   - ��� 32-bit: Win32 OpenSSL v3.x.x Light" -ForegroundColor Yellow
    Write-Host "3. ��������� ���������� � �������� �����������" -ForegroundColor Yellow
    Write-Host "4. ��� ��������� ��������: Copy OpenSSL DLLs to: The OpenSSL binaries (/bin) directory" -ForegroundColor Yellow
    Write-Host "5. ����� ��������� ������������� PowerShell" -ForegroundColor Yellow
    exit 1
}

# ������� ��� ���������� OpenSSL � PATH
function Add-OpenSSL-To-Path {
    # ������� ����� ���� � �������������� OpenSSL
    $possiblePaths = @(
        "${env:ProgramFiles}\OpenSSL-Win64\bin",
        "${env:ProgramFiles}\OpenSSL\bin",
        "C:\OpenSSL-Win64\bin",
        "C:\OpenSSL\bin"
    )
    
    $openSSLPath = $null
    foreach ($path in $possiblePaths) {
        if (Test-Path $path) {
            $openSSLPath = $path
            break
        }
    }
    
    if ($openSSLPath) {
        # ���������, ���� �� ��� ���� ���� � PATH
        $currentPath = [Environment]::GetEnvironmentVariable("PATH", "Machine")
        if ($currentPath -notlike "*$openSSLPath*") {
            Write-Host "���������� OpenSSL � ��������� ���������� PATH..." -ForegroundColor Yellow
            
            try {
                # ��������� ���� � OpenSSL � ��������� ���������� PATH
                [Environment]::SetEnvironmentVariable("PATH", "$currentPath;$openSSLPath", "Machine")
                Write-Host "OpenSSL �������� � PATH. ������������� PowerShell ��� ���������� ���������." -ForegroundColor Green
            } catch {
                Write-Host "�� ������� ������������� �������� OpenSSL � PATH. �������� �������:" -ForegroundColor Yellow
                Write-Host "���� � ����������: $openSSLPath" -ForegroundColor Yellow
            }
        } else {
            Write-Host "OpenSSL ��� ��������� � PATH." -ForegroundColor Green
        }
    } else {
        Write-Host "�� ������� ����� ���� � �������������� OpenSSL. ��������� ���������." -ForegroundColor Yellow
        Write-Host "������� ���� ��� ��������:" -ForegroundColor Yellow
        Write-Host "  ${env:ProgramFiles}\OpenSSL-Win64\bin" -ForegroundColor Yellow
        Write-Host "  ${env:ProgramFiles}\OpenSSL\bin" -ForegroundColor Yellow
    }
}

# ������������ ��������� hostname ���� �������
if ($UseSystemHostname) {
    $Hostname = hostname
}

# ���������� Application URI ���� �� �����
if ([string]::IsNullOrEmpty($ApplicationUri)) {
    $ApplicationUri = "urn:${Hostname}:${ClientName}"
}

# ����� ��� ������
function Write-Blue { param([string]$Message) Write-Host $Message -ForegroundColor Blue }
function Write-Green { param([string]$Message) Write-Host $Message -ForegroundColor Green }
function Write-Yellow { param([string]$Message) Write-Host $Message -ForegroundColor Yellow }
function Write-Red { param([string]$Message) Write-Host $Message -ForegroundColor Red }

Write-Blue "========================================"
Write-Blue "  ��������� ���������� ������������ OPC UA"
Write-Blue "========================================"
Write-Host ""
Write-Host "Hostname: $Hostname"
Write-Host "��� �������: $ClientName"
Write-Host "Application URI: $ApplicationUri"
Write-Host ""

# �������� ������� OpenSSL
$opensslFound = $false
try {
    $null = openssl version 2>$null
    if ($LASTEXITCODE -eq 0) {
        $opensslFound = $true
        $opensslVersion = openssl version
        Write-Host "OpenSSL ������: $opensslVersion"
    }
} catch {
    # OpenSSL �� ������ � PATH
}

if (-not $opensslFound) {
    Write-Red "OpenSSL �� ������ � �������!"
    
    if ($InstallOpenSSL) {
        Write-Yellow "������� �������������� ��������� OpenSSL..."
        Install-OpenSSL
    } else {
        Write-Host "����� ��� ������� ��������:" -ForegroundColor Yellow
        Write-Host "1. ��������� ������ � ���������� -InstallOpenSSL ��� �������������� ���������"
        Write-Host "2. ���������� OpenSSL ������� � �������� � PATH"
        Write-Host ""
        Write-Host "��� �������������� ��������� ���������:"
        Write-Host "  .\generate_client_cert.ps1 -InstallOpenSSL"
        Write-Host ""
        Write-Host "��� ������ ���������:"
        Write-Host "  �������� � https://slproweb.com/products/Win32OpenSSL.html"
        Write-Host "  ���������� ���������"
        Write-Host "  �������� ���� � OpenSSL � ���������� PATH"
        exit 1
    }
}

# �������� ����������
Write-Yellow "�������� ����������..."
$null = New-Item -ItemType Directory -Path "$OutputDir\private" -Force
$null = New-Item -ItemType Directory -Path "$OutputDir\certs" -Force
$null = New-Item -ItemType Directory -Path "$OutputDir\csr" -Force

Write-Host "���������� ������������: $OutputDir"

# �����
$PrivateKey = "$OutputDir\private\${ClientName}_key.pem"
$CsrFile = "$OutputDir\csr\${ClientName}.csr"
$CertFile = "$OutputDir\certs\${ClientName}_cert.pem"
$CertDerFile = "$OutputDir\certs\${ClientName}_cert.der"
$ConfigFile = "$OutputDir\${ClientName}_openssl.cnf"

# �������� ����������������� ����� OpenSSL
Write-Yellow "�������� ����������������� ����� OpenSSL..."

$ConfigContent = @"
[ req ]
default_bits = 2048
default_md = sha256
distinguished_name = req_distinguished_name
req_extensions = v3_req
prompt = no

[ req_distinguished_name ]
CN = $ClientName
O = OPCUA Client

[ v3_req ]
basicConstraints = CA:FALSE
keyUsage = digitalSignature, keyEncipherment
extendedKeyUsage = clientAuth
subjectAltName = @alt_names

[ alt_names ]
DNS.1 = localhost
DNS.2 = $Hostname
IP.1 = 127.0.0.1
URI.1 = $ApplicationUri
"@

$ConfigContent | Out-File -FilePath $ConfigFile -Encoding ASCII

Write-Host "���������������� ���� ������: $ConfigFile"

# ��������� ���������� �����
Write-Yellow "��������� ���������� �����..."
openssl genrsa -out "$PrivateKey" 2048
if (Test-Path $PrivateKey) {
    Write-Host "��������� ���� ������: $PrivateKey"
} else {
    Write-Red "������ ��� �������� ���������� �����!"
    exit 1
}

# ��������� ������� �� ���������� (CSR)
Write-Yellow "��������� ������� �� ���������� (CSR)..."
openssl req -new -key "$PrivateKey" -out "$CsrFile" -config "$ConfigFile"
if (Test-Path $CsrFile) {
    Write-Host "CSR ������: $CsrFile"
} else {
    Write-Red "������ ��� �������� CSR!"
    exit 1
}

# ��������� ���������������� �����������
Write-Yellow "��������� ���������������� �����������..."
openssl x509 -req -in "$CsrFile" -signkey "$PrivateKey" -out "$CertFile" -days $DaysValid -extensions v3_req -extfile "$ConfigFile"
if (Test-Path $CertFile) {
    Write-Host "���������� ������: $CertFile"
} else {
    Write-Red "������ ��� �������� �����������!"
    exit 1
}

# ����������� � DER ������
Write-Yellow "����������� ����������� � DER ������..."
openssl x509 -in "$CertFile" -outform DER -out "$CertDerFile"
if (Test-Path $CertDerFile) {
    Write-Host "DER ���������� ������: $CertDerFile"
} else {
    Write-Red "������ ��� ����������� � DER ������!"
    exit 1
}

# �������� �����������
Write-Yellow "�������� �����������..."
Write-Host "Subject:"
openssl x509 -in "$CertFile" -noout -subject
Write-Host ""
Write-Host "Issuer:"
openssl x509 -in "$CertFile" -noout -issuer
Write-Host ""
Write-Host "Validity:"
openssl x509 -in "$CertFile" -noout -dates
Write-Host ""
Write-Host "Application URI �� Subject Alternative Name:"
$altNames = openssl x509 -in "$CertFile" -noout -text | Select-String -Pattern "URI:"
if ($altNames) {
    Write-Host $altNames
}

# ����� ���������� � ��������� ������
Write-Host ""
Write-Green "========================================"
Write-Green "  ����������� ������� �������!"
Write-Green "========================================"
Write-Host ""
Write-Host "��������� �����:"
Write-Host "  ?? ��������� ����: $PrivateKey"
Write-Host "  ?? ���������� (PEM): $CertFile"
Write-Host "  ?? ���������� (DER): $CertDerFile"
Write-Host "  ?? CSR: $CsrFile"
Write-Host "  ??  ������: $ConfigFile"
Write-Host ""
Write-Host "Hostname: $Hostname"
Write-Host "��� �������: $ClientName"
Write-Host "Application URI: $ApplicationUri"
Write-Host "���� ��������: $DaysValid ����"
Write-Host ""

# ���������� �� �������������
Write-Blue "���������� �� �������������:"
Write-Host "1. ��� ������������� � node-opcua �������:"
Write-Host "   certificateFile: '$CertFile'"
Write-Host "   privateKeyFile: '$PrivateKey'"
Write-Host "   applicationUri: '$ApplicationUri'"
Write-Host ""
Write-Host "2. ��� ���������� � ���������� ������� OPC UA:"
Write-Host "   ���������� '$CertDerFile' � ���������� trusted/certs �������"
Write-Host ""

Write-Green "��������� ��������� �������!"