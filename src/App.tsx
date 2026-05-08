import React, { useState, useRef, useEffect, useCallback } from 'react';
import html2canvas from 'html2canvas';
import jsPDF from 'jspdf';
import Moveable from 'react-moveable';
import './App.css';

// ─── Types ────────────────────────────────────────────────────────────────────
interface ImageItem {
  id: string;
  src: string;
  aspectRatio: number;
  // Rendered position/size (CSS values)
  x: number;
  y: number;
  w: number;
  h: number;
  // Lock: once the user manually resizes, the pixel size is frozen
  locked: boolean;
  lockedW: number; // only meaningful when locked=true
  lockedH: number;
}

// ─── Layout Engine ────────────────────────────────────────────────────────────
/**
 * Computes positions for all images to fill the A4 canvas.
 *
 * Rules:
 *  - Images are arranged in rows. Every image in a row shares the same height.
 *  - Row heights sum to exactly a4H (the canvas is fully filled).
 *  - Locked images keep their exact pixel width and height.
 *  - Unlocked images scale to fill remaining row width and available height.
 *  - No cropping — images are fully visible (object-fit: contain inside their slot).
 */
function layout(items: ImageItem[], a4W: number, a4H: number, gap: number = 8): ImageItem[] {
  if (items.length === 0) return items;

  // ── Step 1: determine rows ─────────────────────────────────────────────────
  // We use a greedy partition: put images in a row until the effective aspect
  // sum is close to the A4 aspect ratio, then start a new row.
  // Locked images keep their aspect ratio (lockedW/lockedH).
  const effAR = (it: ImageItem) =>
    it.locked ? it.lockedW / it.lockedH : it.aspectRatio;

  const a4AR = a4W / a4H;

  // Brute-force optimal partition (for ≤12 images); greedy otherwise
  let bestPartition: ImageItem[][] = [];
  let bestScore = Infinity;

  const rowNaturalHeight = (row: ImageItem[]) => {
    const availableW = Math.max(0, a4W - gap * (row.length - 1));
    return availableW / row.reduce((s, it) => s + effAR(it), 0);
  };

  const totalNaturalHeight = (partition: ImageItem[][]) => {
    const sum = partition.reduce((s, row) => s + rowNaturalHeight(row), 0);
    return sum + gap * (partition.length - 1);
  };

  const scorePartition = (partition: ImageItem[][]) => {
    const h = totalNaturalHeight(partition);
    // Penalise deviations from A4 aspect AND rows that violate locked heights
    let penalty = Math.abs(a4H - h) / a4H;
    for (const row of partition) {
      for (const it of row) {
        if (it.locked) {
          // locked image should end up at its locked height
          const rowH = rowNaturalHeight(row);
          penalty += Math.abs(rowH - it.lockedH) / a4H;
        }
      }
    }
    return penalty;
  };

  const findPartitions = (idx: number, cur: ImageItem[][]) => {
    if (idx === items.length) {
      const s = scorePartition(cur);
      if (s < bestScore) {
        bestScore = s;
        bestPartition = cur.map(r => [...r]);
      }
      return;
    }
    if (cur.length > 0) {
      cur[cur.length - 1].push(items[idx]);
      findPartitions(idx + 1, cur);
      cur[cur.length - 1].pop();
    }
    cur.push([items[idx]]);
    findPartitions(idx + 1, cur);
    cur.pop();
  };

  if (items.length <= 10) {
    findPartitions(0, []);
  } else {
    // Greedy: fill row until aspect sum >= target
    const target = a4AR * 0.9;
    let row: ImageItem[] = [];
    let sum = 0;
    for (const it of items) {
      row.push(it);
      sum += effAR(it);
      if (sum >= target) { bestPartition.push([...row]); row = []; sum = 0; }
    }
    if (row.length) bestPartition.push(row);
  }

  // ── Step 2: compute row heights ────────────────────────────────────────────
  // For rows containing locked images: row height = average locked height in row.
  // For free rows: height is computed proportionally after reserved space is known.

  const rowMeta = bestPartition.map(row => {
    const lockedInRow = row.filter(it => it.locked);
    if (lockedInRow.length > 0) {
      // Use the locked image's height (if multiple, use their average)
      const rowH = lockedInRow.reduce((s, it) => s + it.lockedH, 0) / lockedInRow.length;
      return { row, rowH, hasLocked: true };
    }
    return { row, rowH: 0, hasLocked: false };
  });

  const reservedH = rowMeta
    .filter(m => m.hasLocked)
    .reduce((s, m) => s + m.rowH, 0);

  const totalGapsH = gap * Math.max(0, rowMeta.length - 1);
  const freeRows = rowMeta.filter(m => !m.hasLocked);
  const freeH = Math.max(0, a4H - reservedH - totalGapsH);

  // Distribute free height proportionally (by natural height of each free row)
  const freeNaturalTotal = freeRows.reduce(
    (s, m) => s + rowNaturalHeight(m.row), 0
  );

  freeRows.forEach(m => {
    if (freeNaturalTotal > 0) {
      m.rowH = (rowNaturalHeight(m.row) / freeNaturalTotal) * freeH;
    } else {
      m.rowH = freeH / freeRows.length;
    }
  });

  // ── Step 3: assign pixel positions ────────────────────────────────────────
  const result = items.map(it => ({ ...it }));
  let y = 0;

  for (const { row, rowH } of rowMeta) {
    // For each image in row: width = rowH * aspect (aspect ratio preserved)
    // Then scale the UNLOCKED images horizontally so the row fills a4W exactly.

    const lockedWidthSum = row
      .filter(it => it.locked)
      .reduce((s, it) => s + it.lockedW, 0);

    const unlocked = row.filter(it => !it.locked);
    const unlockedNaturalW = unlocked.reduce((s, it) => s + rowH * it.aspectRatio, 0);
    const totalGapsW = gap * Math.max(0, row.length - 1);
    const remainingW = a4W - lockedWidthSum - totalGapsW;

    // Scale factor for unlocked images to fill remaining row width
    const scale = unlockedNaturalW > 0 ? remainingW / unlockedNaturalW : 1;

    let x = 0;
    for (const it of row) {
      const idx = result.findIndex(r => r.id === it.id);
      if (it.locked) {
        result[idx] = { ...result[idx], x, y, w: it.lockedW, h: rowH };
        x += it.lockedW + gap;
      } else {
        const w = rowH * it.aspectRatio * scale;
        result[idx] = { ...result[idx], x, y, w, h: rowH };
        x += w + gap;
      }
    }
    y += rowH + gap;
  }

  return result;
}

