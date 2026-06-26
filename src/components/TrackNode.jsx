import { memo } from 'react'

const SIZE = 48

function TrackNode({ data }) {
  const { albumArtUrl, artist, name } = data

  return (
    <div
      title={`${artist} – ${name}`}
      style={{
        width: SIZE,
        height: SIZE,
        borderRadius: '50%',
        border: '2px solid rgba(255,255,255,0.55)',
        overflow: 'hidden',
        boxShadow: '0 0 20px rgba(255,255,255,0.12), 0 0 40px rgba(255,255,255,0.06)',
        flexShrink: 0,
        cursor: 'default',
        userSelect: 'none',
      }}
    >
      {albumArtUrl ? (
        <img
          src={albumArtUrl}
          alt={`${name} – ${artist}`}
          style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
          draggable={false}
        />
      ) : (
        <div
          style={{
            width: '100%',
            height: '100%',
            background: 'rgba(255,255,255,0.08)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 18,
            color: 'rgba(255,255,255,0.3)',
          }}
        >
          ♪
        </div>
      )}
    </div>
  )
}

export default memo(TrackNode)
