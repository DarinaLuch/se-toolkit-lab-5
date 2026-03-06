import { useState, useEffect } from 'react'
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  BarElement,
  LineElement,
  PointElement,
  ArcElement,
  Title,
  Tooltip,
  Legend,
} from 'chart.js'
import { Bar, Line } from 'react-chartjs-2'

ChartJS.register(
  CategoryScale,
  LinearScale,
  BarElement,
  LineElement,
  PointElement,
  ArcElement,
  Title,
  Tooltip,
  Legend,
)

const API_KEY_STORAGE = 'api_key'

interface ScoreBucket {
  bucket: string
  count: number
}

interface TimelineEntry {
  date: string
  submissions: number
}

interface PassRateEntry {
  task: string
  avg_score: number
  attempts: number
}

interface LabOption {
  id: string
  title: string
}

type FetchState<T> =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'success'; data: T }
  | { status: 'error'; message: string }

async function fetchWithAuth<T>(url: string): Promise<T> {
  const apiKey = localStorage.getItem(API_KEY_STORAGE)
  if (!apiKey) {
    throw new Error('No API key found')
  }

  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${apiKey}`,
    },
  })

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${response.statusText}`)
  }

  return response.json() as Promise<T>
}

async function fetchLabs(): Promise<LabOption[]> {
  const apiKey = localStorage.getItem(API_KEY_STORAGE)
  if (!apiKey) {
    return []
  }

  const response = await fetch('/items/', {
    headers: {
      Authorization: `Bearer ${apiKey}`,
    },
  })

  if (!response.ok) {
    return []
  }

  const items: unknown[] = await response.json()
  return items
    .filter(
      (item): item is { id: number; type: string; title: string } =>
        typeof item === 'object' &&
        item !== null &&
        'type' in item &&
        item.type === 'lab',
    )
    .map((item) => ({
      id: `lab-${String(item.id)}`,
      title: item.title,
    }))
}

function getLabIdFromTitle(title: string): string {
  const match = title.match(/Lab\s*(\d+)/i)
  if (match) {
    return `lab-${match[1].padStart(2, '0')}`
  }
  return 'lab-04'
}

interface DashboardProps {
  initialLab?: string
}

