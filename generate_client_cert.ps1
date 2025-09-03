# generate_client_cert.ps1 - Скрипт для генерации клиентских сертификатов OPC UA
# .\generate_client_cert.ps1 -Hostname Air-Maksim -ClientName OPCUA-Client
# или с короткими параметрами:
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

# Проверка параметра помощи
if ($Help) {
    Write-Host "Использование: generate_client_cert.ps1 [ПАРАМЕТРЫ]"
    Write-Host ""
    Write-Host "Параметры:"
    Write-Host "  -h, -Hostname HOST           Hostname (по умолчанию: localhost)"
    Write-Host "  -n, -ClientName NAME         Имя клиента (по умолчанию: OPCUA-Client)"
    Write-Host "  -u, -ApplicationUri URI      Application URI (по умолчанию: urn:hostname:clientname)"
    Write-Host "  -o, -OutputDir DIR           Директория для сертификатов (по умолчанию: ./client_certificates)"
    Write-Host "  -d, -DaysValid DAYS          Срок действия в днях (по умолчанию: 365)"
    Write-Host "  -UseSystemHostname           Использовать системный hostname вместо localhost"
    Write-Host "  -InstallOpenSSL              Автоматически установить OpenSSL если он отсутствует"
    Write-Host "  -help                        Показать эту помощь"
    Write-Host ""
    Write-Host "Примеры:"
    Write-Host "  .\generate_client_cert.ps1"
    Write-Host "  .\generate_client_cert.ps1 -h Air-Maksim -n OPCUA-Client"
    Write-Host "  .\generate_client_cert.ps1 -Hostname myhost -ClientName MyClient"
    Write-Host "  .\generate_client_cert.ps1 -UseSystemHostname -ClientName TestClient"
    Write-Host "  .\generate_client_cert.ps1 -InstallOpenSSL"
    exit 0
}

# Функция для установки OpenSSL
function Install-OpenSSL {
    Write-Host "Попытка установки OpenSSL..." -ForegroundColor Yellow
    
    # Попробовать разные варианты установки через winget
    $packages = @(
        "ShiningLight.OpenSSL",
        "OpenSSL.OpenSSL",
        "OpenSSL.libreSSL"
    )
    
    foreach ($package in $packages) {
        Write-Host "Попытка установки пакета: $package" -ForegroundColor Cyan
        try {
            winget install --id $package -e --source winget --accept-package-agreements --accept-source-agreements --silent
            if ($LASTEXITCODE -eq 0) {
                Write-Host "OpenSSL успешно установлен через пакет $package!" -ForegroundColor Green
                Add-OpenSSL-To-Path
                return
            }
        } catch {
            Write-Host "Не удалось установить пакет $package" -ForegroundColor Red
        }
    }
    
    # Если winget не сработал, предложить ручную установку
    Write-Host "Автоматическая установка не удалась. Рекомендуется ручная установка:" -ForegroundColor Red
    Write-Host ""
    Write-Host "1. Скачайте OpenSSL с:" -ForegroundColor Yellow
    Write-Host "   https://slproweb.com/products/Win32OpenSSL.html" -ForegroundColor Yellow
    Write-Host "2. Выберите подходящую версию:" -ForegroundColor Yellow
    Write-Host "   - Для 64-bit: Win64 OpenSSL v3.x.x Light" -ForegroundColor Yellow
    Write-Host "   - Для 32-bit: Win32 OpenSSL v3.x.x Light" -ForegroundColor Yellow
    Write-Host "3. Запустите установщик и следуйте инструкциям" -ForegroundColor Yellow
    Write-Host "4. При установке выберите: Copy OpenSSL DLLs to: The OpenSSL binaries (/bin) directory" -ForegroundColor Yellow
    Write-Host "5. После установки перезапустите PowerShell" -ForegroundColor Yellow
    exit 1
}

