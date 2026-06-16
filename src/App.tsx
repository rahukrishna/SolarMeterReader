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
import pdfWorkerSrc from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
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

type CloudSolarUsageRow = {
  id: string
  user_id: string
  logged_at: string
  value_kwh: number
  note: string | null
  updated_at: string
}

type CloudSolarDailySummaryRow = {
  user_id: string
  summary_date: string
  total_kwh: number
  note: string | null
  updated_at: string
}

type CloudKsebBillRow = {
  id: string
  user_id: string
  bill_date: string
  bill_time: string
  import_total: number
  export_total: number
  net: number
  solar_generated: number
  updated_at: string
}

type ActivityLogEntry = {
  id: string
  timestamp: string
  action: string
  details: string
}

type DailyForecastSnapshot = {
  date: string
  predictedImport: number
  predictedExport: number
  predictedSolar: number
  predictedNet: number
  createdAt: string
}

type ForecastAuditEntry = {
  date: string
  predictedImport: number
  actualImport: number
  predictedExport: number
  actualExport: number
  predictedSolar: number
  actualSolar: number
  predictedNet: number
  actualNet: number
  importErrorPct: number
  exportErrorPct: number
  solarErrorPct: number
  netErrorPct: number
  note: string
  checkedAt: string
}

type SolarUsageEntry = {
  id: string
  timestamp: string
  value: number
  note?: string
}

type SolarDailySummary = {
  date: string
  total: number
  note?: string
  updatedAt: string
}

type BulkSolarSummaryFormRow = {
  id: string
  date: string
  time: string
  total: string
  note: string
}

type BulkMeterFormRow = {
  id: string
  date: string
  time: string
  importTotal: string
  exportTotal: string
  solarGenerated: string
  note: string
}

type SolarDailyProductionRow = {
  date: string
  total: number
  source: 'manual-eod' | 'manual-reading' | 'meter-derived'
  note?: string
}

type KsebBillSnapshot = {
  date: string
  time: string
  importTotal: number
  exportTotal: number
  net: number
  solarGenerated: number
  updatedAt: string
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
const DAILY_FORECAST_SNAPSHOT_KEY = 'solar-meter-daily-forecast-snapshots-v1'
const FORECAST_AUDIT_KEY = 'solar-meter-forecast-audit-v1'
const SOLAR_USAGE_LOG_KEY = 'solar-meter-solar-usage-log-v1'
const SOLAR_DAILY_SUMMARY_KEY = 'solar-meter-solar-daily-summary-v1'
const FIRST_LAUNCH_AUTH_KEY = 'solar-meter-first-launch-auth-v1'
const RAIN_FEEDBACK_KEY = 'solar-meter-rain-feedback-v1'
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

const LEGACY_SEED_IDS = new Set(['seed-1', 'seed-2', 'seed-3'])

const isLegacySeedReading = (reading: Reading) =>
  LEGACY_SEED_IDS.has(reading.id) ||
  seededReadings.some(
    (seed) =>
      reading.date === seed.date &&
      reading.importT1 === seed.importT1 &&
      reading.importT2 === seed.importT2 &&
      reading.importT3 === seed.importT3 &&
      reading.exportT1 === seed.exportT1 &&
      reading.exportT2 === seed.exportT2 &&
      reading.exportT3 === seed.exportT3 &&
      reading.solarGenerated === seed.solarGenerated,
  ) ||
  (reading.date === '2026-05-26' &&
    reading.importT1 === 1 &&
    reading.importT2 === 0 &&
    reading.importT3 === 0 &&
    reading.exportT1 === 1 &&
    reading.exportT2 === 0 &&
    reading.exportT3 === 0 &&
    reading.solarGenerated === 0) ||
  (reading.date === '2026-06-02' &&
    reading.importT1 === 28 &&
    reading.importT2 === 10 &&
    reading.importT3 === 25 &&
    reading.exportT1 === 71 &&
    reading.exportT2 === 0 &&
    reading.exportT3 === 0 &&
    reading.solarGenerated === 103) ||
  (reading.date === '2026-06-07' &&
    reading.importT1 === 49 &&
    reading.importT2 === 15 &&
    reading.importT3 === 31 &&
    reading.exportT1 === 90 &&
    reading.exportT2 === 0 &&
    reading.exportT3 === 0 &&
    reading.solarGenerated === 136) ||
  // Older demo payloads before correction pass.
  (reading.date === '2026-06-02' &&
    reading.importT1 === 63 &&
    reading.importT2 === 0 &&
    reading.importT3 === 0 &&
    reading.exportT1 === 71 &&
    reading.exportT2 === 0 &&
    reading.exportT3 === 0) ||
  (reading.date === '2026-06-07' &&
    reading.importT1 === 1 &&
    reading.importT2 === 0 &&
    reading.importT3 === 0 &&
    reading.exportT1 === 1 &&
    reading.exportT2 === 0 &&
    reading.exportT3 === 0)

const stripLegacySeedReadings = (items: Reading[]) =>
  items.filter((reading) => !isLegacySeedReading(reading))

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

type DailyUsagePoint = {
  date: string
  import: number
  export: number
  solar: number
  net: number
}

const buildDailyUsageSeries = (items: DerivedReading[]) => {
  const grouped = new Map<string, DailyUsagePoint>()

  for (const row of items) {
    const key = row.date
    const existing = grouped.get(key)
    if (!existing) {
      grouped.set(key, {
        date: key,
        import: row.importDelta,
        export: row.exportDelta,
        solar: row.solarDelta,
        net: row.netDelta,
      })
      continue
    }

    existing.import += row.importDelta
    existing.export += row.exportDelta
    existing.solar += row.solarDelta
    existing.net += row.netDelta
  }

  return [...grouped.values()].sort((a, b) => a.date.localeCompare(b.date))
}

const buildNormalizedDailyUsageSeries = (items: DerivedReading[]) => {
  if (items.length <= 1) {
    return buildDailyUsageSeries(items)
  }

  const sorted = [...items].sort((a, b) => {
    const delta = getReadingTimestamp(a) - getReadingTimestamp(b)
    return delta !== 0 ? delta : a.id.localeCompare(b.id)
  })

  const grouped = new Map<string, DailyUsagePoint>()

  const addUsage = (
    date: string,
    importValue: number,
    exportValue: number,
    solarValue: number,
    netValue: number,
  ) => {
    const existing = grouped.get(date)
    if (!existing) {
      grouped.set(date, {
        date,
        import: importValue,
        export: exportValue,
        solar: solarValue,
        net: netValue,
      })
      return
    }

    existing.import += importValue
    existing.export += exportValue
    existing.solar += solarValue
    existing.net += netValue
  }

  for (let index = 1; index < sorted.length; index += 1) {
    const previous = sorted[index - 1]
    const current = sorted[index]

    const startDay = dayjs(previous.date)
    const endDay = dayjs(current.date)
    const gapDays = Math.max(1, endDay.startOf('day').diff(startDay.startOf('day'), 'day'))

    const importPerDay = current.importDelta / gapDays
    const exportPerDay = current.exportDelta / gapDays
    const solarPerDay = current.solarDelta / gapDays
    const netPerDay = current.netDelta / gapDays

    if (gapDays === 1) {
      addUsage(current.date, importPerDay, exportPerDay, solarPerDay, netPerDay)
      continue
    }

    for (let dayOffset = 1; dayOffset <= gapDays; dayOffset += 1) {
      const dayKey = startDay.add(dayOffset, 'day').format('YYYY-MM-DD')
      addUsage(dayKey, importPerDay, exportPerDay, solarPerDay, netPerDay)
    }
  }

  return [...grouped.values()].sort((a, b) => a.date.localeCompare(b.date))
}

const average = (values: number[]) =>
  values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0

const median = (values: number[]) => {
  if (!values.length) {
    return 0
  }
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  if (sorted.length % 2 === 0) {
    return (sorted[mid - 1] + sorted[mid]) / 2
  }
  return sorted[mid]
}

const standardDeviation = (values: number[]) => {
  if (values.length <= 1) {
    return 0
  }
  const mean = average(values)
  const variance =
    values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (values.length - 1)
  return Math.sqrt(variance)
}

const calculateLinearSlope = (values: number[]) => {
  if (values.length <= 1) {
    return 0
  }

  const n = values.length
  const sumX = ((n - 1) * n) / 2
  const sumXX = ((n - 1) * n * (2 * n - 1)) / 6
  const sumY = values.reduce((sum, value) => sum + value, 0)
  const sumXY = values.reduce((sum, value, index) => sum + index * value, 0)
  const denominator = n * sumXX - sumX * sumX

  if (denominator === 0) {
    return 0
  }

  return (n * sumXY - sumX * sumY) / denominator
}

const percentile = (values: number[], percentileRank: number) => {
  if (!values.length) {
    return 0
  }

  const sorted = [...values].sort((a, b) => a - b)
  const index = (sorted.length - 1) * percentileRank
  const low = Math.floor(index)
  const high = Math.ceil(index)

  if (low === high) {
    return sorted[low]
  }

  const ratio = index - low
  return sorted[low] * (1 - ratio) + sorted[high] * ratio
}

const buildOutlierBounds = (values: number[]) => {
  if (values.length < 5) {
    return { min: 0, max: Number.MAX_SAFE_INTEGER }
  }

  const q1 = percentile(values, 0.25)
  const q3 = percentile(values, 0.75)
  const iqr = q3 - q1

  if (iqr <= 0) {
    return {
      min: Math.max(0, q1 * 0.5),
      max: q3 * 1.8 + 0.001,
    }
  }

  return {
    min: Math.max(0, q1 - 1.5 * iqr),
    max: q3 + 1.5 * iqr,
  }
}

const sanitizeDailyUsageForForecast = (rows: DailyUsagePoint[]) => {
  if (!rows.length) {
    return rows
  }

  const normalized = rows.map((row) => ({
    ...row,
    import: Math.max(0, row.import),
    export: Math.max(0, row.export),
    solar: Math.max(0, row.solar),
  }))

  const importBounds = buildOutlierBounds(normalized.map((row) => row.import))
  const exportBounds = buildOutlierBounds(normalized.map((row) => row.export))
  const solarBounds = buildOutlierBounds(normalized.map((row) => row.solar))

  const filtered = normalized.filter(
    (row) =>
      row.import >= importBounds.min &&
      row.import <= importBounds.max &&
      row.export >= exportBounds.min &&
      row.export <= exportBounds.max &&
      row.solar >= solarBounds.min &&
      row.solar <= solarBounds.max,
  )

  // Keep enough samples; fallback to normalized if filtering is too aggressive.
  if (filtered.length < Math.max(7, Math.floor(normalized.length * 0.6))) {
    return normalized
  }

  return filtered
}

const getKeralaSeasonalMultipliers = (dateValue: string) => {
  const month = dayjs(dateValue).month()

  // Irimbiliyam / central Kerala profile: monsoon typically lowers solar and raises grid dependency.
  if (month >= 5 && month <= 7) {
    return { solar: 0.72, import: 1.14, export: 0.82 }
  }

  if (month >= 8 && month <= 9) {
    return { solar: 0.82, import: 1.08, export: 0.9 }
  }

  if (month >= 1 && month <= 4) {
    return { solar: 1.08, import: 0.95, export: 1.08 }
  }

  return { solar: 0.93, import: 1.02, export: 0.96 }
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))

const IRIMBILIYAM_COORDS = {
  latitude: 10.88,
  longitude: 76.13,
}

type WeatherStatus = 'idle' | 'loading' | 'ready' | 'error'

type WeatherDaySignal = {
  cloudCover: number
  rainProbability: number
  sunshineHours: number
  radiation: number
  windSpeedMax?: number
  tempMax?: number
  tempMin?: number
  sunrise?: string
  sunset?: string
}

type RainWindowConfidence = 'low' | 'medium' | 'high'

type RainWindow = {
  id: string
  start: string
  end: string
  peakProbability: number
  averageProbability: number
  expectedRainMm: number
  peakRainMmPerHour: number
  confidence: RainWindowConfidence
  thunderRisk: boolean
  lightningRisk: boolean
  likelyTimes: Array<{
    time: string
    probability: number
    mmPerHour: number
    thunderRisk: boolean
    lightningRisk: boolean
  }>
}

type NearbyWeatherAlert = {
  id: string
  level: 'rain' | 'storm'
  title: string
  message: string
  windowId: string
  windowStart: string
  windowEnd: string
  targetTime: string
}

type RainVerificationPrompt = {
  id: string
  windowId: string
  windowStart: string
  windowEnd: string
  targetTime: string
  createdAt: string
}
type RainPredictionFeedback = {
  windowId: string
  start: string
  end: string
  feedback: 'correct' | 'incorrect'
  notedAt: string
}

type RainModelTuning = {
  probabilityOffset: number
  intensityOffset: number
  mode: 'neutral' | 'strict' | 'follow'
}

type OpenMeteoDailyResponse = {
  time: string[]
  cloud_cover_mean?: number[]
  precipitation_probability_max?: number[]
  sunshine_duration?: number[]
  shortwave_radiation_sum?: number[]
  wind_speed_10m_max?: number[]
  temperature_2m_max?: number[]
  temperature_2m_min?: number[]
  sunrise?: string[]
  sunset?: string[]
}

type OpenMeteoHourlyResponse = {
  time: string[]
  precipitation_probability?: number[]
  precipitation?: number[]
  rain?: number[]
  showers?: number[]
  weather_code?: number[]
  cape?: number[]
}

type OpenMeteoResponse = {
  daily?: OpenMeteoDailyResponse
  hourly?: OpenMeteoHourlyResponse
}

const formatWeatherClock = (value?: string) => {
  if (!value) {
    return '--'
  }
  const parsed = dayjs(value)
  return parsed.isValid() ? parsed.format('HH:mm') : '--'
}

const buildOneLineWeatherReport = (signal?: WeatherDaySignal) => {
  if (!signal) {
    return 'Weather report unavailable.'
  }

  const skyText =
    signal.rainProbability >= 60
      ? 'Rain can be expected today'
      : signal.rainProbability >= 35
        ? 'Light showers are possible'
        : signal.cloudCover >= 70
          ? 'Sky will stay mostly cloudy'
          : signal.cloudCover >= 35
            ? 'Sun should be visible between cloud breaks'
            : 'Mostly sunny conditions are expected'

  const tempText =
    signal.tempMax != null && signal.tempMin != null
      ? `, ${signal.tempMin.toFixed(0)}°-${signal.tempMax.toFixed(0)}°C`
      : ''

  const sunWindowText =
    signal.sunshineHours >= 7
      ? 'good sun visibility for most of the day'
      : signal.sunshineHours >= 4
        ? 'sun should be visible for a few hours'
        : signal.sunshineHours >= 1.5
          ? 'brief sunny breaks are likely'
          : 'very limited sun visibility is expected'

  const windText =
    signal.windSpeedMax != null
      ? signal.windSpeedMax >= 25
        ? `strong wind up to ${signal.windSpeedMax.toFixed(0)} km/h`
        : signal.windSpeedMax >= 15
          ? `moderate wind up to ${signal.windSpeedMax.toFixed(0)} km/h`
          : `light wind around ${signal.windSpeedMax.toFixed(0)} km/h`
      : 'light to moderate wind is expected'

  return `${skyText}${tempText}. ${sunWindowText}. ${windText}. Rain chance ${signal.rainProbability.toFixed(0)}%.`
}

const getRainWindowConfidence = (
  peakProbability: number,
  peakRainMmPerHour: number,
  durationHours: number,
): RainWindowConfidence => {
  if (peakProbability >= 70 && peakRainMmPerHour >= 0.7 && durationHours >= 2) {
    return 'high'
  }

  if (peakProbability >= 50 || peakRainMmPerHour >= 0.35) {
    return 'medium'
  }

  return 'low'
}

const isThunderWeatherCode = (code: number) => code === 95 || code === 96 || code === 99