export default function Dashboard({ initialLab = 'lab-04' }: DashboardProps) {
  const [selectedLab, setSelectedLab] = useState<string>(initialLab)
  const [labs, setLabs] = useState<LabOption[]>([])

  const [scoresState, setScoresState] = useState<FetchState<ScoreBucket[]>>({
    status: 'idle',
  })
  const [timelineState, setTimelineState] = useState<
    FetchState<TimelineEntry[]>
  >({ status: 'idle' })
  const [passRatesState, setPassRatesState] = useState<
    FetchState<PassRateEntry[]>
  >({ status: 'idle' })

  useEffect(() => {
    fetchLabs().then((data) => {
      if (data.length > 0) {
        setLabs(data)
      }
    })
  }, [])

  useEffect(() => {
    if (!selectedLab) return

    setScoresState({ status: 'loading' })
    setTimelineState({ status: 'loading' })
    setPassRatesState({ status: 'loading' })

    Promise.all([
      fetchWithAuth<ScoreBucket[]>(`/analytics/scores?lab=${selectedLab}`),
      fetchWithAuth<TimelineEntry[]>(`/analytics/timeline?lab=${selectedLab}`),
      fetchWithAuth<PassRateEntry[]>(
        `/analytics/pass-rates?lab=${selectedLab}`,
      ),
    ])
      .then(([scores, timeline, passRates]) => {
        setScoresState({ status: 'success', data: scores })
        setTimelineState({ status: 'success', data: timeline })
        setPassRatesState({ status: 'success', data: passRates })
      })
      .catch((err: Error) => {
        setScoresState({ status: 'error', message: err.message })
        setTimelineState({ status: 'error', message: err.message })
        setPassRatesState({ status: 'error', message: err.message })
      })
  }, [selectedLab])

  const scoresData =
    scoresState.status === 'success'
      ? {
          labels: scoresState.data.map((d) => d.bucket),
          datasets: [
            {
              label: 'Submissions',
              data: scoresState.data.map((d) => d.count),
              backgroundColor: [
                'rgba(255, 99, 132, 0.7)',
                'rgba(255, 159, 64, 0.7)',
                'rgba(75, 192, 192, 0.7)',
                'rgba(54, 162, 235, 0.7)',
              ],
              borderColor: [
                'rgb(255, 99, 132)',
                'rgb(255, 159, 64)',
                'rgb(75, 192, 192)',
                'rgb(54, 162, 235)',
              ],
              borderWidth: 1,
            },
          ],
        }
      : undefined

  const timelineData =
    timelineState.status === 'success'
      ? {
          labels: timelineState.data.map((d) => d.date),
          datasets: [
            {
              label: 'Submissions',
              data: timelineState.data.map((d) => d.submissions),
              borderColor: 'rgb(54, 162, 235)',
              backgroundColor: 'rgba(54, 162, 235, 0.5)',
              tension: 0.1,
              fill: true,
            },
          ],
        }
      : undefined

  const commonOptions = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: {
        display: false,
      },
    },
    scales: {
      y: {
        beginAtZero: true,
        ticks: {
          stepSize: 1,
        },
      },
    },
  } as const

  return (
    <div className="dashboard">
      <header className="dashboard-header">
        <h1>Dashboard</h1>
        <div className="lab-selector">
          <label htmlFor="lab-select">Select Lab: </label>
          <select
            id="lab-select"
            value={selectedLab}
            onChange={(e) => setSelectedLab(e.target.value)}
          >
            {labs.length > 0 ? (
              labs.map((lab) => (
                <option key={lab.id} value={lab.id}>
                  {lab.title}
                </option>
              ))
            ) : (
              <>
                <option value="lab-04">Lab 04 — Testing</option>
                <option value="lab-03">Lab 03 — Backend</option>
                <option value="lab-02">Lab 02 — Databases</option>
                <option value="lab-01">Lab 01 — Setup</option>
              </>
            )}
          </select>
        </div>
      </header>

      <div className="charts-container">
        <section className="chart-section">
          <h2>Score Distribution</h2>
          {scoresState.status === 'loading' && <p>Loading...</p>}
          {scoresState.status === 'error' && (
            <p className="error">Error: {scoresState.message}</p>
          )}
          {scoresState.status === 'success' && scoresData && (
            <div className="chart-wrapper">
              <Bar data={scoresData} options={commonOptions} />
            </div>
          )}
        </section>

        <section className="chart-section">
          <h2>Submission Timeline</h2>
          {timelineState.status === 'loading' && <p>Loading...</p>}
          {timelineState.status === 'error' && (
            <p className="error">Error: {timelineState.message}</p>
          )}
          {timelineState.status === 'success' && timelineData && (
            <div className="chart-wrapper">
              <Line data={timelineData} options={commonOptions} />
            </div>
          )}
        </section>
      </div>

      <section className="pass-rates-section">
        <h2>Pass Rates by Task</h2>
        {passRatesState.status === 'loading' && <p>Loading...</p>}
        {passRatesState.status === 'error' && (
          <p className="error">Error: {passRatesState.message}</p>
        )}
        {passRatesState.status === 'success' && (
          <table className="pass-rates-table">
            <thead>
              <tr>
                <th>Task</th>
                <th>Avg Score</th>
                <th>Attempts</th>
              </tr>
            </thead>
            <tbody>
              {passRatesState.data.map((entry, index) => (
                <tr key={`${entry.task}-${index}`}>
                  <td>{entry.task}</td>
                  <td>{entry.avg_score.toFixed(1)}%</td>
                  <td>{entry.attempts}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  )
}
