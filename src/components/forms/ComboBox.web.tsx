import React, { useRef, useCallback, useMemo } from 'react';
import { View, Text, Platform, StyleSheet } from 'react-native';
import { useComboBox } from '@react-aria/combobox';
import { useComboBoxState } from '@react-stately/combobox';
import { useListBox, useOption } from '@react-aria/listbox';
import { Item } from '@react-stately/collections';
import type { Node } from '@react-types/shared';

interface ComboBoxItem {
  id: string;
  name: string;
  icon?: string;
  description?: string;
}

interface ComboBoxProps {
  label?: string;
  placeholder?: string;
  items: ComboBoxItem[];
  selectedId?: string;
  onSelect: (id: string) => void;
  accentColor?: string;
}

// Fuzzy-ish contains filter
function defaultFilter(textValue: string, inputValue: string): boolean {
  const input = inputValue.toLowerCase().trim();
  if (!input) return true;
  const text = textValue.toLowerCase();
  // Simple substring match
  if (text.includes(input)) return true;
  // Check if all chars of input appear in order
  let ti = 0;
  for (let i = 0; i < text.length && ti < input.length; i++) {
    if (text[i] === input[ti]) ti++;
  }
  return ti === input.length;
}

function ListBoxPopup({ listBoxRef, state, listBoxProps: lbProps }: {
  listBoxRef: React.RefObject<HTMLUListElement | null>;
  state: any;
  listBoxProps: any;
}) {
  const { listBoxProps } = useListBox(lbProps, state, listBoxRef);

  return (
    <ul
      {...listBoxProps}
      ref={listBoxRef}
      style={{
        listStyle: 'none',
        margin: 0,
        padding: '4px 0',
        maxHeight: 220,
        overflowY: 'auto',
        outline: 'none',
      }}
    >
      {[...state.collection].map((item: Node<ComboBoxItem>) => (
        <OptionItem key={item.key} item={item} state={state} />
      ))}
      {[...state.collection].length === 0 && (
        <li style={{
          padding: '10px 12px',
          color: '#5a5a70',
          fontFamily: 'monospace',
          fontSize: 12,
        }}>
          No results
        </li>
      )}
    </ul>
  );
}

function OptionItem({ item, state }: { item: Node<ComboBoxItem>; state: any }) {
  const ref = useRef<HTMLLIElement>(null);
  const { optionProps, isSelected, isFocused } = useOption(
    { key: item.key },
    state,
    ref
  );

  const data = item.value as ComboBoxItem | undefined;

  return (
    <li
      {...optionProps}
      ref={ref}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: '8px 12px',
        cursor: 'pointer',
        backgroundColor: isFocused ? '#1a1a28' : isSelected ? '#14142a' : 'transparent',
        outline: 'none',
        borderLeft: isSelected ? '2px solid var(--accent-color, #6366f1)' : '2px solid transparent',
        transition: 'background-color 0.1s',
      }}
    >
      {data?.icon && (
        <span style={{
          fontSize: 14,
          width: 20,
          textAlign: 'center',
          flexShrink: 0,
        }}>
          {data.icon}
        </span>
      )}
      <span style={{ flex: 1, minWidth: 0 }}>
        <span style={{
          color: isSelected ? '#f0f0f5' : '#c0c0d0',
          fontFamily: 'monospace',
          fontSize: 13,
          fontWeight: isSelected ? '700' : '400',
          display: 'block',
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
        }}>
          {item.textValue}
        </span>
        {data?.description && (
          <span style={{
            color: '#5a5a70',
            fontFamily: 'monospace',
            fontSize: 11,
            display: 'block',
            marginTop: 1,
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}>
            {data.description}
          </span>
        )}
      </span>
    </li>
  );
}

export { Item as ComboBoxItem };

export default function ComboBox({
  label,
  placeholder = 'Search...',
  items,
  selectedId,
  onSelect,
  accentColor = '#6366f1',
}: ComboBoxProps) {
  if (Platform.OS !== 'web') return null;

  const inputRef = useRef<HTMLInputElement>(null);
  const listBoxRef = useRef<HTMLUListElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);

  const onSelectionChange = useCallback((key: any) => {
    if (key != null) {
      onSelect(String(key));
    }
  }, [onSelect]);

  const state = useComboBoxState({
    defaultFilter,
    allowsEmptyCollection: true,
    children: (item: ComboBoxItem) => (
      <Item key={item.id} textValue={item.name}>
        {item.name}
      </Item>
    ),
    items,
    selectedKey: selectedId ?? null,
    onSelectionChange,
    menuTrigger: 'focus',
  });

  const { inputProps, listBoxProps, labelProps } = useComboBox(
    {
      inputRef,
      listBoxRef,
      popoverRef,
      label: label || 'Select',
      placeholder,
      selectedKey: selectedId ?? null,
      onSelectionChange,
      menuTrigger: 'focus',
    },
    state
  );

  return (
    <View
      style={[styles.root, { '--accent-color': accentColor } as any]}
      nativeID="section-combobox"
    >
      {label && (
        <label {...labelProps} style={{
          color: '#8888a0',
          fontSize: 11,
          fontFamily: 'monospace',
          letterSpacing: 1,
          textTransform: 'uppercase' as const,
          marginBottom: 6,
          display: 'block',
        }}>
          {label}
        </label>
      )}
      <div style={{ position: 'relative' }}>
        <div style={{
          position: 'absolute',
          left: 10,
          top: '50%',
          transform: 'translateY(-50%)',
          color: '#5a5a70',
          fontFamily: 'monospace',
          fontSize: 13,
          pointerEvents: 'none',
          zIndex: 1,
        }}>
          {'\u2315'}
        </div>
        <input
          {...inputProps}
          ref={inputRef}
          style={{
            width: '100%',
            boxSizing: 'border-box',
            backgroundColor: '#0a0a12',
            color: '#f0f0f5',
            border: `2px solid ${state.isOpen ? accentColor : '#1a1a28'}`,
            borderRadius: 2,
            padding: '10px 12px 10px 30px',
            fontFamily: 'monospace',
            fontSize: 13,
            letterSpacing: 0.5,
            outline: 'none',
            transition: 'border-color 0.15s',
          }}
        />

        {state.isOpen && (
          <div
            ref={popoverRef}
            style={{
              position: 'absolute',
              top: '100%',
              left: 0,
              right: 0,
              marginTop: 4,
              backgroundColor: '#0c0c14',
              border: '2px solid #1a1a28',
              borderRadius: 2,
              zIndex: 200,
              boxShadow: '4px 4px 0px #050508',
              overflow: 'hidden',
            }}
          >
            <ListBoxPopup
              listBoxRef={listBoxRef}
              state={state}
              listBoxProps={listBoxProps}
            />
          </div>
        )}
      </div>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    position: 'relative' as any,
    zIndex: 100,
  },
});