# Функция для добавления OpenSSL в PATH
function Add-OpenSSL-To-Path {
    # Попытка найти путь к установленному OpenSSL
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
        # Проверяем, есть ли уже этот путь в PATH
        $currentPath = [Environment]::GetEnvironmentVariable("PATH", "Machine")
        if ($currentPath -notlike "*$openSSLPath*") {
            Write-Host "Добавление OpenSSL в системную переменную PATH..." -ForegroundColor Yellow
            
            try {
                # Добавляем путь к OpenSSL в системную переменную PATH
                [Environment]::SetEnvironmentVariable("PATH", "$currentPath;$openSSLPath", "Machine")
                Write-Host "OpenSSL добавлен в PATH. Перезапустите PowerShell для применения изменений." -ForegroundColor Green
            } catch {
                Write-Host "Не удалось автоматически добавить OpenSSL в PATH. Добавьте вручную:" -ForegroundColor Yellow
                Write-Host "Путь к добавлению: $openSSLPath" -ForegroundColor Yellow
            }
        } else {
            Write-Host "OpenSSL уже находится в PATH." -ForegroundColor Green
        }
    } else {
        Write-Host "Не удалось найти путь к установленному OpenSSL. Проверьте установку." -ForegroundColor Yellow
        Write-Host "Обычные пути для проверки:" -ForegroundColor Yellow
        Write-Host "  ${env:ProgramFiles}\OpenSSL-Win64\bin" -ForegroundColor Yellow
        Write-Host "  ${env:ProgramFiles}\OpenSSL\bin" -ForegroundColor Yellow
    }
}

# Использовать системный hostname если указано
if ($UseSystemHostname) {
    $Hostname = hostname
}

# Установить Application URI если не задан
if ([string]::IsNullOrEmpty($ApplicationUri)) {
    $ApplicationUri = "urn:${Hostname}:${ClientName}"
}

# Цвета для вывода
function Write-Blue { param([string]$Message) Write-Host $Message -ForegroundColor Blue }
function Write-Green { param([string]$Message) Write-Host $Message -ForegroundColor Green }
function Write-Yellow { param([string]$Message) Write-Host $Message -ForegroundColor Yellow }
function Write-Red { param([string]$Message) Write-Host $Message -ForegroundColor Red }

Write-Blue "========================================"
Write-Blue "  Генерация клиентских сертификатов OPC UA"
Write-Blue "========================================"
Write-Host ""
Write-Host "Hostname: $Hostname"
Write-Host "Имя клиента: $ClientName"
Write-Host "Application URI: $ApplicationUri"
Write-Host ""

# Проверка наличия OpenSSL
$opensslFound = $false
try {
    $null = openssl version 2>$null
    if ($LASTEXITCODE -eq 0) {
        $opensslFound = $true
        $opensslVersion = openssl version
        Write-Host "OpenSSL найден: $opensslVersion"
    }
} catch {
    # OpenSSL не найден в PATH
}

if (-not $opensslFound) {
    Write-Red "OpenSSL не найден в системе!"
    
    if ($InstallOpenSSL) {
        Write-Yellow "Попытка автоматической установки OpenSSL..."
        Install-OpenSSL
    } else {
        Write-Host "Опции для решения проблемы:" -ForegroundColor Yellow
        Write-Host "1. Запустите скрипт с параметром -InstallOpenSSL для автоматической установки"
        Write-Host "2. Установите OpenSSL вручную и добавьте в PATH"
        Write-Host ""
        Write-Host "Для автоматической установки выполните:"
        Write-Host "  .\generate_client_cert.ps1 -InstallOpenSSL"
        Write-Host ""
        Write-Host "Для ручной установки:"
        Write-Host "  Скачайте с https://slproweb.com/products/Win32OpenSSL.html"
        Write-Host "  Установите программу"
        Write-Host "  Добавьте путь к OpenSSL в переменную PATH"
        exit 1
    }
}

# Создание директорий
Write-Yellow "Создание директорий..."
$null = New-Item -ItemType Directory -Path "$OutputDir\private" -Force
$null = New-Item -ItemType Directory -Path "$OutputDir\certs" -Force
$null = New-Item -ItemType Directory -Path "$OutputDir\csr" -Force

Write-Host "Директория сертификатов: $OutputDir"

