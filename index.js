require('dotenv').config();

const express = require('express');
const mqtt = require('mqtt');
const cors = require('cors');
const fs = require('node:fs');
const path = require('node:path');
const readline = require('node:readline');
const { createReadStream } = require('node:fs');

const app = express();
const PORT = Number(process.env.PORT) || 3000;
const MQTT_URL =
    process.env.MQTT_URL || 'mqtts://i2f370d2.ala.asia-southeast1.emqxsl.com:8883';
const MQTT_TOPIC = process.env.MQTT_TOPIC || 'digital_twin';
const telemetryDirectory = path.join(__dirname, 'data');
const telemetryFile = path.join(telemetryDirectory, 'telemetry.jsonl');
const RECENT_HISTORY_SIZE = 10;
const telemetryFields = [
    'battery_v',
    'battery_soc',
    'usb_v',
    'current_ma',
    'power_w'
];

app.use(cors());
app.use(express.json());

let latestData = {
    battery_v: 0,
    battery_soc: 0,
    usb_v: 0,
    current_ma: 0,
    power_w: 0,
    timestamp: '-'
};
let mqttConnected = false;
let mqttError = null;
let lastMessageAt = null;
let lastPayloadKeys = [];
let storageError = null;
let messageSequence = 0;

fs.mkdirSync(telemetryDirectory, { recursive: true });

async function readTelemetryHistory(limit) {
    if (!fs.existsSync(telemetryFile)) {
        return [];
    }

    const records = [];
    const input = createReadStream(telemetryFile, { encoding: 'utf8' });
    const lines = readline.createInterface({ input, crlfDelay: Infinity });

    try {
        for await (const line of lines) {
            if (!line.trim()) {
                continue;
            }

            const record = JSON.parse(line);
            if (limit === null) {
                records.push(record);
                continue;
            }

            records.push(record);
            if (records.length > limit) {
                records.shift();
            }
        }
    } finally {
        lines.close();
        input.destroy();
    }

    return limit === null ? records : records.reverse();
}

let recentTelemetry = [];
const recentHistoryReady = readTelemetryHistory(RECENT_HISTORY_SIZE)
    .then((history) => {
        recentTelemetry = [...history, ...recentTelemetry]
            .sort((left, right) => left.receivedAt.localeCompare(right.receivedAt))
            .slice(-RECENT_HISTORY_SIZE);
    })
    .catch((error) => {
        storageError = error.message || 'Gagal memuat riwayat telemetri dari disk.';
        console.error('Gagal memuat riwayat telemetri saat backend dimulai:', error);
    });

const mqttOptions = {
    clientId: `NodeJS_Dashboard_Server_${Math.random().toString(16).slice(2, 10)}`,
    reconnectPeriod: 3000,
    connectTimeout: 10000
};

if (process.env.MQTT_USERNAME) {
    mqttOptions.username = process.env.MQTT_USERNAME;
}

if (process.env.MQTT_PASSWORD) {
    mqttOptions.password = process.env.MQTT_PASSWORD;
}

console.log(`Menghubungkan ke broker MQTT: ${MQTT_URL}`);
console.log(`Topik telemetri: ${MQTT_TOPIC}`);

const client = mqtt.connect(MQTT_URL, mqttOptions);

client.on('connect', () => {
    mqttConnected = true;
    mqttError = null;
    console.log('Berhasil terhubung ke broker MQTT.');

    client.subscribe(MQTT_TOPIC, (error) => {
        if (error) {
            mqttError = `Gagal subscribe ke topik ${MQTT_TOPIC}: ${error.message}`;
            console.error(mqttError);
            return;
        }

        console.log(`Berhasil subscribe ke topik: ${MQTT_TOPIC}`);
    });
});

client.on('reconnect', () => {
    console.log('Mencoba menghubungkan ulang ke broker MQTT...');
});

client.on('close', () => {
    mqttConnected = false;
    console.warn('Koneksi ke broker MQTT terputus.');
});

client.on('offline', () => {
    mqttConnected = false;
    console.warn('Client MQTT sedang offline.');
});

