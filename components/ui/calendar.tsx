"use client"

import * as React from "react"
import {
  addMonths,
  subMonths,
  format,
  startOfMonth,
  endOfMonth,
  startOfWeek,
  endOfWeek,
  eachDayOfInterval,
  isSameMonth,
  isSameDay,
  isToday,
  getMonth,
  getYear,
  setMonth,
  setYear,
} from "date-fns"
import { ChevronLeft, ChevronRight } from "lucide-react"
import { cn } from "cn"
import { Button } from "@/components/ui/button"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

export interface CalendarProps {
  selected?: Date | null
  onSelect?: (date: Date | undefined) => void
  initialMonth?: Date
  minDate?: Date
  maxDate?: Date
  className?: string
  showActions?: boolean
}

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
]

export function Calendar({
  selected,
  onSelect,
  initialMonth,
  minDate,
  maxDate,
  className,
  showActions = true,
}: CalendarProps) {
  const [currentMonth, setCurrentMonth] = React.useState<Date>(
    () => selected || initialMonth || new Date()
  )

  React.useEffect(() => {
    if (selected) {
      setCurrentMonth(selected)
    }
  }, [selected])

  const currentYear = new Date().getFullYear()
  const years = React.useMemo(() => {
    const list: number[] = []
    for (let y = currentYear + 10; y >= 1920; y--) {
      list.push(y)
    }
    return list
  }, [currentYear])

  const monthStart = startOfMonth(currentMonth)
  const monthEnd = endOfMonth(monthStart)
  const startDate = startOfWeek(monthStart)
  const endDate = endOfWeek(monthEnd)

  const days = eachDayOfInterval({ start: startDate, end: endDate })
  const weekDays = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"]

  const handlePrevMonth = (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setCurrentMonth((prev) => subMonths(prev, 1))
  }

  const handleNextMonth = (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setCurrentMonth((prev) => addMonths(prev, 1))
  }

  const handleMonthChange = (val: string | null) => {
    if (val === null) return
    const m = Number.parseInt(val, 10)
    setCurrentMonth((prev) => setMonth(prev, m))
  }

  const handleYearChange = (val: string | null) => {
    if (val === null) return
    const y = Number.parseInt(val, 10)
    setCurrentMonth((prev) => setYear(prev, y))
  }

  const handleSelect = (day: Date) => {
    if (onSelect) {
      if (selected && isSameDay(day, selected)) {
        onSelect(undefined)
      } else {
        onSelect(day)
      }
    }
  }

  const handleToday = (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    const today = new Date()
    setCurrentMonth(today)
    if (onSelect) {
      onSelect(today)
    }
  }

  const handleClear = (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    if (onSelect) {
      onSelect(undefined)
    }
  }

  return (
    <div
      data-slot="calendar"
      className={cn("p-3 select-none w-[290px]", className)}
    >
      {/* Month & Year Selectors + Nav buttons */}
      <div className="flex items-center justify-between gap-1 pb-3">
        <div className="flex items-center gap-1.5 flex-1 min-w-0">
          <Select
            value={String(getMonth(currentMonth))}
            onValueChange={handleMonthChange}
          >
            <SelectTrigger
              size="sm"
              className="h-7 text-xs font-medium px-2 py-0 border-input bg-background flex-1 rounded-md"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="max-h-56 rounded-md">
              {MONTHS.map((m, idx) => (
                <SelectItem key={m} value={String(idx)} className="text-xs rounded-md">
                  {m}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select
            value={String(getYear(currentMonth))}
            onValueChange={handleYearChange}
          >
            <SelectTrigger
              size="sm"
              className="h-7 text-xs font-medium px-2 py-0 border-input bg-background w-[78px] shrink-0 rounded-md"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="max-h-56 rounded-md">
              {years.map((y) => (
                <SelectItem key={y} value={String(y)} className="text-xs rounded-md">
                  {y}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex items-center gap-0.5 shrink-0 ml-1">
          <Button
            type="button"
            variant="outline"
            size="icon"
            className="size-7 rounded-md p-0"
            onClick={handlePrevMonth}
            aria-label="Previous month"
          >
            <ChevronLeft className="size-3.5" />
          </Button>
          <Button
            type="button"
            variant="outline"
            size="icon"
            className="size-7 rounded-md p-0"
            onClick={handleNextMonth}
            aria-label="Next month"
          >
            <ChevronRight className="size-3.5" />
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-7 gap-1 text-center text-xs font-medium text-muted-foreground pb-1">
        {weekDays.map((day) => (
          <div key={day} className="h-7 flex items-center justify-center">
            {day}
          </div>
        ))}
      </div>

      <div className="grid grid-cols-7 gap-1 text-center">
        {days.map((day, idx) => {
          const isSelected = selected ? isSameDay(day, selected) : false
          const isCurrentMonth = isSameMonth(day, currentMonth)
          const isDayToday = isToday(day)
          const isDisabled =
            (minDate && day < minDate) || (maxDate && day > maxDate)

          return (
            <button
              key={idx}
              type="button"
              disabled={isDisabled}
              onClick={() => handleSelect(day)}
              className={cn(
                "h-8 w-8 text-xs font-normal transition-colors rounded-md flex items-center justify-center mx-auto",
                !isCurrentMonth && "text-muted-foreground/40",
                isCurrentMonth && !isSelected && "text-foreground hover:bg-accent hover:text-accent-foreground",
                isDayToday && !isSelected && "font-semibold text-primary underline underline-offset-2",
                isSelected &&
                  "bg-primary text-primary-foreground font-semibold hover:bg-primary/90",
                isDisabled && "opacity-30 cursor-not-allowed hover:bg-transparent"
              )}
            >
              {format(day, "d")}
            </button>
          )
        })}
      </div>

      {showActions && (
        <div className="flex items-center justify-between pt-3 mt-2 border-t text-xs">
          <button
            type="button"
            onClick={handleClear}
            className="text-muted-foreground hover:text-foreground font-medium rounded-md px-1.5 py-0.5"
          >
            Clear
          </button>
          <button
            type="button"
            onClick={handleToday}
            className="text-primary hover:underline font-medium rounded-md px-1.5 py-0.5"
          >
            Today
          </button>
        </div>
      )}
    </div>
  )
}
