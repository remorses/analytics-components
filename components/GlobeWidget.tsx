import createGlobe, { Marker } from 'cobe'
import { useRef, useEffect, useMemo } from 'react'
import { useSpring } from 'react-spring'
import colors from 'tailwindcss/colors'
import { useAnalytics } from './Provider'
import Widget from './Widget'
import { colord } from 'colord'
import { countriesCoordinates } from '../lib/countries'
import { useParams } from 'next/navigation'
import { useDateFilter, useQuery } from '../lib/hooks'
import {
  TopLocation,
  TopLocationsData,
  TopLocationsSorting,
} from '../lib/types'
import { formatDateTimeForClickHouse, getPipeFromClient } from '../lib/utils'

type Color = [number, number, number]

function getColor(color: string): Color {
  const c = colord(color).toRgb()
  const nums: Color = [c.r / 255, c.g / 255, c.b / 255]
  //   console.log(nums)
  return nums
}

const countriesCodeToCoordinates = countriesCoordinates.reduce((acc, x) => {
  acc[x.country] = [x.latitude, x.longitude]
  return acc
}, {} as Record<string, [number, number]>)

// console.log(countriesCodeToCoordinates)

const locationToCoordinates = (code): [number, number] => {
  const arr = countriesCodeToCoordinates[code]
  if (!arr) {
    return [0, 0]
  }
  return arr
}

function getAngleFromLocation(arr: [number, number]) {
  const [long, lat] = arr
  return [
    Math.PI - ((long * Math.PI) / 180 - Math.PI / 2),
    (lat * Math.PI) / 180,
  ] as const
}

async function getTopLocations({}) {
  const { data: queryData, meta } = await getPipeFromClient<{
    visits: number
    location: string
  }>('current_locations', { limit: 100 })
//   console.log(queryData[0])
  const data = [...queryData]
    // .sort((a, b) => b[sorting] - a[sorting])
    .map(({ location: code, visits }) => {
      const location = locationToCoordinates(code)
      return {
        location,
        visits,
        // ...rest,
      }
    })

  //   const locations = data.map(({ location }) => location)
  //   const labels = data.map(record => record[sorting])

  return data
}

function mapVisitorsToMarkSize(visitors: number) {
  // max is 0.2
  // min i 0.04
  // grow like log so big values don't get too big
  const max = 0.2
  const min = 0.06
  const log = Math.log10(visitors)
  const size = log / 10
  return Math.max(min, Math.min(max, size))
}

export default function GlobeWidget() {
  const canvasRef = useRef<any>()

  const { data, warning, error } = useQuery(
    { key: 'current_locations' },
    getTopLocations
  )
  //   console.log({ data, warning, error })
  const allVisitors = useMemo(() => {
    if (!data) {
      return 0
    }
    return data.reduce((acc, x) => acc + x.visits, 0)
  }, [data])

  useEffect(() => {
    const mostVisitorsCountry = data?.[0]?.location
    if (!mostVisitorsCountry) {
      return
    }
    const [phi] = getAngleFromLocation(mostVisitorsCountry)
    api.start({
      r: phi,
    })
  }, [data])
  const pointerInteracting = useRef<number | null>(null)
  const pointerInteractionMovement = useRef(0)
  let { isDark } = useAnalytics()

  const glowColor: Color = isDark ? [0, 0, 0] : [1, 1, 1]
  const baseColor: Color = isDark
    ? getColor(colors.blue[300])
    : getColor(colors.blue[50])
  const markerColor: Color = isDark
    ? getColor(colors.red[400])
    : getColor(colors.blue[500])
  const [{ r }, api] = useSpring(() => ({
    r: 0,
    config: {
      mass: 1,
      tension: 280,
      friction: 40,
      precision: 0.001,
    },
  }))
  let dark = isDark ? 1 : 0

  const factor = 3
  useEffect(() => {
    let height = 0
    let width = 0
    const onResize = () => {
      if (canvasRef.current) {
        height = canvasRef.current.offsetHeight
        width = canvasRef.current.offsetWidth
      }
    }
    window.addEventListener('resize', onResize)
    onResize()
    const globe = createGlobe(canvasRef.current, {
      devicePixelRatio: 2,
      width: height * factor,
      height: height * factor,
      phi: 0,
      theta: 0.3,
      dark,
      diffuse: 1,
      mapSamples: 30000,
      mapBrightness: 2,
      baseColor,

      markerColor,
      offset: [-50, 2 * height],
      glowColor,

      // scale: 2,
      markers:
        data?.map(x => {
          const marker: Marker = {
            location: x.location,
            //   color: [1, 1, 1],
            size: mapVisitorsToMarkSize(x.visits),
          }
          return marker
        }) || [],
      onRender: state => {
        state.phi = r.get()
        if (!r.isAnimating) {
          r.set(r.get() + 0.0005)
        }

        state.width = height * factor
        state.height = height * factor
        // state.glowColor = glowColor
      },
    })
    setTimeout(() => (canvasRef.current.style.opacity = '1'))
    return () => {
      globe.destroy()
      window.removeEventListener('resize', onResize)
    }
  }, [isDark, data?.length])
  return (
    <Widget className=" pb-0">
      <div className="absolute p-8 inset-0 flex flex-col">
        <div className="self-end">
          <div className="text-2xl font-medium truncate capitalize">
            {allVisitors} Current Visitors
          </div>
        </div>
      </div>
      <canvas
        ref={canvasRef}
        onPointerDown={e => {
          pointerInteracting.current =
            e.clientX - pointerInteractionMovement.current
          canvasRef.current.style.cursor = 'grabbing'
        }}
        onPointerUp={() => {
          pointerInteracting.current = null
          canvasRef.current.style.cursor = 'grab'
        }}
        onPointerOut={() => {
          pointerInteracting.current = null
          canvasRef.current.style.cursor = 'grab'
        }}
        onMouseMove={e => {
          if (pointerInteracting.current !== null) {
            const delta = e.clientX - pointerInteracting.current
            pointerInteractionMovement.current = delta
            api.start({
              r: delta / 200,
            })
          }
        }}
        onTouchMove={e => {
          if (pointerInteracting.current !== null && e.touches[0]) {
            const delta = e.touches[0].clientX - pointerInteracting.current
            pointerInteractionMovement.current = delta
            api.start({
              r: delta / 100,
            })
          }
        }}
        className="flex flex-col grow"
        style={{
          width: '50%',
          // height: '100%',
          cursor: 'grab',
          contain: 'layout paint size',
          opacity: 0,
          transition: 'opacity 1s ease',
        }}
      />
    </Widget>
  )
}
