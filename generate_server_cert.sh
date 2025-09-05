#!/bin/bash

# generate_server_cert.sh - Скрипт для генерации серверных сертификатов OPC UA с поддержкой структуры PKI
# sudo ./generate_server_cert.sh -h Air-Maksim -n OPCUA-Server -i 192.168.1.100,10.0.0.1 -o ./pki
set -e  # Завершить выполнение при ошибке

# Параметры по умолчанию
HOSTNAME=$(hostname)  # Используем системный hostname по умолчанию
SERVER_NAME="OPCUA-Server"
IP_ADDRESSES="127.0.0.1"  # IP-адреса, разделённые запятыми
APPLICATION_URI="urn:${HOSTNAME}:${SERVER_NAME}"
OUTPUT_DIR="./server_certificates"
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
    echo "  -h, --hostname HOST      Hostname для DNS в сертификате (по умолчанию: системный hostname)"
    echo "  -n, --name NAME          Имя сервера (по умолчанию: OPCUA-Server)"
    echo "  -i, --ip IP_LIST         IP-адреса, разделённые запятыми (по умолчанию: 127.0.0.1)"
    echo "  -u, --uri URI            Application URI (по умолчанию: urn:<hostname>:OPCUA-Server)"
    echo "  -o, --output DIR         Директория для сертификатов PKI (по умолчанию: ./server_certificates)"
    echo "  -d, --days DAYS          Срок действия в днях (по умолчанию: 365)"
    echo "  --use-system-hostname    Явно использовать системный hostname"
    echo "  --help                   Показать эту помощь"
    echo ""
    echo "Примеры:"
    echo "  $0"
    echo "  $0 -h Air-Maksim -n OPCUA-Server -i 192.168.1.100,10.0.0.1"
    echo "  $0 --hostname myhost --name MyServer --ip 192.168.1.100,172.16.0.1"
    echo "  $0 --use-system-hostname --name TestServer"
    echo "  $0 -h Air-Maksim -n OPCUA-Server -i 192.168.1.100,10.0.0.1 -o ./pki"
    echo ""
    echo "Примечание: Скрипт создаёт структуру PKI (own/private, own/certs, csr) в указанной директории."
    echo "Сертификаты и ключи сохраняются как certificate.pem и private_key.pem."
    echo "Если файлы уже существуют в директории (например, ./pki/own), они будут перезаписаны."
}

# Парсинг аргументов
while [[ $# -gt 0 ]]; do
    case $1 in
        -h|--hostname)
            HOSTNAME="$2"
            APPLICATION_URI="urn:${HOSTNAME}:${SERVER_NAME}"
            shift 2
            ;;
        -n|--name)
            SERVER_NAME="$2"
            APPLICATION_URI="urn:${HOSTNAME}:${SERVER_NAME}"
            shift 2
            ;;
        -i|--ip)
            IP_ADDRESSES="$2"
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
            APPLICATION_URI="urn:${HOSTNAME}:${SERVER_NAME}"
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
echo -e "${BLUE}  Генерация серверных сертификатов OPC UA${NC}"
echo -e "${BLUE}========================================${NC}"
echo ""
echo "Hostname (DNS): ${HOSTNAME}"
echo "Имя сервера: ${SERVER_NAME}"
echo "IP-адреса: ${IP_ADDRESSES}"
echo "Application URI: ${APPLICATION_URI}"
echo "Директория вывода (PKI): ${OUTPUT_DIR}"
echo ""

# Создание структуры PKI
echo -e "${YELLOW}Создание структуры PKI...${NC}"
mkdir -p "${OUTPUT_DIR}/own/private"
mkdir -p "${OUTPUT_DIR}/own/certs"
mkdir -p "${OUTPUT_DIR}/csr"
chmod 700 "${OUTPUT_DIR}/own/private"  # Ограничение доступа к приватным ключам

# Проверка возможности записи в директорию own/private
if [ ! -d "${OUTPUT_DIR}/own/private" ] || [ ! -w "${OUTPUT_DIR}/own/private" ]; then
    echo -e "${RED}Ошибка: Директория ${OUTPUT_DIR}/own/private не создана или недоступна для записи${NC}"
    exit 1
fi
echo "Структура PKI создана в: ${OUTPUT_DIR}"

# Файлы
PRIVATE_KEY="${OUTPUT_DIR}/own/private/private_key.pem"
CSR_FILE="${OUTPUT_DIR}/csr/certificate.csr"
CERT_FILE="${OUTPUT_DIR}/own/certs/certificate.pem"
CERT_DER_FILE="${OUTPUT_DIR}/own/certs/certificate.der"
CONFIG_FILE="${OUTPUT_DIR}/openssl.cnf"

# Создание конфигурационного файла OpenSSL с поддержкой нескольких IP и явным DNS
echo -e "${YELLOW}Создание конфигурационного файла OpenSSL...${NC}"

# Разделение строки IP-адресов в массив
IFS=',' read -r -a IP_ARRAY <<< "${IP_ADDRESSES}"

# Генерация секции alt_names для DNS, IP-адресов и URI с правильными директивами
ALT_NAMES=""

# Добавляем DNS имена
ALT_NAMES+="DNS.1 = ${HOSTNAME}\n"
if [ "${HOSTNAME}" != "localhost" ]; then
    ALT_NAMES+="DNS.2 = localhost\n"
fi

# Добавляем IP-адреса
IP_INDEX=1
for ip in "${IP_ARRAY[@]}"; do
    ALT_NAMES+="IP.${IP_INDEX} = ${ip}\n"
    ((IP_INDEX++))
done

# Добавляем URI (ОТДЕЛЬНОЙ записью, с директивой URI.)
ALT_NAMES+="URI.1 = ${APPLICATION_URI}"