const buildRainWindowsFromHourly = (
  hourly?: OpenMeteoHourlyResponse,
  tuning: RainModelTuning = {
    probabilityOffset: 0,
    intensityOffset: 0,
    mode: 'neutral',
  },
) => {
  if (!hourly?.time?.length) {
    return [] as RainWindow[]
  }

  const horizonStart = dayjs().startOf('hour')
  const horizonEnd = horizonStart.add(48, 'hour')
  const probabilityTrigger = clamp(45 + tuning.probabilityOffset, 30, 75)
  const moderateProbabilityTrigger = clamp(35 + tuning.probabilityOffset, 20, 70)
  const weakProbabilityTrigger = clamp(25 + tuning.probabilityOffset, 15, 65)
  const moderateIntensityTrigger = clamp(0.2 + tuning.intensityOffset, 0.1, 0.8)
  const highIntensityTrigger = clamp(0.6 + tuning.intensityOffset, 0.2, 1.4)

  const points = hourly.time
    .map((timestamp, index) => {
      const at = dayjs(timestamp)
      if (!at.isValid() || at.isBefore(horizonStart) || at.isAfter(horizonEnd)) {
        return null
      }

      const probability = clamp(Number(hourly.precipitation_probability?.[index] ?? 0), 0, 100)
      const precipitation = Math.max(0, Number(hourly.precipitation?.[index] ?? 0))
      const rain = Math.max(0, Number(hourly.rain?.[index] ?? 0))
      const showers = Math.max(0, Number(hourly.showers?.[index] ?? 0))
      const weatherCode = Math.round(Number(hourly.weather_code?.[index] ?? -1))
      const cape = Math.max(0, Number(hourly.cape?.[index] ?? 0))
      const mmPerHour = Math.max(precipitation, rain + showers)
      const thunderRisk =
        isThunderWeatherCode(weatherCode) ||
        (cape >= 700 && (mmPerHour >= 0.3 || probability >= 45))
      const lightningRisk = isThunderWeatherCode(weatherCode) || cape >= 1200
      const likelyRain =
        thunderRisk ||
        probability >= probabilityTrigger ||
        (probability >= moderateProbabilityTrigger && mmPerHour >= moderateIntensityTrigger) ||
        (probability >= weakProbabilityTrigger && mmPerHour >= highIntensityTrigger)

      return {
        at,
        probability,
        mmPerHour,
        likelyRain,
        thunderRisk,
        lightningRisk,
      }
    })
    .filter((point): point is {
      at: dayjs.Dayjs
      probability: number
      mmPerHour: number
      likelyRain: boolean
      thunderRisk: boolean
      lightningRisk: boolean
    } =>
      point != null,
    )

  if (!points.length) {
    return [] as RainWindow[]
  }

  const windows: RainWindow[] = []
  let current: {
    start: dayjs.Dayjs
    end: dayjs.Dayjs
    probabilities: number[]
    mmPerHourValues: number[]
    thunderRisk: boolean
    lightningRisk: boolean
    slots: Array<{
      time: string
      probability: number
      mmPerHour: number
      thunderRisk: boolean
      lightningRisk: boolean
    }>
  } | null = null

  const finalizeCurrent = () => {
    if (!current) {
      return
    }

    const durationHours = Math.max(1, current.end.diff(current.start, 'hour'))
    const peakProbability = Math.max(...current.probabilities)
    const averageProbability = average(current.probabilities)
    const expectedRainMm = current.mmPerHourValues.reduce((sum, value) => sum + value, 0)
    const peakRainMmPerHour = Math.max(...current.mmPerHourValues)
    const confidence = getRainWindowConfidence(
      peakProbability,
      peakRainMmPerHour,
      durationHours,
    )

    const likelyTimes = [...current.slots]
      .sort((a, b) => {
        const scoreA = a.probability * 0.75 + Math.min(a.mmPerHour * 25, 25)
        const scoreB = b.probability * 0.75 + Math.min(b.mmPerHour * 25, 25)
        return scoreB - scoreA
      })
      .slice(0, 4)
      .sort((a, b) => dayjs(a.time).valueOf() - dayjs(b.time).valueOf())

    windows.push({
      id: `${current.start.toISOString()}_${current.end.toISOString()}`,
      start: current.start.toISOString(),
      end: current.end.toISOString(),
      peakProbability,
      averageProbability,
      expectedRainMm,
      peakRainMmPerHour,
      confidence,
      thunderRisk: current.thunderRisk,
      lightningRisk: current.lightningRisk,
      likelyTimes,
    })
  }

  for (const point of points) {
    if (!point.likelyRain) {
      finalizeCurrent()
      current = null
      continue
    }

    if (!current) {
      current = {
        start: point.at,
        end: point.at.add(1, 'hour'),
        probabilities: [point.probability],
        mmPerHourValues: [point.mmPerHour],
        thunderRisk: point.thunderRisk,
        lightningRisk: point.lightningRisk,
        slots: [
          {
            time: point.at.toISOString(),
            probability: point.probability,
            mmPerHour: point.mmPerHour,
            thunderRisk: point.thunderRisk,
            lightningRisk: point.lightningRisk,
          },
        ],
      }
      continue
    }

    const gapHours = point.at.diff(current.end, 'minute') / 60
    if (gapHours > 1) {
      finalizeCurrent()
      current = {
        start: point.at,
        end: point.at.add(1, 'hour'),
        probabilities: [point.probability],
        mmPerHourValues: [point.mmPerHour],
        thunderRisk: point.thunderRisk,
        lightningRisk: point.lightningRisk,
        slots: [
          {
            time: point.at.toISOString(),
            probability: point.probability,
            mmPerHour: point.mmPerHour,
            thunderRisk: point.thunderRisk,
            lightningRisk: point.lightningRisk,
          },
        ],
      }
      continue
    }

    current.end = point.at.add(1, 'hour')
    current.probabilities.push(point.probability)
    current.mmPerHourValues.push(point.mmPerHour)
    current.thunderRisk = current.thunderRisk || point.thunderRisk
    current.lightningRisk = current.lightningRisk || point.lightningRisk
    current.slots.push({
      time: point.at.toISOString(),
      probability: point.probability,
      mmPerHour: point.mmPerHour,
      thunderRisk: point.thunderRisk,
      lightningRisk: point.lightningRisk,
    })
  }

  finalizeCurrent()

  return windows
    .filter((window) => window.peakProbability >= 35 || window.expectedRainMm >= 0.3)
    .sort((a, b) => dayjs(a.start).valueOf() - dayjs(b.start).valueOf())
    .slice(0, 6)
}

const formatRainWindowRange = (startIso: string, endIso: string) => {
  const start = dayjs(startIso)
  const end = dayjs(endIso)

  if (!start.isValid() || !end.isValid()) {
    return '--'
  }

  const dayLabel = start.isSame(dayjs(), 'day')
    ? 'Today'
    : start.isSame(dayjs().add(1, 'day'), 'day')
      ? 'Tomorrow'
      : start.format('ddd, DD MMM')

  const sameDay = start.isSame(end, 'day')
  return sameDay
    ? `${dayLabel}, ${start.format('HH:mm')} - ${end.format('HH:mm')}`
    : `${dayLabel}, ${start.format('HH:mm')} - ${end.format('ddd HH:mm')}`
}

const buildNearbyWeatherAlert = (windows: RainWindow[]): NearbyWeatherAlert | null => {
  if (!windows.length) {
    return null
  }

  const now = dayjs()
  const ranked = [...windows].sort((a, b) => dayjs(a.start).valueOf() - dayjs(b.start).valueOf())

  const active = ranked.find((window) => {
    const start = dayjs(window.start)
    const end = dayjs(window.end)
    return (now.isAfter(start) || now.isSame(start)) && now.isBefore(end)
  })

  if (active) {
    const targetSlot =
      active.likelyTimes.find((slot) => {
        const slotTime = dayjs(slot.time)
        return now.isSame(slotTime) || now.isBefore(slotTime)
      }) ?? active.likelyTimes[0]
    const targetTime = targetSlot?.time ?? active.start
    const severe = active.thunderRisk || active.lightningRisk
    return {
      id: `${active.id}_${targetTime}_active`,
      level: severe ? 'storm' : 'rain',
      title: severe ? 'Storm risk right now' : 'Rain likely right now',
      message: severe
        ? `Thunder or lightning risk around ${dayjs(targetTime).format('HH:mm')} (peak rain chance ${active.peakProbability.toFixed(0)}%).`
        : `Rain is likely around ${dayjs(targetTime).format('HH:mm')} (peak chance ${active.peakProbability.toFixed(0)}%).`,
      windowId: active.id,
      windowStart: active.start,
      windowEnd: active.end,
      targetTime,
    }
  }

  const next3h = ranked.find((window) => {
    const start = dayjs(window.start)
    const minutesAway = start.diff(now, 'minute')
    return minutesAway >= 0 && minutesAway <= 180
  })

  if (!next3h) {
    return null
  }

  const severe = next3h.thunderRisk || next3h.lightningRisk
  const nextSlot =
    next3h.likelyTimes.find((slot) => dayjs(slot.time).diff(now, 'minute') >= 0) ??
    next3h.likelyTimes[0]
  const targetTime = nextSlot?.time ?? next3h.start
  const minutesAway = Math.max(0, dayjs(targetTime).diff(now, 'minute'))
  const startLabel = dayjs(targetTime).format('HH:mm')

  return {
    id: `${next3h.id}_${targetTime}_soon`,
    level: severe ? 'storm' : 'rain',
    title: severe ? 'Storm risk nearby' : 'Rain likely soon',
    message: severe
      ? `Thunder or lightning risk may start around ${startLabel} (${minutesAway} min).`
      : `Rain may start around ${startLabel} (${minutesAway} min), peak chance ${next3h.peakProbability.toFixed(0)}%.`,
    windowId: next3h.id,
    windowStart: next3h.start,
    windowEnd: next3h.end,
    targetTime,
  }
}

const deriveRainModelTuning = (feedbacks: RainPredictionFeedback[]): RainModelTuning => {
  const recent = feedbacks.slice(0, 20)
  if (recent.length < 4) {
    return { probabilityOffset: 0, intensityOffset: 0, mode: 'neutral' }
  }

  const correctCount = recent.filter((entry) => entry.feedback === 'correct').length
  const incorrectCount = recent.length - correctCount
  const accuracy = correctCount / recent.length
  const recentStreak = recent.slice(0, 3)
  const incorrectStreak =
    recentStreak.length === 3 && recentStreak.every((entry) => entry.feedback === 'incorrect')

  if (accuracy < 0.5 || incorrectStreak) {
    return {
      probabilityOffset: incorrectStreak ? 10 : 8,
      intensityOffset: incorrectStreak ? 0.18 : 0.12,
      mode: 'strict',
    }
  }

  if (accuracy < 0.65) {
    return { probabilityOffset: 4, intensityOffset: 0.06, mode: 'strict' }
  }

  if (accuracy > 0.85 && correctCount >= incorrectCount * 2) {
    return { probabilityOffset: -4, intensityOffset: -0.05, mode: 'follow' }
  }

  if (accuracy > 0.72) {
    return { probabilityOffset: -2, intensityOffset: -0.02, mode: 'follow' }
  }

  return { probabilityOffset: 0, intensityOffset: 0, mode: 'neutral' }
}

const getWeatherAdjustedMultipliers = (
  dateValue: string,
  signal?: WeatherDaySignal,
) => {
  const seasonal = getKeralaSeasonalMultipliers(dateValue)

  if (!signal) {
    return {
      import: seasonal.import,
      export: seasonal.export,
      solar: seasonal.solar,
      hasLiveWeather: false,
    }
  }

  const sunshineFactor = clamp(signal.sunshineHours / 7.2, 0.35, 1.3)
  const cloudFactor = clamp(1 - signal.cloudCover / 120, 0.3, 1.2)
  const rainFactor = clamp(1 - signal.rainProbability / 160, 0.35, 1.1)
  const radiationFactor = clamp(signal.radiation / 18, 0.35, 1.25)

  const solarWeatherFactor = clamp(
    sunshineFactor * 0.42 + cloudFactor * 0.26 + rainFactor * 0.17 + radiationFactor * 0.15,
    0.3,
    1.35,
  )

  const importWeatherFactor = clamp(1 + (1 - solarWeatherFactor) * 0.48, 0.82, 1.42)
  const exportWeatherFactor = clamp(solarWeatherFactor * 0.95, 0.25, 1.35)

  return {
    import: seasonal.import * importWeatherFactor,
    export: seasonal.export * exportWeatherFactor,
    solar: seasonal.solar * solarWeatherFactor,
    hasLiveWeather: true,
  }
}

