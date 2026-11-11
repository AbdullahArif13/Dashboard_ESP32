import { useEffect, useState } from 'react'
import './App.css'

const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000'
const API_URL = `${API_BASE_URL}/api/telemetry`
const STATUS_URL = `${API_BASE_URL}/api/status`
const HISTORY_URL = `${API_BASE_URL}/api/telemetry/history`
const POLL_INTERVAL = 2000

const emptyTelemetry = {
  battery_v: 0,
  battery_soc: 0,
  usb_v: 0,
  current_ma: 0,
  power_w: 0,
  timestamp: '-',
}

function asNumber(value) {
  const number = Number(value)
  return Number.isFinite(number) ? number : 0
}

function App() {
  const [telemetry, setTelemetry] = useState(emptyTelemetry)
  const [isConnected, setIsConnected] = useState(false)
  const [mqttStatus, setMqttStatus] = useState(null)
  const [errorMessage, setErrorMessage] = useState('')
  const [exportError, setExportError] = useState('')
  const [isExporting, setIsExporting] = useState(false)
  const [logs, setLogs] = useState([])

  async function downloadRawData() {
    if (logs.length === 0 || isExporting) return

    setIsExporting(true)
    setExportError('')

    try {
      const historyResponse = await fetch(`${HISTORY_URL}?all=true`)
      if (!historyResponse.ok) {
        throw new Error(`Server riwayat merespons dengan status ${historyResponse.status}.`)
      }

      const history = await historyResponse.json()
      if (!Array.isArray(history) || history.length === 0) {
        throw new Error('Belum ada data telemetri tersimpan di backend.')
      }

      const { default: ExcelJS } = await import('exceljs')
      const workbook = new ExcelJS.Workbook()
      const worksheet = workbook.addWorksheet('telemetry_raw')
      worksheet.addRow([
        'timestamp',
        'battery_v',
        'battery_soc',
        'usb_v',
        'current_ma',
        'power_w',
      ])

      history.forEach((log) => {
        worksheet.addRow([
          log.timestamp,
          log.battery_v,
          log.battery_soc,
          log.usb_v,
          log.current_ma,
          log.power_w,
        ])
      })

      const file = new Blob([await workbook.xlsx.writeBuffer()], {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      })
      const url = URL.createObjectURL(file)
      const link = document.createElement('a')
      const date = new Date().toISOString().slice(0, 10)

      link.href = url
      link.download = `telemetry-raw-${date}.xlsx`
      document.body.append(link)
      link.click()
      link.remove()
      window.setTimeout(() => URL.revokeObjectURL(url), 0)
    } catch (error) {
      setExportError(
        error instanceof Error
          ? `Gagal membuat file Excel: ${error.message}`
          : 'Gagal membuat file Excel.',
      )
    } finally {
      setIsExporting(false)
    }
  }

  useEffect(() => {
    let active = true

    async function fetchTelemetry() {
      try {
        const response = await fetch(API_URL)
        if (!response.ok) {
          throw new Error(`Server API merespons dengan status ${response.status}.`)
        }

        const data = await response.json()
        const nextTelemetry = {
          battery_v: asNumber(data.battery_v),
          battery_soc: asNumber(data.battery_soc),
          usb_v: asNumber(data.usb_v),
          current_ma: asNumber(data.current_ma),
          power_w: asNumber(data.power_w),
          timestamp:
            typeof data.timestamp === 'string' && data.timestamp
              ? data.timestamp
              : '-',
        }

        if (!active) return

        setTelemetry(nextTelemetry)
        setIsConnected(true)
        setErrorMessage('')

        const [statusResponse, historyResponse] = await Promise.all([
          fetch(STATUS_URL),
          fetch(`${HISTORY_URL}?limit=10`),
        ])

        if (!statusResponse.ok) {
          throw new Error(`Status API merespons dengan status ${statusResponse.status}.`)
        }
        if (!historyResponse.ok) {
          throw new Error(`Riwayat API merespons dengan status ${historyResponse.status}.`)
        }

        const [status, history] = await Promise.all([
          statusResponse.json(),
          historyResponse.json(),
        ])

        if (active) {
          setMqttStatus({
            brokerConnected: Boolean(status.brokerConnected),
            topic: typeof status.topic === 'string' ? status.topic : 'tidak diketahui',
            lastMessageAt:
              typeof status.lastMessageAt === 'string' ? status.lastMessageAt : null,
            lastError: typeof status.lastError === 'string' ? status.lastError : null,
            payloadKeys: Array.isArray(status.payloadKeys) ? status.payloadKeys : [],
          })
          setLogs(Array.isArray(history) ? history : [])
        }
      } catch (error) {
        if (!active) return

        setIsConnected(false)
        setErrorMessage(
          error instanceof Error
            ? error.message
            : 'Tidak dapat terhubung ke server API.',
        )
      }
    }

    fetchTelemetry()
    const intervalId = window.setInterval(fetchTelemetry, POLL_INTERVAL)

    return () => {
      active = false
      window.clearInterval(intervalId)
    }
  }, [])

  return (
    <main className="dashboard">
      <header className="dashboard-header">
        <div>
          <p className="eyebrow">MONITORING PERANGKAT</p>
          <h1>ESP32-S3 IoT Telemetry Monitor</h1>
          <p className="subtitle">
            Pemantauan baterai dan daya USB secara real-time melalui MQTT SSL
          </p>
        </div>
        <div className="connection-info">
          <span
            className={`connection-badge ${isConnected ? 'is-online' : 'is-offline'}`}
            role="status"
          >
            <span className="connection-dot" aria-hidden="true" />
            {isConnected ? 'SERVER API TERHUBUNG' : 'SERVER TERPUTUS'}
          </span>
          <span className="updated-time">Diperbarui: {telemetry.timestamp}</span>
        </div>
      </header>

      {errorMessage && (
        <p className="error-message" role="alert">
          {errorMessage} Pastikan backend berjalan di{' '}
          <code>{API_BASE_URL}</code>.
        </p>
      )}

      {isConnected && (
        <section
          className={`mqtt-status ${mqttStatus?.brokerConnected ? 'mqtt-status-online' : 'mqtt-status-offline'}`}
          aria-live="polite"
        >
          <span className="mqtt-status-indicator" aria-hidden="true" />
          <div>
            <h2>
              {mqttStatus === null
                ? 'Memeriksa koneksi MQTT...'
                : mqttStatus.brokerConnected
                  ? 'Broker MQTT terhubung'
                  : 'Broker MQTT belum terhubung'}
            </h2>
            <p>
              {mqttStatus === null
                ? 'Mengambil status koneksi dari backend.'
                : mqttStatus.lastError
                  ? mqttStatus.lastError
                  : !mqttStatus.brokerConnected
                    ? 'Pastikan backend memiliki URL broker dan kredensial MQTT yang benar.'
                    : !mqttStatus.lastMessageAt
                      ? `Belum ada pesan diterima pada topik "${mqttStatus.topic}". Pastikan ESP32 memublikasikan ke topik yang sama.`
                      : `Topik "${mqttStatus.topic}" · pesan terakhir ${new Date(mqttStatus.lastMessageAt).toLocaleString('id-ID')}`}
            </p>
            {mqttStatus?.payloadKeys.length > 0 && mqttStatus.lastError && (
              <p className="mqtt-payload-keys">
                Field yang diterima: {mqttStatus.payloadKeys.join(', ')}
              </p>
            )}
          </div>
        </section>
      )}

      <section className="metrics-grid" aria-label="Data telemetri terbaru">
        <article className="metric-card">
          <span className="metric-label">Tegangan Aki 12V</span>
          <p className="metric-value">
            {telemetry.battery_v.toFixed(2)} <span>V</span>
          </p>
        </article>
        <article className="metric-card">
          <span className="metric-label">Kapasitas (SoC)</span>
          <p className="metric-value metric-green">
            {telemetry.battery_soc} <span>%</span>
          </p>
        </article>
        <article className="metric-card">
          <span className="metric-label">Arus Pengisian USB</span>
          <p className="metric-value metric-amber">
            {Math.round(telemetry.current_ma)} <span>mA</span>
          </p>
        </article>
        <article className="metric-card">
          <span className="metric-label">Konsumsi Daya</span>
          <p className="metric-value metric-purple">
            {telemetry.power_w.toFixed(2)} <span>W</span>
          </p>
        </article>
      </section>

      <section className="history-card" aria-labelledby="history-heading">
        <div className="history-heading">
          <div>
            <p className="eyebrow">LOG SENSOR</p>
            <h2 id="history-heading">Riwayat Telemetri Masuk</h2>
          </div>
          <span className="history-count">{logs.length} data terbaru · tersimpan di backend</span>
        </div>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th scope="col">Waktu</th>
                <th scope="col">Tegangan Aki</th>
                <th scope="col">SoC</th>
                <th scope="col">V-Out USB</th>
                <th scope="col">Arus</th>
                <th scope="col">Daya</th>
              </tr>
            </thead>
            <tbody>
              {logs.length === 0 ? (
                <tr>
                  <td className="empty-state" colSpan="6">
                    Menunggu data telemetri dari ESP32...
                  </td>
                </tr>
              ) : (
                logs.map((log) => (
                  <tr key={log.id}>
                    <td className="muted-cell">{log.timestamp}</td>
                    <td className="metric-blue">{log.battery_v.toFixed(2)} V</td>
                    <td>{log.battery_soc} %</td>
                    <td className="metric-amber">{log.usb_v.toFixed(2)} V</td>
                    <td>{Math.round(log.current_ma)} mA</td>
                    <td className="metric-purple">{log.power_w.toFixed(2)} W</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        <div className="history-actions">
          <p className="export-note">
            Tampilkan 10 data terbaru. Excel mengunduh semua data yang tersimpan di backend.
          </p>
          <button
            className="export-button"
            type="button"
            onClick={downloadRawData}
            disabled={logs.length === 0 || isExporting}
          >
            <svg
              aria-hidden="true"
              width="17"
              height="17"
              viewBox="0 0 24 24"
              fill="none"
            >
              <path
                d="M12 3v12m0 0 4-4m-4 4-4-4M5 17v3h14v-3"
                stroke="currentColor"
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth="1.8"
              />
            </svg>
            {isExporting ? 'Menyiapkan Excel...' : 'Download Excel'}
          </button>
        </div>
        {exportError && (
          <p className="error-message export-error" role="alert">
            {exportError}
          </p>
        )}
      </section>

      <footer className="dashboard-footer">
        <div className="footer-orbit" aria-hidden="true">
          <span />
          <span />
          <span />
        </div>
        <div className="footer-copy">
          <span className="footer-mark" aria-hidden="true">
            ESP
          </span>
          <span>ESP32-S3 TELEMETRY</span>
          <span className="footer-divider" aria-hidden="true">
            /
          </span>
          <span className="footer-caption">Data perangkat, langsung terbaca.</span>
        </div>
        <span className="footer-live">
          <span className="footer-live-dot" />
          {isConnected ? 'LIVE' : 'MENUNGGU KONEKSI'}
        </span>
      </footer>
    </main>
  )
}

export default App
