import { useState } from 'react'
import { useTheme } from '../hooks/useTheme'
import ReactDiffViewer, { DiffMethod } from 'react-diff-viewer-continued'

const RED = 'rgba(209,54,58,'
const GREEN = 'rgba(98,180,138,'

const styles = {
  variables: {
    dark: {
      diffViewerBackground: '#0A0A0A',
      diffViewerColor: '#E7E6E3',
      addedBackground: GREEN + '0.12)',
      addedColor: '#E7E6E3',
      removedBackground: RED + '0.14)',
      removedColor: '#E7E6E3',
      wordAddedBackground: GREEN + '0.35)',
      wordRemovedBackground: RED + '0.4)',
      addedGutterBackground: GREEN + '0.18)',
      removedGutterBackground: RED + '0.2)',
      gutterBackground: '#161615',
      gutterBackgroundDark: '#161615',
      gutterColor: '#ADACAA',
      emptyLineBackground: '#121211',
      codeFoldBackground: '#161615',
      codeFoldGutterBackground: '#161615',
      codeFoldContentColor: '#ADACAA',
      diffViewerTitleBackground: '#161615',
      diffViewerTitleColor: '#E7E6E3',
      diffViewerTitleBorderColor: '#2B2A29',
    },
    light: {
      diffViewerBackground: '#FFFFFF',
      diffViewerColor: '#2B2A29',
      addedBackground: 'rgba(46,125,87,0.10)',
      addedColor: '#2B2A29',
      removedBackground: RED + '0.10)',
      removedColor: '#2B2A29',
      wordAddedBackground: 'rgba(46,125,87,0.28)',
      wordRemovedBackground: RED + '0.28)',
      addedGutterBackground: 'rgba(46,125,87,0.14)',
      removedGutterBackground: RED + '0.14)',
      gutterBackground: '#F4F3F1',
      gutterBackgroundDark: '#F4F3F1',
      gutterColor: '#656462',
      emptyLineBackground: '#FAFAF9',
      codeFoldBackground: '#F4F3F1',
      codeFoldGutterBackground: '#F4F3F1',
      codeFoldContentColor: '#656462',
      diffViewerTitleBackground: '#F4F3F1',
      diffViewerTitleColor: '#2B2A29',
      diffViewerTitleBorderColor: '#DBD9D6',
    },
  },
  contentText: { fontFamily: 'JetBrains Mono, ui-monospace, monospace', fontSize: '12px', lineHeight: '1.6' },
  line: { wordBreak: 'break-word' },
}

/** Side-by-side or unified diff (diff rows use +/− markers, not color alone). */
export default function DiffView({ oldValue, newValue, leftTitle, rightTitle, method = 'words' }) {
  const [split, setSplit] = useState(true)
  const [theme] = useTheme()
  return (
    <div className="overflow-hidden rounded-lg border border-border">
      <div className="flex items-center justify-end gap-1 border-b border-border bg-surface px-2 py-1.5" role="group" aria-label="Diff layout">
        {[
          [true, 'Side by side'],
          [false, 'Unified'],
        ].map(([v, l]) => (
          <button
            key={l}
            type="button"
            aria-pressed={split === v}
            onClick={() => setSplit(v)}
            className={`rounded px-2 py-1 font-mono text-[11px] ${split === v ? 'bg-surface-2 text-text' : 'text-muted hover:text-text'}`}
          >
            {l}
          </button>
        ))}
      </div>
      <div className="max-h-[32rem] overflow-auto">
        <ReactDiffViewer
          oldValue={oldValue}
          newValue={newValue}
          splitView={split}
          useDarkTheme={theme === 'dark'}
          styles={styles}
          leftTitle={leftTitle}
          rightTitle={rightTitle}
          compareMethod={method === 'lines' ? DiffMethod.LINES : DiffMethod.WORDS}
          extraLinesSurroundingDiff={3}
          disableWorker
        />
      </div>
    </div>
  )
}
