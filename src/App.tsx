import dayjs from 'dayjs'
import customParseFormat from 'dayjs/plugin/customParseFormat'
import { type ChangeEvent, type FormEvent, useEffect, useMemo, useState } from 'react'
import type { User } from '@supabase/supabase-js'
import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import './App.css'
import { isCloudEnabled, supabase } from './lib/supabase'

dayjs.extend(customParseFormat)

type BillingDay = number

type RangePreset =
  | '2D'
  | '1W'
  | '2W'
  | '1M'
  | '6M'
  | '1Y'
  | 'YTD'
  | 'CUSTOM'
  | 'ALL'

type Reading = {
  id: string
  date: string
  time: string
  importT?: number
  importT1: number
  importT2: number
  importT3: number
  exportT?: number
  exportT1: number
  exportT2: number
  exportT3: number
  net?: number
  solarGenerated: number
  note?: string
}

type BillingCycleSummary = {
  key: string
  start: string
  end: string
  importTotal: number
  exportTotal: number
  net: number
  consumedUnits: number
  openingBank: number
  bankUsed: number
  bankAdded: number
  payableUnits: number
  settlementPayoutUnits: number
  closingBank: number
}

type DerivedReading = Reading & {
  importTotal: number
  exportTotal: number
  netTotal: number
  importDelta: number
  exportDelta: number
  netDelta: number
  solarDelta: number
}

type CloudReadingRow = {
  id: string
  reading_date: string
  reading_time: string | null
  import_t: number | null
  import_t1: number
  import_t2: number
  import_t3: number
  export_t: number | null
  export_t1: number
  export_t2: number
  export_t3: number
  net: number | null
  solar_generated: number
  note: string | null
}

type ActivityLogEntry = {
  id: string
  timestamp: string
  action: string
  details: string
}

type SyncStatus = 'idle' | 'syncing' | 'success' | 'error'
type AppTab = 'home' | 'analytics' | 'history' | 'cloud' | 'manage'

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>
  userChoice: Promise<{
    outcome: 'accepted' | 'dismissed'
    platform: string
  }>
}

const STORAGE_KEY = 'solar-meter-readings-v1'
const SETTINGS_KEY = 'solar-meter-settings-v1'
const DATA_VERSION_KEY = 'solar-meter-data-version-v1'
const ACTIVITY_LOG_KEY = 'solar-meter-activity-log-v1'
const LAST_BACKUP_KEY = 'solar-meter-last-backup-v1'
const DATA_VERSION = 3

const seededReadings: Reading[] = [
  {
    id: 'seed-1',
    date: '2026-05-26',
    time: '07:00',
    importT: 1,
    importT1: 1,
    importT2: 0,
    importT3: 0,
    exportT: 1,
    exportT1: 1,
    exportT2: 0,
    exportT3: 0,
    net: 0,
    solarGenerated: 0,
    note: 'Initial installation baseline',
  },
  {
    id: 'seed-2',
    date: '2026-06-02',
    time: '07:00',
    importT: 63,
    importT1: 28,
    importT2: 10,
    importT3: 25,
    exportT: 71,
    exportT1: 71,
    exportT2: 0,
    exportT3: 0,
    net: -8,
    solarGenerated: 103,
    note: 'Meter reading',
  },
  {
    id: 'seed-3',
    date: '2026-06-07',
    time: '07:00',
    importT: 95,
    importT1: 49,
    importT2: 15,
    importT3: 31,
    exportT: 90,
    exportT1: 90,
    exportT2: 0,
    exportT3: 0,
    net: 5,
    solarGenerated: 136,
    note: 'Yesterday reading',
  },
]

const presetLabels: Record<RangePreset, string> = {
  '2D': '2 Days',
  '1W': '1 Week',
  '2W': '2 Weeks',
  '1M': '1 Month',
  '6M': '6 Months',
  '1Y': '1 Year',
  YTD: 'Year to Date',
  CUSTOM: 'Custom',
  ALL: 'All Time',
}

const toNum = (value: string) => {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0
}

const normalizeBillingDay = (value: number) => {
  if (!Number.isFinite(value)) {
    return 1
  }
  return Math.min(28, Math.max(1, Math.floor(value)))
}

const calculateImportTotal = (reading: Reading) =>
  reading.importT ?? reading.importT1 + reading.importT2 + reading.importT3

const calculateExportTotal = (reading: Reading) =>
  reading.exportT ?? reading.exportT1 + reading.exportT2 + reading.exportT3

const calculateNet = (reading: Reading) =>
  calculateImportTotal(reading) - calculateExportTotal(reading)

const getReadingTimestamp = (reading: Pick<Reading, 'date' | 'time'>) =>
  dayjs(`${reading.date}T${reading.time || '00:00'}`).valueOf()

const sortReadings = (items: Reading[]) =>
  [...items].sort((a, b) => {
    const delta = getReadingTimestamp(a) - getReadingTimestamp(b)
    return delta !== 0 ? delta : a.id.localeCompare(b.id)
  })

const deriveReadings = (items: Reading[]): DerivedReading[] => {
  const sorted = sortReadings(items)

  return sorted.map((reading, index) => {
    const importTotal = calculateImportTotal(reading)
    const exportTotal = calculateExportTotal(reading)
    const netTotal = calculateNet(reading)

    if (index === 0) {
      return {
        ...reading,
        importTotal,
        exportTotal,
        netTotal,
        importDelta: 0,
        exportDelta: 0,
        netDelta: 0,
        solarDelta: 0,
      }
    }

    const prev = sorted[index - 1]
    const prevImportTotal = calculateImportTotal(prev)
    const prevExportTotal = calculateExportTotal(prev)
    const prevNetTotal = calculateNet(prev)

    return {
      ...reading,
      importTotal,
      exportTotal,
      netTotal,
      importDelta: importTotal - prevImportTotal,
      exportDelta: exportTotal - prevExportTotal,
      netDelta: netTotal - prevNetTotal,
      solarDelta: reading.solarGenerated - prev.solarGenerated,
    }
  })
}

const applyKnownCorrections = (items: Reading[]) =>
  items.map((reading) => {
    const isOldJune02Pattern =
      reading.date === '2026-06-02' &&
      reading.importT1 === 63 &&
      reading.importT2 === 0 &&
      reading.importT3 === 0 &&
      reading.exportT1 === 71 &&
      reading.exportT2 === 0 &&
      reading.exportT3 === 0

    if (isOldJune02Pattern) {
      return {
        ...reading,
        importT: 63,
        importT1: 28,
        importT2: 10,
        importT3: 25,
        exportT: 71,
        exportT1: 71,
        exportT2: 0,
        exportT3: 0,
        net: -8,
        solarGenerated: 103,
      }
    }

    const isOldJune07Pattern =
      reading.date === '2026-06-07' &&
      reading.importT1 === 1 &&
      reading.importT2 === 0 &&
      reading.importT3 === 0 &&
      reading.exportT1 === 1 &&
      reading.exportT2 === 0 &&
      reading.exportT3 === 0

    if (isOldJune07Pattern) {
      return {
        ...reading,
        importT: 95,
        importT1: 49,
        importT2: 15,
        importT3: 31,
        exportT: 90,
        exportT1: 90,
        exportT2: 0,
        exportT3: 0,
        net: 5,
        solarGenerated: 136,
      }
    }

    return reading
  })

const hasReadingsChanged = (before: Reading[], after: Reading[]) =>
  JSON.stringify(before) !== JSON.stringify(after)

const isUuid = (value: string) =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value,
  )

const createReadingId = () => {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }

  const template = 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'
  return template.replace(/[xy]/g, (char) => {
    const random = Math.floor(Math.random() * 16)
    const value = char === 'x' ? random : (random & 0x3) | 0x8
    return value.toString(16)
  })
}

const normalizeReadingIds = (items: Reading[]) =>
  items.map((reading) => ({
    ...reading,
    id: isUuid(reading.id) ? reading.id : createReadingId(),
    time: reading.time || '07:00',
  }))

const defaultReadingTime = () => dayjs().format('HH:mm')

const formatUnits = (value: number) => `${value.toLocaleString('en-IN')} kWh`

const getPresetStartDate = (preset: RangePreset, maxDate: string) => {
  const end = dayjs(maxDate)
  switch (preset) {
    case '2D':
      return end.subtract(1, 'day').format('YYYY-MM-DD')
    case '1W':
      return end.subtract(6, 'day').format('YYYY-MM-DD')
    case '2W':
      return end.subtract(13, 'day').format('YYYY-MM-DD')
    case '1M':
      return end.subtract(1, 'month').add(1, 'day').format('YYYY-MM-DD')
    case '6M':
      return end.subtract(6, 'month').add(1, 'day').format('YYYY-MM-DD')
    case '1Y':
      return end.subtract(1, 'year').add(1, 'day').format('YYYY-MM-DD')
    case 'YTD':
      return end.startOf('year').format('YYYY-MM-DD')
    case 'ALL':
    case 'CUSTOM':
    default:
      return ''
  }
}

const getCycleBoundaries = (dateValue: string, billingDay: BillingDay) => {
  const normalizedBillingDay = normalizeBillingDay(billingDay)
  const date = dayjs(dateValue)
  const start =
    date.date() >= normalizedBillingDay
      ? date.date(normalizedBillingDay)
      : date.subtract(1, 'month').date(normalizedBillingDay)
  const end = start.add(1, 'month').subtract(1, 'day')
  return {
    key: `${start.format('YYYY-MM-DD')}_${end.format('YYYY-MM-DD')}`,
    start: start.format('YYYY-MM-DD'),
    end: end.format('YYYY-MM-DD'),
  }
}

const buildFinancialYearCycles = (anchorDate: string, billingDay: BillingDay) => {
  const normalizedBillingDay = normalizeBillingDay(billingDay)
  const anchor = dayjs(anchorDate)
  const fyStartYear = anchor.month() >= 3 ? anchor.year() : anchor.year() - 1
  const fyStart = dayjs(`${fyStartYear}-04-${normalizedBillingDay.toString().padStart(2, '0')}`)

  return Array.from({ length: 12 }, (_, index) => {
    const start = fyStart.add(index, 'month')
    const end = start.add(1, 'month').subtract(1, 'day')
    return {
      key: `${start.format('YYYY-MM-DD')}_${end.format('YYYY-MM-DD')}`,
      start: start.format('YYYY-MM-DD'),
      end: end.format('YYYY-MM-DD'),
    }
  })
}

