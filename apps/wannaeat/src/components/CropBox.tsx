import { useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent } from 'react'
import type { CropArea } from '../lib/extract.ts'

/** 사진 위에서 원재료명 영역만 끌어서 고른다. 고르지 않으면 사진 전체를 보낸다. */
export default function CropBox({ src, area, onChange, onError }: {
  src: string
  area: CropArea | null
  onChange: (area: CropArea | null) => void
  onError: () => void
}) {
  const frame = useRef<HTMLDivElement>(null)
  const start = useRef<{ x: number; y: number } | null>(null)
  const [dragging, setDragging] = useState(false)

  function point(event: ReactPointerEvent) {
    const box = frame.current!.getBoundingClientRect()
    return {
      x: Math.min(1, Math.max(0, (event.clientX - box.left) / box.width)),
      y: Math.min(1, Math.max(0, (event.clientY - box.top) / box.height)),
    }
  }

  function down(event: ReactPointerEvent) {
    event.currentTarget.setPointerCapture(event.pointerId)
    start.current = point(event)
    setDragging(true)
    onChange(null)
  }

  function move(event: ReactPointerEvent) {
    if (!start.current) return
    const now = point(event)
    onChange({
      x: Math.min(start.current.x, now.x), y: Math.min(start.current.y, now.y),
      width: Math.abs(now.x - start.current.x), height: Math.abs(now.y - start.current.y),
    })
  }

  function up() {
    start.current = null
    setDragging(false)
    // 손가락이 스친 정도는 영역으로 보지 않는다.
    if (area && (area.width < 0.05 || area.height < 0.05)) onChange(null)
  }

  const style = area ? { left: `${area.x * 100}%`, top: `${area.y * 100}%`, width: `${area.width * 100}%`, height: `${area.height * 100}%` } : undefined
  return <div className="crop-frame" ref={frame} onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up}>
    <img src={src} alt="선택한 원재료 표시" draggable={false} onError={onError} />
    {area && <div className="crop-area" style={style} />}
    {!area && !dragging && <span className="crop-hint">원재료명 부분을 손가락으로 끌어 선택하면 그 부분만 보내요</span>}
  </div>
}
