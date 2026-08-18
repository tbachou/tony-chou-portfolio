// Decorative topographic contour lines — Beta's background art (spec 0004
// design identity). Nested irregular blobs like a crag's summit knoll on a
// trail map. Purely decorative: aria-hidden, pointer-events-none, and the
// parent is expected to be position:relative with overflow hidden.
export function TopoBackground({ className }: { className?: string }) {
  return (
    <div
      aria-hidden="true"
      className={`pointer-events-none absolute select-none ${className ?? ''}`}
    >
      <svg
        viewBox="0 0 640 640"
        width="640"
        height="640"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        style={{ opacity: 0.6 }}
      >
        <path
          d="M320 40c118 8 224 62 254 158 29 92-14 200-92 258-80 60-204 66-292 14C96 415 44 314 68 216 93 114 204 32 320 40Z"
          stroke="var(--beta-border)"
          strokeWidth="1.5"
        />
        <path
          d="M318 104c92 6 172 50 196 124 23 72-12 156-74 200-63 46-159 52-227 12-73-42-112-121-93-197C140 164 227 98 318 104Z"
          stroke="var(--beta-border)"
          strokeWidth="1.5"
        />
        <path
          d="M316 170c66 4 122 36 140 89 17 51-10 111-54 143-46 33-114 37-163 8-52-30-79-86-66-140 14-56 77-104 143-100Z"
          stroke="var(--beta-border)"
          strokeWidth="1.5"
        />
        <path
          d="M314 238c39 2 72 21 82 52 10 30-7 65-33 84-27 19-67 22-96 5-30-18-46-51-38-82 8-34 46-61 85-59Z"
          stroke="var(--beta-border)"
          strokeWidth="1.5"
        />
      </svg>
    </div>
  );
}