client.on('error', (error) => {
    mqttConnected = false;
    mqttError =
        error.message ||
        error.code ||
        error.syscall ||
        'Broker menutup koneksi atau koneksi jaringan gagal tanpa detail tambahan.';
    console.error('Koneksi MQTT gagal:', error);
});

client.on('message', (topic, message) => {
    let payload;

    try {
        payload = JSON.parse(message.toString());
    } catch (error) {
        mqttError = `Payload pada topik ${topic} bukan JSON yang valid.`;
        console.error(`${mqttError} ${error.message}`);
        return;
    }

    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
        mqttError = `Payload pada topik ${topic} harus berupa objek JSON.`;
        console.error(mqttError);
        return;
    }

    lastPayloadKeys = Object.keys(payload);
    const missingFields = telemetryFields.filter(
        (field) => payload[field] === undefined || payload[field] === null
    );

    if (missingFields.length > 0) {
        mqttError = `Field telemetri tidak ditemukan: ${missingFields.join(', ')}.`;
        console.error(
            `${mqttError} Field yang diterima: ${lastPayloadKeys.join(', ') || '(kosong)'}`
        );
        return;
    }

    const parsedValues = Object.fromEntries(
        telemetryFields.map((field) => [field, Number(payload[field])])
    );
    const invalidFields = telemetryFields.filter(
        (field) => !Number.isFinite(parsedValues[field])
    );

    if (invalidFields.length > 0) {
        mqttError = `Nilai telemetri tidak valid: ${invalidFields.join(', ')}.`;
        console.error(mqttError);
        return;
    }

    const receivedAt = new Date();
    const record = {
        id: `${receivedAt.getTime()}-${process.pid}-${messageSequence++}`,
        ...parsedValues,
        timestamp: receivedAt.toLocaleTimeString('id-ID'),
        receivedAt: receivedAt.toISOString()
    };

    try {
        fs.appendFileSync(telemetryFile, `${JSON.stringify(record)}\n`, 'utf8');
        storageError = null;
    } catch (error) {
        storageError = error.message || 'Gagal menyimpan telemetri ke disk.';
        console.error(`Gagal menyimpan telemetri ke ${telemetryFile}:`, error);
    }

    latestData = record;
    recentTelemetry.push(record);
    if (recentTelemetry.length > RECENT_HISTORY_SIZE) {
        recentTelemetry.shift();
    }
    lastMessageAt = record.receivedAt;
    mqttError = null;
    console.log(`Data telemetri diterima dari topik ${topic}:`, latestData);
});

app.get('/api/telemetry', (req, res) => {
    res.json(latestData);
});

app.get('/api/telemetry/history', async (req, res) => {
    const allRecords = req.query.all === 'true';
    const requestedLimit = Number(req.query.limit ?? RECENT_HISTORY_SIZE);

    if (
        !allRecords &&
        (!Number.isInteger(requestedLimit) ||
            requestedLimit < 1 ||
            requestedLimit > RECENT_HISTORY_SIZE)
    ) {
        res.status(400).json({
            error: `Parameter limit harus berupa bilangan bulat antara 1 dan ${RECENT_HISTORY_SIZE}.`
        });
        return;
    }

    try {
        const history = allRecords
            ? await readTelemetryHistory(null)
            : await recentHistoryReady.then(() =>
                  recentTelemetry.slice(-requestedLimit).reverse()
              );
        res.json(history);
    } catch (error) {
        console.error('Gagal membaca riwayat telemetri:', error);
        res.status(500).json({
            error: error.message || 'Gagal membaca riwayat telemetri dari penyimpanan backend.'
        });
    }
});

app.get('/api/status', (req, res) => {
    res.json({
        brokerConnected: mqttConnected,
        topic: MQTT_TOPIC,
        lastMessageAt,
        lastError: mqttError || storageError,
        storageError,
        payloadKeys: lastPayloadKeys
    });
});

app.get('/', (req, res) => {
    res.send('Server Backend ESP32 Telemetri Aktif!');
});

app.listen(PORT, () => {
    console.log(`Server berjalan di http://localhost:${PORT}`);
});