const summarizeBillingCycles = (
  readings: Reading[],
  derivedReadings: DerivedReading[],
  billingDay: BillingDay,
): BillingCycleSummary[] => {
  if (!readings.length || !derivedReadings.length) {
    return []
  }

  const latestDate = readings[readings.length - 1].date
  const financialYearCycles = buildFinancialYearCycles(latestDate, billingDay)

  const cycles = financialYearCycles.map((cycle) => ({
    key: cycle.key,
    start: cycle.start,
    end: cycle.end,
    importTotal: 0,
    exportTotal: 0,
    net: 0,
    consumedUnits: 0,
    openingBank: 0,
    bankUsed: 0,
    bankAdded: 0,
    payableUnits: 0,
    settlementPayoutUnits: 0,
    closingBank: 0,
  }))

  const cycleIndexByKey = new Map(cycles.map((cycle, index) => [cycle.key, index]))

  for (const reading of derivedReadings) {
    const bounds = getCycleBoundaries(reading.date, billingDay)
    const index = cycleIndexByKey.get(bounds.key)
    if (index === undefined) {
      continue
    }

    cycles[index].importTotal += reading.importDelta
    cycles[index].exportTotal += reading.exportDelta
    cycles[index].net += reading.netDelta
  }

  const rowsByCycle = new Map<string, Reading[]>()
  for (const reading of readings) {
    const bounds = getCycleBoundaries(reading.date, billingDay)
    if (!rowsByCycle.has(bounds.key)) {
      rowsByCycle.set(bounds.key, [])
    }
    rowsByCycle.get(bounds.key)?.push(reading)
  }

  const recordedCycles = cycles.filter((cycle) => (rowsByCycle.get(cycle.key)?.length ?? 0) > 0)

  let runningBank = 0

  for (let i = 0; i < recordedCycles.length; i += 1) {
    const cycle = recordedCycles[i]
    const cycleRows = sortReadings(rowsByCycle.get(cycle.key) ?? [])

    const firstRow = cycleRows[0]
    const cycleOpeningCredit = firstRow ? Math.max(0, -(calculateNet(firstRow) || 0)) : 0
    cycle.openingBank = runningBank + cycleOpeningCredit
    cycle.consumedUnits = Math.max(cycle.net, 0)

    if (cycle.net >= 0) {
      cycle.bankUsed = Math.min(cycle.openingBank, cycle.net)
      cycle.payableUnits = cycle.net - cycle.bankUsed
      cycle.bankAdded = 0
      cycle.closingBank = cycle.openingBank - cycle.bankUsed
    } else {
      cycle.bankUsed = 0
      cycle.payableUnits = 0
      cycle.bankAdded = Math.abs(cycle.net)
      cycle.closingBank = cycle.openingBank + cycle.bankAdded
    }

    const settlementDate = dayjs(`${dayjs(cycle.start).year()}-03-31`)
    if (
      (settlementDate.isSame(dayjs(cycle.start)) ||
        settlementDate.isAfter(dayjs(cycle.start))) &&
      (settlementDate.isSame(dayjs(cycle.end)) ||
        settlementDate.isBefore(dayjs(cycle.end)))
    ) {
      cycle.settlementPayoutUnits = cycle.closingBank
      cycle.closingBank = 0
    }

    runningBank = cycle.closingBank
  }

  return recordedCycles
}

type ReadingFormState = {
  date: string
  time: string
  importT: string
  importT1: string
  importT2: string
  importT3: string
  exportT: string
  exportT1: string
  exportT2: string
  exportT3: string
  net: string
  solarGenerated: string
  note: string
}

const defaultFormState = (): ReadingFormState => ({
  date: dayjs().format('YYYY-MM-DD'),
  time: defaultReadingTime(),
  importT: '',
  importT1: '0',
  importT2: '0',
  importT3: '0',
  exportT: '',
  exportT1: '0',
  exportT2: '0',
  exportT3: '0',
  net: '',
  solarGenerated: '0',
  note: '',
})

const parseOptionalTotal = (value: string) => {
  if (value.trim() === '') {
    return undefined
  }
  return toNum(value)
}

const parseOptionalNet = (value: string) => {
  if (value.trim() === '') {
    return undefined
  }
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : undefined
}

type ParsedBillData = {
  billDate?: string
  billGeneratedAt?: string
  importT?: number
  exportT?: number
  net?: number
  importT1?: number
  importT2?: number
  importT3?: number
  exportT1?: number
  exportT2?: number
  exportT3?: number
}

const toNormalizedText = (text: string) => text.replace(/\r/g, '\n').replace(/[\t ]+/g, ' ')

const parseNumeric = (value: string) => {
  const cleaned = value.replace(/,/g, '').trim()
  const parsed = Number(cleaned)
  return Number.isFinite(parsed) ? parsed : undefined
}

const parseDateCandidate = (value: string) => {
  const cleaned = value.trim().replace(/[.,]$/, '')
  const formats = [
    'DD/MM/YYYY',
    'D/M/YYYY',
    'DD-MM-YYYY',
    'D-M-YYYY',
    'YYYY-MM-DD',
    'DD.MM.YYYY',
    'D.M.YYYY',
    'DD MMM YYYY',
    'D MMM YYYY',
    'DD-MMM-YYYY',
    'D-MMM-YYYY',
  ]

  for (const format of formats) {
    const parsed = dayjs(cleaned, format, true)
    if (parsed.isValid()) {
      return parsed.format('YYYY-MM-DD')
    }
  }

  const fallback = dayjs(cleaned)
  return fallback.isValid() ? fallback.format('YYYY-MM-DD') : undefined
}

const extractDateByLabels = (text: string, labels: string[]) => {
  const datePattern = '(\\d{1,2}[\\/.-]\\d{1,2}[\\/.-]\\d{2,4}|\\d{4}-\\d{2}-\\d{2}|\\d{1,2}\\s+[A-Za-z]{3,9}\\s+\\d{4})'
  for (const label of labels) {
    const expression = new RegExp(`${label}[^\\n\\d]{0,25}${datePattern}`, 'i')
    const match = text.match(expression)
    if (match?.[1]) {
      const parsed = parseDateCandidate(match[1])
      if (parsed) {
        return parsed
      }
    }
  }
  return undefined
}

const extractNumberByLabels = (text: string, labels: string[]) => {
  for (const label of labels) {
    const expression = new RegExp(`${label}[^\\n\\d-]{0,30}(-?\\d[\\d,]*(?:\\.\\d+)?)`, 'i')
    const match = text.match(expression)
    if (match?.[1]) {
      const parsed = parseNumeric(match[1])
      if (parsed !== undefined) {
        return parsed
      }
    }
  }
  return undefined
}

const parseKsebBillText = (rawText: string): ParsedBillData => {
  const text = toNormalizedText(rawText)

  const billDate = extractDateByLabels(text, [
    'bill\\s*date',
    'reading\\s*date',
    'current\\s*reading\\s*date',
    'billing\\s*date',
  ])

  const generatedDate = extractDateByLabels(text, [
    'bill\\s*generated\\s*(?:on|date)?',
    'generated\\s*on',
    'issue\\s*date',
  ])

  const importT = extractNumberByLabels(text, [
    'import\\s*(?:reading|total|units|kwh)',
    'kseb\\s*import',
    'imp\\s*(?:total|reading)',
  ])

  const exportT = extractNumberByLabels(text, [
    'export\\s*(?:reading|total|units|kwh)',
    'kseb\\s*export',
    'exp\\s*(?:total|reading)',
  ])

  const net = extractNumberByLabels(text, ['net\\s*(?:units|kwh|reading|usage)'])

  const importT1 = extractNumberByLabels(text, ['import\\s*t1', 'imp\\s*t1', 't1\\s*import'])
  const importT2 = extractNumberByLabels(text, ['import\\s*t2', 'imp\\s*t2', 't2\\s*import'])
  const importT3 = extractNumberByLabels(text, ['import\\s*t3', 'imp\\s*t3', 't3\\s*import'])

  const exportT1 = extractNumberByLabels(text, ['export\\s*t1', 'exp\\s*t1', 't1\\s*export'])
  const exportT2 = extractNumberByLabels(text, ['export\\s*t2', 'exp\\s*t2', 't2\\s*export'])
  const exportT3 = extractNumberByLabels(text, ['export\\s*t3', 'exp\\s*t3', 't3\\s*export'])

  const billGeneratedAt = generatedDate ? `${generatedDate}T${dayjs().format('HH:mm')}` : undefined

  return {
    billDate,
    billGeneratedAt,
    importT,
    exportT,
    net,
    importT1,
    importT2,
    importT3,
    exportT1,
    exportT2,
    exportT3,
  }
}