const describeForecastDeviation = (
  importErrorPct: number,
  exportErrorPct: number,
  solarErrorPct: number,
) => {
  if (solarErrorPct < -18) {
    return 'Actual solar was lower than expected, likely due to cloud/rain variation.'
  }
  if (solarErrorPct > 18) {
    return 'Actual solar was higher than expected, likely due to clearer weather.'
  }
  if (importErrorPct > 15) {
    return 'Import was higher than predicted, likely due to additional household load.'
  }
  if (importErrorPct < -15) {
    return 'Import was lower than predicted, likely due to lighter household usage.'
  }
  if (exportErrorPct > 15) {
    return 'Export exceeded expectation, showing stronger generation or lower self-use.'
  }
  if (exportErrorPct < -15) {
    return 'Export was lower than expected, likely due to higher self-consumption.'
  }
  return 'Prediction matched observed pattern reasonably well.'
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
    // Allow line breaks and separators between label and value; many bills split these.
    const expression = new RegExp(`${label}[^\\d-]{0,45}(-?\\d[\\d,]*(?:\\.\\d+)?)`, 'i')
    const match = text.match(expression)
    if (match?.[1]) {
      const parsed = parseNumeric(match[1])
      if (parsed !== undefined) {
        return parsed
      }
    }

    // Fallback for table-like PDF text where label and value may be split across lines.
    const labelRegex = new RegExp(label, 'i')
    const lines = text.split('\n')
    for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
      const line = lines[lineIndex]
      if (!labelRegex.test(line)) {
        continue
      }

      const scanWindow = [line, lines[lineIndex + 1] ?? '', lines[lineIndex + 2] ?? ''].join(' ')
      const numberMatches = Array.from(scanWindow.matchAll(/-?\d[\d,]*(?:\.\d+)?/g)).map(
        (match) => match[0],
      )

      if (!numberMatches.length) {
        continue
      }

      // Prefer the last value in the row/window (usually the current reading in bill tables).
      const candidate = parseNumeric(numberMatches[numberMatches.length - 1])
      if (candidate !== undefined) {
        return candidate
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

  let importT = extractNumberByLabels(text, [
    'import\\s*(?:reading|total|units|kwh)',
    'kseb\\s*import',
    'import\\s*energy',
    'import\\s*current\\s*reading',
    'present\\s*import\\s*reading',
    'import\\s*meter\\s*reading',
    'imp\\s*(?:total|reading)',
  ])

  let exportT = extractNumberByLabels(text, [
    'export\\s*(?:reading|total|units|kwh)',
    'kseb\\s*export',
    'export\\s*energy',
    'export\\s*current\\s*reading',
    'present\\s*export\\s*reading',
    'export\\s*meter\\s*reading',
    'exp\\s*(?:total|reading)',
  ])

  let net = extractNumberByLabels(text, ['net\\s*(?:units|kwh|reading|usage)'])

  const importT1 = extractNumberByLabels(text, [
    'import\\s*t\\s*1',
    'imp\\s*t\\s*1',
    't\\s*1\\s*import',
    'import\\s*zone\\s*1',
    'import\\s*slot\\s*1',
    'import\\s*normal',
    'import\\s*t1',
    'imp\\s*t1',
    't1\\s*import',
  ])
  const importT2 = extractNumberByLabels(text, [
    'import\\s*t\\s*2',
    'imp\\s*t\\s*2',
    't\\s*2\\s*import',
    'import\\s*zone\\s*2',
    'import\\s*slot\\s*2',
    'import\\s*peak',
    'import\\s*t2',
    'imp\\s*t2',
    't2\\s*import',
  ])
  const importT3 = extractNumberByLabels(text, [
    'import\\s*t\\s*3',
    'imp\\s*t\\s*3',
    't\\s*3\\s*import',
    'import\\s*zone\\s*3',
    'import\\s*slot\\s*3',
    'import\\s*off\\s*peak',
    'import\\s*t3',
    'imp\\s*t3',
    't3\\s*import',
  ])

  const exportT1 = extractNumberByLabels(text, [
    'export\\s*t\\s*1',
    'exp\\s*t\\s*1',
    't\\s*1\\s*export',
    'export\\s*zone\\s*1',
    'export\\s*slot\\s*1',
    'export\\s*t1',
    'exp\\s*t1',
    't1\\s*export',
  ])
  const exportT2 = extractNumberByLabels(text, [
    'export\\s*t\\s*2',
    'exp\\s*t\\s*2',
    't\\s*2\\s*export',
    'export\\s*zone\\s*2',
    'export\\s*slot\\s*2',
    'export\\s*t2',
    'exp\\s*t2',
    't2\\s*export',
  ])
  const exportT3 = extractNumberByLabels(text, [
    'export\\s*t\\s*3',
    'exp\\s*t\\s*3',
    't\\s*3\\s*export',
    'export\\s*zone\\s*3',
    'export\\s*slot\\s*3',
    'export\\s*t3',
    'exp\\s*t3',
    't3\\s*export',
  ])

  if (importT === undefined && importT1 !== undefined && importT2 !== undefined && importT3 !== undefined) {
    importT = importT1 + importT2 + importT3
  }

  if (exportT === undefined && exportT1 !== undefined && exportT2 !== undefined && exportT3 !== undefined) {
    exportT = exportT1 + exportT2 + exportT3
  }

  if (net === undefined && importT !== undefined && exportT !== undefined) {
    net = importT - exportT
  }

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
  pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerSrc

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
const defaultSolarSummaryDateTime = () => dayjs().format('YYYY-MM-DDTHH:mm')

const createBulkSolarSummaryRow = (
  previousRow?: BulkSolarSummaryFormRow,
): BulkSolarSummaryFormRow => {
  if (previousRow) {
    const base = dayjs(`${previousRow.date}T${previousRow.time || '00:00'}`)
    return {
      id: createReadingId(),
      date: base.isValid() ? base.add(1, 'day').format('YYYY-MM-DD') : dayjs().format('YYYY-MM-DD'),
      time: previousRow.time || dayjs().format('HH:mm'),
      total: '',
      note: '',
    }
  }

  const current = defaultSolarSummaryDateTime()
  return {
    id: createReadingId(),
    date: current.slice(0, 10),
    time: current.slice(11, 16),
    total: '',
    note: '',
  }
}

const createBulkMeterRow = (previousRow?: BulkMeterFormRow): BulkMeterFormRow => {
  if (previousRow) {
    const base = dayjs(`${previousRow.date}T${previousRow.time || '00:00'}`)
    return {
      id: createReadingId(),
      date: base.isValid() ? base.add(1, 'day').format('YYYY-MM-DD') : dayjs().format('YYYY-MM-DD'),
      time: previousRow.time || dayjs().format('HH:mm'),
      importTotal: previousRow.importTotal,
      exportTotal: previousRow.exportTotal,
      solarGenerated: previousRow.solarGenerated,
      note: '',
    }
  }

  return {
    id: createReadingId(),
    date: dayjs().format('YYYY-MM-DD'),
    time: dayjs().format('HH:mm'),
    importTotal: '',
    exportTotal: '',
    solarGenerated: '',
    note: '',
  }
}

const findLatestKsebBillReading = (items: Reading[]) =>
  [...items]
    .filter((reading) => (reading.note ?? '').toLowerCase().includes('kseb bill'))
    .sort((a, b) => getReadingTimestamp(b) - getReadingTimestamp(a))[0] ?? null

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
  const [solarHistoryMonthFilter, setSolarHistoryMonthFilter] = useState('')
  const [solarHistoryYearFilter, setSolarHistoryYearFilter] = useState('')
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
  const [ksebBillEntryDate, setKsebBillEntryDate] = useState(dayjs().format('YYYY-MM-DD'))
  const [ksebBillEntryTime, setKsebBillEntryTime] = useState('07:00')
  const [ksebBillImportInput, setKsebBillImportInput] = useState('')
  const [ksebBillExportInput, setKsebBillExportInput] = useState('')
  const [ksebBillNetInput, setKsebBillNetInput] = useState('')
  const [ksebBillSolarInput, setKsebBillSolarInput] = useState('')
  const [ksebBillSnapshot, setKsebBillSnapshot] = useState<KsebBillSnapshot | null>(null)
  const [billImportBusy, setBillImportBusy] = useState(false)
  const [billImportMessage, setBillImportMessage] = useState('')
  const [weatherSignals, setWeatherSignals] = useState<Record<string, WeatherDaySignal>>({})
  const [rainWindows, setRainWindows] = useState<RainWindow[]>([])
  const [rainPredictionFeedbacks, setRainPredictionFeedbacks] = useState<RainPredictionFeedback[]>([])
  const [rainForecastUpdatedAt, setRainForecastUpdatedAt] = useState('')
  const [nearbyWeatherAlert, setNearbyWeatherAlert] = useState<NearbyWeatherAlert | null>(null)
  const [rainVerificationPrompt, setRainVerificationPrompt] =
    useState<RainVerificationPrompt | null>(null)
  const [lastWeatherNotificationKey, setLastWeatherNotificationKey] = useState('')
  const [weatherStatus, setWeatherStatus] = useState<WeatherStatus>('idle')
  const [weatherMessage, setWeatherMessage] = useState('')
  const [dailyForecastSnapshots, setDailyForecastSnapshots] = useState<
    Record<string, DailyForecastSnapshot>
  >({})
  const [forecastAudits, setForecastAudits] = useState<ForecastAuditEntry[]>([])
  const [solarUsageLogs, setSolarUsageLogs] = useState<SolarUsageEntry[]>([])
  const [isSolarLogModalOpen, setIsSolarLogModalOpen] = useState(false)
  const [solarLogDate, setSolarLogDate] = useState(dayjs().format('YYYY-MM-DD'))
  const [solarLogTime, setSolarLogTime] = useState(defaultReadingTime())
  const [solarLogValue, setSolarLogValue] = useState('')
  const [solarLogNote, setSolarLogNote] = useState('')
  const [isBulkSolarModalOpen, setIsBulkSolarModalOpen] = useState(false)
  const [bulkSolarRows, setBulkSolarRows] = useState<BulkSolarSummaryFormRow[]>([])
  const [bulkSolarErrors, setBulkSolarErrors] = useState<string[]>([])
  const [isBulkMeterModalOpen, setIsBulkMeterModalOpen] = useState(false)
  const [bulkMeterRows, setBulkMeterRows] = useState<BulkMeterFormRow[]>([])
  const [bulkMeterErrors, setBulkMeterErrors] = useState<string[]>([])
  const [showDailyBreakdown, setShowDailyBreakdown] = useState(false)
  const [showWeatherOutlook, setShowWeatherOutlook] = useState(false)
  const [solarDailySummaries, setSolarDailySummaries] = useState<SolarDailySummary[]>([])
  const [eodSolarTotalInput, setEodSolarTotalInput] = useState('')
  const [eodSolarNoteInput, setEodSolarNoteInput] = useState('')
  const [requiresFirstLaunchAuth, setRequiresFirstLaunchAuth] = useState(true)
  const [firstLaunchEmail, setFirstLaunchEmail] = useState('')
  const [firstLaunchPassword, setFirstLaunchPassword] = useState('')
  const [firstLaunchAuthBusy, setFirstLaunchAuthBusy] = useState(false)
  const [firstLaunchAuthError, setFirstLaunchAuthError] = useState('')

  const rainModelTuning = useMemo(
    () => deriveRainModelTuning(rainPredictionFeedbacks),
    [rainPredictionFeedbacks],
  )

  const rainFeedbackByWindowId = useMemo(
    () => new Map(rainPredictionFeedbacks.map((entry) => [entry.windowId, entry.feedback])),
    [rainPredictionFeedbacks],
  )

  const rainPredictionAccuracy = useMemo(() => {
    if (!rainPredictionFeedbacks.length) {
      return {
        sampleSize: 0,
        correctCount: 0,
        accuracyPct: 0,
      }
    }

    const recent = rainPredictionFeedbacks.slice(0, 30)
    const correctCount = recent.filter((entry) => entry.feedback === 'correct').length
    const accuracyPct = (correctCount / recent.length) * 100

    return {
      sampleSize: recent.length,
      correctCount,
      accuracyPct,
    }
  }, [rainPredictionFeedbacks])

  useEffect(() => {
    const rawReadings = localStorage.getItem(STORAGE_KEY)
    const rawSettings = localStorage.getItem(SETTINGS_KEY)
    const firstLaunchAuth = localStorage.getItem(FIRST_LAUNCH_AUTH_KEY)
    const versionRaw = localStorage.getItem(DATA_VERSION_KEY)
    const version = versionRaw ? Number(versionRaw) : 0

    setRequiresFirstLaunchAuth(firstLaunchAuth !== 'done')

    if (rawReadings) {
      const parsed = JSON.parse(rawReadings) as Reading[]
      const withoutLegacySeeds = stripLegacySeedReadings(parsed)
      let normalized = withoutLegacySeeds.length ? sortReadings(withoutLegacySeeds) : []
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

      const parsedKsebFromReadings = findLatestKsebBillReading(normalized)
      if (parsedKsebFromReadings) {
        setKsebBillSnapshot({
          date: parsedKsebFromReadings.date,
          time: parsedKsebFromReadings.time,
          importTotal: calculateImportTotal(parsedKsebFromReadings),
          exportTotal: calculateExportTotal(parsedKsebFromReadings),
          net: calculateNet(parsedKsebFromReadings),
          solarGenerated: parsedKsebFromReadings.solarGenerated,
          updatedAt: new Date().toISOString(),
        })
      }
    } else {
      setReadings([])
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

    const rawForecastAudit = localStorage.getItem(FORECAST_AUDIT_KEY)
    if (rawForecastAudit) {
      const parsed = JSON.parse(rawForecastAudit) as ForecastAuditEntry[]
      setForecastAudits(parsed.slice(0, 40))
    }

    const rawForecastSnapshots = localStorage.getItem(DAILY_FORECAST_SNAPSHOT_KEY)
    if (rawForecastSnapshots) {
      const parsed = JSON.parse(rawForecastSnapshots) as Record<string, DailyForecastSnapshot>
      setDailyForecastSnapshots(parsed)
    }

    const rawSolarUsage = localStorage.getItem(SOLAR_USAGE_LOG_KEY)
    if (rawSolarUsage) {
      const parsed = JSON.parse(rawSolarUsage) as SolarUsageEntry[]
      setSolarUsageLogs(parsed.slice(0, 300))
    }

    const rawSolarSummary = localStorage.getItem(SOLAR_DAILY_SUMMARY_KEY)
    if (rawSolarSummary) {
      const parsed = JSON.parse(rawSolarSummary) as SolarDailySummary[]
      setSolarDailySummaries(parsed.slice(0, 120))
    }

    const rawRainFeedback = localStorage.getItem(RAIN_FEEDBACK_KEY)
    if (rawRainFeedback) {
      const parsed = JSON.parse(rawRainFeedback) as RainPredictionFeedback[]
      setRainPredictionFeedbacks(parsed.slice(0, 120))
    }

    setIsHydrated(true)
  }, [])

  useEffect(() => {
    if (!isHydrated) {
      return
    }
    localStorage.setItem(FORECAST_AUDIT_KEY, JSON.stringify(forecastAudits.slice(0, 40)))
  }, [forecastAudits, isHydrated])

  useEffect(() => {
    if (!isHydrated) {
      return
    }
    localStorage.setItem(DAILY_FORECAST_SNAPSHOT_KEY, JSON.stringify(dailyForecastSnapshots))
  }, [dailyForecastSnapshots, isHydrated])

  useEffect(() => {
    if (!isHydrated) {
      return
    }
    localStorage.setItem(SOLAR_USAGE_LOG_KEY, JSON.stringify(solarUsageLogs.slice(0, 300)))
  }, [solarUsageLogs, isHydrated])

  useEffect(() => {
    if (!isHydrated) {
      return
    }
    localStorage.setItem(
      SOLAR_DAILY_SUMMARY_KEY,
      JSON.stringify(solarDailySummaries.slice(0, 120)),
    )
  }, [solarDailySummaries, isHydrated])

  useEffect(() => {
    if (!isHydrated) {
      return
    }
    localStorage.setItem(
      RAIN_FEEDBACK_KEY,
      JSON.stringify(rainPredictionFeedbacks.slice(0, 120)),
    )
  }, [rainPredictionFeedbacks, isHydrated])

  useEffect(() => {
    if (!isCloudEnabled || !supabase) {
      return
    }

    let isMounted = true

    void supabase.auth.getUser().then(({ data }) => {
      if (isMounted) {
        setCloudUser(data.user ?? null)
        if (data.user) {
          localStorage.setItem(FIRST_LAUNCH_AUTH_KEY, 'done')
          setRequiresFirstLaunchAuth(false)
        }
      }
    })

    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      setCloudUser(session?.user ?? null)
      if (session?.user) {
        localStorage.setItem(FIRST_LAUNCH_AUTH_KEY, 'done')
        setRequiresFirstLaunchAuth(false)
      }
    })

    return () => {
      isMounted = false
      listener.subscription.unsubscribe()
    }
  }, [])

  useEffect(() => {
    let isCancelled = false
    let isRefreshing = false

    const loadWeatherForecast = async () => {
      if (isRefreshing) {
        return
      }
      isRefreshing = true
      setWeatherStatus('loading')

      try {
        const today = dayjs().format('YYYY-MM-DD')
        const forecastEnd = dayjs().add(15, 'day').format('YYYY-MM-DD')
        const params = new URLSearchParams({
          latitude: String(IRIMBILIYAM_COORDS.latitude),
          longitude: String(IRIMBILIYAM_COORDS.longitude),
          timezone: 'Asia/Kolkata',
          start_date: today,
          end_date: forecastEnd,
          daily:
            'cloud_cover_mean,precipitation_probability_max,sunshine_duration,shortwave_radiation_sum,wind_speed_10m_max,temperature_2m_max,temperature_2m_min,sunrise,sunset',
          hourly: 'precipitation_probability,precipitation,rain,showers,weather_code,cape',
        })

        const response = await fetch(`https://api.open-meteo.com/v1/forecast?${params.toString()}`)
        if (!response.ok) {
          throw new Error(`Weather service unavailable (${response.status})`)
        }

        const payload = (await response.json()) as OpenMeteoResponse
        const daily = payload.daily
        const windows = buildRainWindowsFromHourly(payload.hourly, rainModelTuning)

        if (!daily?.time?.length) {
          throw new Error('Weather service returned empty daily forecast')
        }

        const nextSignals: Record<string, WeatherDaySignal> = {}

        for (let index = 0; index < daily.time.length; index += 1) {
          const dateKey = daily.time[index]
          nextSignals[dateKey] = {
            cloudCover: Number(daily.cloud_cover_mean?.[index] ?? 60),
            rainProbability: Number(daily.precipitation_probability_max?.[index] ?? 40),
            sunshineHours: Number(daily.sunshine_duration?.[index] ?? 21600) / 3600,
            radiation: Number(daily.shortwave_radiation_sum?.[index] ?? 12),
            windSpeedMax:
              daily.wind_speed_10m_max?.[index] != null
                ? Number(daily.wind_speed_10m_max[index])
                : undefined,
            tempMax: daily.temperature_2m_max?.[index] != null ? Number(daily.temperature_2m_max[index]) : undefined,
            tempMin: daily.temperature_2m_min?.[index] != null ? Number(daily.temperature_2m_min[index]) : undefined,
            sunrise: daily.sunrise?.[index],
            sunset: daily.sunset?.[index],
          }
        }

        if (!isCancelled) {
          setWeatherSignals(nextSignals)
          setRainWindows(windows)
          setRainForecastUpdatedAt(dayjs().toISOString())
          setWeatherStatus('ready')
          setWeatherMessage(
            `Live weather synced for ${Object.keys(nextSignals).length} days with hourly rain timing (${windows.length} windows, ${rainModelTuning.mode} mode).`,
          )
        }
      } catch (error) {
        if (!isCancelled) {
          setRainWindows([])
          setRainForecastUpdatedAt('')
          setWeatherStatus('error')
          setWeatherMessage(
            error instanceof Error
              ? `${error.message}. Using seasonal fallback model.`
              : 'Weather sync failed. Using seasonal fallback model.',
          )
        }
      } finally {
        isRefreshing = false
      }
    }

    void loadWeatherForecast()

    const refreshTimer = window.setInterval(() => {
      void loadWeatherForecast()
    }, 20 * 60 * 1000)

    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        void loadWeatherForecast()
      }
    }

    document.addEventListener('visibilitychange', onVisibilityChange)

    return () => {
      isCancelled = true
      window.clearInterval(refreshTimer)
      document.removeEventListener('visibilitychange', onVisibilityChange)
    }
  }, [rainModelTuning])

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

  useEffect(() => {
    setNearbyWeatherAlert(buildNearbyWeatherAlert(rainWindows))
  }, [rainWindows])

  useEffect(() => {
    if (!nearbyWeatherAlert) {
      return
    }

    const notificationKey = `${nearbyWeatherAlert.id}_${nearbyWeatherAlert.level}`
    if (lastWeatherNotificationKey === notificationKey) {
      return
    }

    setLastWeatherNotificationKey(notificationKey)
    setAppToast(`${nearbyWeatherAlert.title}: ${nearbyWeatherAlert.message}`)

    if (!rainFeedbackByWindowId.has(nearbyWeatherAlert.windowId)) {
      setRainVerificationPrompt({
        id: notificationKey,
        windowId: nearbyWeatherAlert.windowId,
        windowStart: nearbyWeatherAlert.windowStart,
        windowEnd: nearbyWeatherAlert.windowEnd,
        targetTime: nearbyWeatherAlert.targetTime,
        createdAt: new Date().toISOString(),
      })
    }

    if (typeof Notification === 'undefined') {
      return
    }

    const sendNotification = () => {
      try {
        void new Notification(nearbyWeatherAlert.title, {
          body: nearbyWeatherAlert.message,
          tag: notificationKey,
        })
      } catch {
        // Ignore notification failures on unsupported environments.
      }
    }

    if (Notification.permission === 'granted') {
      sendNotification()
      return
    }

    if (Notification.permission === 'default') {
      void Notification.requestPermission().then((permission) => {
        if (permission === 'granted') {
          sendNotification()
        }
      })
    }
  }, [nearbyWeatherAlert, lastWeatherNotificationKey, rainFeedbackByWindowId])

  useEffect(() => {
    if (!rainVerificationPrompt) {
      return
    }

    if (rainFeedbackByWindowId.has(rainVerificationPrompt.windowId)) {
      return
    }

    const target = dayjs(rainVerificationPrompt.targetTime)
    const promptText = `Did it rain at ${target.format('HH:mm')}? Please mark Yes or No in Expected Rain Timing.`
    const delay = target.diff(dayjs(), 'millisecond')

    if (delay <= 0) {
      setAppToast(promptText)
      return
    }

    const timer = window.setTimeout(() => {
      setAppToast(promptText)
    }, delay)

    return () => {
      window.clearTimeout(timer)
    }
  }, [rainVerificationPrompt, rainFeedbackByWindowId])

  const sortedReadings = useMemo(() => sortReadings(readings), [readings])
  const derivedReadings = useMemo(() => deriveReadings(sortedReadings), [sortedReadings])
  const dailySeries = useMemo(() => buildDailyUsageSeries(derivedReadings), [derivedReadings])
  const normalizedDailySeries = useMemo(
    () => buildNormalizedDailyUsageSeries(derivedReadings),
    [derivedReadings],
  )
  const completedDailySeries = useMemo(() => {
    const todayStart = dayjs().startOf('day')
    return normalizedDailySeries.filter((row) => dayjs(row.date).isBefore(todayStart, 'day'))
  }, [normalizedDailySeries])

  const forecastCalibration = useMemo(() => {
    if (!forecastAudits.length) {
      return { import: 1, export: 1, solar: 1 }
    }

    const recent = forecastAudits.slice(0, 7)
    const ratio = (actual: number, predicted: number) =>
      predicted > 0 ? actual / predicted : 1

    const importMultiplier = clamp(
      average(recent.map((row) => ratio(row.actualImport, row.predictedImport))),
      0.72,
      1.3,
    )
    const exportMultiplier = clamp(
      average(recent.map((row) => ratio(row.actualExport, row.predictedExport))),
      0.72,
      1.3,
    )
    const solarMultiplier = clamp(
      average(recent.map((row) => ratio(row.actualSolar, row.predictedSolar))),
      0.72,
      1.3,
    )

    return {
      import: Number.isFinite(importMultiplier) ? importMultiplier : 1,
      export: Number.isFinite(exportMultiplier) ? exportMultiplier : 1,
      solar: Number.isFinite(solarMultiplier) ? solarMultiplier : 1,
    }
  }, [forecastAudits])

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

    const buildTrackerFromCycle = (cycle: BillingCycleSummary) => {
      const inCycle = sortReadings(
        sortedReadings.filter((reading) => {
          const date = dayjs(reading.date)
          return (
            (date.isSame(dayjs(cycle.start)) || date.isAfter(dayjs(cycle.start))) &&
            (date.isSame(dayjs(cycle.end)) || date.isBefore(dayjs(cycle.end)))
          )
        }),
      )

      const first = inCycle[0]
      const last = inCycle[inCycle.length - 1]
      const billAnchorReading = [...inCycle]
        .reverse()
        .find((reading) => (reading.note ?? '').toLowerCase().includes('kseb bill'))

      let importConsumed = 0
      let exportConsumed = 0
      let solarAdded = 0

      // Use KSEB bill snapshot if it exists in this cycle, otherwise search for reading with note
      let effectiveBillReading = billAnchorReading
      if (!effectiveBillReading && ksebBillSnapshot) {
        const billDate = ksebBillSnapshot.date
        const billInCycle = (
          (dayjs(billDate).isSame(dayjs(cycle.start)) || dayjs(billDate).isAfter(dayjs(cycle.start))) &&
          (dayjs(billDate).isSame(dayjs(cycle.end)) || dayjs(billDate).isBefore(dayjs(cycle.end)))
        )
        if (billInCycle) {
          // Create a reading object from ksebBillSnapshot to use as reference
          effectiveBillReading = {
            id: `kseb-snapshot-${billDate}`,
            date: billDate,
            time: ksebBillSnapshot.time,
            importT: ksebBillSnapshot.importTotal,
            importT1: ksebBillSnapshot.importTotal,
            importT2: 0,
            importT3: 0,
            exportT: ksebBillSnapshot.exportTotal,
            exportT1: ksebBillSnapshot.exportTotal,
            exportT2: 0,
            exportT3: 0,
            net: ksebBillSnapshot.net,
            solarGenerated: ksebBillSnapshot.solarGenerated || 0,
            note: 'KSEB Bill entry',
          } as Reading
        }
      }

      // Use KSEB bill reading as reference point if available, otherwise use first reading
      const referenceReading = effectiveBillReading || first

      if (referenceReading && last && inCycle.length > 1) {
        importConsumed = calculateImportTotal(last) - calculateImportTotal(referenceReading)
        exportConsumed = calculateExportTotal(last) - calculateExportTotal(referenceReading)
        solarAdded = last.solarGenerated - referenceReading.solarGenerated
      }

      const netConsumed = importConsumed - exportConsumed
      
      // Use KSEB bill net directly if available; otherwise calculate from cycle
      let openingBank = 0
      if (effectiveBillReading) {
        const billNet = calculateNet(effectiveBillReading)
        // If net is negative (export > import), that's a credit/bank
        openingBank = Math.max(0, -billNet)
      } else {
        // Fallback to cycle's opening bank if no KSEB bill
        openingBank = cycle.openingBank
      }
      
      let bankUsed = 0
      let bankAdded = 0
      let payableUnits = 0

      if (netConsumed >= 0) {
        bankUsed = Math.min(openingBank, netConsumed)
        payableUnits = netConsumed - bankUsed
      } else {
        bankAdded = Math.abs(netConsumed)
      }

      const closingBank = Math.max(0, openingBank - bankUsed) + bankAdded

      return {
        periodLabel: `${dayjs(cycle.start).format('DD MMM YYYY')} - ${dayjs(cycle.end).format('DD MMM YYYY')}`,
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
        remainingBank: closingBank,
        totalImport: last ? calculateImportTotal(last) : 0,
        totalExport: last ? calculateExportTotal(last) : 0,
        totalNet: last ? calculateNet(last) : 0,
        totalSolar: last ? last.solarGenerated : 0,
      }
    }

    // If a specific billing cycle is selected and found in billingCycles, use that.
    if (selectedBillingCycleKey) {
      const selectedCycle = billingCycles.find((c) => c.key === selectedBillingCycleKey)
      if (selectedCycle) {
        return buildTrackerFromCycle(selectedCycle)
      }
    }

    // Default: use the cycle that contains today's date, not just the latest reading date.
    const todayCycleBounds = getCycleBoundaries(dayjs().format('YYYY-MM-DD'), billingDay)
    const todayCycle = billingCycles.find((c) => c.key === todayCycleBounds.key)
    if (todayCycle) {
      return buildTrackerFromCycle(todayCycle)
    }

    // Fallback for sparse data: use latest reading cycle.
    const latestCycleBounds = getCycleBoundaries(latest.date, billingDay)
    const latestCycle = billingCycles.find((c) => c.key === latestCycleBounds.key)
    if (latestCycle) {
      return buildTrackerFromCycle(latestCycle)
    }

    return {
      periodLabel: `${dayjs(latestCycleBounds.start).format('DD MMM YYYY')} - ${dayjs(latestCycleBounds.end).format('DD MMM YYYY')}`,
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
      totalImport: calculateImportTotal(latest),
      totalExport: calculateExportTotal(latest),
      totalNet: calculateNet(latest),
      totalSolar: latest.solarGenerated,
    }
  }, [sortedReadings, billingDay, billingCycles, selectedBillingCycleKey, ksebBillSnapshot])

  const currentBank = billingCycles.length
    ? billingCycles[billingCycles.length - 1].closingBank
    : 0

  const latestKsebBillReading = useMemo(() => {
    if (ksebBillSnapshot) {
      return {
        id: `kseb-${ksebBillSnapshot.date}T${ksebBillSnapshot.time}`,
        date: ksebBillSnapshot.date,
        time: ksebBillSnapshot.time,
        importT: ksebBillSnapshot.importTotal,
        importT1: ksebBillSnapshot.importTotal,
        importT2: 0,
        importT3: 0,
        exportT: ksebBillSnapshot.exportTotal,
        exportT1: ksebBillSnapshot.exportTotal,
        exportT2: 0,
        exportT3: 0,
        net: ksebBillSnapshot.net,
        solarGenerated: ksebBillSnapshot.solarGenerated,
        note: 'KSEB Bill entry',
      } satisfies Reading
    }

    return findLatestKsebBillReading(sortedReadings)
  }, [ksebBillSnapshot, sortedReadings])

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
    if (!selectedCycle || !selectedCycleReadings.length || !derivedReadings.length) {
      return null
    }

    const cycleStart = dayjs(selectedCycle.start)
    const cycleEnd = dayjs(selectedCycle.end)
    const totalDays = cycleEnd.diff(cycleStart, 'day') + 1
    const lastReadingDate = dayjs(
      selectedCycleReadings[selectedCycleReadings.length - 1].date,
    )
    const elapsedDays = Math.max(1, lastReadingDate.diff(cycleStart, 'day') + 1)

    const remainingDays = Math.max(0, cycleEnd.diff(lastReadingDate, 'day'))

    const historyWindowStart = cycleStart.subtract(75, 'day')
    const relevantRows = derivedReadings.filter((row) => {
      const date = dayjs(row.date)
      return (
        (date.isSame(historyWindowStart) || date.isAfter(historyWindowStart)) &&
        (date.isSame(lastReadingDate) || date.isBefore(lastReadingDate))
      )
    })

    const dailyUsage = buildNormalizedDailyUsageSeries(relevantRows)
    if (!dailyUsage.length) {
      return null
    }

    const recent = sanitizeDailyUsageForForecast(
      dailyUsage.slice(-Math.min(21, dailyUsage.length)),
    )
    const importSeries = recent.map((row) => row.import)
    const exportSeries = recent.map((row) => row.export)
    const solarSeries = recent.map((row) => row.solar)

    const baseImport =
      (average(importSeries) * 0.6 + median(importSeries) * 0.4) * forecastCalibration.import
    const baseExport =
      (average(exportSeries) * 0.6 + median(exportSeries) * 0.4) * forecastCalibration.export
    const baseSolar =
      (average(solarSeries) * 0.6 + median(solarSeries) * 0.4) * forecastCalibration.solar

    const importSlope = calculateLinearSlope(importSeries)
    const exportSlope = calculateLinearSlope(exportSeries)
    const solarSlope = calculateLinearSlope(solarSeries)

    const weekdaySums = Array.from({ length: 7 }, () => ({
      import: 0,
      export: 0,
      solar: 0,
      count: 0,
    }))

    for (const row of recent) {
      const weekday = dayjs(row.date).day()
      weekdaySums[weekday].import += Math.max(0, row.import)
      weekdaySums[weekday].export += Math.max(0, row.export)
      weekdaySums[weekday].solar += Math.max(0, row.solar)
      weekdaySums[weekday].count += 1
    }

    const getWeekdayFactor = (dateValue: string, metric: 'import' | 'export' | 'solar') => {
      const weekday = dayjs(dateValue).day()
      const bucket = weekdaySums[weekday]
      const weekdayAverage =
        bucket.count > 0 ? bucket[metric] / bucket.count : metric === 'import' ? baseImport : metric === 'export' ? baseExport : baseSolar
      const baseline = metric === 'import' ? baseImport : metric === 'export' ? baseExport : baseSolar

      if (baseline <= 0) {
        return 1
      }

      return clamp(weekdayAverage / baseline, 0.7, 1.35)
    }

    let futureImport = 0
    let futureExport = 0
    let futureSolar = 0
    let projectedPayable = selectedCycle.payableUnits
    let projectedClosingBank = selectedCycle.closingBank
    let weatherDaysUsed = 0

    for (let offset = 1; offset <= remainingDays; offset += 1) {
      const targetDate = lastReadingDate.add(offset, 'day').format('YYYY-MM-DD')
      const multipliers = getWeatherAdjustedMultipliers(targetDate, weatherSignals[targetDate])
      if (multipliers.hasLiveWeather) {
        weatherDaysUsed += 1
      }

      const importPerDay = clamp(
        (baseImport + importSlope * offset) * getWeekdayFactor(targetDate, 'import') * multipliers.import,
        0,
        Number.MAX_SAFE_INTEGER,
      )

      const exportPerDay = clamp(
        (baseExport + exportSlope * offset) * getWeekdayFactor(targetDate, 'export') * multipliers.export,
        0,
        Number.MAX_SAFE_INTEGER,
      )

      const solarPerDay = clamp(
        (baseSolar + solarSlope * offset) * getWeekdayFactor(targetDate, 'solar') * multipliers.solar,
        0,
        Number.MAX_SAFE_INTEGER,
      )

      const netPerDay = importPerDay - exportPerDay

      if (netPerDay > 0) {
        const bankUsed = Math.min(projectedClosingBank, netPerDay)
        projectedClosingBank -= bankUsed
        projectedPayable += netPerDay - bankUsed
      } else if (netPerDay < 0) {
        projectedClosingBank += Math.abs(netPerDay)
      }

      futureImport += importPerDay
      futureExport += exportPerDay
      futureSolar += solarPerDay
    }

    const importVolatility = baseImport > 0 ? standardDeviation(importSeries) / baseImport : 1
    const sampleStrength = clamp(recent.length / 21, 0, 1)
    const coverageStrength = clamp(elapsedDays / totalDays, 0, 1)
    const volatilityPenalty = clamp(importVolatility, 0, 1.2)
    const confidenceScore = clamp(
      Math.round(42 + sampleStrength * 28 + coverageStrength * 25 - volatilityPenalty * 20),
      35,
      95,
    )

    return {
      elapsedDays,
      totalDays,
      remainingDays,
      projectedImport: selectedCycle.importTotal + futureImport,
      projectedExport: selectedCycle.exportTotal + futureExport,
      projectedNet: selectedCycle.net + (futureImport - futureExport),
      projectedPayable,
      projectedSolar: selectedCycleReadings.reduce((sum, row) => sum + row.solarDelta, 0) + futureSolar,
      projectedClosingBank,
      confidenceScore,
      weatherDaysUsed,
      modelNote:
        weatherDaysUsed > 0
          ? 'Model uses daily behavior trend + weekday pattern + live Irimbiliyam weather (cloud/rain/sunlight) and seasonal correction.'
          : 'Model uses daily behavior trend + weekday pattern with Irimbiliyam seasonal fallback (weather feed unavailable).',
    }
  }, [
    selectedCycle,
    selectedCycleReadings,
    derivedReadings,
    weatherSignals,
    forecastCalibration,
  ])

  const todayForecast = useMemo(() => {
    const recentDaily = sanitizeDailyUsageForForecast(
      completedDailySeries.slice(-Math.min(28, completedDailySeries.length)),
    )
    if (!recentDaily.length) {
      return null
    }

    const importSeries = recentDaily.map((row) => row.import)
    const exportSeries = recentDaily.map((row) => row.export)
    const solarSeries = recentDaily.map((row) => row.solar)

    const baseImport =
      (average(importSeries) * 0.6 + median(importSeries) * 0.4) * forecastCalibration.import
    const baseExport =
      (average(exportSeries) * 0.6 + median(exportSeries) * 0.4) * forecastCalibration.export
    const baseSolar =
      (average(solarSeries) * 0.6 + median(solarSeries) * 0.4) * forecastCalibration.solar

    const importSlope = calculateLinearSlope(importSeries)
    const exportSlope = calculateLinearSlope(exportSeries)
    const solarSlope = calculateLinearSlope(solarSeries)

    const weekdaySums = Array.from({ length: 7 }, () => ({
      import: 0,
      export: 0,
      solar: 0,
      count: 0,
    }))

    for (const row of recentDaily) {
      const weekday = dayjs(row.date).day()
      weekdaySums[weekday].import += Math.max(0, row.import)
      weekdaySums[weekday].export += Math.max(0, row.export)
      weekdaySums[weekday].solar += Math.max(0, row.solar)
      weekdaySums[weekday].count += 1
    }

    const todayKey = dayjs().format('YYYY-MM-DD')
    const todayWeekday = dayjs(todayKey).day()
    const todayBucket = weekdaySums[todayWeekday]

    const weekdayFactor = (metric: 'import' | 'export' | 'solar') => {
      const baseline = metric === 'import' ? baseImport : metric === 'export' ? baseExport : baseSolar
      if (baseline <= 0) {
        return 1
      }
      const dayAverage = todayBucket.count > 0 ? todayBucket[metric] / todayBucket.count : baseline
      return clamp(dayAverage / baseline, 0.7, 1.35)
    }

    const weatherSignal = weatherSignals[todayKey]
    const multipliers = getWeatherAdjustedMultipliers(todayKey, weatherSignal)
    const weekdayImportFactor = weekdayFactor('import')
    const weekdayExportFactor = weekdayFactor('export')
    const weekdaySolarFactor = weekdayFactor('solar')

    const expectedImport = clamp(
      (baseImport + importSlope) * weekdayImportFactor * multipliers.import,
      0,
      Number.MAX_SAFE_INTEGER,
    )

    const expectedExport = clamp(
      (baseExport + exportSlope) * weekdayExportFactor * multipliers.export,
      0,
      Number.MAX_SAFE_INTEGER,
    )

    const expectedSolar = clamp(
      (baseSolar + solarSlope) * weekdaySolarFactor * multipliers.solar,
      0,
      Number.MAX_SAFE_INTEGER,
    )

    const loggedSolarToday =
      solarUsageLogs.find((entry) => dayjs(entry.timestamp).format('YYYY-MM-DD') === todayKey)
        ?.value ?? 0

    const now = dayjs()
    const daylightProgress = clamp((now.hour() + now.minute() / 60 - 6) / 12, 0, 1)
    const expectedSoFar = expectedSolar * daylightProgress
    const remainingShare = clamp(1 - daylightProgress, 0, 1)

    let adjustedExpectedSolar = expectedSolar
    if (loggedSolarToday > expectedSoFar) {
      adjustedExpectedSolar = loggedSolarToday + expectedSolar * remainingShare * 0.9
    }
    adjustedExpectedSolar = Math.max(adjustedExpectedSolar, loggedSolarToday)

    const solarAdjustmentRatio = clamp(adjustedExpectedSolar / Math.max(expectedSolar, 0.1), 0.72, 1.38)
    const adjustedExpectedImport = expectedImport / solarAdjustmentRatio
    const adjustedExpectedExport = expectedExport * solarAdjustmentRatio
    const expectedNet = adjustedExpectedImport - adjustedExpectedExport
    const volatility = baseImport > 0 ? standardDeviation(importSeries) / baseImport : 1
    const confidenceScore = clamp(
      Math.round(45 + clamp(recentDaily.length / 28, 0, 1) * 30 - clamp(volatility, 0, 1.2) * 16),
      38,
      94,
    )

    return {
      date: todayKey,
      expectedImport: adjustedExpectedImport,
      expectedExport: adjustedExpectedExport,
      expectedSolar: adjustedExpectedSolar,
      expectedNet,
      confidenceScore,
      weatherSignal,
      weatherDriven: multipliers.hasLiveWeather,
      loggedSolarToday,
      breakdown: {
        baseImport,
        baseExport,
        baseSolar,
        importSlope,
        exportSlope,
        solarSlope,
        weekdayImportFactor,
        weekdayExportFactor,
        weekdaySolarFactor,
        weatherImportFactor: multipliers.import,
        weatherExportFactor: multipliers.export,
        weatherSolarFactor: multipliers.solar,
        calibrationImportFactor: forecastCalibration.import,
        calibrationExportFactor: forecastCalibration.export,
        calibrationSolarFactor: forecastCalibration.solar,
      },
    }
  }, [completedDailySeries, weatherSignals, forecastCalibration, solarUsageLogs])

  const displayedTodayForecast = useMemo(() => {
    if (!todayForecast) {
      return null
    }

    const snapshot = dailyForecastSnapshots[todayForecast.date]
    if (!snapshot) {
      return todayForecast
    }

    return {
      ...todayForecast,
      expectedImport: snapshot.predictedImport,
      expectedExport: snapshot.predictedExport,
      expectedSolar: snapshot.predictedSolar,
      expectedNet: snapshot.predictedNet,
    }
  }, [dailyForecastSnapshots, todayForecast])

  const upcomingForecast = useMemo(() => {
    const recentDaily = sanitizeDailyUsageForForecast(
      completedDailySeries.slice(-Math.min(28, completedDailySeries.length)),
    )
    if (!recentDaily.length) return []

    const importSeries = recentDaily.map((row) => row.import)
    const exportSeries = recentDaily.map((row) => row.export)
    const solarSeries = recentDaily.map((row) => row.solar)

    const baseImport =
      (average(importSeries) * 0.6 + median(importSeries) * 0.4) * forecastCalibration.import
    const baseExport =
      (average(exportSeries) * 0.6 + median(exportSeries) * 0.4) * forecastCalibration.export
    const baseSolar =
      (average(solarSeries) * 0.6 + median(solarSeries) * 0.4) * forecastCalibration.solar

    const importSlope = calculateLinearSlope(importSeries)
    const exportSlope = calculateLinearSlope(exportSeries)
    const solarSlope = calculateLinearSlope(solarSeries)

    const weekdaySums = Array.from({ length: 7 }, () => ({
      import: 0, export: 0, solar: 0, count: 0,
    }))
    for (const row of recentDaily) {
      const wd = dayjs(row.date).day()
      weekdaySums[wd].import += Math.max(0, row.import)
      weekdaySums[wd].export += Math.max(0, row.export)
      weekdaySums[wd].solar += Math.max(0, row.solar)
      weekdaySums[wd].count += 1
    }

    const weekdayFactor = (metric: 'import' | 'export' | 'solar', wd: number) => {
      const baseline = metric === 'import' ? baseImport : metric === 'export' ? baseExport : baseSolar
      if (baseline <= 0) return 1
      const bucket = weekdaySums[wd]
      const dayAverage = bucket.count > 0 ? bucket[metric] / bucket.count : baseline
      return clamp(dayAverage / baseline, 0.7, 1.35)
    }

    const volatility = baseImport > 0 ? standardDeviation(importSeries) / baseImport : 1
    const confidenceScore = clamp(
      Math.round(45 + clamp(recentDaily.length / 28, 0, 1) * 30 - clamp(volatility, 0, 1.2) * 16),
      38,
      94,
    )

    return [1, 2].map((daysAhead) => {
      const targetDate = dayjs().add(daysAhead, 'day')
      const dateKey = targetDate.format('YYYY-MM-DD')
      const wd = targetDate.day()
      const weatherSignal = weatherSignals[dateKey]
      const multipliers = getWeatherAdjustedMultipliers(dateKey, weatherSignal)

      const expectedImport = clamp(
        (baseImport + importSlope * daysAhead) * weekdayFactor('import', wd) * multipliers.import,
        0, Number.MAX_SAFE_INTEGER,
      )
      const expectedExport = clamp(
        (baseExport + exportSlope * daysAhead) * weekdayFactor('export', wd) * multipliers.export,
        0, Number.MAX_SAFE_INTEGER,
      )
      const expectedSolar = clamp(
        (baseSolar + solarSlope * daysAhead) * weekdayFactor('solar', wd) * multipliers.solar,
        0, Number.MAX_SAFE_INTEGER,
      )
      const expectedNet = expectedImport - expectedExport

      return {
        date: dateKey,
        label: daysAhead === 1 ? 'Tomorrow' : 'Day After',
        expectedImport,
        expectedExport,
        expectedSolar,
        expectedNet,
        confidenceScore: Math.max(confidenceScore - daysAhead * 4, 30),
        weatherDriven: multipliers.hasLiveWeather,
        weatherSignal,
      }
    })
  }, [completedDailySeries, weatherSignals, forecastCalibration])

  const manualSolarToday = useMemo(() => {
    const todayKey = dayjs().format('YYYY-MM-DD')
    return (
      solarUsageLogs.find((entry) => dayjs(entry.timestamp).format('YYYY-MM-DD') === todayKey)
        ?.value ?? 0
    )
  }, [solarUsageLogs])

  const latestSolarLog = useMemo(() => solarUsageLogs[0], [solarUsageLogs])
  const todayDateKey = dayjs().format('YYYY-MM-DD')
  const todaySolarLogs = useMemo(
    () =>
      solarUsageLogs
        .filter((entry) => dayjs(entry.timestamp).format('YYYY-MM-DD') === todayDateKey)
        .slice(0, 8),
    [solarUsageLogs, todayDateKey],
  )

  const todaySolarSummary = useMemo(
    () => solarDailySummaries.find((entry) => entry.date === todayDateKey),
    [solarDailySummaries, todayDateKey],
  )

  const solarDailyProductionRows = useMemo(() => {
    const rows = new Map<string, SolarDailyProductionRow>()

    for (const entry of dailySeries) {
      rows.set(entry.date, {
        date: entry.date,
        total: Math.max(0, entry.solar),
        source: 'meter-derived',
      })
    }

    for (const log of solarUsageLogs) {
      const date = dayjs(log.timestamp).format('YYYY-MM-DD')
      const existing = rows.get(date)
      const nextTotal = Math.max(0, log.value)

      if (!existing || existing.source === 'meter-derived') {
        rows.set(date, {
          date,
          total: nextTotal,
          source: 'manual-reading',
          note: log.note,
        })
      }
    }

    for (const summary of solarDailySummaries) {
      rows.set(summary.date, {
        date: summary.date,
        total: summary.total,
        source: 'manual-eod',
        note: summary.note,
      })
    }

    return [...rows.values()].sort((a, b) => a.date.localeCompare(b.date))
  }, [dailySeries, solarDailySummaries, solarUsageLogs])

  const solarExportDailyRows = useMemo(
    () =>
      dailySeries.map((entry) => ({
        date: entry.date,
        total: Math.max(0, entry.export),
      })),
    [dailySeries],
  )

  const solarHistoryYearOptions = useMemo(() => {
    const years = new Set<string>()
    for (const row of solarDailyProductionRows) {
      years.add(dayjs(row.date).format('YYYY'))
    }
    for (const row of solarExportDailyRows) {
      years.add(dayjs(row.date).format('YYYY'))
    }
    return [...years].sort((a, b) => Number(b) - Number(a))
  }, [solarDailyProductionRows, solarExportDailyRows])

  const filteredSolarProductionRows = useMemo(
    () =>
      solarDailyProductionRows.filter((row) => {
        const date = dayjs(row.date)
        return (
          (!solarHistoryMonthFilter || date.format('MM') === solarHistoryMonthFilter) &&
          (!solarHistoryYearFilter || date.format('YYYY') === solarHistoryYearFilter)
        )
      }),
    [solarDailyProductionRows, solarHistoryMonthFilter, solarHistoryYearFilter],
  )

  const filteredSolarExportRows = useMemo(
    () =>
      solarExportDailyRows.filter((row) => {
        const date = dayjs(row.date)
        return (
          (!solarHistoryMonthFilter || date.format('MM') === solarHistoryMonthFilter) &&
          (!solarHistoryYearFilter || date.format('YYYY') === solarHistoryYearFilter)
        )
      }),
    [solarExportDailyRows, solarHistoryMonthFilter, solarHistoryYearFilter],
  )

  const solarHistoryMonthLabel = solarHistoryMonthFilter
    ? dayjs(`2000-${solarHistoryMonthFilter}-01`).format('MMMM')
    : 'All Months'

  const solarHistoryYearLabel = solarHistoryYearFilter || 'All Years'

  const filteredSolarProductionHistoryRows = useMemo(
    () => [...filteredSolarProductionRows].reverse(),
    [filteredSolarProductionRows],
  )

  const filteredSolarExportHistoryRows = useMemo(
    () => [...filteredSolarExportRows].reverse(),
    [filteredSolarExportRows],
  )

  const solarHistoryFilterLabel = `${solarHistoryMonthLabel} / ${solarHistoryYearLabel}`

  const solarHistoryMonthOptions = [
    { value: '01', label: 'January' },
    { value: '02', label: 'February' },
    { value: '03', label: 'March' },
    { value: '04', label: 'April' },
    { value: '05', label: 'May' },
    { value: '06', label: 'June' },
    { value: '07', label: 'July' },
    { value: '08', label: 'August' },
    { value: '09', label: 'September' },
    { value: '10', label: 'October' },
    { value: '11', label: 'November' },
    { value: '12', label: 'December' },
  ]

  const recentSolarProductionRows = useMemo(
    () => filteredSolarProductionRows,
    [filteredSolarProductionRows],
  )

  const solarProductionHistoryRows = useMemo(
    () => filteredSolarProductionHistoryRows,
    [filteredSolarProductionHistoryRows],
  )

  const meterDerivedSolarToday = useMemo(() => {
    const row = normalizedDailySeries.find((entry) => entry.date === todayDateKey)
    return row ? Math.max(0, row.solar) : 0
  }, [normalizedDailySeries, todayDateKey])

  const effectiveEodSolar = useMemo(() => {
    if (todaySolarSummary) {
      return {
        total: todaySolarSummary.total,
        source: 'manual-eod' as const,
      }
    }
    if (meterDerivedSolarToday > 0) {
      return {
        total: meterDerivedSolarToday,
        source: 'meter-derived' as const,
      }
    }
    return {
      total: manualSolarToday,
      source: 'manual-intraday' as const,
    }
  }, [todaySolarSummary, meterDerivedSolarToday, manualSolarToday])

  useEffect(() => {
    if (!todaySolarSummary) {
      if (eodSolarTotalInput.trim() === '' && meterDerivedSolarToday > 0) {
        setEodSolarTotalInput(meterDerivedSolarToday.toFixed(3))
      }
      return
    }
    setEodSolarTotalInput(todaySolarSummary.total.toString())
    setEodSolarNoteInput(todaySolarSummary.note ?? '')
  }, [todaySolarSummary, meterDerivedSolarToday, eodSolarTotalInput])

  const openSolarLogModal = () => {
    setSolarLogDate(dayjs().format('YYYY-MM-DD'))
    setSolarLogTime(defaultReadingTime())
    setSolarLogValue('')
    setSolarLogNote('')
    setIsSolarLogModalOpen(true)
  }

  const saveSolarUsageLog = () => {
    const value = Number(solarLogValue)
    if (!Number.isFinite(value) || value <= 0) {
      setAppToast('Enter a valid solar value in kWh.')
      return
    }

    const logMoment = dayjs(`${solarLogDate}T${solarLogTime || '00:00'}`)
    if (!logMoment.isValid()) {
      setAppToast('Enter a valid date and time for solar log.')
      return
    }

    const entry: SolarUsageEntry = {
      id: createReadingId(),
      timestamp: logMoment.toISOString(),
      value,
      note: solarLogNote.trim() || undefined,
    }

    const nextSolarLogs = [entry, ...solarUsageLogs].slice(0, 300)
    setSolarUsageLogs(nextSolarLogs)
    setSolarLogDate(dayjs().format('YYYY-MM-DD'))
    setSolarLogTime(defaultReadingTime())
    setSolarLogValue('')
    setSolarLogNote('')
    setIsSolarLogModalOpen(false)
    markLocalChange()
    setAppToast('Solar usage logged.')
    logActivity('add-solar-log', `${value.toFixed(2)} kWh at ${logMoment.format('DD MMM YYYY HH:mm')}`)

    if (supabase && cloudUser) {
      void pushToCloud(sortedReadings, true, nextSolarLogs, solarDailySummaries)
    }
  }

  const openBulkSolarModal = () => {
    setBulkSolarRows([createBulkSolarSummaryRow()])
    setBulkSolarErrors([])
    setIsBulkSolarModalOpen(true)
  }

  const updateBulkSolarRow = (
    rowId: string,
    field: keyof Omit<BulkSolarSummaryFormRow, 'id'>,
    value: string,
  ) => {
    setBulkSolarRows((prev) =>
      prev.map((row) => (row.id === rowId ? { ...row, [field]: value } : row)),
    )
  }

  const appendBulkSolarRow = () => {
    setBulkSolarRows((prev) => {
      const lastRow = prev[prev.length - 1]
      return [...prev, createBulkSolarSummaryRow(lastRow)]
    })
  }

  const removeBulkSolarRow = (rowId: string) => {
    setBulkSolarRows((prev) => (prev.length <= 1 ? prev : prev.filter((row) => row.id !== rowId)))
  }

  const resetBulkSolarRows = () => {
    setBulkSolarRows([createBulkSolarSummaryRow()])
    setBulkSolarErrors([])
  }

  const saveBulkSolarEntries = () => {
    const errors: string[] = []
    const seenDates = new Set<string>()

    bulkSolarRows.forEach((row, index) => {
      const rowLabel = `Row ${index + 1}`

      if (!row.date.trim()) {
        errors.push(`${rowLabel}: date is required.`)
      }

      if (!row.time.trim()) {
        errors.push(`${rowLabel}: time is required.`)
      }

      const rowMoment = dayjs(`${row.date}T${row.time || '00:00'}`)
      if (!rowMoment.isValid()) {
        errors.push(`${rowLabel}: please enter a valid date and time.`)
      }

      if (row.total.trim() === '') {
        errors.push(`${rowLabel}: solar total is required.`)
      }

      const total = Number(row.total)
      if (row.total.trim() !== '' && (!Number.isFinite(total) || total < 0)) {
        errors.push(`${rowLabel}: solar total must be zero or higher.`)
      }

      if (row.date.trim()) {
        if (seenDates.has(row.date)) {
          errors.push(`${rowLabel}: each row must use a unique date.`)
        } else {
          seenDates.add(row.date)
        }
      }
    })

    if (errors.length > 0) {
      setBulkSolarErrors(errors)
      setAppToast('Please fix the bulk solar rows before saving.')
      return
    }

    const updatedByDate = new Map(solarDailySummaries.map((entry) => [entry.date, entry]))

    for (const row of bulkSolarRows) {
      const rowMoment = dayjs(`${row.date}T${row.time}`)
      updatedByDate.set(row.date, {
        date: row.date,
        total: Number(row.total),
        note: row.note.trim() || undefined,
        updatedAt: rowMoment.isValid() ? rowMoment.toISOString() : new Date().toISOString(),
      })
    }

    const nextSummaries = [...updatedByDate.values()]
      .sort((a, b) => a.date.localeCompare(b.date))
      .slice(0, 120)

    setSolarDailySummaries(nextSummaries)
    setBulkSolarErrors([])
    setIsBulkSolarModalOpen(false)
    markLocalChange()
    setAppToast(`Saved ${bulkSolarRows.length} solar day${bulkSolarRows.length === 1 ? '' : 's'}.`)
    logActivity('bulk-solar-entry', `Saved ${bulkSolarRows.length} solar rows`)

    if (supabase && cloudUser) {
      void pushToCloud(sortedReadings, true, solarUsageLogs, nextSummaries)
    }
  }

  const openBulkMeterModal = () => {
    setBulkMeterRows([createBulkMeterRow()])
    setBulkMeterErrors([])
    setIsBulkMeterModalOpen(true)
  }

  const updateBulkMeterRow = (
    rowId: string,
    field: keyof Omit<BulkMeterFormRow, 'id'>,
    value: string,
  ) => {
    setBulkMeterRows((prev) =>
      prev.map((row) => (row.id === rowId ? { ...row, [field]: value } : row)),
    )
  }

  const appendBulkMeterRow = () => {
    setBulkMeterRows((prev) => {
      const lastRow = prev[prev.length - 1]
      return [...prev, createBulkMeterRow(lastRow)]
    })
  }

  const removeBulkMeterRow = (rowId: string) => {
    setBulkMeterRows((prev) => (prev.length <= 1 ? prev : prev.filter((row) => row.id !== rowId)))
  }

  const resetBulkMeterRows = () => {
    setBulkMeterRows([createBulkMeterRow()])
    setBulkMeterErrors([])
  }

  const saveBulkMeterEntries = () => {
    const errors: string[] = []
    const seenDateTimes = new Set<string>()

    bulkMeterRows.forEach((row, index) => {
      const rowLabel = `Row ${index + 1}`
      const key = `${row.date}T${row.time}`

      if (!row.date.trim()) {
        errors.push(`${rowLabel}: date is required.`)
      }

      if (!row.time.trim()) {
        errors.push(`${rowLabel}: time is required.`)
      }

      const rowMoment = dayjs(`${row.date}T${row.time || '00:00'}`)
      if (!rowMoment.isValid()) {
        errors.push(`${rowLabel}: enter a valid date and time.`)
      }

      if (!row.importTotal.trim()) {
        errors.push(`${rowLabel}: import total is required.`)
      }

      if (!row.exportTotal.trim()) {
        errors.push(`${rowLabel}: export total is required.`)
      }

      const importTotal = Number(row.importTotal)
      const exportTotal = Number(row.exportTotal)
      const solarGenerated = Number(row.solarGenerated || '0')

      if (row.importTotal.trim() && (!Number.isFinite(importTotal) || importTotal < 0)) {
        errors.push(`${rowLabel}: import total must be zero or higher.`)
      }

      if (row.exportTotal.trim() && (!Number.isFinite(exportTotal) || exportTotal < 0)) {
        errors.push(`${rowLabel}: export total must be zero or higher.`)
      }

      if (row.solarGenerated.trim() && (!Number.isFinite(solarGenerated) || solarGenerated < 0)) {
        errors.push(`${rowLabel}: solar generated must be zero or higher.`)
      }

      if (row.date.trim() && row.time.trim()) {
        if (seenDateTimes.has(key)) {
          errors.push(`${rowLabel}: each row must have a unique date and time.`)
        } else {
          seenDateTimes.add(key)
        }
      }
    })

    if (errors.length > 0) {
      setBulkMeterErrors(errors)
      setAppToast('Please fix the bulk meter rows before saving.')
      return
    }

    const byDateTime = new Map(readings.map((reading) => [`${reading.date}T${reading.time}`, reading]))

    for (const row of bulkMeterRows) {
      const key = `${row.date}T${row.time}`
      const importTotal = Number(row.importTotal)
      const exportTotal = Number(row.exportTotal)
      const solarGenerated = row.solarGenerated.trim() ? Number(row.solarGenerated) : 0
      const existing = byDateTime.get(key)

      byDateTime.set(key, {
        id: existing?.id ?? createReadingId(),
        date: row.date,
        time: row.time,
        importT: importTotal,
        importT1: importTotal,
        importT2: 0,
        importT3: 0,
        exportT: exportTotal,
        exportT1: exportTotal,
        exportT2: 0,
        exportT3: 0,
        net: importTotal - exportTotal,
        solarGenerated,
        note: row.note.trim() || existing?.note || 'Bulk meter entry',
      })
    }

    const nextReadings = sortReadings([...byDateTime.values()])
    setReadings(nextReadings)
    setBulkMeterErrors([])
    setIsBulkMeterModalOpen(false)
    markLocalChange()
    setAppToast(`Saved ${bulkMeterRows.length} meter row${bulkMeterRows.length === 1 ? '' : 's'}.`)
    logActivity('bulk-meter-entry', `Saved ${bulkMeterRows.length} meter rows`)

    if (supabase && cloudUser) {
      void pushToCloud(nextReadings, true)
    }
  }

  useEffect(() => {
    if (!isBulkMeterModalOpen || bulkMeterRows.length === 0) {
      return
    }

    const latestRow = bulkMeterRows[bulkMeterRows.length - 1]
    const scrollTimer = window.setTimeout(() => {
      const rowElement = document.getElementById(`bulk-meter-row-${latestRow.id}`)
      rowElement?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }, 40)

    return () => {
      window.clearTimeout(scrollTimer)
    }
  }, [bulkMeterRows.length, isBulkMeterModalOpen])

  const saveEndOfDaySolarTotal = () => {
    const total = Number(eodSolarTotalInput)
    if (!Number.isFinite(total) || total < 0) {
      setAppToast('Enter a valid end-of-day solar total in kWh.')
      return
    }

    const entry: SolarDailySummary = {
      date: todayDateKey,
      total,
      note: eodSolarNoteInput.trim() || undefined,
      updatedAt: new Date().toISOString(),
    }

    const nextSummaries = (() => {
      const filtered = solarDailySummaries.filter((item) => item.date !== todayDateKey)
      return [entry, ...filtered].slice(0, 120)
    })()

    setSolarDailySummaries(nextSummaries)

    markLocalChange()
    setAppToast('End-of-day solar total saved.')
    logActivity('save-solar-eod', `${todayDateKey} - ${total.toFixed(2)} kWh`)

    if (supabase && cloudUser) {
      void pushToCloud(sortedReadings, true, solarUsageLogs, nextSummaries)
    }
  }

  const markRainWindowFeedback = (
    window: Pick<RainWindow, 'id' | 'start' | 'end'>,
    feedback: 'correct' | 'incorrect',
  ) => {
    const entry: RainPredictionFeedback = {
      windowId: window.id,
      start: window.start,
      end: window.end,
      feedback,
      notedAt: new Date().toISOString(),
    }

    setRainPredictionFeedbacks((prev) => {
      const next = [entry, ...prev.filter((item) => item.windowId !== window.id)]
      return next.slice(0, 120)
    })

    setRainVerificationPrompt((prev) => (prev?.windowId === window.id ? null : prev))

    setAppToast(
      feedback === 'correct'
        ? 'Rain prediction marked correct. Model will follow this pattern.'
        : 'Rain prediction marked incorrect. Model will tighten similar future alerts.',
    )
  }

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

  const completeFirstLaunchAuth = () => {
    localStorage.setItem(FIRST_LAUNCH_AUTH_KEY, 'done')
    setRequiresFirstLaunchAuth(false)
    setFirstLaunchPassword('')
    setFirstLaunchAuthError('')
    setActiveTab('home')
  }

  const handleFirstLaunchSignIn = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()

    const email = firstLaunchEmail.trim()
    const password = firstLaunchPassword.trim()

    if (!email || !password) {
      setFirstLaunchAuthError('Enter your email and password.')
      return
    }

    if (!supabase) {
      setFirstLaunchAuthError(
        'Secure login is not configured. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in .env.',
      )
      return
    }

    setFirstLaunchAuthBusy(true)
    setFirstLaunchAuthError('')

    try {
      const { data, error } = await supabase.auth.signInWithPassword({ email, password })

      if (error || !data.user) {
        setFirstLaunchAuthError(error?.message ?? 'Invalid email or password.')
        return
      }

      setCloudUser(data.user)
      setCloudEmail(email)
      completeFirstLaunchAuth()
    } finally {
      setFirstLaunchAuthBusy(false)
    }
  }

  const recomputeTodayForecast = () => {
    if (!todayForecast) {
      setAppToast('Today forecast is not ready yet.')
      return
    }

    setDailyForecastSnapshots((prev) => {
      const nextSnapshots = { ...prev }
      delete nextSnapshots[todayForecast.date]
      return nextSnapshots
    })

    setAppToast('Today forecast recalculated using current weather and model data.')
    logActivity('recompute-forecast', `Manual refresh for ${todayForecast.date}`)
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

  const saveKsebBillDetails = () => {
    const importTotal = Number(ksebBillImportInput)
    const exportTotal = Number(ksebBillExportInput)
    const explicitNet = ksebBillNetInput.trim() === '' ? undefined : Number(ksebBillNetInput)
    const explicitSolar =
      ksebBillSolarInput.trim() === '' ? undefined : Number(ksebBillSolarInput)

    if (!ksebBillEntryDate.trim() || !ksebBillEntryTime.trim()) {
      setAppToast('Enter bill date and time.')
      return
    }

    const timestamp = dayjs(`${ksebBillEntryDate}T${ksebBillEntryTime}`)
    if (!timestamp.isValid()) {
      setAppToast('Enter a valid bill date and time.')
      return
    }

    if (!Number.isFinite(importTotal) || importTotal < 0) {
      setAppToast('Enter a valid import total from the bill.')
      return
    }

    if (!Number.isFinite(exportTotal) || exportTotal < 0) {
      setAppToast('Enter a valid export total from the bill.')
      return
    }

    if (explicitNet !== undefined && !Number.isFinite(explicitNet)) {
      setAppToast('Net should be a valid number if entered.')
      return
    }

    if (explicitSolar !== undefined && (!Number.isFinite(explicitSolar) || explicitSolar < 0)) {
      setAppToast('Generated solar should be zero or higher if entered.')
      return
    }

    const previousSolar = (() => {
      const previous = [...sortedReadings]
        .filter((reading) => getReadingTimestamp(reading) <= timestamp.valueOf())
        .sort((a, b) => getReadingTimestamp(b) - getReadingTimestamp(a))[0]
      return previous?.solarGenerated ?? 0
    })()

    const note = 'KSEB Bill entry'

    const existingAtSameMoment = readings.find(
      (reading) => reading.date === ksebBillEntryDate && reading.time === ksebBillEntryTime,
    )

    const ksebReading: Reading = {
      id: existingAtSameMoment?.id ?? createReadingId(),
      date: ksebBillEntryDate,
      time: ksebBillEntryTime,
      importT: importTotal,
      importT1: importTotal,
      importT2: 0,
      importT3: 0,
      exportT: exportTotal,
      exportT1: exportTotal,
      exportT2: 0,
      exportT3: 0,
      net: explicitNet ?? importTotal - exportTotal,
      solarGenerated: explicitSolar ?? previousSolar,
      note,
    }

    const nextKsebSnapshot: KsebBillSnapshot = {
      date: ksebBillEntryDate,
      time: ksebBillEntryTime,
      importTotal,
      exportTotal,
      net: explicitNet ?? importTotal - exportTotal,
      solarGenerated: explicitSolar ?? previousSolar,
      updatedAt: timestamp.toISOString(),
    }

    saveRecoverySnapshot(readings)

    const nextReadings = sortReadings(
      existingAtSameMoment
        ? readings.map((reading) =>
            reading.id === existingAtSameMoment.id ? ksebReading : reading,
          )
        : [...readings, ksebReading],
    )

    setReadings(nextReadings)
    setKsebBillSnapshot(nextKsebSnapshot)
    setBillingReferenceDate(ksebBillEntryDate)
    setBillGeneratedAt(`${ksebBillEntryDate}T${ksebBillEntryTime}`)
    setKsebBillSolarInput('')
    applyBillingDateToCycle(ksebBillEntryDate)
    markLocalChange()
    setAppToast('KSEB bill details saved and billing cycle applied.')
    logActivity('save-kseb-bill', `${ksebBillEntryDate} ${ksebBillEntryTime}`)

    if (supabase && cloudUser) {
      void pushToCloud(nextReadings, true, solarUsageLogs, solarDailySummaries, nextKsebSnapshot)
    }
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
    setAppToast('Bill parsed. Verify values and tap Save Meter Reading.')
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

      const foundMeterValues =
        parsed.importT !== undefined ||
        parsed.exportT !== undefined ||
        parsed.net !== undefined ||
        parsed.importT1 !== undefined ||
        parsed.importT2 !== undefined ||
        parsed.importT3 !== undefined ||
        parsed.exportT1 !== undefined ||
        parsed.exportT2 !== undefined ||
        parsed.exportT3 !== undefined

      if (!foundMeterValues) {
        const dateHint = parsed.billDate
          ? ` Date detected as ${dayjs(parsed.billDate).format('DD MMM YYYY')}, but meter values were not found.`
          : ''
        setBillImportMessage(
          `Could not detect import/export meter values from this bill.${dateHint} Please add values manually or upload a clearer file.`,
        )
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

  const pushToCloud = async (
    readingsToSync = sortedReadings,
    silent = false,
    solarLogsToSync = solarUsageLogs,
    solarSummariesToSync = solarDailySummaries,
    ksebBillToSync = ksebBillSnapshot,
  ) => {
    if (!supabase || !cloudUser) {
      if (!silent) {
        setCloudMessage('Sign in to cloud first.')
      }
      return
    }

    setSyncStatus('syncing')
    setCloudBusy(true)
    if (!silent) {
      setCloudMessage('Syncing local readings and solar tracker to cloud...')
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

    const solarLogPayload = solarLogsToSync.map((entry) => ({
      id: entry.id,
      user_id: cloudUser.id,
      logged_at: entry.timestamp,
      value_kwh: entry.value,
      note: entry.note ?? null,
      updated_at: new Date().toISOString(),
    }))

    const solarSummaryPayload = solarSummariesToSync.map((entry) => ({
      user_id: cloudUser.id,
      summary_date: entry.date,
      total_kwh: entry.total,
      note: entry.note ?? null,
      updated_at: entry.updatedAt,
    }))

    const ksebBillPayload = ksebBillToSync
      ? [{
          id: `kseb-${ksebBillToSync.date}T${ksebBillToSync.time}`,
          user_id: cloudUser.id,
          bill_date: ksebBillToSync.date,
          bill_time: ksebBillToSync.time,
          import_total: ksebBillToSync.importTotal,
          export_total: ksebBillToSync.exportTotal,
          net: ksebBillToSync.net,
          solar_generated: ksebBillToSync.solarGenerated,
          updated_at: new Date().toISOString(),
        }]
      : []

    const [meterResult, solarLogResult, solarSummaryResult, ksebResult] = await Promise.all([
      supabase.from('meter_readings').upsert(payload, { onConflict: 'id' }),
      solarLogPayload.length
        ? supabase.from('solar_usage_logs').upsert(solarLogPayload, { onConflict: 'id' })
        : Promise.resolve({ error: null }),
      solarSummaryPayload.length
        ? supabase
            .from('solar_daily_summaries')
            .upsert(solarSummaryPayload, { onConflict: 'user_id,summary_date' })
        : Promise.resolve({ error: null }),
      ksebBillPayload.length
        ? supabase.from('kseb_bill_snapshots').upsert(ksebBillPayload, { onConflict: 'user_id,bill_date' })
        : Promise.resolve({ error: null }),
    ])

    const error = meterResult.error ?? solarLogResult.error ?? solarSummaryResult.error ?? ksebResult.error

    if (error) {
      setCloudMessage(`Cloud push failed: ${error.message}`)
      setSyncStatus('error')
    } else if (!silent) {
      setCloudMessage('Cloud sync complete: readings, solar tracker, and KSEB bill uploaded.')
      setSyncStatus('success')
      setLastSyncAt(new Date().toISOString())
      setPendingSyncChanges(0)
    } else {
      setCloudMessage('Data saved locally and synced to cloud automatically.')
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

    const [meterResult, solarLogResult, solarSummaryResult, ksebResult] = await Promise.all([
      supabase
        .from('meter_readings')
        .select(
          'id, reading_date, reading_time, import_t, import_t1, import_t2, import_t3, export_t, export_t1, export_t2, export_t3, net, solar_generated, note',
        )
        .eq('user_id', cloudUser.id)
        .order('reading_date', { ascending: true })
        .order('reading_time', { ascending: true }),
      supabase
        .from('solar_usage_logs')
        .select('id, user_id, logged_at, value_kwh, note, updated_at')
        .eq('user_id', cloudUser.id)
        .order('logged_at', { ascending: false }),
      supabase
        .from('solar_daily_summaries')
        .select('user_id, summary_date, total_kwh, note, updated_at')
        .eq('user_id', cloudUser.id)
        .order('summary_date', { ascending: false }),
      supabase
        .from('kseb_bill_snapshots')
        .select('id, user_id, bill_date, bill_time, import_total, export_total, net, solar_generated, updated_at')
        .eq('user_id', cloudUser.id)
        .order('bill_date', { ascending: false })
        .limit(1),
    ])

    const error = meterResult.error ?? solarLogResult.error ?? solarSummaryResult.error ?? ksebResult.error

    if (error) {
      setCloudMessage(`Cloud pull failed: ${error.message}`)
      setSyncStatus('error')
      setCloudBusy(false)
      return
    }

    const cloudReadings: Reading[] = ((meterResult.data ?? []) as CloudReadingRow[]).map((row) => ({
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

    const cloudSolarLogs: SolarUsageEntry[] = ((solarLogResult.data ?? []) as CloudSolarUsageRow[]).map(
      (row) => ({
        id: row.id,
        timestamp: row.logged_at,
        value: Number(row.value_kwh),
        note: row.note ?? undefined,
      }),
    )

    const cloudSolarSummaries: SolarDailySummary[] = (
      (solarSummaryResult.data ?? []) as CloudSolarDailySummaryRow[]
    ).map((row) => ({
      date: row.summary_date,
      total: Number(row.total_kwh),
      note: row.note ?? undefined,
      updatedAt: row.updated_at,
    }))

    const cloudKsebBill = ((ksebResult.data ?? [])[0]) as CloudKsebBillRow | undefined
    if (cloudKsebBill) {
      setKsebBillSnapshot({
        date: cloudKsebBill.bill_date,
        time: cloudKsebBill.bill_time,
        importTotal: Number(cloudKsebBill.import_total),
        exportTotal: Number(cloudKsebBill.export_total),
        net: Number(cloudKsebBill.net),
        solarGenerated: Number(cloudKsebBill.solar_generated ?? 0),
        updatedAt: cloudKsebBill.updated_at,
      })
    }

    const sanitizedCloudReadings = sortReadings(
      stripLegacySeedReadings(applyKnownCorrections(cloudReadings)),
    )

    if (cloudReadings.length > 0 || cloudSolarLogs.length > 0 || cloudSolarSummaries.length > 0 || cloudKsebBill) {
      setReadings(sanitizedCloudReadings)
      setSolarUsageLogs(cloudSolarLogs)
      setSolarDailySummaries(cloudSolarSummaries)
      setCloudMessage(
        silent
          ? `Auto-synced cloud data: ${sanitizedCloudReadings.length} readings, ${cloudSolarLogs.length} solar logs, KSEB bill.`
          : `Cloud download complete: ${sanitizedCloudReadings.length} readings, ${cloudSolarLogs.length} solar logs, ${cloudSolarSummaries.length} EOD summaries, KSEB bill.`,
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

  useEffect(() => {
    if (!isHydrated || !todayForecast) {
      return
    }

    if (dailyForecastSnapshots[todayForecast.date]) {
      return
    }

    setDailyForecastSnapshots((prev) => ({
      ...prev,
      [todayForecast.date]: {
        date: todayForecast.date,
        predictedImport: todayForecast.expectedImport,
        predictedExport: todayForecast.expectedExport,
        predictedSolar: todayForecast.expectedSolar,
        predictedNet: todayForecast.expectedNet,
        createdAt: new Date().toISOString(),
      },
    }))
  }, [todayForecast, dailyForecastSnapshots, isHydrated])

  useEffect(() => {
    if (!isHydrated) {
      return
    }

    const yesterday = dayjs().subtract(1, 'day').format('YYYY-MM-DD')
    const actualYesterday = normalizedDailySeries.find((row) => row.date === yesterday)
    const snapshotYesterday = dailyForecastSnapshots[yesterday]

    if (!actualYesterday || !snapshotYesterday) {
      return
    }

    const alreadyAudited = forecastAudits.some((entry) => entry.date === yesterday)
    if (alreadyAudited) {
      return
    }

    const errorPct = (predicted: number, actual: number) =>
      predicted > 0 ? ((actual - predicted) / predicted) * 100 : 0

    const importErrorPct = errorPct(snapshotYesterday.predictedImport, actualYesterday.import)
    const exportErrorPct = errorPct(snapshotYesterday.predictedExport, actualYesterday.export)
    const solarErrorPct = errorPct(snapshotYesterday.predictedSolar, actualYesterday.solar)
    const netErrorPct = errorPct(snapshotYesterday.predictedNet, actualYesterday.net)

    const note = describeForecastDeviation(importErrorPct, exportErrorPct, solarErrorPct)

    const audit: ForecastAuditEntry = {
      date: yesterday,
      predictedImport: snapshotYesterday.predictedImport,
      actualImport: actualYesterday.import,
      predictedExport: snapshotYesterday.predictedExport,
      actualExport: actualYesterday.export,
      predictedSolar: snapshotYesterday.predictedSolar,
      actualSolar: actualYesterday.solar,
      predictedNet: snapshotYesterday.predictedNet,
      actualNet: actualYesterday.net,
      importErrorPct,
      exportErrorPct,
      solarErrorPct,
      netErrorPct,
      note,
      checkedAt: new Date().toISOString(),
    }

    setForecastAudits((prev) => [audit, ...prev].slice(0, 40))
  }, [dailyForecastSnapshots, normalizedDailySeries, forecastAudits, isHydrated])

  if (!isHydrated) {
    return (
      <main className="auth-shell">
        <section className="auth-card">
          <h1>Loading Solar Meter Reader...</h1>
        </section>
      </main>
    )
  }

  if (requiresFirstLaunchAuth) {
    return (
      <main className="auth-shell">
        <section className="auth-card">
          <h1>Secure Login Required</h1>
          <p className="field-hint">
            Sign in with your account to open your dashboard.
          </p>
          <form className="auth-form" onSubmit={(event) => void handleFirstLaunchSignIn(event)}>
            <label>
              Email
              <input
                type="email"
                value={firstLaunchEmail}
                onChange={(event) => setFirstLaunchEmail(event.target.value)}
                autoComplete="username"
                required
              />
            </label>
            <label>
              Password
              <input
                type="password"
                value={firstLaunchPassword}
                onChange={(event) => setFirstLaunchPassword(event.target.value)}
                autoComplete="current-password"
                required
              />
            </label>
            <button type="submit" disabled={firstLaunchAuthBusy || !isCloudEnabled}>
              {firstLaunchAuthBusy ? 'Signing In...' : 'Continue To Dashboard'}
            </button>
          </form>
          {!isCloudEnabled && (
            <p className="cloud-message">
              Secure login is not configured. Add VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in .env.
            </p>
          )}
          {firstLaunchAuthError && <p className="cloud-message">{firstLaunchAuthError}</p>}
          <p className="field-hint">
            This prompt appears only on first launch for this device.
          </p>
        </section>
      </main>
    )
  }

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
            + Log Meter
          </button>
          <button
            type="button"
            className="quick-add-button quick-add-button-secondary"
            onClick={openSolarLogModal}
          >
            + Log Solar
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
        <article className="card kpi">
          <h2>Last KSEB Reading</h2>
          {latestKsebBillReading ? (
            <>
              <p>
                {dayjs(`${latestKsebBillReading.date}T${latestKsebBillReading.time}`).format(
                  'DD MMM YYYY',
                )}
              </p>
              <p className="field-hint">
                IMP {calculateImportTotal(latestKsebBillReading).toFixed(2)} | EXP{' '}
                {calculateExportTotal(latestKsebBillReading).toFixed(2)} | NET{' '}
                {calculateNet(latestKsebBillReading).toFixed(2)}
              </p>
            </>
          ) : (
            <p className="field-hint">No KSEB bill saved yet.</p>
          )}
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
          <button
            type="button"
            className="manage-bulk-button manage-bulk-meter-button"
            onClick={openBulkMeterModal}
          >
            Bulk Meter Entry
          </button>
          <button
            type="button"
            className="manage-bulk-button manage-bulk-solar-button"
            onClick={openBulkSolarModal}
          >
            Bulk Solar Entry
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
              'Upload a KSEB bill and the app will detect date/import/export values, then pre-fill meter reading form for review.'}
        </p>

        <section className="kseb-bill-section">
          <div className="section-head">
            <h3>Last KSEB Bill Reading</h3>
            <p className="field-hint" style={{ margin: 0 }}>
              Saved with note: KSEB Bill entry
            </p>
          </div>

          {latestKsebBillReading ? (
            <div className="tracker-metrics">
              <div>
                <span>Date and Time</span>
                <strong>
                  {dayjs(`${latestKsebBillReading.date}T${latestKsebBillReading.time}`).format(
                    'DD MMM YYYY HH:mm',
                  )}
                </strong>
              </div>
              <div>
                <span>Import Total</span>
                <strong>{formatUnits(calculateImportTotal(latestKsebBillReading))}</strong>
              </div>
              <div>
                <span>Export Total</span>
                <strong>{formatUnits(calculateExportTotal(latestKsebBillReading))}</strong>
              </div>
              <div>
                <span>Net</span>
                <strong>{formatUnits(calculateNet(latestKsebBillReading))}</strong>
              </div>
              <div>
                <span>Generated Solar</span>
                <strong>{formatUnits(latestKsebBillReading.solarGenerated)}</strong>
              </div>
            </div>
          ) : (
            <p className="field-hint">No KSEB bill reading saved yet.</p>
          )}

          <div className="controls-row kseb-bill-form-grid">
            <label>
              Bill Date
              <input
                type="date"
                value={ksebBillEntryDate}
                onChange={(event) => setKsebBillEntryDate(event.target.value)}
              />
            </label>
            <label>
              Bill Time
              <input
                type="time"
                value={ksebBillEntryTime}
                onChange={(event) => setKsebBillEntryTime(event.target.value)}
              />
            </label>
            <label>
              Import Total (T)
              <input
                type="number"
                min="0"
                step="0.01"
                value={ksebBillImportInput}
                onChange={(event) => setKsebBillImportInput(event.target.value)}
                placeholder="e.g. 63"
              />
            </label>
            <label>
              Export Total (T)
              <input
                type="number"
                min="0"
                step="0.01"
                value={ksebBillExportInput}
                onChange={(event) => setKsebBillExportInput(event.target.value)}
                placeholder="e.g. 71"
              />
            </label>
            <label>
              Net (optional)
              <input
                type="number"
                step="0.01"
                value={ksebBillNetInput}
                onChange={(event) => setKsebBillNetInput(event.target.value)}
                placeholder="Auto = Import - Export"
              />
            </label>
            <label>
              Generated Solar (optional)
              <input
                type="number"
                min="0"
                step="0.01"
                value={ksebBillSolarInput}
                onChange={(event) => setKsebBillSolarInput(event.target.value)}
                placeholder="Carry forward if blank"
              />
            </label>
            <button type="button" onClick={saveKsebBillDetails}>
              Save Bill Details
            </button>
          </div>
        </section>
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
            <h3>This Month's Imported Energy</h3>
            <p>{formatUnits(currentMonthTracker.importConsumed)}</p>
          </article>
          <article className="critical-tile export">
            <h3>This Month's Exported Energy</h3>
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

      <section className="card">
        <div className="section-head">
          <h2>Last KSEB Bill Reading</h2>
          <button type="button" className="ghost" onClick={() => setActiveTab('manage')}>
            Update In Manage
          </button>
        </div>
        {latestKsebBillReading ? (
          <div className="tracker-metrics">
            <div>
              <span>Date and Time</span>
              <strong>
                {dayjs(`${latestKsebBillReading.date}T${latestKsebBillReading.time}`).format(
                  'DD MMM YYYY HH:mm',
                )}
              </strong>
            </div>
            <div>
              <span>Import Total</span>
              <strong>{formatUnits(calculateImportTotal(latestKsebBillReading))}</strong>
            </div>
            <div>
              <span>Export Total</span>
              <strong>{formatUnits(calculateExportTotal(latestKsebBillReading))}</strong>
            </div>
            <div>
              <span>Net</span>
              <strong>{formatUnits(calculateNet(latestKsebBillReading))}</strong>
            </div>
            <div>
              <span>Generated Solar</span>
              <strong>{formatUnits(latestKsebBillReading.solarGenerated)}</strong>
            </div>
          </div>
        ) : (
          <p className="field-hint">
            No KSEB bill reading saved yet. Open Manage tab and save bill details.
          </p>
        )}
      </section>

      <section className="card">
        <div className="section-head">
          <h2>Solar Production Tracker</h2>
          <button type="button" className="ghost" onClick={openSolarLogModal}>
            Log Solar Usage
          </button>
        </div>
        <div className="tracker-metrics">
          <div>
            <span>Latest Manual Solar Reading</span>
            <strong>{formatUnits(manualSolarToday)}</strong>
          </div>
          <div>
            <span>Meter-Derived Solar Today</span>
            <strong>{formatUnits(meterDerivedSolarToday)}</strong>
          </div>
          <div>
            <span>Expected Solar Today</span>
            <strong>{formatUnits(displayedTodayForecast?.expectedSolar ?? 0)}</strong>
          </div>
          <div>
            <span>Effective EOD Solar</span>
            <strong>{formatUnits(effectiveEodSolar.total)}</strong>
          </div>
        </div>
        <p className="field-hint">
          Source:{' '}
          {effectiveEodSolar.source === 'manual-eod'
            ? 'Manual end-of-day entry'
            : effectiveEodSolar.source === 'meter-derived'
              ? 'Auto-derived from meter readings'
                : 'Latest manual solar reading'}
        </p>

        <div className="goals-grid">
          <label>
            End-of-Day Solar Total (kWh)
            <input
              type="number"
              min="0"
              step="0.01"
              value={eodSolarTotalInput}
              onChange={(event) => setEodSolarTotalInput(event.target.value)}
              placeholder="e.g. 5.8"
            />
          </label>
          <label>
            EOD Note (optional)
            <input
              type="text"
              value={eodSolarNoteInput}
              onChange={(event) => setEodSolarNoteInput(event.target.value)}
              placeholder="Clear day / rain / partial cloud"
            />
          </label>
        </div>

        <div className="inline-actions">
          <button type="button" onClick={saveEndOfDaySolarTotal}>
            Save EOD Solar Total
          </button>
        </div>
        <p className="field-hint">
          If you skip manual EOD entry, the app auto-calculates EOD solar from meter readings
          (including night/next-day readings where applicable).
        </p>
        <p className="field-hint">
          Each solar log is treated as your latest cumulative solar reading at that moment,
          not an incremental addition.
        </p>

        {todaySolarLogs.length > 0 && (
          <div className="table-wrap solar-log-table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Time</th>
                  <th>Solar Reading</th>
                  <th>Note</th>
                </tr>
              </thead>
              <tbody>
                {todaySolarLogs.map((entry) => (
                  <tr key={entry.id}>
                    <td>{dayjs(entry.timestamp).format('HH:mm')}</td>
                    <td>{entry.value.toFixed(2)} kWh</td>
                    <td>{entry.note ?? '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="card">
        <div className="section-head">
          <h2>Daily Solar History</h2>
          <p className="field-hint" style={{ margin: 0 }}>
            Manual solar readings are used first for the total solar view, then meter-derived data.
          </p>
        </div>

        <div className="month-select-row solar-history-filter-row">
          <label className="month-select-label">
            <span>Month:</span>
            <select
              className="month-select-input"
              value={solarHistoryMonthFilter}
              onChange={(event) => setSolarHistoryMonthFilter(event.target.value)}
            >
              <option value="">All Months</option>
              {solarHistoryMonthOptions.map((month) => (
                <option key={month.value} value={month.value}>
                  {month.label}
                </option>
              ))}
            </select>
          </label>
          <label className="month-select-label">
            <span>Year:</span>
            <select
              className="month-select-input"
              value={solarHistoryYearFilter}
              onChange={(event) => setSolarHistoryYearFilter(event.target.value)}
            >
              <option value="">All Years</option>
              {solarHistoryYearOptions.map((year) => (
                <option key={year} value={year}>
                  {year}
                </option>
              ))}
            </select>
          </label>
        </div>

        <p className="field-hint" style={{ marginTop: '0.5rem' }}>
          Showing {solarHistoryFilterLabel}. Use this to check yesterday, the day before, or any
          month/year range you want.
        </p>

        <div className="solar-history-grid">
          <article className="tracker-card solar-history-card">
            <h3>Total Solar Production</h3>
            {recentSolarProductionRows.length > 0 ? (
              <>
                <div className="chart-wrap solar-daily-chart">
                  <ResponsiveContainer width="100%" height="100%">
                    <ComposedChart
                      data={recentSolarProductionRows}
                      margin={{ top: 8, right: 8, left: 0, bottom: 0 }}
                    >
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis
                        dataKey="date"
                        tickFormatter={(value) => dayjs(value).format('DD MMM')}
                        minTickGap={20}
                      />
                      <YAxis tickFormatter={(value) => formatUnits(Number(value))} />
                      <Tooltip
                        labelFormatter={(value) => dayjs(String(value)).format('DD MMM YYYY')}
                        formatter={(value) => [`${Number(value).toFixed(2)} kWh`, 'Solar']}
                      />
                      <Bar dataKey="total" fill="#1a8f69" radius={[8, 8, 0, 0]} />
                      <Line type="monotone" dataKey="total" stroke="#f18f01" strokeWidth={2} dot={false} />
                    </ComposedChart>
                  </ResponsiveContainer>
                </div>

                <div className="table-wrap solar-daily-table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>Date</th>
                        <th>Total Solar</th>
                        <th>Source</th>
                        <th>Note</th>
                      </tr>
                    </thead>
                    <tbody>
                      {solarProductionHistoryRows.map((row) => (
                        <tr key={row.date}>
                          <td>{dayjs(row.date).format('DD MMM YYYY')}</td>
                          <td>{row.total.toFixed(2)} kWh</td>
                          <td>
                            {row.source === 'manual-eod'
                              ? 'Saved EOD'
                              : row.source === 'manual-reading'
                                ? 'Manual reading'
                                : 'Meter-derived'}
                          </td>
                          <td>{row.note ?? '-'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            ) : (
              <p className="empty-state">No daily solar totals available for this filter.</p>
            )}
          </article>

          <article className="tracker-card solar-history-card">
            <h3>Exported Solar Per Day</h3>
            {filteredSolarExportRows.length > 0 ? (
              <>
                <div className="chart-wrap solar-daily-chart">
                  <ResponsiveContainer width="100%" height="100%">
                    <ComposedChart
                      data={filteredSolarExportRows}
                      margin={{ top: 8, right: 8, left: 0, bottom: 0 }}
                    >
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis
                        dataKey="date"
                        tickFormatter={(value) => dayjs(value).format('DD MMM')}
                        minTickGap={20}
                      />
                      <YAxis tickFormatter={(value) => formatUnits(Number(value))} />
                      <Tooltip
                        labelFormatter={(value) => dayjs(String(value)).format('DD MMM YYYY')}
                        formatter={(value) => [`${Number(value).toFixed(2)} kWh`, 'Exported Solar']}
                      />
                      <Bar dataKey="total" fill="#2f6b74" radius={[8, 8, 0, 0]} />
                      <Line type="monotone" dataKey="total" stroke="#1a5f80" strokeWidth={2} dot={false} />
                    </ComposedChart>
                  </ResponsiveContainer>
                </div>

                <div className="table-wrap solar-daily-table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>Date</th>
                        <th>Exported Solar</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredSolarExportHistoryRows.map((row) => (
                        <tr key={row.date}>
                          <td>{dayjs(row.date).format('DD MMM YYYY')}</td>
                          <td>{row.total.toFixed(2)} kWh</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            ) : (
              <p className="empty-state">No exported solar data available for this filter.</p>
            )}
          </article>
        </div>
      </section>

      <section className="card form-card">
        <div className="section-head">
          <h2>Quick Entry</h2>
          <button type="button" onClick={openAddReadingModal}>
            Log Meter Reading
          </button>
          <button type="button" className="ghost" onClick={openSolarLogModal}>
            Log Solar Usage
          </button>
        </div>
        <p className="field-hint">
          Use Meter Reading for cumulative meter snapshots and Solar Usage for intraday logs.
          Bulk Meter and Bulk Solar entry are available in Manage tab.
        </p>
      </section>

      </>
      )}

      {isReadingModalOpen && (
        <div className="modal-overlay" role="dialog" aria-modal="true" aria-label="Meter reading">
          <section className="modal-sheet">
            <div className="section-head">
              <h2>{editingReadingId ? 'Edit Meter Reading' : 'Add Meter Reading'}</h2>
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
              <button type="submit">{editingReadingId ? 'Save Meter Reading' : 'Save Meter Reading'}</button>
            </form>
          </section>
        </div>
      )}

      {isSolarLogModalOpen && (
        <div className="modal-overlay" role="dialog" aria-modal="true" aria-label="Solar usage log">
          <section className="modal-sheet solar-log-sheet">
            <div className="section-head">
              <h2>Log Solar Usage</h2>
              <button type="button" className="ghost" onClick={() => setIsSolarLogModalOpen(false)}>
                Close
              </button>
            </div>

            <p className="field-hint solar-log-subtitle">
              Enter the solar value from your app and choose the reading date/time.
            </p>

            <div className="inline-actions solar-log-actions">
              <button
                type="button"
                className="ghost"
                onClick={() => {
                  setSolarLogDate(dayjs().format('YYYY-MM-DD'))
                  setSolarLogTime(defaultReadingTime())
                }}
              >
                Use Current Date/Time
              </button>
            </div>

            <div className="reading-form solar-log-form">
              <label className="solar-log-date-field">
                Date
                <input
                  type="date"
                  value={solarLogDate}
                  onChange={(event) => setSolarLogDate(event.target.value)}
                  required
                />
              </label>
              <label className="solar-log-time-field">
                Time
                <input
                  type="time"
                  value={solarLogTime}
                  onChange={(event) => setSolarLogTime(event.target.value)}
                  required
                />
              </label>
              <label className="solar-log-value-field">
                Current Solar Reading Till Now (kWh)
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  value={solarLogValue}
                  onChange={(event) => setSolarLogValue(event.target.value)}
                  placeholder="e.g. 0.85"
                />
              </label>
              <label className="note-field">
                Note (optional)
                <textarea
                  value={solarLogNote}
                  onChange={(event) => setSolarLogNote(event.target.value)}
                  placeholder="Noon peak / cloudy interval / etc"
                />
              </label>
            </div>

            <div className="inline-actions">
              <button type="button" onClick={saveSolarUsageLog}>
                Save Solar Log
              </button>
            </div>
          </section>
        </div>
      )}

      {isBulkSolarModalOpen && (
        <div className="modal-overlay" role="dialog" aria-modal="true" aria-label="Bulk solar entry">
          <section className="modal-sheet bulk-solar-sheet">
            <div className="section-head">
              <div>
                <h2>Bulk Solar Entry</h2>
                <p className="field-hint">
                  Add historical daily solar totals row by row. Each added row starts on the next day.
                </p>
              </div>
              <button type="button" className="ghost" onClick={() => setIsBulkSolarModalOpen(false)}>
                Close
              </button>
            </div>

            <div className="inline-actions bulk-solar-actions">
              <button type="button" onClick={appendBulkSolarRow}>
                Add Next Row
              </button>
              <button type="button" className="ghost" onClick={resetBulkSolarRows}>
                Reset Rows
              </button>
            </div>

            {bulkSolarErrors.length > 0 && (
              <div className="form-errors" role="alert">
                {bulkSolarErrors.map((error) => (
                  <p key={error}>{error}</p>
                ))}
              </div>
            )}

            <div className="bulk-solar-list">
              {bulkSolarRows.map((row, index) => (
                <article key={row.id} className="bulk-solar-row">
                  <div className="section-head bulk-solar-row-head">
                    <h3>Row {index + 1}</h3>
                    <button
                      type="button"
                      className="ghost danger"
                      onClick={() => removeBulkSolarRow(row.id)}
                      disabled={bulkSolarRows.length === 1}
                    >
                      Remove
                    </button>
                  </div>
                  <div className="reading-form bulk-solar-form">
                    <label>
                      Date
                      <input
                        type="date"
                        value={row.date}
                        onChange={(event) => updateBulkSolarRow(row.id, 'date', event.target.value)}
                        required
                      />
                    </label>
                    <label>
                      Time
                      <input
                        type="time"
                        value={row.time}
                        onChange={(event) => updateBulkSolarRow(row.id, 'time', event.target.value)}
                        required
                      />
                    </label>
                    <label>
                      Solar Produced (kWh)
                      <input
                        type="number"
                        step="0.01"
                        min="0"
                        value={row.total}
                        onChange={(event) => updateBulkSolarRow(row.id, 'total', event.target.value)}
                        placeholder="e.g. 12.4"
                        required
                      />
                    </label>
                    <label className="note-field">
                      Note
                      <textarea
                        value={row.note}
                        onChange={(event) => updateBulkSolarRow(row.id, 'note', event.target.value)}
                        placeholder="Optional note for this day"
                      />
                    </label>
                  </div>
                </article>
              ))}
            </div>

            <div className="inline-actions bulk-solar-save-actions bulk-solar-sticky-bar">
              <button type="button" className="ghost" onClick={appendBulkSolarRow}>
                Add Next Row
              </button>
              <button type="button" onClick={saveBulkSolarEntries}>
                Save Bulk Solar Entries
              </button>
            </div>
          </section>
        </div>
      )}

      {isBulkMeterModalOpen && (
        <div className="modal-overlay" role="dialog" aria-modal="true" aria-label="Bulk meter entry">
          <section className="modal-sheet bulk-meter-sheet">
            <div className="section-head">
              <div>
                <h2>Bulk Meter Entry</h2>
                <p className="field-hint">
                  Add historical meter snapshots row by row. Each added row starts on the next day.
                </p>
              </div>
              <button type="button" className="ghost" onClick={() => setIsBulkMeterModalOpen(false)}>
                Close
              </button>
            </div>

            <div className="inline-actions bulk-meter-actions">
              <button type="button" onClick={appendBulkMeterRow}>
                Add Next Row
              </button>
              <button type="button" className="ghost" onClick={resetBulkMeterRows}>
                Reset Rows
              </button>
            </div>

            {bulkMeterErrors.length > 0 && (
              <div className="form-errors" role="alert">
                {bulkMeterErrors.map((error) => (
                  <p key={error}>{error}</p>
                ))}
              </div>
            )}

            <div className="bulk-meter-list">
              {bulkMeterRows.map((row, index) => (
                <article id={`bulk-meter-row-${row.id}`} key={row.id} className="bulk-meter-row">
                  <div className="section-head bulk-meter-row-head">
                    <h3>Row {index + 1}</h3>
                    <button
                      type="button"
                      className="ghost danger"
                      onClick={() => removeBulkMeterRow(row.id)}
                      disabled={bulkMeterRows.length === 1}
                    >
                      Remove
                    </button>
                  </div>

                  <div className="reading-form bulk-meter-form">
                    <label>
                      Date
                      <input
                        type="date"
                        value={row.date}
                        onChange={(event) => updateBulkMeterRow(row.id, 'date', event.target.value)}
                        required
                      />
                    </label>
                    <label>
                      Time
                      <input
                        type="time"
                        value={row.time}
                        onChange={(event) => updateBulkMeterRow(row.id, 'time', event.target.value)}
                        required
                      />
                    </label>
                    <label>
                      Import Total (T)
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        value={row.importTotal}
                        onChange={(event) =>
                          updateBulkMeterRow(row.id, 'importTotal', event.target.value)
                        }
                        placeholder="e.g. 163"
                        required
                      />
                    </label>
                    <label>
                      Export Total (T)
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        value={row.exportTotal}
                        onChange={(event) =>
                          updateBulkMeterRow(row.id, 'exportTotal', event.target.value)
                        }
                        placeholder="e.g. 153"
                        required
                      />
                    </label>
                    <label>
                      Solar Generated
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        value={row.solarGenerated}
                        onChange={(event) =>
                          updateBulkMeterRow(row.id, 'solarGenerated', event.target.value)
                        }
                        placeholder="e.g. 232"
                      />
                    </label>
                    <label className="note-field">
                      Note
                      <textarea
                        value={row.note}
                        onChange={(event) => updateBulkMeterRow(row.id, 'note', event.target.value)}
                        placeholder="Optional note for this meter row"
                      />
                    </label>
                  </div>
                </article>
              ))}
            </div>

            <div className="inline-actions bulk-meter-save-actions bulk-meter-sticky-bar">
              <button type="button" className="ghost" onClick={appendBulkMeterRow}>
                Add Next Row
              </button>
              <button type="button" onClick={saveBulkMeterEntries}>
                Save Bulk Meter Entries
              </button>
            </div>
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

        <article className="weather-outlook-article">
          <div className="section-head">
            <h2>7-Day Weather Outlook</h2>
            <div style={{ display: 'flex', gap: '0.6rem', alignItems: 'center' }}>
              <span className="field-hint" style={{ margin: 0 }}>
                {weatherStatus === 'loading' ? '⏳ Loading...' : weatherStatus === 'ready' ? '✓ Live – Irimbiliyam' : weatherStatus === 'error' ? '⚠ Offline' : ''}
              </span>
              <button
                type="button"
                className="ghost breakdown-toggle"
                style={{ margin: 0 }}
                onClick={() => setShowWeatherOutlook((prev) => !prev)}
              >
                {showWeatherOutlook ? 'Hide' : 'Show'}
              </button>
            </div>
          </div>
          {showWeatherOutlook && weatherStatus === 'ready' && Object.keys(weatherSignals).length > 0 ? (
            <div className="weather-week-grid">
              {Array.from({ length: 7 }, (_, i) => ({ d: dayjs().add(i, 'day'), i })).map(({ d, i }) => {
                const key = d.format('YYYY-MM-DD')
                const sig = weatherSignals[key]
                if (!sig) return null
                const isToday = i === 0
                const cloud = sig.cloudCover
                const weatherIcon =
                  sig.rainProbability >= 60 ? '🌧'
                  : sig.rainProbability >= 30 ? '🌦'
                  : cloud >= 70 ? '☁'
                  : cloud >= 35 ? '⛅'
                  : '☀'
                return (
                  <div key={key} className={`weather-day-card${isToday ? ' weather-day-today' : ''}`}>
                    <div className="weather-day-name">{isToday ? 'Today' : d.format('ddd')}</div>
                    <div className="weather-day-date">{d.format('DD MMM')}</div>
                    <div className="weather-day-icon">{weatherIcon}</div>
                    {sig.tempMax != null && sig.tempMin != null && (
                      <div className="weather-day-temp">
                        <span className="temp-max">{sig.tempMax.toFixed(0)}°</span>
                        <span className="temp-min">{sig.tempMin.toFixed(0)}°</span>
                      </div>
                    )}
                    <div className="weather-day-stats">
                      <span title="Rain probability">🌧 {sig.rainProbability.toFixed(0)}%</span>
                      <span title="Sunshine hours">☀ {sig.sunshineHours.toFixed(1)}h</span>
                    </div>
                    <div className="weather-day-stats">
                      <span title="Sunrise">🌅 {formatWeatherClock(sig.sunrise)}</span>
                      <span title="Sunset">🌇 {formatWeatherClock(sig.sunset)}</span>
                    </div>
                  </div>
                )
              })}
            </div>
          ) : showWeatherOutlook && weatherStatus === 'loading' ? (
            <p className="empty-state">Fetching weather data…</p>
          ) : showWeatherOutlook ? (
            <p className="empty-state">Weather unavailable. Forecasts use seasonal model.</p>
          ) : null}

          {showWeatherOutlook && weatherStatus === 'ready' && (
            <div className="rain-window-panel" role="region" aria-label="Expected rain timing in next 48 hours">
              {nearbyWeatherAlert && (
                <div className={`nearby-weather-alert ${nearbyWeatherAlert.level === 'storm' ? 'storm' : 'rain'}`} role="alert">
                  <strong>{nearbyWeatherAlert.title}</strong>
                  <span>{nearbyWeatherAlert.message}</span>
                </div>
              )}

              <div className="rain-window-head">
                <h3>Expected Rain Timing (Next 48 Hours)</h3>
                {rainForecastUpdatedAt && (
                  <span className="field-hint" style={{ margin: 0 }}>
                    Updated {dayjs(rainForecastUpdatedAt).format('DD MMM HH:mm')}
                  </span>
                )}
              </div>

              <p className="field-hint" style={{ marginTop: '0.4rem' }}>
                Prediction learning: {rainModelTuning.mode.toUpperCase()} mode |
                {' '}Accuracy {rainPredictionAccuracy.accuracyPct.toFixed(0)}%
                {' '}({rainPredictionAccuracy.correctCount}/{rainPredictionAccuracy.sampleSize || 0})
              </p>

              {rainVerificationPrompt &&
                !rainFeedbackByWindowId.has(rainVerificationPrompt.windowId) && (
                  <div className="rain-check-prompt" role="status">
                    <strong>
                      {dayjs().isBefore(dayjs(rainVerificationPrompt.targetTime))
                        ? `Rain verification scheduled for ${dayjs(rainVerificationPrompt.targetTime).format('HH:mm')}`
                        : `Did it rain at ${dayjs(rainVerificationPrompt.targetTime).format('HH:mm')}?`}
                    </strong>
                    <p className="field-hint" style={{ marginBottom: 0 }}>
                      {dayjs().isBefore(dayjs(rainVerificationPrompt.targetTime))
                        ? 'You will be asked to confirm this exact predicted time once it passes.'
                        : 'Confirming this helps the model learn and improve upcoming rain timing.'}
                    </p>
                    {!dayjs().isBefore(dayjs(rainVerificationPrompt.targetTime)) && (
                      <div className="rain-feedback-actions">
                        <button
                          type="button"
                          className="ghost"
                          onClick={() =>
                            markRainWindowFeedback(
                              {
                                id: rainVerificationPrompt.windowId,
                                start: rainVerificationPrompt.windowStart,
                                end: rainVerificationPrompt.windowEnd,
                              },
                              'correct',
                            )
                          }
                        >
                          Yes, it rained
                        </button>
                        <button
                          type="button"
                          className="ghost danger"
                          onClick={() =>
                            markRainWindowFeedback(
                              {
                                id: rainVerificationPrompt.windowId,
                                start: rainVerificationPrompt.windowStart,
                                end: rainVerificationPrompt.windowEnd,
                              },
                              'incorrect',
                            )
                          }
                        >
                          No, it did not
                        </button>
                      </div>
                    )}
                  </div>
                )}

              {rainWindows.length > 0 ? (
                <div className="rain-window-list">
                  {rainWindows.map((window) => (
                    <article key={window.id} className="rain-window-item">
                      <div>
                        <strong>
                          Likely at{' '}
                          {window.likelyTimes.length > 0
                            ? window.likelyTimes
                                .map((slot) => dayjs(slot.time).format('HH:mm'))
                                .join(', ')
                            : formatRainWindowRange(window.start, window.end)}
                        </strong>
                        <p className="field-hint" style={{ marginBottom: 0 }}>
                          Window: {formatRainWindowRange(window.start, window.end)} | Peak rain chance {window.peakProbability.toFixed(0)}%
                        </p>
                      </div>
                      {window.likelyTimes.length > 0 && (
                        <div className="rain-time-list">
                          {window.likelyTimes.map((slot) => (
                            <span key={`${window.id}_${slot.time}`} className="rain-time-chip">
                              {dayjs(slot.time).format('HH:mm')} ({slot.probability.toFixed(0)}%)
                            </span>
                          ))}
                        </div>
                      )}
                      <div className="rain-window-metrics">
                        <span>{window.expectedRainMm.toFixed(1)} mm expected</span>
                        <span>{window.peakRainMmPerHour.toFixed(1)} mm/h peak</span>
                        {window.thunderRisk && (
                          <span className="rain-risk-tag">Thunder risk</span>
                        )}
                        {window.lightningRisk && (
                          <span className="rain-risk-tag danger">Lightning risk</span>
                        )}
                        <span className={`rain-confidence ${window.confidence}`}>
                          {window.confidence.toUpperCase()} confidence
                        </span>
                      </div>
                      <div className="rain-feedback-actions">
                        <span className="field-hint" style={{ margin: 0 }}>
                          Was this prediction correct?
                        </span>
                        <button
                          type="button"
                          className={
                            rainFeedbackByWindowId.get(window.id) === 'correct'
                              ? 'ghost is-selected'
                              : 'ghost'
                          }
                          onClick={() => markRainWindowFeedback(window, 'correct')}
                        >
                          Correct
                        </button>
                        <button
                          type="button"
                          className={
                            rainFeedbackByWindowId.get(window.id) === 'incorrect'
                              ? 'ghost is-selected danger'
                              : 'ghost danger'
                          }
                          onClick={() => markRainWindowFeedback(window, 'incorrect')}
                        >
                          Incorrect
                        </button>
                      </div>
                    </article>
                  ))}
                </div>
              ) : (
                <p className="empty-state" style={{ marginTop: '0.45rem' }}>
                  No notable rain windows are expected in the next 48 hours.
                </p>
              )}

              <p className="field-hint" style={{ marginBottom: 0 }}>
                Timing is computed from hourly precipitation probability and precipitation intensity from Open-Meteo for Irimbiliyam.
              </p>
            </div>
          )}
        </article>

        <article className="forecast-full-article">
          <div className="section-head">
            <h2>Daily Forecast</h2>
            <button
              type="button"
              className="ghost"
              onClick={recomputeTodayForecast}
              disabled={!todayForecast}
            >
              Recompute Today Forecast
            </button>
          </div>
          {displayedTodayForecast ? (
            <>
              <p className="field-hint">
                {dayjs(displayedTodayForecast.date).format('DD MMM YYYY')}
                {displayedTodayForecast.weatherDriven ? ' - weather-driven' : ' - seasonal fallback'}
              </p>
              <div className="tracker-metrics">
                <div>
                  <span>Expected Solar</span>
                  <strong>{formatUnits(displayedTodayForecast.expectedSolar)}</strong>
                </div>
                <div>
                  <span>Expected Import</span>
                  <strong>{formatUnits(displayedTodayForecast.expectedImport)}</strong>
                </div>
                <div>
                  <span>Expected Export</span>
                  <strong>{formatUnits(displayedTodayForecast.expectedExport)}</strong>
                </div>
                <div>
                  <span>Expected Net</span>
                  <strong>{formatUnits(displayedTodayForecast.expectedNet)}</strong>
                </div>
                <div>
                  <span>Daily Confidence</span>
                  <strong>{displayedTodayForecast.confidenceScore}%</strong>
                </div>
                <div>
                    <span>Latest Manual Solar Reading</span>
                  <strong>{formatUnits(manualSolarToday)}</strong>
                </div>
                <div>
                  <span>Forecast vs Current Reading Gap</span>
                  <strong>{formatUnits(displayedTodayForecast.expectedSolar - manualSolarToday)}</strong>
                </div>
              </div>
              {displayedTodayForecast.weatherSignal && (
                <>
                  <p className="field-hint">
                    Weather inputs: Cloud {displayedTodayForecast.weatherSignal.cloudCover.toFixed(0)}% |
                    Rain chance {displayedTodayForecast.weatherSignal.rainProbability.toFixed(0)}% |
                    Sunshine {displayedTodayForecast.weatherSignal.sunshineHours.toFixed(1)}h |
                    {displayedTodayForecast.weatherSignal.windSpeedMax != null
                      ? `Wind ${displayedTodayForecast.weatherSignal.windSpeedMax.toFixed(0)} km/h`
                      : 'Wind estimate only'} |
                    Sunrise {formatWeatherClock(displayedTodayForecast.weatherSignal.sunrise)} |
                    Sunset {formatWeatherClock(displayedTodayForecast.weatherSignal.sunset)}
                  </p>
                  <p className="field-hint" style={{ marginTop: '-0.15rem' }}>
                    Weather report: {buildOneLineWeatherReport(displayedTodayForecast.weatherSignal)}
                  </p>
                </>
              )}
              <p className="field-hint">
                Real-time adjustment uses today's latest manual solar reading: {displayedTodayForecast.loggedSolarToday.toFixed(2)} kWh
              </p>
              <button
                type="button"
                className="ghost breakdown-toggle"
                onClick={() => setShowDailyBreakdown((prev) => !prev)}
              >
                {showDailyBreakdown ? 'Hide Calculation Breakdown' : 'Show Calculation Breakdown'}
              </button>
              {showDailyBreakdown && (
                <div className="breakdown-panel">
                  <p>
                    Base solar: {displayedTodayForecast.breakdown.baseSolar.toFixed(2)} | Trend:
                    {' '}{displayedTodayForecast.breakdown.solarSlope.toFixed(3)}
                  </p>
                  <p>
                    Weekday factor: {displayedTodayForecast.breakdown.weekdaySolarFactor.toFixed(2)} |
                    Weather factor: {displayedTodayForecast.breakdown.weatherSolarFactor.toFixed(2)}
                  </p>
                  <p>
                    Calibration factor: {displayedTodayForecast.breakdown.calibrationSolarFactor.toFixed(2)}
                    {' '}| Final expected solar: {displayedTodayForecast.expectedSolar.toFixed(3)} kWh
                  </p>
                </div>
              )}
              {latestSolarLog && (
                <p className="field-hint">
                  Last solar log: {dayjs(latestSolarLog.timestamp).format('DD MMM HH:mm')} |
                  {' '}{latestSolarLog.value.toFixed(2)} kWh
                </p>
              )}
              {upcomingForecast.length > 0 && (
                <>
                  <h3 style={{ marginTop: '1.1rem', marginBottom: '0.5rem', fontSize: '0.97rem' }}>
                    Upcoming 2-Day Outlook
                  </h3>
                  <div className="upcoming-forecast-grid">
                    {upcomingForecast.map((day) => (
                      <div key={day.date} className="upcoming-forecast-card">
                        <div className="upcoming-forecast-header">
                          <strong>{day.label}</strong>
                          <span className="field-hint" style={{ margin: 0 }}>
                            {dayjs(day.date).format('ddd, DD MMM')}
                          </span>
                          <span className="field-hint" style={{ margin: 0, fontSize: '0.75rem' }}>
                            {day.weatherDriven ? 'weather-driven' : 'seasonal'} · {day.confidenceScore}% confidence
                          </span>
                        </div>
                        <div className="upcoming-forecast-metrics">
                          <div><span>Solar</span><strong>{formatUnits(day.expectedSolar)}</strong></div>
                          <div><span>Import</span><strong>{formatUnits(day.expectedImport)}</strong></div>
                          <div><span>Export</span><strong>{formatUnits(day.expectedExport)}</strong></div>
                          <div><span>Net</span><strong>{formatUnits(day.expectedNet)}</strong></div>
                        </div>
                        {day.weatherSignal && (
                          <>
                            <p className="field-hint" style={{ marginBottom: 0, fontSize: '0.75rem' }}>
                              ☁ {day.weatherSignal.cloudCover.toFixed(0)}% cloud · 🌧 {day.weatherSignal.rainProbability.toFixed(0)}% rain · ☀ {day.weatherSignal.sunshineHours.toFixed(1)}h sun · 🌅 {formatWeatherClock(day.weatherSignal.sunrise)} · 🌇 {formatWeatherClock(day.weatherSignal.sunset)}
                            </p>
                            <p className="field-hint" style={{ marginBottom: 0, fontSize: '0.74rem' }}>
                              {buildOneLineWeatherReport(day.weatherSignal)}
                            </p>
                          </>
                        )}
                      </div>
                    ))}
                  </div>
                </>
              )}
            </>
          ) : (
            <p className="empty-state">No daily forecast available yet.</p>
          )}
        </article>
      </section>

      <section className="card insights-grid">
        <article>
          <h2>Monthly Forecast</h2>
          {forecast ? (
            <>
              <div className="tracker-metrics">
                <div>
                  <span>Cycle Progress</span>
                  <strong>
                    {forecast.elapsedDays}/{forecast.totalDays} days
                  </strong>
                </div>
                <div>
                  <span>Remaining Days</span>
                  <strong>{forecast.remainingDays}</strong>
                </div>
                <div>
                  <span>Forecast Confidence</span>
                  <strong>{forecast.confidenceScore}%</strong>
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
                <div>
                  <span>Projected Bank Close</span>
                  <strong>{formatUnits(forecast.projectedClosingBank)}</strong>
                </div>
                <div>
                  <span>Live Weather Days Used</span>
                  <strong>{forecast.weatherDaysUsed}</strong>
                </div>
              </div>
              <p className="field-hint">{forecast.modelNote}</p>
              <p className="field-hint">
                Weather Sync: {weatherStatus.toUpperCase()}
                {weatherMessage ? ` - ${weatherMessage}` : ''}
              </p>
            </>
          ) : (
            <p className="empty-state">No forecast yet for this cycle.</p>
          )}
        </article>

        <article>
          <h2>Forecast Accuracy Check</h2>
          {forecastAudits[0] ? (
            <>
              <p className="field-hint">
                Last verified day: {dayjs(forecastAudits[0].date).format('DD MMM YYYY')}
              </p>
              <div className="tracker-metrics">
                <div>
                  <span>Import Error</span>
                  <strong>{formatSigned(forecastAudits[0].importErrorPct)}%</strong>
                </div>
                <div>
                  <span>Export Error</span>
                  <strong>{formatSigned(forecastAudits[0].exportErrorPct)}%</strong>
                </div>
                <div>
                  <span>Solar Error</span>
                  <strong>{formatSigned(forecastAudits[0].solarErrorPct)}%</strong>
                </div>
                <div>
                  <span>Net Error</span>
                  <strong>{formatSigned(forecastAudits[0].netErrorPct)}%</strong>
                </div>
              </div>
              <p className="field-hint">{forecastAudits[0].note}</p>
            </>
          ) : (
            <p className="empty-state">
              Daily auto-check starts once tomorrow readings are available. We compare
              yesterday predicted vs actual and self-correct next forecasts.
            </p>
          )}
          <p className="field-hint">
            Active calibration: Import {(forecastCalibration.import * 100).toFixed(0)}% |
            Export {(forecastCalibration.export * 100).toFixed(0)}% |
            Solar {(forecastCalibration.solar * 100).toFixed(0)}%
          </p>
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
        + Meter
      </button>
      <button
        type="button"
        className="fab-solar-log"
        onClick={openSolarLogModal}
      >
        + Solar
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