# Создание конфигурационного файла OpenSSL
cat > "${CONFIG_FILE}" << EOF
[ req ]
default_bits = 2048
default_md = sha256
distinguished_name = req_distinguished_name
req_extensions = v3_req
prompt = no

[ req_distinguished_name ]
CN = IntraOPC
O = IntraOPC
L = Kazan
C = RU

[ v3_req ]
basicConstraints = CA:FALSE
keyUsage = digitalSignature, keyEncipherment
extendedKeyUsage = serverAuth
subjectAltName = @alt_names

[ alt_names ]
${ALT_NAMES}
EOF

echo "Конфигурационный файл создан: ${CONFIG_FILE}"

# Генерация приватного ключа
echo -e "${YELLOW}Генерация приватного ключа...${NC}"
if ! openssl genrsa -out "${PRIVATE_KEY}" 2048 2> "${OUTPUT_DIR}/openssl_error.log"; then
    echo -e "${RED}Ошибка: Не удалось сгенерировать приватный ключ. Подробности в ${OUTPUT_DIR}/openssl_error.log${NC}"
    exit 1
fi
chmod 700 "${PRIVATE_KEY}"
if [ -f "${PRIVATE_KEY}" ] && [ -s "${PRIVATE_KEY}" ]; then
    echo "Приватный ключ создан: ${PRIVATE_KEY}"
else
    echo -e "${RED}Ошибка: Приватный ключ не создан или пустой в ${PRIVATE_KEY}${NC}"
    exit 1
fi

# Генерация запроса на сертификат (CSR)
echo -e "${YELLOW}Генерация запроса на сертификат (CSR)...${NC}"
if ! openssl req -new -key "${PRIVATE_KEY}" -out "${CSR_FILE}" -config "${CONFIG_FILE}" 2>> "${OUTPUT_DIR}/openssl_error.log"; then
    echo -e "${RED}Ошибка: Не удалось сгенерировать CSR. Подробности в ${OUTPUT_DIR}/openssl_error.log${NC}"
    exit 1
fi
if [ -f "${CSR_FILE}" ] && [ -s "${CSR_FILE}" ]; then
    echo "CSR создан: ${CSR_FILE}"
else
    echo -e "${RED}Ошибка: CSR не создан или пустой в ${CSR_FILE}${NC}"
    exit 1
fi

# Генерация самоподписанного сертификата
echo -e "${YELLOW}Генерация самоподписанного сертификата...${NC}"
if ! openssl x509 -req -in "${CSR_FILE}" -signkey "${PRIVATE_KEY}" -out "${CERT_FILE}" \
    -days "${DAYS_VALID}" -extensions v3_req -extfile "${CONFIG_FILE}" 2>> "${OUTPUT_DIR}/openssl_error.log"; then
    echo -e "${RED}Ошибка: Не удалось сгенерировать сертификат. Подробности в ${OUTPUT_DIR}/openssl_error.log${NC}"
    exit 1
fi
if [ -f "${CERT_FILE}" ] && [ -s "${CERT_FILE}" ]; then
    echo "Сертификат создан: ${CERT_FILE}"
else
    echo -e "${RED}Ошибка: Сертификат не создан или пустой в ${CERT_FILE}${NC}"
    exit 1
fi

# Конвертация в DER формат
echo -e "${YELLOW}Конвертация сертификата в DER формат...${NC}"
if ! openssl x509 -in "${CERT_FILE}" -outform DER -out "${CERT_DER_FILE}" 2>> "${OUTPUT_DIR}/openssl_error.log"; then
    echo -e "${RED}Ошибка: Не удалось конвертировать сертификат в DER формат. Подробности в ${OUTPUT_DIR}/openssl_error.log${NC}"
    exit 1
fi
if [ -f "${CERT_DER_FILE}" ] && [ -s "${CERT_DER_FILE}" ]; then
    echo "DER сертификат создан: ${CERT_DER_FILE}"
else
    echo -e "${RED}Ошибка: DER сертификат не создан или пустой в ${CERT_DER_FILE}${NC}"
    exit 1
fi

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
echo "Subject Alternative Name:"
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
echo "Hostname (DNS): ${HOSTNAME}"
echo "Имя сервера: ${SERVER_NAME}"
echo "IP-адреса: ${IP_ADDRESSES}"
echo "Application URI: ${APPLICATION_URI}"
echo "Директория вывода (PKI): ${OUTPUT_DIR}"
echo "Срок действия: ${DAYS_VALID} дней"
echo ""

# Инструкции по использованию
echo -e "${BLUE}Инструкции по использованию:${NC}"
echo "1. Для использования в OPC UA сервере (например, node-opcua):"
echo "   certificateFile: '${CERT_FILE}'"
echo "   privateKeyFile: '${PRIVATE_KEY}'"
echo "   applicationUri: '${APPLICATION_URI}'"
echo ""
echo "2. Для настройки доверия на клиенте:"
echo "   Скопируйте '${CERT_DER_FILE}' в директорию trusted/certs клиента"
echo ""
echo "3. Для замены существующих сертификатов:"
echo "   Убедитесь, что старая версия сертификатов и ключей сохранена,"
echo "   затем используйте опцию -o для указания той же директории PKI (например, ./pki)."
echo "   Новые файлы (certificate.pem, private_key.pem) перезапишут существующие."
echo ""
echo "4. Структура PKI:"
echo "   Приватные ключи: ${OUTPUT_DIR}/own/private/"
echo "   Сертификаты: ${OUTPUT_DIR}/own/certs/"
echo "   Запросы на сертификаты (CSR): ${OUTPUT_DIR}/csr/"

echo -e "${GREEN}Генерация завершена успешно!${NC}"