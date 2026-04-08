import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { View, Text, Pressable, Platform, StyleSheet } from 'react-native';
import {
  CalendarDate,
  parseDate,
  today,
  getLocalTimeZone,
  getDayOfWeek,
  isSameDay,
  isSameMonth,
  startOfMonth,
  endOfMonth,
} from '@internationalized/date';

interface DatePickerProps {
  label?: string;
  value?: string;
  onChange: (isoDate: string) => void;
  accentColor?: string;
}

const DAYS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];

function toISOString(d: CalendarDate): string {
  const mm = String(d.month).padStart(2, '0');
  const dd = String(d.day).padStart(2, '0');
  return `${d.year}-${mm}-${dd}`;
}

function getCalendarGrid(year: number, month: number): (CalendarDate | null)[][] {
  const first = new CalendarDate(year, month, 1);
  const last = endOfMonth(first) as CalendarDate;
  const startDow = getDayOfWeek(first, 'en-US');

  const weeks: (CalendarDate | null)[][] = [];
  let currentWeek: (CalendarDate | null)[] = [];

  // Pad days before the 1st
  for (let i = 0; i < startDow; i++) {
    const prevDay = first.subtract({ days: startDow - i });
    currentWeek.push(prevDay as CalendarDate);
  }

  // Fill actual month days
  for (let day = 1; day <= last.day; day++) {
    currentWeek.push(new CalendarDate(year, month, day));
    if (currentWeek.length === 7) {
      weeks.push(currentWeek);
      currentWeek = [];
    }
  }

  // Pad remaining days
  if (currentWeek.length > 0) {
    let nextDay = 1;
    const nextMonth = month === 12 ? 1 : month + 1;
    const nextYear = month === 12 ? year + 1 : year;
    while (currentWeek.length < 7) {
      currentWeek.push(new CalendarDate(nextYear, nextMonth, nextDay++));
    }
    weeks.push(currentWeek);
  }

  return weeks;
}

