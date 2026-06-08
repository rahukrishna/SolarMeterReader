import dayjs from 'dayjs'
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

type BillingDay = 1 | 2

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

const STORAGE_KEY = 'solar-meter-readings-v1'
const SETTINGS_KEY = 'solar-meter-settings-v1'
const DATA_VERSION_KEY = 'solar-meter-data-version-v1'
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
  const date = dayjs(dateValue)
  const start =
    date.date() >= billingDay
      ? date.date(billingDay)
      : date.subtract(1, 'month').date(billingDay)
  const end = start.add(1, 'month').subtract(1, 'day')
  return {
    key: `${start.format('YYYY-MM-DD')}_${end.format('YYYY-MM-DD')}`,
    start: start.format('YYYY-MM-DD'),
    end: end.format('YYYY-MM-DD'),
  }
}

const buildFinancialYearCycles = (anchorDate: string, billingDay: BillingDay) => {
  const anchor = dayjs(anchorDate)
  const fyStartYear = anchor.month() >= 3 ? anchor.year() : anchor.year() - 1
  const fyStart = dayjs(`${fyStartYear}-04-${billingDay.toString().padStart(2, '0')}`)

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
      }
      setBillingDay(parsedSettings.billingDay ?? 1)
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
      }),
    )
  }, [billingDay, isHydrated])

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
        payableUnits: 0,
        remainingBank: 0,
        totalImport: 0,
        totalExport: 0,
        totalNet: 0,
        totalSolar: 0,
      }
    }

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

    return {
      periodLabel: `${dayjs(bounds.start).format('DD MMM YYYY')} - ${dayjs(bounds.end).format('DD MMM YYYY')}`,
      readingsCount: inCycle.length,
      importConsumed,
      exportConsumed,
      netConsumed,
      solarAdded,
      openingBank,
      payableUnits,
      remainingBank,
      totalImport: calculateImportTotal(latest),
      totalExport: calculateExportTotal(latest),
      totalNet: calculateNet(latest),
      totalSolar: latest.solarGenerated,
    }
  }, [sortedReadings, billingDay])

  const currentBank = billingCycles.length
    ? billingCycles[billingCycles.length - 1].closingBank
    : 0

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
      id: createReadingId(),
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

    setReadings((prev) => sortReadings([...prev, next]))
    setFormState(defaultFormState())
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
    setReadings((prev) => prev.filter((item) => item.id !== id))
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
  }

  const pushToCloud = async () => {
    if (!supabase || !cloudUser) {
      setCloudMessage('Sign in to cloud first.')
      return
    }

    setCloudBusy(true)
    setCloudMessage('Syncing local readings to cloud...')

    const payload = sortedReadings.map((reading) => ({
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
    } else {
      setCloudMessage('Cloud sync complete: local data uploaded.')
    }
    setCloudBusy(false)
  }

  const pullFromCloud = async () => {
    if (!supabase || !cloudUser) {
      setCloudMessage('Sign in to cloud first.')
      return
    }

    setCloudBusy(true)
    setCloudMessage('Downloading readings from cloud...')

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

    setReadings(sortReadings(cloudReadings))
    setCloudMessage(`Cloud download complete: ${cloudReadings.length} readings loaded.`)
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

  return (
    <main className="app-shell">
      <header className="hero">
        <p className="eyebrow">Solar Meter Reader</p>
        <h1>Track Import, Export, Net, Solar, and Energy Bank</h1>
        <p className="hero-subtitle">
          Enter cumulative meter snapshots. App calculates usage by difference from the
          previous reading and applies billing-cycle bank adjustment with annual settlement
          on 31 March.
        </p>
      </header>

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

      <section className="card controls">
        <div className="controls-row">
          <label>
            Billing Day
            <select
              value={billingDay}
              onChange={(event) => setBillingDay(Number(event.target.value) as BillingDay)}
            >
              <option value={1}>1st of Month</option>
              <option value={2}>2nd of Month</option>
            </select>
          </label>
          <button type="button" onClick={exportData} className="ghost">
            Export JSON Backup
          </button>
        </div>
      </section>

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
              <button type="button" onClick={() => void pullFromCloud()} disabled={!cloudUser || cloudBusy}>
                Download From Cloud
              </button>
              <button type="button" onClick={() => void pushToCloud()} disabled={!cloudUser || cloudBusy}>
                Upload To Cloud
              </button>
              <button type="button" className="ghost" onClick={() => void signOutCloud()} disabled={!cloudUser || cloudBusy}>
                Sign Out
              </button>
            </div>
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

      <section className="card month-tracker">
        <div className="section-head">
          <h2>Current Month Usage</h2>
          <p className="field-hint">
            {currentMonthTracker.periodLabel} | Readings: {currentMonthTracker.readingsCount}
          </p>
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
              <div className="payable-focus">
                <span>Payable Units</span>
                <strong>{formatUnits(currentMonthTracker.payableUnits)}</strong>
              </div>
              <div>
                <span>Remaining Bank</span>
                <strong>{formatUnits(currentMonthTracker.remainingBank)}</strong>
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
        <h2>Add Daily Reading</h2>
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
          <button type="submit">Add Reading</button>
        </form>
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

      <section className="card table-card">
        <h2>Billing Cycle Summary (Usage Deltas)</h2>
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
                <tr key={cycle.key}>
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

      <footer className="footer-note">
        Data is stored locally in your browser. You can host this app for free on GitHub
        Pages.
      </footer>
    </main>
  )
}

export default App