const extractTextFromPdf = async (file: File) => {
  const pdfjs = await import('pdfjs-dist')
  pdfjs.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjs.version}/pdf.worker.min.js`

  const data = new Uint8Array(await file.arrayBuffer())
  const pdf = await pdfjs.getDocument({ data }).promise
  const chunks: string[] = []

  for (let pageIndex = 1; pageIndex <= pdf.numPages; pageIndex += 1) {
    const page = await pdf.getPage(pageIndex)
    const textContent = await page.getTextContent()
    const pageText = textContent.items
      .map((item) => ('str' in item ? item.str : ''))
      .join(' ')
    chunks.push(pageText)
  }

  return chunks.join('\n')
}

const extractTextFromImage = async (file: File) => {
  const { createWorker } = await import('tesseract.js')
  const worker = await createWorker('eng')

  try {
    const {
      data: { text },
    } = await worker.recognize(file)
    return text
  } finally {
    await worker.terminate()
  }
}

const extractBillText = async (file: File) => {
  const lowerName = file.name.toLowerCase()
  if (file.type.includes('pdf') || lowerName.endsWith('.pdf')) {
    return extractTextFromPdf(file)
  }
  return extractTextFromImage(file)
}

const defaultBillGeneratedAt = () => dayjs().format('YYYY-MM-DDTHH:mm')

const toPercent = (value: number) => `${value.toFixed(1)}%`

const formatSigned = (value: number) => (value >= 0 ? `+${value.toFixed(2)}` : value.toFixed(2))

function App() {
  const [readings, setReadings] = useState<Reading[]>([])
  const [billingDay, setBillingDay] = useState<BillingDay>(1)
  const [isHydrated, setIsHydrated] = useState(false)
  const [formState, setFormState] = useState<ReadingFormState>(defaultFormState)
  const [rangePreset, setRangePreset] = useState<RangePreset>('ALL')
  const [customStart, setCustomStart] = useState<string>('')
  const [customEnd, setCustomEnd] = useState<string>('')
  const [cloudEmail, setCloudEmail] = useState('')
  const [cloudPassword, setCloudPassword] = useState('')
  const [cloudUser, setCloudUser] = useState<User | null>(null)
  const [cloudBusy, setCloudBusy] = useState(false)
  const [cloudMessage, setCloudMessage] = useState('')
  const [selectedBillingCycleKey, setSelectedBillingCycleKey] = useState<string | null>(null)
  const [editingReadingId, setEditingReadingId] = useState<string | null>(null)
  const [lastDeletedReading, setLastDeletedReading] = useState<Reading | null>(null)
  const [activityLog, setActivityLog] = useState<ActivityLogEntry[]>([])
  const [monthlyPayableGoal, setMonthlyPayableGoal] = useState('0')
  const [monthlyImportGoal, setMonthlyImportGoal] = useState('0')
  const [syncStatus, setSyncStatus] = useState<SyncStatus>('idle')
  const [lastSyncAt, setLastSyncAt] = useState<string>('')
  const [pendingSyncChanges, setPendingSyncChanges] = useState(0)
  const [showManualSyncTools, setShowManualSyncTools] = useState(false)
  const [installPromptEvent, setInstallPromptEvent] =
    useState<BeforeInstallPromptEvent | null>(null)
  const [updateMessage, setUpdateMessage] = useState('')
  const [isReadingModalOpen, setIsReadingModalOpen] = useState(false)
  const [readingFormErrors, setReadingFormErrors] = useState<string[]>([])
  const [appToast, setAppToast] = useState('')
  const [activeTab, setActiveTab] = useState<AppTab>('home')
  const [billingReferenceDate, setBillingReferenceDate] = useState(dayjs().format('YYYY-MM-DD'))
  const [billGeneratedAt, setBillGeneratedAt] = useState(defaultBillGeneratedAt)
  const [billImportBusy, setBillImportBusy] = useState(false)
  const [billImportMessage, setBillImportMessage] = useState('')

  useEffect(() => {
    const rawReadings = localStorage.getItem(STORAGE_KEY)
    const rawSettings = localStorage.getItem(SETTINGS_KEY)
    const versionRaw = localStorage.getItem(DATA_VERSION_KEY)
    const version = versionRaw ? Number(versionRaw) : 0

    if (rawReadings) {
      const parsed = JSON.parse(rawReadings) as Reading[]
      let normalized = parsed.length ? sortReadings(parsed) : sortReadings(seededReadings)
      const corrected = applyKnownCorrections(normalized)
      const idNormalized = normalizeReadingIds(corrected)

      // One-time correction for earlier seed values in existing local storage.
      if (version < DATA_VERSION) {
        localStorage.setItem(DATA_VERSION_KEY, String(DATA_VERSION))
      }

      if (hasReadingsChanged(normalized, idNormalized)) {
        normalized = sortReadings(idNormalized)
        localStorage.setItem(STORAGE_KEY, JSON.stringify(normalized))
      } else {
        normalized = sortReadings(idNormalized)
      }

      setReadings(normalized)
    } else {
      setReadings(sortReadings(seededReadings))
      localStorage.setItem(DATA_VERSION_KEY, String(DATA_VERSION))
    }

    if (rawSettings) {
      const parsedSettings = JSON.parse(rawSettings) as {
        billingDay: BillingDay
        monthlyPayableGoal?: number
        monthlyImportGoal?: number
        billingReferenceDate?: string
        billGeneratedAt?: string
      }
      setBillingDay(normalizeBillingDay(parsedSettings.billingDay ?? 1))
      setMonthlyPayableGoal(String(parsedSettings.monthlyPayableGoal ?? 0))
      setMonthlyImportGoal(String(parsedSettings.monthlyImportGoal ?? 0))
      setBillingReferenceDate(
        parsedSettings.billingReferenceDate ?? dayjs().format('YYYY-MM-DD'),
      )
      setBillGeneratedAt(parsedSettings.billGeneratedAt ?? defaultBillGeneratedAt())
    }

    const rawLog = localStorage.getItem(ACTIVITY_LOG_KEY)
    if (rawLog) {
      const parsed = JSON.parse(rawLog) as ActivityLogEntry[]
      setActivityLog(parsed.slice(0, 100))
    }

    setIsHydrated(true)
  }, [])

  useEffect(() => {
    if (!isCloudEnabled || !supabase) {
      return
    }

    let isMounted = true

    void supabase.auth.getUser().then(({ data }) => {
      if (isMounted) {
        setCloudUser(data.user ?? null)
      }
    })

    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      setCloudUser(session?.user ?? null)
    })

    return () => {
      isMounted = false
      listener.subscription.unsubscribe()
    }
  }, [])

  useEffect(() => {
    if (!isHydrated) {
      return
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(readings))
  }, [readings, isHydrated])

  useEffect(() => {
    if (!isHydrated) {
      return
    }
    localStorage.setItem(
      SETTINGS_KEY,
      JSON.stringify({
        billingDay,
        monthlyPayableGoal: Number(monthlyPayableGoal) || 0,
        monthlyImportGoal: Number(monthlyImportGoal) || 0,
        billingReferenceDate,
        billGeneratedAt,
      }),
    )
  }, [
    billingDay,
    isHydrated,
    monthlyImportGoal,
    monthlyPayableGoal,
    billingReferenceDate,
    billGeneratedAt,
  ])

  useEffect(() => {
    if (!isHydrated) {
      return
    }
    localStorage.setItem(ACTIVITY_LOG_KEY, JSON.stringify(activityLog.slice(0, 100)))
  }, [activityLog, isHydrated])

  useEffect(() => {
    const onBeforeInstallPrompt = (event: Event) => {
      event.preventDefault()
      setInstallPromptEvent(event as BeforeInstallPromptEvent)
    }

    window.addEventListener('beforeinstallprompt', onBeforeInstallPrompt)
    return () => {
      window.removeEventListener('beforeinstallprompt', onBeforeInstallPrompt)
    }
  }, [])

  useEffect(() => {
    if (syncStatus === 'error' || pendingSyncChanges > 0) {
      setShowManualSyncTools(true)
    }
  }, [syncStatus, pendingSyncChanges])

  useEffect(() => {
    if (!appToast) {
      return
    }

    const timer = window.setTimeout(() => {
      setAppToast('')
    }, 3200)

    return () => {
      window.clearTimeout(timer)
    }
  }, [appToast])

  const sortedReadings = useMemo(() => sortReadings(readings), [readings])
  const derivedReadings = useMemo(() => deriveReadings(sortedReadings), [sortedReadings])

  const filteredReadings = useMemo(() => {
    if (!derivedReadings.length) {
      return []
    }

    const minDate = derivedReadings[0].date
    const maxDate = derivedReadings[derivedReadings.length - 1].date

    let startDate = minDate
    let endDate = maxDate

    if (rangePreset !== 'ALL') {
      if (rangePreset === 'CUSTOM') {
        startDate = customStart || minDate
        endDate = customEnd || maxDate
      } else {
        startDate = getPresetStartDate(rangePreset, maxDate) || minDate
      }
    }

    return derivedReadings.filter((reading) => {
      const date = dayjs(reading.date)
      return (
        (date.isSame(dayjs(startDate)) || date.isAfter(dayjs(startDate))) &&
        (date.isSame(dayjs(endDate)) || date.isBefore(dayjs(endDate)))
      )
    })
  }, [derivedReadings, rangePreset, customStart, customEnd])

  const rangeSummary = useMemo(() => {
    const summary = filteredReadings.reduce(
      (acc, reading) => {
        acc.importTotal += reading.importDelta
        acc.exportTotal += reading.exportDelta
        acc.net += reading.netDelta
        acc.solarTotal += reading.solarDelta
        return acc
      },
      {
        importTotal: 0,
        exportTotal: 0,
        net: 0,
        solarTotal: 0,
      },
    )

    return summary
  }, [filteredReadings])

  const chartData = useMemo(
    () =>
      filteredReadings.map((reading) => ({
        date: dayjs(`${reading.date}T${reading.time}`).format('DD MMM HH:mm'),
        import: reading.importDelta,
        export: reading.exportDelta,
        net: reading.netDelta,
        solar: reading.solarDelta,
      })),
    [filteredReadings],
  )

  const billingCycles = useMemo(
    () => summarizeBillingCycles(sortedReadings, derivedReadings, billingDay),
    [sortedReadings, derivedReadings, billingDay],
  )

  const currentMonthTracker = useMemo(() => {
    const latest = sortedReadings[sortedReadings.length - 1]
    if (!latest) {
      return {
        periodLabel: '-',
        readingsCount: 0,
        importConsumed: 0,
        exportConsumed: 0,
        netConsumed: 0,
        solarAdded: 0,
        openingBank: 0,
        bankUsed: 0,
        bankAdded: 0,
        payableUnits: 0,
        closingBank: 0,
        remainingBank: 0,
        totalImport: 0,
        totalExport: 0,
        totalNet: 0,
        totalSolar: 0,
      }
    }

    // If a specific billing cycle is selected and found in billingCycles, use that
    if (selectedBillingCycleKey) {
      const selectedCycle = billingCycles.find((c) => c.key === selectedBillingCycleKey)
      if (selectedCycle) {
        const inCycle = sortReadings(
          sortedReadings.filter((reading) => {
            const date = dayjs(reading.date)
            return (
              (date.isSame(dayjs(selectedCycle.start)) ||
                date.isAfter(dayjs(selectedCycle.start))) &&
              (date.isSame(dayjs(selectedCycle.end)) ||
                date.isBefore(dayjs(selectedCycle.end)))
            )
          }),
        )

        const first = inCycle[0]
        const last = inCycle[inCycle.length - 1]

        let importConsumed = 0
        let exportConsumed = 0
        let solarAdded = 0

        if (first && last && inCycle.length > 1) {
          importConsumed = calculateImportTotal(last) - calculateImportTotal(first)
          exportConsumed = calculateExportTotal(last) - calculateExportTotal(first)
          solarAdded = last.solarGenerated - first.solarGenerated
        }

        const netConsumed = importConsumed - exportConsumed

        return {
          periodLabel: `${dayjs(selectedCycle.start).format('DD MMM YYYY')} - ${dayjs(selectedCycle.end).format('DD MMM YYYY')}`,
          readingsCount: inCycle.length,
          importConsumed,
          exportConsumed,
          netConsumed,
          solarAdded,
          openingBank: selectedCycle.openingBank,
          bankUsed: selectedCycle.bankUsed,
          bankAdded: selectedCycle.bankAdded,
          payableUnits: selectedCycle.payableUnits,
          closingBank: selectedCycle.closingBank,
          remainingBank: selectedCycle.closingBank,
          totalImport: last ? calculateImportTotal(last) : 0,
          totalExport: last ? calculateExportTotal(last) : 0,
          totalNet: last ? calculateNet(last) : 0,
          totalSolar: last ? last.solarGenerated : 0,
        }
      }
    }

    // Default: use current month based on latest reading
    const bounds = getCycleBoundaries(latest.date, billingDay)
    const inCycle = sortReadings(
      sortedReadings.filter((reading) => {
        const date = dayjs(reading.date)
        return (
          (date.isSame(dayjs(bounds.start)) || date.isAfter(dayjs(bounds.start))) &&
          (date.isSame(dayjs(bounds.end)) || date.isBefore(dayjs(bounds.end)))
        )
      }),
    )

    const first = inCycle[0]
    const last = inCycle[inCycle.length - 1]

    let importConsumed = 0
    let exportConsumed = 0
    let solarAdded = 0

    if (first && last && inCycle.length > 1) {
      importConsumed = calculateImportTotal(last) - calculateImportTotal(first)
      exportConsumed = calculateExportTotal(last) - calculateExportTotal(first)
      solarAdded = last.solarGenerated - first.solarGenerated
    }

    const netConsumed = importConsumed - exportConsumed
    const openingBank = first ? Math.max(0, -calculateNet(first)) : 0
    const payableUnits = Math.max(netConsumed - openingBank, 0)
    const remainingBank = Math.max(openingBank - netConsumed, 0)

    // Get the current month's cycle data from billingCycles if available
    const currentCycle = billingCycles.find((c) => c.key === bounds.key)
    const bankUsed = currentCycle?.bankUsed ?? 0
    const bankAdded = currentCycle?.bankAdded ?? 0
    const closingBank = currentCycle?.closingBank ?? remainingBank

    return {
      periodLabel: `${dayjs(bounds.start).format('DD MMM YYYY')} - ${dayjs(bounds.end).format('DD MMM YYYY')}`,
      readingsCount: inCycle.length,
      importConsumed,
      exportConsumed,
      netConsumed,
      solarAdded,
      openingBank,
      bankUsed,
      bankAdded,
      payableUnits,
      closingBank,
      remainingBank,
      totalImport: calculateImportTotal(latest),
      totalExport: calculateExportTotal(latest),
      totalNet: calculateNet(latest),
      totalSolar: latest.solarGenerated,
    }
  }, [sortedReadings, billingDay, billingCycles, selectedBillingCycleKey])

  const currentBank = billingCycles.length
    ? billingCycles[billingCycles.length - 1].closingBank
    : 0

  const selectedCycle = useMemo(() => {
    if (!billingCycles.length) {
      return undefined
    }
    if (selectedBillingCycleKey) {
      return billingCycles.find((cycle) => cycle.key === selectedBillingCycleKey)
    }
    return billingCycles[billingCycles.length - 1]
  }, [billingCycles, selectedBillingCycleKey])

  const selectedCycleReadings = useMemo(() => {
    if (!selectedCycle) {
      return []
    }

    return derivedReadings.filter((reading) => {
      const date = dayjs(reading.date)
      return (
        (date.isSame(dayjs(selectedCycle.start)) || date.isAfter(dayjs(selectedCycle.start))) &&
        (date.isSame(dayjs(selectedCycle.end)) || date.isBefore(dayjs(selectedCycle.end)))
      )
    })
  }, [derivedReadings, selectedCycle])

  const previousCycle = useMemo(() => {
    if (!selectedCycle) {
      return undefined
    }
    const index = billingCycles.findIndex((cycle) => cycle.key === selectedCycle.key)
    if (index <= 0) {
      return undefined
    }
    return billingCycles[index - 1]
  }, [billingCycles, selectedCycle])

  const cycleComparison = useMemo(() => {
    if (!selectedCycle || !previousCycle) {
      return null
    }

    const importDiff = selectedCycle.importTotal - previousCycle.importTotal
    const payableDiff = selectedCycle.payableUnits - previousCycle.payableUnits
    const netDiff = selectedCycle.net - previousCycle.net

    const safePct = (current: number, prev: number) =>
      prev === 0 ? 0 : ((current - prev) / Math.abs(prev)) * 100

    return {
      importDiff,
      importPct: safePct(selectedCycle.importTotal, previousCycle.importTotal),
      payableDiff,
      payablePct: safePct(selectedCycle.payableUnits, previousCycle.payableUnits),
      netDiff,
      netPct: safePct(selectedCycle.net, previousCycle.net),
    }
  }, [selectedCycle, previousCycle])

  const forecast = useMemo(() => {
    if (!selectedCycle || !selectedCycleReadings.length) {
      return null
    }

    const cycleStart = dayjs(selectedCycle.start)
    const cycleEnd = dayjs(selectedCycle.end)
    const totalDays = cycleEnd.diff(cycleStart, 'day') + 1
    const lastReadingDate = dayjs(
      selectedCycleReadings[selectedCycleReadings.length - 1].date,
    )
    const elapsedDays = Math.max(1, lastReadingDate.diff(cycleStart, 'day') + 1)
    const multiplier = Math.max(1, totalDays / elapsedDays)

    return {
      elapsedDays,
      totalDays,
      projectedImport: selectedCycle.importTotal * multiplier,
      projectedExport: selectedCycle.exportTotal * multiplier,
      projectedNet: selectedCycle.net * multiplier,
      projectedPayable: selectedCycle.payableUnits * multiplier,
      projectedSolar: selectedCycleReadings.reduce((sum, row) => sum + row.solarDelta, 0) * multiplier,
    }
  }, [selectedCycle, selectedCycleReadings])

  const anomalies = useMemo(() => {
    const alerts: Array<{ id: string; message: string; level: 'warn' | 'danger' }> = []

    for (let i = 1; i < derivedReadings.length; i += 1) {
      const current = derivedReadings[i]
      const previousWindow = derivedReadings.slice(Math.max(1, i - 5), i)

      const avgImport =
        previousWindow.reduce((sum, row) => sum + row.importDelta, 0) /
        Math.max(previousWindow.length, 1)

      if (current.importDelta < 0 || current.exportDelta < 0 || current.solarDelta < 0) {
        alerts.push({
          id: `neg-${current.id}`,
          level: 'danger',
          message: `${dayjs(current.date).format('DD MMM')}: Negative usage delta found. Check meter entry order/values.`,
        })
      }

      if (avgImport > 0 && current.importDelta > avgImport * 2.5) {
        alerts.push({
          id: `spike-${current.id}`,
          level: 'warn',
          message: `${dayjs(current.date).format('DD MMM')}: Import spike ${current.importDelta.toFixed(2)} kWh vs avg ${avgImport.toFixed(2)} kWh.`,
        })
      }
    }

    return alerts.slice(-8).reverse()
  }, [derivedReadings])

  const solarKpis = useMemo(() => {
    if (!selectedCycle) {
      return null
    }

    const solarAdded = selectedCycleReadings.reduce((sum, row) => sum + row.solarDelta, 0)
    const exportUsed = selectedCycle.exportTotal
    const importUsed = selectedCycle.importTotal
    const selfConsumedSolar = Math.max(solarAdded - exportUsed, 0)

    return {
      solarAdded,
      selfConsumedSolar,
      selfConsumptionRatio: solarAdded > 0 ? (selfConsumedSolar / solarAdded) * 100 : 0,
      exportRatio: solarAdded > 0 ? (exportUsed / solarAdded) * 100 : 0,
      solarOffsetRatio: importUsed > 0 ? (selfConsumedSolar / importUsed) * 100 : 0,
    }
  }, [selectedCycle, selectedCycleReadings])

  const payableGoalValue = Number(monthlyPayableGoal) || 0
  const importGoalValue = Number(monthlyImportGoal) || 0
  const goalProgress = useMemo(() => {
    if (!selectedCycle) {
      return null
    }
    const payableUsedPct = payableGoalValue > 0 ? (selectedCycle.payableUnits / payableGoalValue) * 100 : 0
    const importUsedPct = importGoalValue > 0 ? (selectedCycle.importTotal / importGoalValue) * 100 : 0
    return {
      payableUsedPct,
      importUsedPct,
    }
  }, [selectedCycle, payableGoalValue, importGoalValue])

  const logActivity = (action: string, details: string) => {
    const entry: ActivityLogEntry = {
      id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
      timestamp: new Date().toISOString(),
      action,
      details,
    }
    setActivityLog((prev) => [entry, ...prev].slice(0, 100))
  }

  const saveRecoverySnapshot = (data: Reading[]) => {
    localStorage.setItem(
      LAST_BACKUP_KEY,
      JSON.stringify({
        createdAt: new Date().toISOString(),
        readings: data,
      }),
    )
  }

  const markLocalChange = () => {
    setPendingSyncChanges((prev) => prev + 1)
    if (cloudUser) {
      setSyncStatus('idle')
    }
  }

  const saveBillingConfigFromBill = () => {
    if (!billingReferenceDate) {
      setAppToast('Please enter KSEB billing date first.')
      return
    }

    const nextBillingDay = normalizeBillingDay(dayjs(billingReferenceDate).date())
    setBillingDay(nextBillingDay)

    const cycle = getCycleBoundaries(billingReferenceDate, nextBillingDay)
    setSelectedBillingCycleKey(cycle.key)
    setRangePreset('CUSTOM')
    setCustomStart(cycle.start)
    setCustomEnd(cycle.end)
    setAppToast(`Billing cycle updated from bill date (${dayjs(billingReferenceDate).format('DD MMM YYYY')}).`)
  }

  const applyBillingDateToCycle = (date: string) => {
    const nextBillingDay = normalizeBillingDay(dayjs(date).date())
    setBillingDay(nextBillingDay)

    const cycle = getCycleBoundaries(date, nextBillingDay)
    setSelectedBillingCycleKey(cycle.key)
    setRangePreset('CUSTOM')
    setCustomStart(cycle.start)
    setCustomEnd(cycle.end)
  }

  const autoFillFromParsedBill = (parsed: ParsedBillData, fileName: string) => {
    const resolvedImportT = parsed.importT
    const resolvedExportT = parsed.exportT

    const nextDate = parsed.billDate ?? dayjs().format('YYYY-MM-DD')
    const nextTime = parsed.billGeneratedAt
      ? dayjs(parsed.billGeneratedAt).format('HH:mm')
      : dayjs().format('HH:mm')

    setEditingReadingId(null)
    setReadingFormErrors([])
    setFormState((prev) => ({
      ...prev,
      date: nextDate,
      time: nextTime,
      importT: resolvedImportT !== undefined ? String(resolvedImportT) : prev.importT,
      exportT: resolvedExportT !== undefined ? String(resolvedExportT) : prev.exportT,
      net: parsed.net !== undefined ? String(parsed.net) : prev.net,
      importT1: parsed.importT1 !== undefined ? String(parsed.importT1) : prev.importT1,
      importT2: parsed.importT2 !== undefined ? String(parsed.importT2) : prev.importT2,
      importT3: parsed.importT3 !== undefined ? String(parsed.importT3) : prev.importT3,
      exportT1: parsed.exportT1 !== undefined ? String(parsed.exportT1) : prev.exportT1,
      exportT2: parsed.exportT2 !== undefined ? String(parsed.exportT2) : prev.exportT2,
      exportT3: parsed.exportT3 !== undefined ? String(parsed.exportT3) : prev.exportT3,
      note: `Auto-read from bill: ${fileName}`,
    }))

    if (parsed.billDate) {
      setBillingReferenceDate(parsed.billDate)
      applyBillingDateToCycle(parsed.billDate)
    }

    if (parsed.billGeneratedAt) {
      setBillGeneratedAt(parsed.billGeneratedAt)
    }

    setIsReadingModalOpen(true)
    setAppToast('Bill parsed. Verify values and tap Save Reading.')
  }

  const importKsebBillFromFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) {
      return
    }

    event.target.value = ''
    setBillImportBusy(true)
    setBillImportMessage('Extracting bill details...')

    try {
      const extractedText = await extractBillText(file)
      const parsed = parseKsebBillText(extractedText)

      const foundAnyValue =
        parsed.billDate !== undefined ||
        parsed.importT !== undefined ||
        parsed.exportT !== undefined ||
        parsed.net !== undefined ||
        parsed.importT1 !== undefined ||
        parsed.importT2 !== undefined ||
        parsed.importT3 !== undefined ||
        parsed.exportT1 !== undefined ||
        parsed.exportT2 !== undefined ||
        parsed.exportT3 !== undefined

      if (!foundAnyValue) {
        setBillImportMessage('Could not detect bill fields. Please add values manually.')
        return
      }

      autoFillFromParsedBill(parsed, file.name)

      const summary = [
        parsed.billDate ? `Date ${dayjs(parsed.billDate).format('DD MMM YYYY')}` : null,
        parsed.importT !== undefined ? `Import ${parsed.importT}` : null,
        parsed.exportT !== undefined ? `Export ${parsed.exportT}` : null,
      ]
        .filter(Boolean)
        .join(' | ')

      setBillImportMessage(summary ? `Detected: ${summary}` : 'Detected bill details and filled reading form.')
      logActivity('import-kseb-bill', `Parsed bill file ${file.name}`)
    } catch (error) {
      setBillImportMessage(
        `Bill parsing failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
      )
    } finally {
      setBillImportBusy(false)
    }
  }

  const openAddReadingModal = () => {
    setEditingReadingId(null)
    setFormState(defaultFormState())
    setReadingFormErrors([])
    setIsReadingModalOpen(true)
  }

  const validateReadingForm = () => {
    const errors: string[] = []

    if (!formState.date.trim()) {
      errors.push('Date is required.')
    }

    if (!formState.time.trim()) {
      errors.push('Time is required.')
    }

    const readingMoment = dayjs(`${formState.date}T${formState.time || '00:00'}`)
    if (!readingMoment.isValid()) {
      errors.push('Please enter a valid date and time.')
      return errors
    }

    const importTZTotal =
      toNum(formState.importT1) + toNum(formState.importT2) + toNum(formState.importT3)
    const exportTZTotal =
      toNum(formState.exportT1) + toNum(formState.exportT2) + toNum(formState.exportT3)
    const enteredImportT = parseOptionalTotal(formState.importT)
    const enteredExportT = parseOptionalTotal(formState.exportT)

    const effectiveImportT = enteredImportT ?? importTZTotal
    const effectiveExportT = enteredExportT ?? exportTZTotal

    if (effectiveImportT === 0 && effectiveExportT === 0 && toNum(formState.solarGenerated) === 0) {
      errors.push('Import, export, and solar cannot all be zero. Please verify values.')
    }

    const comparableReadings = editingReadingId
      ? sortedReadings.filter((reading) => reading.id !== editingReadingId)
      : sortedReadings

    const previousReading = [...comparableReadings]
      .filter((reading) => getReadingTimestamp(reading) <= readingMoment.valueOf())
      .sort((a, b) => getReadingTimestamp(b) - getReadingTimestamp(a))[0]

    if (previousReading) {
      const prevImportTotal = calculateImportTotal(previousReading)
      const prevExportTotal = calculateExportTotal(previousReading)
      const prevSolarTotal = previousReading.solarGenerated

      if (effectiveImportT < prevImportTotal) {
        errors.push('Import total is less than previous reading. Please check entry.')
      }

      if (effectiveExportT < prevExportTotal) {
        errors.push('Export total is less than previous reading. Please check entry.')
      }

      if (toNum(formState.solarGenerated) < prevSolarTotal) {
        errors.push('Solar generated is less than previous reading. Please check entry.')
      }
    }

    return errors
  }

  const handleFieldChange =
    (field: keyof ReadingFormState) =>
    (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      setFormState((prev) => ({
        ...prev,
        [field]: event.target.value,
      }))
    }

  const handleAddReading = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()

    const validationErrors = validateReadingForm()
    setReadingFormErrors(validationErrors)
    if (validationErrors.length > 0) {
      setAppToast('Please fix the highlighted issues before saving.')
      return
    }

    const importTZTotal =
      toNum(formState.importT1) + toNum(formState.importT2) + toNum(formState.importT3)
    const exportTZTotal =
      toNum(formState.exportT1) + toNum(formState.exportT2) + toNum(formState.exportT3)

    const enteredImportT = parseOptionalTotal(formState.importT)
    const enteredExportT = parseOptionalTotal(formState.exportT)
    const effectiveImportT = enteredImportT ?? importTZTotal
    const effectiveExportT = enteredExportT ?? exportTZTotal
    const derivedNet = effectiveImportT - effectiveExportT

    const next: Reading = {
      id: editingReadingId ?? createReadingId(),
      date: formState.date,
      time: formState.time || defaultReadingTime(),
      importT: effectiveImportT,
      importT1: toNum(formState.importT1),
      importT2: toNum(formState.importT2),
      importT3: toNum(formState.importT3),
      exportT: effectiveExportT,
      exportT1: toNum(formState.exportT1),
      exportT2: toNum(formState.exportT2),
      exportT3: toNum(formState.exportT3),
      net: parseOptionalNet(formState.net) ?? derivedNet,
      solarGenerated: toNum(formState.solarGenerated),
      note: formState.note.trim() || undefined,
    }

    saveRecoverySnapshot(readings)
    const nextReadings = sortReadings(
      editingReadingId
        ? readings.map((reading) => (reading.id === editingReadingId ? next : reading))
        : [...readings, next],
    )
    setReadings(nextReadings)
    setFormState(defaultFormState())
    markLocalChange()
    setReadingFormErrors([])
    setIsReadingModalOpen(false)
    setAppToast(editingReadingId ? 'Reading updated successfully.' : 'Reading added successfully.')
    logActivity(
      editingReadingId ? 'edit-reading' : 'add-reading',
      `${dayjs(next.date).format('DD MMM YYYY')} ${next.time}`,
    )
    setEditingReadingId(null)

    if (supabase && cloudUser) {
      void pushToCloud(nextReadings, true)
    }
  }

  const formImportTZTotal =
    toNum(formState.importT1) + toNum(formState.importT2) + toNum(formState.importT3)
  const formExportTZTotal =
    toNum(formState.exportT1) + toNum(formState.exportT2) + toNum(formState.exportT3)
  const enteredImportT = parseOptionalTotal(formState.importT)
  const enteredExportT = parseOptionalTotal(formState.exportT)
  const enteredNet = parseOptionalNet(formState.net)
  const derivedNet =
    (enteredImportT ?? formImportTZTotal) - (enteredExportT ?? formExportTZTotal)
  const showImportMismatch =
    enteredImportT !== undefined && Math.abs(enteredImportT - formImportTZTotal) > 0.001
  const showExportMismatch =
    enteredExportT !== undefined && Math.abs(enteredExportT - formExportTZTotal) > 0.001
  const showNetMismatch =
    enteredNet !== undefined && Math.abs(enteredNet - derivedNet) > 0.001

  const deleteReading = (id: string) => {
    const toDelete = readings.find((item) => item.id === id)
    if (!toDelete) {
      return
    }
    saveRecoverySnapshot(readings)
    setLastDeletedReading(toDelete)
    setReadings((prev) => prev.filter((item) => item.id !== id))
    markLocalChange()
    logActivity('delete-reading', `${dayjs(toDelete.date).format('DD MMM YYYY')} ${toDelete.time}`)
  }

  const undoDeleteReading = () => {
    if (!lastDeletedReading) {
      return
    }
    const restored = sortReadings([...readings, lastDeletedReading])
    setReadings(restored)
    setLastDeletedReading(null)
    markLocalChange()
    logActivity('undo-delete', `${dayjs(restored[restored.length - 1].date).format('DD MMM YYYY')}`)
  }

  const startEditingReading = (reading: Reading) => {
    setEditingReadingId(reading.id)
    setReadingFormErrors([])
    setFormState({
      date: reading.date,
      time: reading.time,
      importT: reading.importT?.toString() ?? '',
      importT1: reading.importT1.toString(),
      importT2: reading.importT2.toString(),
      importT3: reading.importT3.toString(),
      exportT: reading.exportT?.toString() ?? '',
      exportT1: reading.exportT1.toString(),
      exportT2: reading.exportT2.toString(),
      exportT3: reading.exportT3.toString(),
      net: reading.net?.toString() ?? '',
      solarGenerated: reading.solarGenerated.toString(),
      note: reading.note ?? '',
    })
    setIsReadingModalOpen(true)
  }

  const cancelEditing = () => {
    setEditingReadingId(null)
    setFormState(defaultFormState())
    setReadingFormErrors([])
    setIsReadingModalOpen(false)
  }

  const exportData = () => {
    const blob = new Blob([JSON.stringify(readings, null, 2)], {
      type: 'application/json',
    })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `solar-meter-data-${dayjs().format('YYYYMMDD-HHmmss')}.json`
    anchor.click()
    URL.revokeObjectURL(url)
    logActivity('export-json', `Exported ${readings.length} readings`)
  }

  const exportMonthlyCsv = () => {
    if (!selectedCycleReadings.length || !selectedCycle) {
      return
    }

    const header = [
      'Date',
      'Time',
      'Import Used',
      'Export Used',
      'Net Used',
      'Solar Added',
      'Payable Cycle',
      'Opening Bank',
      'Closing Bank',
    ]
    const rows = selectedCycleReadings.map((row) => [
      dayjs(row.date).format('YYYY-MM-DD'),
      row.time,
      row.importDelta.toFixed(2),
      row.exportDelta.toFixed(2),
      row.netDelta.toFixed(2),
      row.solarDelta.toFixed(2),
      selectedCycle.payableUnits.toFixed(2),
      selectedCycle.openingBank.toFixed(2),
      selectedCycle.closingBank.toFixed(2),
    ])

    const csv = [header, ...rows].map((line) => line.join(',')).join('\n')
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `monthly-report-${dayjs(selectedCycle.start).format('YYYY-MM')}.csv`
    anchor.click()
    URL.revokeObjectURL(url)
    logActivity('export-csv', `Monthly CSV ${dayjs(selectedCycle.start).format('MMM YYYY')}`)
  }

  const exportMonthlyPdf = () => {
    if (!selectedCycle) {
      return
    }

    const html = `
      <html>
        <head>
          <title>Monthly Report</title>
          <style>
            body { font-family: Arial, sans-serif; padding: 20px; }
            table { width: 100%; border-collapse: collapse; margin-top: 12px; }
            th, td { border: 1px solid #ccc; padding: 6px; text-align: left; }
            th { background: #f2f2f2; }
          </style>
        </head>
        <body>
          <h2>Solar Meter Monthly Report</h2>
          <p>Cycle: ${dayjs(selectedCycle.start).format('DD MMM YYYY')} - ${dayjs(selectedCycle.end).format('DD MMM YYYY')}</p>
          <p>Import: ${selectedCycle.importTotal.toFixed(2)} kWh | Export: ${selectedCycle.exportTotal.toFixed(2)} kWh | Payable: ${selectedCycle.payableUnits.toFixed(2)} kWh</p>
          <table>
            <thead>
              <tr><th>Date</th><th>Time</th><th>Import Used</th><th>Export Used</th><th>Net</th><th>Solar Added</th></tr>
            </thead>
            <tbody>
              ${selectedCycleReadings
                .map(
                  (row) =>
                    `<tr><td>${dayjs(row.date).format('DD MMM YYYY')}</td><td>${row.time}</td><td>${row.importDelta.toFixed(2)}</td><td>${row.exportDelta.toFixed(2)}</td><td>${row.netDelta.toFixed(2)}</td><td>${row.solarDelta.toFixed(2)}</td></tr>`,
                )
                .join('')}
            </tbody>
          </table>
        </body>
      </html>
    `

    const reportWindow = window.open('', '_blank', 'width=900,height=700')
    if (reportWindow) {
      reportWindow.document.write(html)
      reportWindow.document.close()
      reportWindow.focus()
      reportWindow.print()
      logActivity('export-pdf', `Monthly PDF ${dayjs(selectedCycle.start).format('MMM YYYY')}`)
    }
  }

  const importDataFromFile = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) {
      return
    }

    const reader = new FileReader()
    reader.onload = () => {
      try {
        const parsed = JSON.parse(String(reader.result)) as Reading[]
        if (!Array.isArray(parsed)) {
          throw new Error('Invalid backup format.')
        }

        const sanitized = sortReadings(
          parsed.map((item) => ({
            ...item,
            id: item.id && typeof item.id === 'string' ? item.id : createReadingId(),
            date: item.date,
            time: item.time || '07:00',
            importT1: Number(item.importT1 || 0),
            importT2: Number(item.importT2 || 0),
            importT3: Number(item.importT3 || 0),
            exportT1: Number(item.exportT1 || 0),
            exportT2: Number(item.exportT2 || 0),
            exportT3: Number(item.exportT3 || 0),
            solarGenerated: Number(item.solarGenerated || 0),
          })),
        )

        saveRecoverySnapshot(readings)
        setReadings(sanitized)
        setCloudMessage(`Imported ${sanitized.length} readings from backup.`)
        markLocalChange()
        logActivity('import-json', `Imported ${sanitized.length} readings`)
      } catch (error) {
        setCloudMessage(
          `Backup import failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
        )
      }
    }
    reader.readAsText(file)
    event.target.value = ''
  }

  const restoreLastBackup = () => {
    const raw = localStorage.getItem(LAST_BACKUP_KEY)
    if (!raw) {
      setCloudMessage('No recovery backup found.')
      return
    }

    const parsed = JSON.parse(raw) as { createdAt: string; readings: Reading[] }
    const restored = sortReadings(parsed.readings || [])
    setReadings(restored)
    markLocalChange()
    logActivity('restore-backup', `Restored snapshot from ${dayjs(parsed.createdAt).format('DD MMM YYYY HH:mm')}`)
  }

  const installApp = async () => {
    if (!installPromptEvent) {
      setUpdateMessage('Install prompt is not available yet. Open app in a supported browser and try again.')
      return
    }
    await installPromptEvent.prompt()
    const choice = await installPromptEvent.userChoice
    setUpdateMessage(
      choice.outcome === 'accepted' ? 'App install started.' : 'Install prompt dismissed.',
    )
    setInstallPromptEvent(null)
  }

  const checkForUpdates = async () => {
    if (!('serviceWorker' in navigator)) {
      setUpdateMessage('Service Worker not available in this browser.')
      return
    }

    const registrations = await navigator.serviceWorker.getRegistrations()
    if (!registrations.length) {
      setUpdateMessage('No service worker update channel found. Deploy latest build and refresh browser.')
      return
    }

    await Promise.all(registrations.map((registration) => registration.update()))
    setUpdateMessage('Checked for updates. Refresh the app to apply latest build.')
  }

  const pushToCloud = async (readingsToSync = sortedReadings, silent = false) => {
    if (!supabase || !cloudUser) {
      if (!silent) {
        setCloudMessage('Sign in to cloud first.')
      }
      return
    }

    setSyncStatus('syncing')
    setCloudBusy(true)
    if (!silent) {
      setCloudMessage('Syncing local readings to cloud...')
    }

    const payload = readingsToSync.map((reading) => ({
      id: reading.id,
      user_id: cloudUser.id,
      reading_date: reading.date,
      reading_time: reading.time,
      import_t: reading.importT ?? null,
      import_t1: reading.importT1,
      import_t2: reading.importT2,
      import_t3: reading.importT3,
      export_t: reading.exportT ?? null,
      export_t1: reading.exportT1,
      export_t2: reading.exportT2,
      export_t3: reading.exportT3,
      net: reading.net ?? null,
      solar_generated: reading.solarGenerated,
      note: reading.note ?? null,
      updated_at: new Date().toISOString(),
    }))

    const { error } = await supabase
      .from('meter_readings')
      .upsert(payload, { onConflict: 'id' })

    if (error) {
      setCloudMessage(`Cloud push failed: ${error.message}`)
      setSyncStatus('error')
    } else if (!silent) {
      setCloudMessage('Cloud sync complete: local data uploaded.')
      setSyncStatus('success')
      setLastSyncAt(new Date().toISOString())
      setPendingSyncChanges(0)
    } else {
      setCloudMessage('Reading saved locally and synced to cloud automatically.')
      setSyncStatus('success')
      setLastSyncAt(new Date().toISOString())
      setPendingSyncChanges(0)
    }
    setCloudBusy(false)
  }

  const pullFromCloud = async (silent = false) => {
    if (!supabase || !cloudUser) {
      if (!silent) {
        setCloudMessage('Sign in to cloud first.')
      }
      return
    }

    setSyncStatus('syncing')
    setCloudBusy(true)
    if (!silent) {
      setCloudMessage('Downloading readings from cloud...')
    }

    const { data, error } = await supabase
      .from('meter_readings')
      .select(
        'id, reading_date, reading_time, import_t, import_t1, import_t2, import_t3, export_t, export_t1, export_t2, export_t3, net, solar_generated, note',
      )
      .eq('user_id', cloudUser.id)
      .order('reading_date', { ascending: true })
      .order('reading_time', { ascending: true })

    if (error) {
      setCloudMessage(`Cloud pull failed: ${error.message}`)
      setSyncStatus('error')
      setCloudBusy(false)
      return
    }

    const cloudReadings: Reading[] = (data as CloudReadingRow[]).map((row) => ({
      id: row.id,
      date: row.reading_date,
      time: row.reading_time ?? '07:00',
      importT: row.import_t ?? undefined,
      importT1: Number(row.import_t1),
      importT2: Number(row.import_t2),
      importT3: Number(row.import_t3),
      exportT: row.export_t ?? undefined,
      exportT1: Number(row.export_t1),
      exportT2: Number(row.export_t2),
      exportT3: Number(row.export_t3),
      net: row.net ?? undefined,
      solarGenerated: Number(row.solar_generated),
      note: row.note ?? undefined,
    }))

    if (cloudReadings.length > 0) {
      setReadings(sortReadings(cloudReadings))
      setCloudMessage(
        silent
          ? `Auto-synced ${cloudReadings.length} readings from cloud.`
          : `Cloud download complete: ${cloudReadings.length} readings loaded.`,
      )
      setSyncStatus('success')
      setLastSyncAt(new Date().toISOString())
      setPendingSyncChanges(0)
    } else if (!silent) {
      setCloudMessage('No cloud readings found. Keeping local data as-is.')
      setSyncStatus('idle')
    }
    setCloudBusy(false)
  }

  const sendMagicLink = async () => {
    if (!supabase || !cloudEmail.trim()) {
      return
    }

    setCloudBusy(true)
    const { error } = await supabase.auth.signInWithOtp({
      email: cloudEmail.trim(),
      options: {
        emailRedirectTo: window.location.origin,
      },
    })
    if (error) {
      const isRateLimit = /limit exceeded|rate limit|too many requests/i.test(error.message)
      if (isRateLimit) {
        const anon = await supabase.auth.signInAnonymously()
        if (anon.error) {
          setCloudMessage(
            `OTP rate limit hit. Also failed anonymous login: ${anon.error.message}`,
          )
        } else {
          setCloudMessage(
            'OTP limit hit. Signed in anonymously instead. You can continue with upload/download now.',
          )
        }
      } else {
        setCloudMessage(`Sign-in failed: ${error.message}`)
      }
    } else {
      setCloudMessage('Magic link sent. Open email on mobile/laptop and continue.')
    }
    setCloudBusy(false)
  }

  const signInWithPassword = async () => {
    if (!supabase || !cloudEmail.trim() || !cloudPassword.trim()) {
      setCloudMessage('Enter email and password to sign in.')
      return
    }

    setCloudBusy(true)
    const { error } = await supabase.auth.signInWithPassword({
      email: cloudEmail.trim(),
      password: cloudPassword,
    })

    if (error) {
      setCloudMessage(`Password sign-in failed: ${error.message}`)
    } else {
      setCloudMessage('Signed in with shared account successfully.')
    }
    setCloudBusy(false)
  }

  const createSharedAccount = async () => {
    if (!supabase || !cloudEmail.trim() || !cloudPassword.trim()) {
      setCloudMessage('Enter email and password to create shared account.')
      return
    }

    setCloudBusy(true)
    const { error } = await supabase.auth.signUp({
      email: cloudEmail.trim(),
      password: cloudPassword,
    })

    if (error) {
      setCloudMessage(`Create account failed: ${error.message}`)
    } else {
      setCloudMessage(
        'Shared account created/sign-in initiated. Use the same email+password on both devices.',
      )
    }
    setCloudBusy(false)
  }

  const signOutCloud = async () => {
    if (!supabase) {
      return
    }
    await supabase.auth.signOut()
    setCloudMessage('Signed out from cloud.')
  }

  const signInAnonymous = async () => {
    if (!supabase) {
      return
    }
    setCloudBusy(true)
    const { error } = await supabase.auth.signInAnonymously()
    if (error) {
      setCloudMessage(`Anonymous sign-in failed: ${error.message}`)
    } else {
      setCloudMessage('Signed in anonymously. You can now upload/download cloud data.')
    }
    setCloudBusy(false)
  }

  useEffect(() => {
    if (!cloudUser || !isHydrated) {
      return
    }

    void pullFromCloud(true)
  }, [cloudUser?.id, isHydrated])

  return (
    <main className="app-shell">
      <header className="hero">
        <div className="hero-layout">
          <div className="hero-copy">
            <div className="hero-topline">
              <div className="hero-brandmark" aria-hidden="true">
                <span className="brand-halo" />
                <span className="brand-sun" />
                <span className="brand-roof" />
                <span className="brand-panel" />
                <span className="brand-meter" />
              </div>
              <div>
                <p className="eyebrow">Solar Meter Reader</p>
                <h1>
                  Track power flow with a cleaner{' '}
                  <span className="hero-accent">solar</span> usage dashboard
                </h1>
              </div>
            </div>
            <p className="hero-subtitle">
              Capture meter snapshots, monitor import and export trends, and keep your
              bank units and payable usage clear across every billing cycle.
            </p>
            <div className="hero-badges" aria-label="Highlights">
              <span>Import, export, and net tracking</span>
              <span>Bank-aware billing cycles</span>
              <span>Reports, goals, and sync</span>
            </div>
          </div>

          <div className="hero-visual" aria-hidden="true">
            <div className="hero-visual-ring" />
            <div className="hero-visual-grid" />
            <div className="hero-brandmark hero-brandmark-large">
              <span className="brand-halo" />
              <span className="brand-sun" />
              <span className="brand-roof" />
              <span className="brand-panel" />
              <span className="brand-meter" />
            </div>
            <div className="hero-mini-card hero-mini-card-top">Live bank units</div>
            <div className="hero-mini-card hero-mini-card-bottom">Cloud-ready logs</div>
            <div className="hero-mini-pill">Solar meter ledger</div>
          </div>
        </div>
      </header>

      <div className="top-nav-stack">
        <nav className="app-tabs" aria-label="App sections">
          <button
            type="button"
            className={activeTab === 'home' ? 'tab-button active' : 'tab-button'}
            onClick={() => setActiveTab('home')}
          >
            Home
          </button>
          <button
            type="button"
            className={activeTab === 'analytics' ? 'tab-button active' : 'tab-button'}
            onClick={() => setActiveTab('analytics')}
          >
            Insights
          </button>
          <button
            type="button"
            className={activeTab === 'history' ? 'tab-button active' : 'tab-button'}
            onClick={() => setActiveTab('history')}
          >
            History
          </button>
          <button
            type="button"
            className={activeTab === 'cloud' ? 'tab-button active' : 'tab-button'}
            onClick={() => setActiveTab('cloud')}
          >
            Cloud
          </button>
          <button
            type="button"
            className={activeTab === 'manage' ? 'tab-button active' : 'tab-button'}
            onClick={() => setActiveTab('manage')}
          >
            Manage
          </button>
        </nav>

        <div className="quick-add-bar">
          <button type="button" className="quick-add-button" onClick={openAddReadingModal}>
            + Add Reading
          </button>
        </div>
      </div>

      {activeTab === 'home' && (
      <>
      <section className="cards-grid">
        <article className="card kpi">
          <h2>Import Used</h2>
          <p>{formatUnits(rangeSummary.importTotal)}</p>
        </article>
        <article className="card kpi">
          <h2>Export Used</h2>
          <p>{formatUnits(rangeSummary.exportTotal)}</p>
        </article>
        <article className="card kpi">
          <h2>Net</h2>
          <p>{formatUnits(rangeSummary.net)}</p>
        </article>
        <article className="card kpi">
          <h2>Solar Added</h2>
          <p>{formatUnits(rangeSummary.solarTotal)}</p>
        </article>
        <article className="card kpi accent">
          <h2>Current Bank</h2>
          <p>{formatUnits(currentBank)}</p>
        </article>
      </section>

      </>
      )}

      {activeTab === 'manage' && (
      <section className="card controls">
        <div className="controls-row">
          <label>
            Billing Day
            <input
              type="number"
              min={1}
              max={28}
              value={billingDay}
              onChange={(event) => setBillingDay(normalizeBillingDay(Number(event.target.value)))}
            />
          </label>
          <label>
            KSEB Billing Date
            <input
              type="date"
              value={billingReferenceDate}
              onChange={(event) => setBillingReferenceDate(event.target.value)}
            />
          </label>
          <label>
            Bill Generated DateTime
            <input
              type="datetime-local"
              value={billGeneratedAt}
              onChange={(event) => setBillGeneratedAt(event.target.value)}
            />
          </label>
          <button type="button" onClick={saveBillingConfigFromBill}>
            Apply Bill Cycle
          </button>
          <label>
            Upload KSEB Bill (PDF/Image)
            <input
              type="file"
              accept="application/pdf,image/*"
              onChange={(event) => {
                void importKsebBillFromFile(event)
              }}
              disabled={billImportBusy}
            />
          </label>
          <button type="button" onClick={exportData} className="ghost">
            Export JSON Backup
          </button>
          <label>
            Import JSON Backup
            <input type="file" accept="application/json" onChange={importDataFromFile} />
          </label>
          <button type="button" onClick={restoreLastBackup} className="ghost">
            Restore Last Backup
          </button>
        </div>
        {lastDeletedReading && (
          <div className="inline-actions">
            <p className="field-hint">Deleted one reading. Undo available.</p>
            <button type="button" onClick={undoDeleteReading} className="ghost">
              Undo Delete
            </button>
          </div>
        )}
        <div className="sync-status">
          <strong>Sync Status:</strong>
          <span className={`sync-badge ${syncStatus}`}>{syncStatus.toUpperCase()}</span>
          <span>
            Pending changes: {pendingSyncChanges} | Last sync:{' '}
            {lastSyncAt ? dayjs(lastSyncAt).format('DD MMM YYYY HH:mm') : 'Never'}
          </span>
        </div>

        <p className="field-hint">
          Applied bill date: {dayjs(billingReferenceDate).format('DD MMM YYYY')} | Generated:{' '}
          {dayjs(billGeneratedAt).isValid()
            ? dayjs(billGeneratedAt).format('DD MMM YYYY HH:mm')
            : '-'}
        </p>
        <p className="field-hint">
          {billImportBusy
            ? 'Processing bill...'
            : billImportMessage ||
              'Upload a KSEB bill and the app will detect date/import/export values, then pre-fill Add Reading for review.'}
        </p>
      </section>

      )}

      {activeTab === 'cloud' && (
      <section className="card cloud-sync">
        <div className="section-head">
          <h2>Cloud Sync (Free)</h2>
          <p className="field-hint">
            {isCloudEnabled ? 'Supabase connected' : 'Add .env values to enable cloud sync'}
          </p>
        </div>

        {isCloudEnabled ? (
          <>
            {!cloudUser && (
              <>
                <div className="cloud-row">
                  <label>
                    Shared Home Email
                    <input
                      type="email"
                      placeholder="you@example.com"
                      value={cloudEmail}
                      onChange={(event) => setCloudEmail(event.target.value)}
                    />
                  </label>
                  <label>
                    Password
                    <input
                      type="password"
                      placeholder="Enter shared password"
                      value={cloudPassword}
                      onChange={(event) => setCloudPassword(event.target.value)}
                    />
                  </label>
                </div>

                <div className="cloud-actions">
                  <button type="button" onClick={() => void signInWithPassword()} disabled={cloudBusy}>
                    Sign In With Password
                  </button>
                  <button type="button" className="ghost" onClick={() => void createSharedAccount()} disabled={cloudBusy}>
                    Create Shared Account
                  </button>
                  <button type="button" onClick={() => void sendMagicLink()} disabled={cloudBusy}>
                    Send Magic Link (Optional)
                  </button>
                </div>

                <div className="cloud-actions">
                  <button type="button" className="ghost" onClick={() => void signInAnonymous()} disabled={cloudBusy}>
                    Continue Anonymously
                  </button>
                </div>
              </>
            )}

            <div className="cloud-actions">
              <p className="field-hint">
                Signed in user:{' '}
                {cloudUser
                  ? cloudUser.email
                    ? cloudUser.email
                    : `Anonymous (${cloudUser.id.slice(0, 8)}...)`
                  : 'Not signed in'}
              </p>
              <button type="button" className="ghost" onClick={() => void signOutCloud()} disabled={!cloudUser || cloudBusy}>
                Sign Out
              </button>
            </div>
            {cloudUser && (
              <div className="manual-sync-tools">
                <button
                  type="button"
                  className="ghost"
                  onClick={() => setShowManualSyncTools((prev) => !prev)}
                  disabled={cloudBusy}
                >
                  {showManualSyncTools ? 'Hide Manual Sync Tools' : 'Show Manual Sync Tools'}
                </button>

                {showManualSyncTools && (
                  <div className="manual-sync-panel">
                    <p className="field-hint">
                      Auto-sync is enabled. Use these only when you want a forced upload/download.
                    </p>
                    <div className="cloud-actions">
                      <button
                        type="button"
                        onClick={() => void pullFromCloud()}
                        disabled={!cloudUser || cloudBusy}
                      >
                        Download From Cloud
                      </button>
                      <button
                        type="button"
                        onClick={() => void pushToCloud()}
                        disabled={!cloudUser || cloudBusy}
                      >
                        Upload To Cloud
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}
            {cloudUser && !cloudUser.email && (
              <p className="cloud-message">
                Anonymous login is device-specific. To see the same data on mobile and laptop,
                use the same email login on both devices.
              </p>
            )}
            {cloudMessage && <p className="cloud-message">{cloudMessage}</p>}
          </>
        ) : (
          <p className="cloud-message">
            Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in .env to use free cloud sync.
          </p>
        )}
      </section>

      )}

      {activeTab === 'home' && (
      <>

      <section className="card month-tracker">
        <div className="section-head">
          <h2>Current Month Usage</h2>
          <p className="field-hint">
            {currentMonthTracker.periodLabel} | Readings: {currentMonthTracker.readingsCount}
          </p>
        </div>

        <div className="month-select-row">
          <label className="month-select-label">
            <span>Select Month:</span>
            <select
              className="month-select-input"
              value={selectedBillingCycleKey ?? ''}
              onChange={(e) => setSelectedBillingCycleKey(e.target.value || null)}
            >
              <option value="">Current Month</option>
              {billingCycles.map((cycle) => (
                <option key={cycle.key} value={cycle.key}>
                  {dayjs(cycle.start).format('MMM YYYY')} (
                  {dayjs(cycle.start).format('DD')} - {dayjs(cycle.end).format('DD MMM')})
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="critical-tiles">
          <article className="critical-tile payable">
            <h3>Payable Units</h3>
            <p>{formatUnits(currentMonthTracker.payableUnits)}</p>
          </article>
          <article className="critical-tile import">
            <h3>This Month Import Used</h3>
            <p>{formatUnits(currentMonthTracker.importConsumed)}</p>
          </article>
          <article className="critical-tile export">
            <h3>This Month Export Used</h3>
            <p>{formatUnits(currentMonthTracker.exportConsumed)}</p>
          </article>
        </div>

        <div className="tracker-panels">
          <article className="tracker-card">
            <h3>Energy Consumption</h3>
            <div className="tracker-metrics">
              <div>
                <span>Import Used</span>
                <strong>{formatUnits(currentMonthTracker.importConsumed)}</strong>
              </div>
              <div>
                <span>Export Used</span>
                <strong>{formatUnits(currentMonthTracker.exportConsumed)}</strong>
              </div>
              <div>
                <span>Net Used</span>
                <strong>{formatUnits(currentMonthTracker.netConsumed)}</strong>
              </div>
              <div>
                <span>Solar Added</span>
                <strong>{formatUnits(currentMonthTracker.solarAdded)}</strong>
              </div>
            </div>
          </article>

          <article className="tracker-card emphasis">
            <h3>Payable And Bank</h3>
            <div className="tracker-metrics">
              <div>
                <span>Opening Bank</span>
                <strong>{formatUnits(currentMonthTracker.openingBank)}</strong>
              </div>
              <div>
                <span>Units Consumed from Bank</span>
                <strong>{formatUnits(currentMonthTracker.bankUsed)}</strong>
              </div>
              <div className="payable-focus">
                <span>Payable Units</span>
                <strong>{formatUnits(currentMonthTracker.payableUnits)}</strong>
              </div>
              <div>
                <span>Bank Balance</span>
                <strong>{formatUnits(currentMonthTracker.closingBank)}</strong>
              </div>
            </div>
          </article>

          <article className="tracker-card">
            <h3>Latest Total Meter Reading</h3>
            <div className="tracker-metrics">
              <div>
                <span>Total Import</span>
                <strong>{formatUnits(currentMonthTracker.totalImport)}</strong>
              </div>
              <div>
                <span>Total Export</span>
                <strong>{formatUnits(currentMonthTracker.totalExport)}</strong>
              </div>
              <div>
                <span>Total Net</span>
                <strong>{formatUnits(currentMonthTracker.totalNet)}</strong>
              </div>
              <div>
                <span>Total Solar</span>
                <strong>{formatUnits(currentMonthTracker.totalSolar)}</strong>
              </div>
            </div>
          </article>
        </div>
      </section>

      <section className="card form-card">
        <div className="section-head">
          <h2>Reading Entry</h2>
          <button type="button" onClick={openAddReadingModal}>
            Add Reading
          </button>
        </div>
        <p className="field-hint">
          Tap Add Reading to open a quick entry popup. You will get alerts if any values
          are missing or incorrect.
        </p>
      </section>

      </>
      )}

      {isReadingModalOpen && (
        <div className="modal-overlay" role="dialog" aria-modal="true" aria-label="Add reading">
          <section className="modal-sheet">
            <div className="section-head">
              <h2>{editingReadingId ? 'Edit Reading' : 'Add Daily Reading'}</h2>
              <button type="button" className="ghost" onClick={cancelEditing}>
                Close
              </button>
            </div>

            <div className="inline-actions">
              <button
                type="button"
                className="ghost"
                onClick={() => {
                  setFormState((prev) => ({
                    ...prev,
                    date: dayjs().format('YYYY-MM-DD'),
                    time: defaultReadingTime(),
                  }))
                }}
              >
                Use Current Date/Time
              </button>
              <button
                type="button"
                className="ghost"
                onClick={() => {
                  const latest = sortedReadings[sortedReadings.length - 1]
                  if (!latest) {
                    return
                  }
                  setFormState((prev) => ({
                    ...prev,
                    importT: calculateImportTotal(latest).toString(),
                    exportT: calculateExportTotal(latest).toString(),
                    solarGenerated: latest.solarGenerated.toString(),
                  }))
                }}
              >
                Copy Last Totals
              </button>
            </div>

            {readingFormErrors.length > 0 && (
              <div className="form-errors" role="alert">
                {readingFormErrors.map((error) => (
                  <p key={error}>{error}</p>
                ))}
              </div>
            )}

            <form onSubmit={handleAddReading} className="reading-form">
              <label>
                Date
                <input
                  type="date"
                  value={formState.date}
                  onChange={handleFieldChange('date')}
                  required
                />
              </label>
              <label>
                Time
                <input
                  type="time"
                  value={formState.time}
                  onChange={handleFieldChange('time')}
                  required
                />
              </label>
              <label>
                Import T (Total)
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  value={formState.importT}
                  onChange={handleFieldChange('importT')}
                />
                <span className="field-hint">T1 + T2 + T3 = {formImportTZTotal.toFixed(2)}</span>
              </label>
              <label>
                Import T1 (6 AM - 6 PM)
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  value={formState.importT1}
                  onChange={handleFieldChange('importT1')}
                />
              </label>
              <label>
                Import T2 (6 PM - 10 PM)
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  value={formState.importT2}
                  onChange={handleFieldChange('importT2')}
                />
              </label>
              <label>
                Import T3 (10 PM - 6 AM)
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  value={formState.importT3}
                  onChange={handleFieldChange('importT3')}
                />
              </label>
              <label>
                Export T (Total)
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  value={formState.exportT}
                  onChange={handleFieldChange('exportT')}
                />
                <span className="field-hint">T1 + T2 + T3 = {formExportTZTotal.toFixed(2)}</span>
              </label>
              <label>
                Export T1
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  value={formState.exportT1}
                  onChange={handleFieldChange('exportT1')}
                />
              </label>
              <label>
                Export T2 (usually 0)
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  value={formState.exportT2}
                  onChange={handleFieldChange('exportT2')}
                />
              </label>
              <label>
                Export T3 (usually 0)
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  value={formState.exportT3}
                  onChange={handleFieldChange('exportT3')}
                />
              </label>
              <label>
                Net N (can be + or -)
                <input
                  type="number"
                  step="0.01"
                  value={formState.net}
                  onChange={handleFieldChange('net')}
                />
                <span className="field-hint">Import T - Export T = {derivedNet.toFixed(2)}</span>
              </label>
              <label>
                Solar Generated
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  value={formState.solarGenerated}
                  onChange={handleFieldChange('solarGenerated')}
                />
              </label>
              <label className="note-field">
                Note
                <textarea
                  value={formState.note}
                  onChange={handleFieldChange('note')}
                  placeholder="Optional"
                />
              </label>
              {(showImportMismatch || showExportMismatch || showNetMismatch) && (
                <p className="form-hint">
                  Note: Entered values differ from derived values. T and Net can be entered
                  manually; usage and billing are computed from change between consecutive
                  readings.
                </p>
              )}
              <button type="submit">{editingReadingId ? 'Save Reading' : 'Add Reading'}</button>
            </form>
          </section>
        </div>
      )}

      {activeTab === 'analytics' && (
      <>
      <section className="card">
        <div className="section-head">
          <h2>Alerts and Anomaly Detection</h2>
          <p className="field-hint">Auto-detected from recent reading deltas</p>
        </div>
        {anomalies.length ? (
          <div className="alerts-list">
            {anomalies.map((alert) => (
              <div key={alert.id} className={`alert-row ${alert.level}`}>
                <strong>{alert.level === 'danger' ? 'Critical' : 'Warning'}</strong>
                <span>{alert.message}</span>
              </div>
            ))}
          </div>
        ) : (
          <p className="empty-state">No anomalies found in current data.</p>
        )}
      </section>

      <section className="card insights-grid">
        <article>
          <h2>Compare Periods</h2>
          {cycleComparison ? (
            <div className="tracker-metrics">
              <div>
                <span>Import vs Previous</span>
                <strong>
                  {formatSigned(cycleComparison.importDiff)} kWh ({toPercent(cycleComparison.importPct)})
                </strong>
              </div>
              <div>
                <span>Net vs Previous</span>
                <strong>
                  {formatSigned(cycleComparison.netDiff)} kWh ({toPercent(cycleComparison.netPct)})
                </strong>
              </div>
              <div>
                <span>Payable vs Previous</span>
                <strong>
                  {formatSigned(cycleComparison.payableDiff)} kWh ({toPercent(cycleComparison.payablePct)})
                </strong>
              </div>
            </div>
          ) : (
            <p className="empty-state">Need at least two billing cycles for comparison.</p>
          )}
        </article>

        <article>
          <h2>Forecasting</h2>
          {forecast ? (
            <div className="tracker-metrics">
              <div>
                <span>Cycle Progress</span>
                <strong>
                  {forecast.elapsedDays}/{forecast.totalDays} days
                </strong>
              </div>
              <div>
                <span>Projected Import</span>
                <strong>{formatUnits(forecast.projectedImport)}</strong>
              </div>
              <div>
                <span>Projected Payable</span>
                <strong>{formatUnits(forecast.projectedPayable)}</strong>
              </div>
              <div>
                <span>Projected Solar</span>
                <strong>{formatUnits(forecast.projectedSolar)}</strong>
              </div>
            </div>
          ) : (
            <p className="empty-state">No forecast yet for this cycle.</p>
          )}
        </article>
      </section>

      <section className="card insights-grid">
        <article>
          <h2>Solar Performance KPIs</h2>
          {solarKpis ? (
            <div className="tracker-metrics">
              <div>
                <span>Solar Added</span>
                <strong>{formatUnits(solarKpis.solarAdded)}</strong>
              </div>
              <div>
                <span>Self Consumed Solar</span>
                <strong>{formatUnits(solarKpis.selfConsumedSolar)}</strong>
              </div>
              <div>
                <span>Self Consumption Ratio</span>
                <strong>{toPercent(solarKpis.selfConsumptionRatio)}</strong>
              </div>
              <div>
                <span>Solar Export Ratio</span>
                <strong>{toPercent(solarKpis.exportRatio)}</strong>
              </div>
              <div>
                <span>Solar Offset Ratio</span>
                <strong>{toPercent(solarKpis.solarOffsetRatio)}</strong>
              </div>
            </div>
          ) : (
            <p className="empty-state">No KPI data available.</p>
          )}
        </article>

        <article>
          <h2>Goal Tracking</h2>
          <div className="goals-grid">
            <label>
              Payable Goal (kWh)
              <input
                type="number"
                min="0"
                step="0.01"
                value={monthlyPayableGoal}
                onChange={(event) => setMonthlyPayableGoal(event.target.value)}
              />
            </label>
            <label>
              Import Goal (kWh)
              <input
                type="number"
                min="0"
                step="0.01"
                value={monthlyImportGoal}
                onChange={(event) => setMonthlyImportGoal(event.target.value)}
              />
            </label>
          </div>
          {goalProgress && (
            <div className="tracker-metrics">
              <div>
                <span>Payable Goal Used</span>
                <strong>{toPercent(goalProgress.payableUsedPct)}</strong>
              </div>
              <div>
                <span>Import Goal Used</span>
                <strong>{toPercent(goalProgress.importUsedPct)}</strong>
              </div>
            </div>
          )}
        </article>
      </section>

      <section className="card insights-grid">
        <article>
          <h2>Monthly Report (PDF/CSV)</h2>
          <div className="inline-actions">
            <button type="button" className="ghost" onClick={exportMonthlyCsv}>
              Export Monthly CSV
            </button>
            <button type="button" className="ghost" onClick={exportMonthlyPdf}>
              Export Monthly PDF
            </button>
          </div>
        </article>

        <article>
          <h2>Install and Update UX</h2>
          <div className="inline-actions">
            <button type="button" className="ghost" onClick={() => void installApp()}>
              Install App
            </button>
            <button type="button" className="ghost" onClick={() => void checkForUpdates()}>
              Check for Update
            </button>
          </div>
          {updateMessage && <p className="field-hint">{updateMessage}</p>}
        </article>
      </section>

      <section className="card">
        <div className="section-head">
          <h2>Usage Analytics</h2>
          <div className="pills">
            {(Object.keys(presetLabels) as RangePreset[]).map((preset) => (
              <button
                key={preset}
                type="button"
                className={preset === rangePreset ? 'pill active' : 'pill'}
                onClick={() => setRangePreset(preset)}
              >
                {presetLabels[preset]}
              </button>
            ))}
          </div>
        </div>

        {rangePreset === 'CUSTOM' && (
          <div className="custom-range">
            <label>
              Start
              <input
                type="date"
                value={customStart}
                onChange={(event) => setCustomStart(event.target.value)}
              />
            </label>
            <label>
              End
              <input
                type="date"
                value={customEnd}
                onChange={(event) => setCustomEnd(event.target.value)}
              />
            </label>
          </div>
        )}

        <div className="chart-wrap">
          <ResponsiveContainer width="100%" height={320}>
            <ComposedChart data={chartData}>
              <CartesianGrid strokeDasharray="4 4" />
              <XAxis dataKey="date" />
              <YAxis />
              <Tooltip />
              <Legend />
              <Bar dataKey="import" name="Import" fill="#da6a1f" />
              <Bar dataKey="export" name="Export" fill="#2f8f80" />
              <Line
                type="monotone"
                dataKey="net"
                name="Net"
                stroke="#22415d"
                strokeWidth={3}
              />
              <Line
                type="monotone"
                dataKey="solar"
                name="Solar"
                stroke="#c7392f"
                strokeWidth={2}
              />
            </ComposedChart>
          </ResponsiveContainer>
        </div>

        {!chartData.length && (
          <p className="empty-state">No readings in the selected date range.</p>
        )}
      </section>

      </>
      )}

      {activeTab === 'history' && (
      <>
      <section className="card table-card">
        <h2>Billing Cycle Summary (Usage Deltas)</h2>
        <p className="section-note">
          Annual settlement reset is tracked automatically inside the cycle summary and
          reflected in closing bank values.
        </p>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Cycle</th>
                <th>Import</th>
                <th>Export</th>
                <th>Net</th>
                <th>Consumed Units</th>
                <th>Opening Bank</th>
                <th>Payable Units</th>
                <th>Settlement (31 Mar)</th>
                <th>Closing Bank</th>
              </tr>
            </thead>
            <tbody>
              {billingCycles.map((cycle) => (
                <tr
                  key={cycle.key}
                  className={selectedCycle?.key === cycle.key ? 'selected-row' : ''}
                  onClick={() => setSelectedBillingCycleKey(cycle.key)}
                >
                  <td>
                    {dayjs(cycle.start).format('DD MMM YYYY')} -{' '}
                    {dayjs(cycle.end).format('DD MMM YYYY')}
                  </td>
                  <td>{cycle.importTotal.toFixed(2)}</td>
                  <td>{cycle.exportTotal.toFixed(2)}</td>
                  <td>{cycle.net.toFixed(2)}</td>
                  <td>{cycle.consumedUnits.toFixed(2)}</td>
                  <td>{cycle.openingBank.toFixed(2)}</td>
                  <td>{cycle.payableUnits.toFixed(2)}</td>
                  <td>{cycle.settlementPayoutUnits.toFixed(2)}</td>
                  <td>{cycle.closingBank.toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {!billingCycles.length && <p className="empty-state">No billing cycles yet.</p>}
      </section>

      <section className="card table-card">
        <h2>Dashboard Drill-down ({selectedCycleReadings.length})</h2>
        <p className="field-hint">
          Selected cycle:{' '}
          {selectedCycle
            ? `${dayjs(selectedCycle.start).format('DD MMM YYYY')} - ${dayjs(selectedCycle.end).format('DD MMM YYYY')}`
            : 'None'}
        </p>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Date</th>
                <th>Time</th>
                <th>Import Used</th>
                <th>Export Used</th>
                <th>Net Used</th>
                <th>Solar Added</th>
              </tr>
            </thead>
            <tbody>
              {selectedCycleReadings.map((reading) => (
                <tr key={`drill-${reading.id}`}>
                  <td>{dayjs(reading.date).format('DD MMM YYYY')}</td>
                  <td>{reading.time}</td>
                  <td>{reading.importDelta.toFixed(2)}</td>
                  <td>{reading.exportDelta.toFixed(2)}</td>
                  <td>{reading.netDelta.toFixed(2)}</td>
                  <td>{reading.solarDelta.toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!selectedCycleReadings.length && (
          <p className="empty-state">No readings in selected cycle.</p>
        )}
      </section>

      <section className="card table-card">
        <h2>Activity History</h2>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>When</th>
                <th>Action</th>
                <th>Details</th>
              </tr>
            </thead>
            <tbody>
              {activityLog.map((item) => (
                <tr key={item.id}>
                  <td>{dayjs(item.timestamp).format('DD MMM YYYY HH:mm')}</td>
                  <td>{item.action}</td>
                  <td>{item.details}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!activityLog.length && <p className="empty-state">No activity yet.</p>}
      </section>

      <section className="card table-card">
        <h2>All Readings ({sortedReadings.length})</h2>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Date</th>
                <th>Time</th>
                <th>Imp T1</th>
                <th>Imp T2</th>
                <th>Imp T3</th>
                <th>Imp T</th>
                <th>Imp Used</th>
                <th>Exp T1</th>
                <th>Exp T2</th>
                <th>Exp T3</th>
                <th>Exp T</th>
                <th>Exp Used</th>
                <th>Net</th>
                <th>Net Used</th>
                <th>Solar</th>
                <th>Solar Added</th>
                <th>Note</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {derivedReadings.map((reading) => (
                <tr key={reading.id}>
                  <td>{dayjs(reading.date).format('DD MMM YYYY')}</td>
                  <td>{reading.time}</td>
                  <td>{reading.importT1.toFixed(2)}</td>
                  <td>{reading.importT2.toFixed(2)}</td>
                  <td>{reading.importT3.toFixed(2)}</td>
                  <td>{calculateImportTotal(reading).toFixed(2)}</td>
                  <td>{reading.importDelta.toFixed(2)}</td>
                  <td>{reading.exportT1.toFixed(2)}</td>
                  <td>{reading.exportT2.toFixed(2)}</td>
                  <td>{reading.exportT3.toFixed(2)}</td>
                  <td>{calculateExportTotal(reading).toFixed(2)}</td>
                  <td>{reading.exportDelta.toFixed(2)}</td>
                  <td>{calculateNet(reading).toFixed(2)}</td>
                  <td>{reading.netDelta.toFixed(2)}</td>
                  <td>{reading.solarGenerated.toFixed(2)}</td>
                  <td>{reading.solarDelta.toFixed(2)}</td>
                  <td>{reading.note ?? '-'}</td>
                  <td>
                    <button
                      type="button"
                      className="ghost"
                      onClick={() => startEditingReading(reading)}
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      className="danger"
                      onClick={() => deleteReading(reading.id)}
                    >
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      </>
      )}

      <button type="button" className="fab-add-reading" onClick={openAddReadingModal}>
        + Add Reading
      </button>

      <nav className="app-bottom-nav" aria-label="Mobile app sections">
        <button
          type="button"
          className={activeTab === 'home' ? 'bottom-tab active' : 'bottom-tab'}
          onClick={() => setActiveTab('home')}
        >
          Home
        </button>
        <button
          type="button"
          className={activeTab === 'analytics' ? 'bottom-tab active' : 'bottom-tab'}
          onClick={() => setActiveTab('analytics')}
        >
          Insights
        </button>
        <button
          type="button"
          className={activeTab === 'history' ? 'bottom-tab active' : 'bottom-tab'}
          onClick={() => setActiveTab('history')}
        >
          History
        </button>
        <button
          type="button"
          className={activeTab === 'cloud' ? 'bottom-tab active' : 'bottom-tab'}
          onClick={() => setActiveTab('cloud')}
        >
          Cloud
        </button>
        <button
          type="button"
          className={activeTab === 'manage' ? 'bottom-tab active' : 'bottom-tab'}
          onClick={() => setActiveTab('manage')}
        >
          Manage
        </button>
      </nav>

      {appToast && <div className="app-toast">{appToast}</div>}

      <footer className="footer-note">
        Data stays local in your browser by default, with optional cloud sync when enabled.
        Annual settlement handling is built into the billing logic and shown in the cycle
        summary.
      </footer>
    </main>
  )
}

export default App