export default function DatePicker({ label, value, onChange, accentColor = '#6366f1' }: DatePickerProps) {
  if (Platform.OS !== 'web') return null;

  const todayDate = useMemo(() => today(getLocalTimeZone()) as CalendarDate, []);
  const selectedDate = useMemo(() => {
    if (!value) return null;
    try { return parseDate(value) as CalendarDate; } catch { return null; }
  }, [value]);

  const [isOpen, setIsOpen] = useState(false);
  const [viewYear, setViewYear] = useState(selectedDate?.year ?? todayDate.year);
  const [viewMonth, setViewMonth] = useState(selectedDate?.month ?? todayDate.month);
  const containerRef = useRef<View>(null);

  // Close on outside click
  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: MouseEvent) => {
      const el = containerRef.current as unknown as HTMLElement;
      if (el && !el.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [isOpen]);

  const weeks = useMemo(() => getCalendarGrid(viewYear, viewMonth), [viewYear, viewMonth]);
  const monthName = new Date(viewYear, viewMonth - 1).toLocaleString('default', { month: 'long' });

  const goPrev = useCallback(() => {
    if (viewMonth === 1) { setViewMonth(12); setViewYear(y => y - 1); }
    else { setViewMonth(m => m - 1); }
  }, [viewMonth]);

  const goNext = useCallback(() => {
    if (viewMonth === 12) { setViewMonth(1); setViewYear(y => y + 1); }
    else { setViewMonth(m => m + 1); }
  }, [viewMonth]);

  const handleSelect = useCallback((d: CalendarDate) => {
    onChange(toISOString(d));
    setIsOpen(false);
  }, [onChange]);

  const displayValue = selectedDate
    ? `${selectedDate.year}-${String(selectedDate.month).padStart(2, '0')}-${String(selectedDate.day).padStart(2, '0')}`
    : '';

  return (
    <View ref={containerRef} style={styles.root}>
      {label && <Text style={styles.label}>{label}</Text>}
      <Pressable
        onPress={() => {
          if (!isOpen && selectedDate) {
            setViewYear(selectedDate.year);
            setViewMonth(selectedDate.month);
          }
          setIsOpen(!isOpen);
        }}
        style={({ pressed }) => [
          styles.field,
          pressed && { borderColor: accentColor },
          isOpen && { borderColor: accentColor },
        ]}
      >
        <Text style={[styles.fieldText, !displayValue && styles.fieldPlaceholder]}>
          {displayValue || 'YYYY-MM-DD'}
        </Text>
        <Text style={styles.fieldIcon}>{'\u25BC'}</Text>
      </Pressable>

      {isOpen && (
        <View style={styles.dropdown}>
          {/* Header nav */}
          <View style={styles.calHeader}>
            <Pressable onPress={goPrev} style={styles.navBtn}>
              <Text style={styles.navBtnText}>{'\u25C0'}</Text>
            </Pressable>
            <Text style={styles.calTitle}>{monthName} {viewYear}</Text>
            <Pressable onPress={goNext} style={styles.navBtn}>
              <Text style={styles.navBtnText}>{'\u25B6'}</Text>
            </Pressable>
          </View>

          {/* Day headers */}
          <View style={styles.weekRow}>
            {DAYS.map(d => (
              <View key={d} style={styles.dayCell}>
                <Text style={styles.dayHeader}>{d}</Text>
              </View>
            ))}
          </View>

          {/* Calendar grid */}
          {weeks.map((week, wi) => (
            <View key={wi} style={styles.weekRow}>
              {week.map((day, di) => {
                if (!day) return <View key={di} style={styles.dayCell} />;
                const inMonth = day.month === viewMonth && day.year === viewYear;
                const isSelected = selectedDate ? isSameDay(day, selectedDate) : false;
                const isToday = isSameDay(day, todayDate);

                return (
                  <Pressable
                    key={di}
                    onPress={() => handleSelect(day)}
                    style={({ hovered }: any) => [
                      styles.dayCell,
                      isSelected && { backgroundColor: accentColor },
                      isToday && !isSelected && { borderColor: accentColor, borderWidth: 1 },
                      hovered && !isSelected && { backgroundColor: '#1a1a28' },
                    ]}
                  >
                    <Text style={[
                      styles.dayText,
                      !inMonth && styles.dayMuted,
                      isSelected && { color: '#ffffff', fontWeight: '700' },
                    ]}>
                      {day.day}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          ))}

          {/* Today shortcut */}
          <Pressable
            onPress={() => {
              setViewYear(todayDate.year);
              setViewMonth(todayDate.month);
              handleSelect(todayDate);
            }}
            style={styles.todayBtn}
          >
            <Text style={[styles.todayBtnText, { color: accentColor }]}>Today</Text>
          </Pressable>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    position: 'relative' as any,
    zIndex: 100,
  },
  label: {
    color: '#8888a0',
    fontSize: 11,
    fontFamily: 'monospace',
    letterSpacing: 1,
    textTransform: 'uppercase',
    marginBottom: 6,
  },
  field: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#0a0a12',
    borderWidth: 2,
    borderColor: '#1a1a28',
    borderRadius: 2,
    paddingHorizontal: 12,
    paddingVertical: 10,
    cursor: 'pointer' as any,
  },
  fieldText: {
    color: '#f0f0f5',
    fontSize: 13,
    fontFamily: 'monospace',
    letterSpacing: 1,
  },
  fieldPlaceholder: {
    color: '#4a4a60',
  },
  fieldIcon: {
    color: '#6a6a80',
    fontSize: 10,
    fontFamily: 'monospace',
  },
  dropdown: {
    position: 'absolute' as any,
    top: '100%' as any,
    left: 0,
    marginTop: 4,
    backgroundColor: '#0c0c14',
    borderWidth: 2,
    borderColor: '#1a1a28',
    borderRadius: 2,
    padding: 8,
    zIndex: 200,
    minWidth: 260,
    shadowColor: '#000',
    shadowOffset: { width: 4, height: 4 },
    shadowOpacity: 0.6,
    shadowRadius: 0,
  },
  calHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
    paddingHorizontal: 4,
  },
  navBtn: {
    padding: 6,
    cursor: 'pointer' as any,
  },
  navBtnText: {
    color: '#8888a0',
    fontSize: 10,
    fontFamily: 'monospace',
  },
  calTitle: {
    color: '#f0f0f5',
    fontSize: 12,
    fontFamily: 'monospace',
    fontWeight: '700',
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  weekRow: {
    flexDirection: 'row',
  },
  dayCell: {
    width: 34,
    height: 30,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 2,
  },
  dayHeader: {
    color: '#5a5a70',
    fontSize: 10,
    fontFamily: 'monospace',
    fontWeight: '700',
    letterSpacing: 1,
  },
  dayText: {
    color: '#c0c0d0',
    fontSize: 12,
    fontFamily: 'monospace',
  },
  dayMuted: {
    color: '#3a3a50',
  },
  todayBtn: {
    alignItems: 'center',
    paddingVertical: 6,
    marginTop: 4,
    borderTopWidth: 1,
    borderTopColor: '#1a1a28',
    cursor: 'pointer' as any,
  },
  todayBtnText: {
    fontSize: 11,
    fontFamily: 'monospace',
    fontWeight: '700',
    letterSpacing: 1,
  },
});
