import React from 'react';
import {
  KBarProvider,
  KBarPortal,
  KBarPositioner,
  KBarAnimator,
  KBarSearch,
  KBarResults,
  useMatches,
  Action,
} from 'kbar';
import { ActionImpl } from 'kbar';

// ── Styled results list ──────────────────────────────────────────────────────

function RenderResults() {
  const { results } = useMatches();

  return (
    <KBarResults
      items={results}
      onRender={({ item, active }) => {
        if (typeof item === 'string') {
          return <div style={styles.sectionHeader}>{item}</div>;
        }

        return (
          <div style={{
            ...styles.resultRow,
            backgroundColor: active ? '#1a1a40' : 'transparent',
            borderLeft: active ? '2px solid #6366f1' : '2px solid transparent',
          }}>
            <span style={styles.resultName}>{item.name}</span>
            {item.shortcut?.length ? (
              <div style={styles.shortcutContainer}>
                {item.shortcut.map((sc: string, i: number) => (
                  <kbd key={i} style={styles.kbd}>
                    {sc}
                  </kbd>
                ))}
              </div>
            ) : null}
          </div>
        );
      }}
    />
  );
}

// ── Palette overlay (rendered inside KBarProvider) ────────────────────────────

function CommandPaletteOverlay() {
  return (
    <KBarPortal>
      <KBarPositioner style={styles.positioner}>
        <KBarAnimator style={styles.animator}>
          <KBarSearch style={styles.search} placeholder="Type a command or search..." />
          <div style={styles.resultsList}>
            <RenderResults />
          </div>
          <div style={styles.footer}>
            <span style={styles.footerHint}>
              <kbd style={styles.kbdSmall}>↑↓</kbd> navigate
            </span>
            <span style={styles.footerHint}>
              <kbd style={styles.kbdSmall}>↵</kbd> select
            </span>
            <span style={styles.footerHint}>
              <kbd style={styles.kbdSmall}>esc</kbd> close
            </span>
          </div>
        </KBarAnimator>
      </KBarPositioner>
    </KBarPortal>
  );
}

// ── Provider wrapper ─────────────────────────────────────────────────────────

interface CommandPaletteProviderProps {
  children: React.ReactNode;
  actions: Action[];
}

export function CommandPaletteProvider({ children, actions }: CommandPaletteProviderProps) {
  return (
    <KBarProvider actions={actions} options={{
      animations: { enterMs: 200, exitMs: 100 },
      toggleShortcut: '$mod+k',
    }}>
      <CommandPaletteOverlay />
      {children}
    </KBarProvider>
  );
}

// ── Styles (inline objects for web) ──────────────────────────────────────────

const styles: Record<string, React.CSSProperties> = {
  positioner: {
    position: 'fixed',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    display: 'flex',
    alignItems: 'flex-start',
    justifyContent: 'center',
    paddingTop: '14vh',
    backgroundColor: 'rgba(0, 0, 0, 0.55)',
    zIndex: 9999,
  },
  animator: {
    maxWidth: 560,
    width: '100%',
    backgroundColor: '#0f0f18',
    border: '1px solid #2a2a3e',
    borderRadius: 16,
    boxShadow: '0 24px 80px rgba(0, 0, 0, 0.65), 0 0 1px rgba(99, 102, 241, 0.2)',
    overflow: 'hidden',
  },
  search: {
    width: '100%',
    padding: '14px 20px',
    fontSize: 15,
    fontFamily: 'monospace',
    color: '#f0f0f5',
    backgroundColor: '#0a0a12',
    border: 'none',
    borderBottom: '1px solid #1a1a28',
    outline: 'none',
    boxSizing: 'border-box' as const,
  },
  resultsList: {
    maxHeight: 360,
    overflowY: 'auto' as const,
    padding: '8px 0',
  },
  sectionHeader: {
    padding: '8px 20px 4px',
    fontSize: 10,
    fontFamily: 'monospace',
    fontWeight: 700,
    textTransform: 'uppercase' as const,
    letterSpacing: 2,
    color: '#6366f1',
  },
  resultRow: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '10px 20px',
    cursor: 'pointer',
    transition: 'background-color 0.1s ease',
  },
  resultName: {
    fontSize: 14,
    fontFamily: 'monospace',
    color: '#f0f0f5',
  },
  shortcutContainer: {
    display: 'flex',
    gap: 4,
  },
  kbd: {
    display: 'inline-block',
    padding: '2px 6px',
    fontSize: 11,
    fontFamily: 'monospace',
    fontWeight: 600,
    color: '#a0a0b8',
    backgroundColor: '#1a1a28',
    border: '1px solid #2a2a3e',
    borderRadius: 4,
    minWidth: 20,
    textAlign: 'center' as const,
  },
  footer: {
    display: 'flex',
    gap: 16,
    padding: '8px 20px',
    borderTop: '1px solid #1a1a28',
  },
  footerHint: {
    fontSize: 11,
    fontFamily: 'monospace',
    color: '#606078',
    display: 'flex',
    alignItems: 'center',
    gap: 4,
  },
  kbdSmall: {
    display: 'inline-block',
    padding: '1px 4px',
    fontSize: 10,
    fontFamily: 'monospace',
    color: '#808098',
    backgroundColor: '#14141e',
    border: '1px solid #2a2a3e',
    borderRadius: 3,
  },
};