// ─── App ──────────────────────────────────────────────────────────────────────
const PhotoLayoutApp: React.FC = () => {
  const [images, setImages] = useState<ImageItem[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const a4Ref = useRef<HTMLDivElement>(null);
  const [target, setTarget] = useState<HTMLElement | null>(null);
  const [isExporting, setIsExporting] = useState<'pdf' | 'img' | null>(null);
  const [statusMsg, setStatusMsg] = useState('Ready — upload images to get started');
  const [lockedCount, setLockedCount] = useState(0);

  const flash = (msg: string) => setStatusMsg(msg);

  // Sync Moveable target whenever selection changes
  useEffect(() => {
    setTarget(selectedId ? document.getElementById(selectedId) : null);
  }, [selectedId, images]);

  // ── Core arrange helper ────────────────────────────────────────────────────
  const arrange = useCallback((imgs: ImageItem[]): ImageItem[] => {
    if (!a4Ref.current || imgs.length === 0) return imgs;
    return layout(imgs, a4Ref.current.clientWidth, a4Ref.current.clientHeight);
  }, []);

  // ── Upload ─────────────────────────────────────────────────────────────────
  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files) return;
    const files = Array.from(e.target.files);

    const loaded = await Promise.all(
      files.map((file, i) =>
        new Promise<ImageItem>(resolve => {
          const img = new Image();
          const src = URL.createObjectURL(file);
          img.onload = () => resolve({
            id: `img-${Date.now()}-${i}`,
            src,
            aspectRatio: img.naturalWidth / img.naturalHeight,
            x: 0, y: 0, w: 120, h: 90,
            locked: false, lockedW: 0, lockedH: 0,
          });
          img.src = src;
        })
      )
    );

    setImages(prev => {
      const merged = [...prev, ...loaded];
      return arrange(merged);
    });
    setLockedCount(0);
    flash(`✓ ${loaded.length} image${loaded.length > 1 ? 's' : ''} added & arranged`);
    e.target.value = '';
  };

  // ── Delete key ─────────────────────────────────────────────────────────────
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.key === 'Delete' || e.key === 'Backspace') && selectedId) {
        setImages(prev => {
          const next = prev.filter(it => it.id !== selectedId);
          const arranged = arrange(next);
          setLockedCount(arranged.filter(it => it.locked).length);
          return arranged;
        });
        setSelectedId(null);
        flash('Image deleted — layout updated');
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selectedId, arrange]);

  // ── Canvas click deselect ──────────────────────────────────────────────────
  const handleCanvasClick = (e: React.MouseEvent) => {
    if (e.target === a4Ref.current) setSelectedId(null);
  };

  // ── Manual arrange button ──────────────────────────────────────────────────
  const autoArrange = useCallback(() => {
    setImages(prev => {
      // Reset all locks when manually re-arranging
      const reset = prev.map(it => ({ ...it, locked: false, lockedW: 0, lockedH: 0 }));
      return arrange(reset);
    });
    setLockedCount(0);
    flash('✓ Re-arranged — all size locks cleared');
  }, [arrange]);

  // ── Unlock selected image ──────────────────────────────────────────────────
  const unlockSelected = useCallback(() => {
    if (!selectedId) return;
    setImages(prev => {
      const next = prev.map(it =>
        it.id === selectedId ? { ...it, locked: false, lockedW: 0, lockedH: 0 } : it
      );
      const arranged = arrange(next);
      setLockedCount(arranged.filter(it => it.locked).length);
      return arranged;
    });
    flash('🔓 Image unlocked — reflowed');
  }, [selectedId, arrange]);

  // ── On resize end: lock size + reflow unlocked ────────────────────────────
  const handleResizeEnd = useCallback((el: HTMLElement) => {
    const newW = parseFloat(el.style.width);
    const newH = parseFloat(el.style.height);
    if (!newW || !newH) return;

    setImages(prev => {
      const withLock = prev.map(it =>
        it.id === el.id
          ? { ...it, locked: true, lockedW: newW, lockedH: newH, w: newW, h: newH }
          : it
      );
      const arranged = arrange(withLock);
      setLockedCount(arranged.filter(it => it.locked).length);
      return arranged;
    });
    // sync element left/top after reflow (Moveable may have residual transform)
    el.style.transform = 'none';
    flash('🔒 Size locked — other images reflowed');
  }, [arrange]);

  // ── Drag end: read left/top directly ─────────────────────────────────────
  const handleDragEnd = useCallback((el: HTMLElement) => {
    const nx = parseFloat(el.style.left);
    const ny = parseFloat(el.style.top);
    setImages(prev =>
      prev.map(it => it.id === el.id ? { ...it, x: nx, y: ny } : it)
    );
  }, []);

  // ── Delete selected ────────────────────────────────────────────────────────
  const deleteSelected = () => {
    if (!selectedId) return;
    setImages(prev => {
      const next = prev.filter(it => it.id !== selectedId);
      const arranged = arrange(next);
      setLockedCount(arranged.filter(it => it.locked).length);
      return arranged;
    });
    setSelectedId(null);
    flash('Image deleted — layout updated');
  };

  const clearAll = () => {
    setImages([]);
    setSelectedId(null);
    setLockedCount(0);
    flash('Canvas cleared');
  };

  // ── Export PDF ─────────────────────────────────────────────────────────────
  const downloadAsPDF = async () => {
    setSelectedId(null);
    setIsExporting('pdf');
    flash('Generating PDF…');
    await new Promise(r => setTimeout(r, 150));
    const el = a4Ref.current;
    if (!el) return;
    const canvas = await html2canvas(el, { scale: 2, useCORS: true });
    const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
    pdf.addImage(canvas.toDataURL('image/png'), 'PNG', 0, 0,
      pdf.internal.pageSize.getWidth(), pdf.internal.pageSize.getHeight());
    pdf.save('a4-layout.pdf');
    setIsExporting(null);
    flash('✓ PDF saved');
  };

  // ── Export Image ───────────────────────────────────────────────────────────
  const downloadAsImage = async () => {
    setSelectedId(null);
    setIsExporting('img');
    flash('Generating image…');
    await new Promise(r => setTimeout(r, 150));
    const el = a4Ref.current;
    if (!el) return;
    const canvas = await html2canvas(el, { scale: 2, useCORS: true });
    const link = document.createElement('a');
    link.href = canvas.toDataURL('image/png');
    link.download = 'a4-layout.png';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    setIsExporting(null);
    flash('✓ Image saved');
  };

  const selectedItem = images.find(it => it.id === selectedId);

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="app-shell">

      {/* Header */}
      <header className="app-header">
        <div className="header-brand">
          <div className="brand-icon">📄</div>
          <div>
            <span className="brand-name">A4 Sizer</span>
            <span className="brand-tag">Photo Layout Studio</span>
          </div>
        </div>
        <div className="header-meta">
          <div className="image-counter">
            <span className="count">{images.length}</span>
            <span>image{images.length !== 1 ? 's' : ''}</span>
          </div>
          {lockedCount > 0 && (
            <div className="live-badge">
              <span className="live-dot" />
              {lockedCount} locked
            </div>
          )}
          <div className="hint-chip">
            <span className="kbd">Del</span>
            <span>remove selected</span>
          </div>
        </div>
      </header>

      {/* Sidebar */}
      <aside className="app-sidebar">

        <div className="sidebar-section">
          <span className="section-label">Upload</span>
          <label className="upload-zone">
            <input type="file" multiple accept="image/*"
              onChange={handleImageUpload} className="upload-input" />
            <span className="upload-icon">🖼️</span>
            <p className="upload-text-primary">Drop images here</p>
            <p className="upload-text-secondary">or click to browse</p>
          </label>
        </div>

        <div className="sidebar-divider" />

        <div className="sidebar-section">
          <span className="section-label">Arrange</span>
          <button className="sidebar-btn btn-auto" onClick={autoArrange}
            disabled={images.length === 0}>
            <span className="btn-icon">✨</span>
            <span className="btn-text">Re-Arrange All</span>
          </button>
          {selectedItem?.locked && (
            <button className="sidebar-btn btn-reset" onClick={unlockSelected}>
              <span className="btn-icon">🔓</span>
              <span className="btn-text">Unlock Selected</span>
            </button>
          )}
        </div>

        <div className="sidebar-divider" />

        <div className="sidebar-section">
          <span className="section-label">Export</span>
          <button
            className={`sidebar-btn btn-pdf${isExporting === 'pdf' ? ' loading-btn' : ''}`}
            onClick={downloadAsPDF}
            disabled={images.length === 0 || isExporting !== null}>
            <span className="btn-icon">{isExporting === 'pdf' ? '⏳' : '📑'}</span>
            <span className="btn-text">Download PDF</span>
            <span className="btn-shortcut">A4</span>
          </button>
          <button
            className={`sidebar-btn btn-img${isExporting === 'img' ? ' loading-btn' : ''}`}
            onClick={downloadAsImage}
            disabled={images.length === 0 || isExporting !== null}>
            <span className="btn-icon">{isExporting === 'img' ? '⏳' : '🖼'}</span>
            <span className="btn-text">Download Image</span>
            <span className="btn-shortcut">PNG</span>
          </button>
        </div>

        <div className="sidebar-divider" />

        <div className="sidebar-section">
          <span className="section-label">Edit</span>
          {selectedId && (
            <button className="sidebar-btn btn-delete-sel" onClick={deleteSelected}>
              <span className="btn-icon">🗑</span>
              <span className="btn-text">Delete Selected</span>
            </button>
          )}
          <button className="sidebar-btn btn-clear" onClick={clearAll}
            disabled={images.length === 0}>
            <span className="btn-icon">🧹</span>
            <span className="btn-text">Clear All</span>
          </button>
        </div>

        <div className="sidebar-divider" />

        <div className="tips-card">
          <p className="tips-title">💡 How it works</p>
          <ul className="tips-list">
            <li>Upload images — they auto-arrange to fill A4</li>
            <li>Resize any image — its size locks 🔒, others reflow</li>
            <li>Resize more images — all locked ones stay fixed</li>
            <li>Click <strong>Re-Arrange All</strong> to reset locks</li>
            <li>Select a locked image to unlock it individually</li>
          </ul>
        </div>

      </aside>

      {/* Canvas */}
      <main className="app-main">
        <div className="canvas-label">
          <div className="canvas-label-line" />
          <span className="canvas-label-text">A4 CANVAS</span>
          <div className="canvas-label-line" />
          <span className="canvas-label-badge">210 × 297 mm</span>
        </div>

        <div className="a4-page" ref={a4Ref} onClick={handleCanvasClick}>

          {images.length === 0 && (
            <div className="empty-state">
              <span className="empty-icon">📷</span>
              <p className="empty-text">Your canvas is empty</p>
              <p className="empty-sub">Upload images — they fill A4 automatically</p>
            </div>
          )}

          {images.map(img => (
            <div
              key={img.id}
              id={img.id}
              className={`photo-slot${selectedId === img.id ? ' selected' : ''}${img.locked ? ' locked' : ''}`}
              onClick={e => { e.stopPropagation(); setSelectedId(img.id); }}
              style={{
                position: 'absolute',
                left: `${img.x}px`,
                top: `${img.y}px`,
                width: `${img.w}px`,
                height: `${img.h}px`,
                transform: 'none',   /* always use left/top — no transform */
                zIndex: selectedId === img.id ? 10 : 1,
              }}
            >
              <img
                src={img.src}
                alt="Uploaded"
                style={{ width: '100%', height: '100%', objectFit: 'contain', display: 'block' }}
                draggable={false}
              />
              {img.locked && (
                <span className="lock-badge">🔒</span>
              )}
            </div>
          ))}

          {target && (
            <Moveable
              target={target}
              draggable
              resizable
              keepRatio={true}
              snappable
              snapContainer={a4Ref.current}
              /* Use left/top positioning — no CSS transform */
              onDrag={e => {
                (e.target as HTMLElement).style.left = `${e.left}px`;
                (e.target as HTMLElement).style.top  = `${e.top}px`;
              }}
              onResize={e => {
                const el = e.target as HTMLElement;
                el.style.width  = `${e.width}px`;
                el.style.height = `${e.height}px`;
                el.style.left   = `${e.drag.left}px`;
                el.style.top    = `${e.drag.top}px`;
              }}
              onDragEnd={e => handleDragEnd(e.target as HTMLElement)}
              onResizeEnd={e => handleResizeEnd(e.target as HTMLElement)}
            />
          )}
        </div>

        <div className="status-bar">
          <span className="status-dot" />
          <span>{statusMsg}</span>
        </div>
      </main>
    </div>
  );
};

export default PhotoLayoutApp;