"use client"

import * as React from "react"
import { format, parseISO } from "date-fns"
import { Calendar as CalendarIcon } from "lucide-react"
import { cn } from "cn"
import { Button } from "@/components/ui/button"
import { Calendar } from "@/components/ui/calendar"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"

export interface DatePickerProps {
  id?: string
  name?: string
  value?: string // YYYY-MM-DD string or ISO string
  onChange?: (dateString: string) => void
  placeholder?: string
  disabled?: boolean
  className?: string
  required?: boolean
}

export function DatePicker({
  id,
  name,
  value,
  onChange,
  placeholder = "Pick a date",
  disabled = false,
  className,
  required = false,
}: DatePickerProps) {
  const [open, setOpen] = React.useState(false)

  const parsedDate = React.useMemo(() => {
    if (!value) return undefined
    try {
      const parsed = parseISO(value)
      return isNaN(parsed.getTime()) ? undefined : parsed
    } catch {
      return undefined
    }
  }, [value])

  const handleSelect = (date: Date | undefined) => {
    if (onChange) {
      onChange(date ? format(date, "yyyy-MM-dd") : "")
    }
    setOpen(false)
  }

  return (
    <div className={cn("relative inline-block w-full", className)}>
      {/* Hidden input to ensure form submission includes the value if used inside native forms */}
      {name && (
        <input
          type="hidden"
          id={id}
          name={name}
          value={value || ""}
          required={required}
        />
      )}
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger
          render={
            <Button
              type="button"
              variant="outline"
              id={name ? undefined : id}
              disabled={disabled}
              className={cn(
                "w-full justify-start text-left font-normal rounded-md h-9 px-3",
                !value && "text-muted-foreground",
                className
              )}
            >
              <CalendarIcon className="mr-2 size-4 opacity-70 shrink-0" />
              {parsedDate ? (
                <span>{format(parsedDate, "PPP")}</span>
              ) : (
                <span>{placeholder}</span>
              )}
            </Button>
          }
        />
        <PopoverContent
          className="w-auto p-0 rounded-md"
          align="start"
          sideOffset={4}
        >
          <Calendar
            selected={parsedDate}
            onSelect={handleSelect}
            initialMonth={parsedDate || new Date()}
          />
        </PopoverContent>
      </Popover>
    </div>
  )
}
