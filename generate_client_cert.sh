#!/bin/bash

# generate_client_cert.sh - Скрипт для генерации клиентских сертификатов OPC UA
# sudo ./generate_client_cert.sh -h Air-Maksim -n OPCUA-Client
set -e  # Завершить выполнение при ошибке

# Параметры по умолчанию
HOSTNAME="localhost"
CLIENT_NAME="OPCUA-Client"  # Теперь как отдельный параметр
APPLICATION_URI="urn:${HOSTNAME}:${CLIENT_NAME}"
OUTPUT_DIR="./client_certificates"
DAYS_VALID=365

# Цвета для вывода
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Функция помощи
show_help() {
    echo "Использование: $0 [ОПЦИИ]"
    echo ""
    echo "Опции:"
    echo "  -h, --hostname HOST      Hostname (по умолчанию: localhost)"
    echo "  -n, --name NAME          Имя клиента (по умолчанию: OPCUA-Client)"
    echo "  -u, --uri URI            Application URI (по умолчанию: urn:localhost:OPCUA-Client)"
    echo "  -o, --output DIR         Директория для сертификатов (по умолчанию: ./client_certificates)"
    echo "  -d, --days DAYS          Срок действия в днях (по умолчанию: 365)"
    echo "  --use-system-hostname    Использовать системный hostname вместо localhost"
    echo "  --help                   Показать эту помощь"
    echo ""
    echo "Примеры:"
    echo "  $0"
    echo "  $0 -h Air-Maksim -n OPCUA-Client"
    echo "  $0 --hostname myhost --name MyClient"
    echo "  $0 --use-system-hostname --name TestClient"
}

# Парсинг аргументов
while [[ $# -gt 0 ]]; do
    case $1 in
        -h|--hostname)
            HOSTNAME="$2"
            APPLICATION_URI="urn:${HOSTNAME}:${CLIENT_NAME}"
            shift 2
            ;;
        -n|--name)
            CLIENT_NAME="$2"
            APPLICATION_URI="urn:${HOSTNAME}:${CLIENT_NAME}"
            shift 2
            ;;
        -u|--uri)
            APPLICATION_URI="$2"
            shift 2
            ;;
        -o|--output)
            OUTPUT_DIR="$2"
            shift 2
            ;;
        -d|--days)
            DAYS_VALID="$2"
            shift 2
            ;;
        --use-system-hostname)
            HOSTNAME=$(hostname)
            APPLICATION_URI="urn:${HOSTNAME}:${CLIENT_NAME}"
            shift
            ;;
        --help)
            show_help
            exit 0
            ;;
        *)
            echo -e "${RED}Неизвестная опция: $1${NC}"
            show_help
            exit 1
            ;;
    esac
done

echo -e "${BLUE}========================================${NC}"
echo -e "${BLUE}  Генерация клиентских сертификатов OPC UA${NC}"
echo -e "${BLUE}========================================${NC}"
echo ""
echo "Hostname: ${HOSTNAME}"
echo "Имя клиента: ${CLIENT_NAME}"
echo "Application URI: ${APPLICATION_URI}"
echo ""

# Создание директорий
echo -e "${YELLOW}Создание директорий...${NC}"
mkdir -p "${OUTPUT_DIR}/private"
mkdir -p "${OUTPUT_DIR}/certs"
mkdir -p "${OUTPUT_DIR}/csr"

echo "Директория сертификатов: ${OUTPUT_DIR}"

# Файлы
PRIVATE_KEY="${OUTPUT_DIR}/private/${CLIENT_NAME}_key.pem"
CSR_FILE="${OUTPUT_DIR}/csr/${CLIENT_NAME}.csr"
CERT_FILE="${OUTPUT_DIR}/certs/${CLIENT_NAME}_cert.pem"
CERT_DER_FILE="${OUTPUT_DIR}/certs/${CLIENT_NAME}_cert.der"
CONFIG_FILE="${OUTPUT_DIR}/${CLIENT_NAME}_openssl.cnf"

# Создание конфигурационного файла OpenSSL
echo -e "${YELLOW}Создание конфигурационного файла OpenSSL...${NC}"