# Файлы
$PrivateKey = "$OutputDir\private\${ClientName}_key.pem"
$CsrFile = "$OutputDir\csr\${ClientName}.csr"
$CertFile = "$OutputDir\certs\${ClientName}_cert.pem"
$CertDerFile = "$OutputDir\certs\${ClientName}_cert.der"
$ConfigFile = "$OutputDir\${ClientName}_openssl.cnf"

# Создание конфигурационного файла OpenSSL
Write-Yellow "Создание конфигурационного файла OpenSSL..."

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

Write-Host "Конфигурационный файл создан: $ConfigFile"

# Генерация приватного ключа
Write-Yellow "Генерация приватного ключа..."
openssl genrsa -out "$PrivateKey" 2048
if (Test-Path $PrivateKey) {
    Write-Host "Приватный ключ создан: $PrivateKey"
} else {
    Write-Red "Ошибка при создании приватного ключа!"
    exit 1
}

# Генерация запроса на сертификат (CSR)
Write-Yellow "Генерация запроса на сертификат (CSR)..."
openssl req -new -key "$PrivateKey" -out "$CsrFile" -config "$ConfigFile"
if (Test-Path $CsrFile) {
    Write-Host "CSR создан: $CsrFile"
} else {
    Write-Red "Ошибка при создании CSR!"
    exit 1
}

# Генерация самоподписанного сертификата
Write-Yellow "Генерация самоподписанного сертификата..."
openssl x509 -req -in "$CsrFile" -signkey "$PrivateKey" -out "$CertFile" -days $DaysValid -extensions v3_req -extfile "$ConfigFile"
if (Test-Path $CertFile) {
    Write-Host "Сертификат создан: $CertFile"
} else {
    Write-Red "Ошибка при создании сертификата!"
    exit 1
}

# Конвертация в DER формат
Write-Yellow "Конвертация сертификата в DER формат..."
openssl x509 -in "$CertFile" -outform DER -out "$CertDerFile"
if (Test-Path $CertDerFile) {
    Write-Host "DER сертификат создан: $CertDerFile"
} else {
    Write-Red "Ошибка при конвертации в DER формат!"
    exit 1
}

# Проверка сертификата
Write-Yellow "Проверка сертификата..."
Write-Host "Subject:"
openssl x509 -in "$CertFile" -noout -subject
Write-Host ""
Write-Host "Issuer:"
openssl x509 -in "$CertFile" -noout -issuer
Write-Host ""
Write-Host "Validity:"
openssl x509 -in "$CertFile" -noout -dates
Write-Host ""
Write-Host "Application URI из Subject Alternative Name:"
$altNames = openssl x509 -in "$CertFile" -noout -text | Select-String -Pattern "URI:"
if ($altNames) {
    Write-Host $altNames
}

# Вывод информации о созданных файлах
Write-Host ""
Write-Green "========================================"
Write-Green "  Сертификаты успешно созданы!"
Write-Green "========================================"
Write-Host ""
Write-Host "Созданные файлы:"
Write-Host "  ?? Приватный ключ: $PrivateKey"
Write-Host "  ?? Сертификат (PEM): $CertFile"
Write-Host "  ?? Сертификат (DER): $CertDerFile"
Write-Host "  ?? CSR: $CsrFile"
Write-Host "  ??  Конфиг: $ConfigFile"
Write-Host ""
Write-Host "Hostname: $Hostname"
Write-Host "Имя клиента: $ClientName"
Write-Host "Application URI: $ApplicationUri"
Write-Host "Срок действия: $DaysValid дней"
Write-Host ""

# Инструкции по использованию
Write-Blue "Инструкции по использованию:"
Write-Host "1. Для использования в node-opcua клиенте:"
Write-Host "   certificateFile: '$CertFile'"
Write-Host "   privateKeyFile: '$PrivateKey'"
Write-Host "   applicationUri: '$ApplicationUri'"
Write-Host ""
Write-Host "2. Для добавления в доверенные сервера OPC UA:"
Write-Host "   Скопируйте '$CertDerFile' в директорию trusted/certs сервера"
Write-Host ""

Write-Green "Генерация завершена успешно!"