cat > "${CONFIG_FILE}" << EOF
[ req ]
default_bits = 2048
default_md = sha256
distinguished_name = req_distinguished_name
req_extensions = v3_req
prompt = no

[ req_distinguished_name ]
CN = ${CLIENT_NAME}
O = OPCUA Client

[ v3_req ]
basicConstraints = CA:FALSE
keyUsage = digitalSignature, keyEncipherment
extendedKeyUsage = clientAuth
subjectAltName = @alt_names

[ alt_names ]
DNS.1 = localhost
DNS.2 = ${HOSTNAME}
IP.1 = 127.0.0.1
URI.1 = ${APPLICATION_URI}
EOF

echo "Конфигурационный файл создан: ${CONFIG_FILE}"

# Генерация приватного ключа
echo -e "${YELLOW}Генерация приватного ключа...${NC}"
openssl genrsa -out "${PRIVATE_KEY}" 2048
chmod 600 "${PRIVATE_KEY}"
echo "Приватный ключ создан: ${PRIVATE_KEY}"

# Генерация запроса на сертификат (CSR)
echo -e "${YELLOW}Генерация запроса на сертификат (CSR)...${NC}"
openssl req -new -key "${PRIVATE_KEY}" -out "${CSR_FILE}" -config "${CONFIG_FILE}"
echo "CSR создан: ${CSR_FILE}"

# Генерация самоподписанного сертификата
echo -e "${YELLOW}Генерация самоподписанного сертификата...${NC}"
openssl x509 -req -in "${CSR_FILE}" -signkey "${PRIVATE_KEY}" -out "${CERT_FILE}" \
    -days "${DAYS_VALID}" -extensions v3_req -extfile "${CONFIG_FILE}"
echo "Сертификат создан: ${CERT_FILE}"

# Конвертация в DER формат
echo -e "${YELLOW}Конвертация сертификата в DER формат...${NC}"
openssl x509 -in "${CERT_FILE}" -outform DER -out "${CERT_DER_FILE}"
echo "DER сертификат создан: ${CERT_DER_FILE}"

# Проверка сертификата
echo -e "${YELLOW}Проверка сертификата...${NC}"
echo "Subject:"
openssl x509 -in "${CERT_FILE}" -noout -subject
echo ""
echo "Issuer:"
openssl x509 -in "${CERT_FILE}" -noout -issuer
echo ""
echo "Validity:"
openssl x509 -in "${CERT_FILE}" -noout -dates
echo ""
echo "Application URI из Subject Alternative Name:"
openssl x509 -in "${CERT_FILE}" -noout -text | grep -A 5 "Subject Alternative Name"

# Вывод информации о созданных файлах
echo ""
echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}  Сертификаты успешно созданы!${NC}"
echo -e "${GREEN}========================================${NC}"
echo ""
echo "Созданные файлы:"
echo "  🔑 Приватный ключ: ${PRIVATE_KEY}"
echo "  📄 Сертификат (PEM): ${CERT_FILE}"
echo "  📦 Сертификат (DER): ${CERT_DER_FILE}"
echo "  📝 CSR: ${CSR_FILE}"
echo "  ⚙️  Конфиг: ${CONFIG_FILE}"
echo ""
echo "Hostname: ${HOSTNAME}"
echo "Имя клиента: ${CLIENT_NAME}"
echo "Application URI: ${APPLICATION_URI}"
echo "Срок действия: ${DAYS_VALID} дней"
echo ""

# Инструкции по использованию
echo -e "${BLUE}Инструкции по использованию:${NC}"
echo "1. Для использования в node-opcua клиенте:"
echo "   certificateFile: '${CERT_FILE}'"
echo "   privateKeyFile: '${PRIVATE_KEY}'"
echo "   applicationUri: '${APPLICATION_URI}'"
echo ""
echo "2. Для добавления в доверенные сервера OPC UA:"
echo "   Скопируйте '${CERT_DER_FILE}' в директорию trusted/certs сервера"
echo ""

echo -e "${GREEN}Генерация завершена успешно!${NC}"