'use client'

import { useEffect, useRef } from 'react'

interface MapStop {
  lat: number
  lng: number
  sequence: number
  customer: string
  postcode: string
}

interface RouteMapProps {
  stops: MapStop[]
}

export function RouteMap({ stops }: RouteMapProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<unknown>(null)

  useEffect(() => {
    if (!containerRef.current || stops.length === 0) return

    // Inject Leaflet CSS once
    if (!document.getElementById('leaflet-css')) {
      const link = document.createElement('link')
      link.id = 'leaflet-css'
      link.rel = 'stylesheet'
      link.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css'
      document.head.appendChild(link)
    }

    // Destroy any previous instance
    if (mapRef.current) {
      ;(mapRef.current as { remove(): void }).remove()
      mapRef.current = null
    }

    import('leaflet').then((L) => {
      if (!containerRef.current) return

      // Fix Leaflet default icon paths (broken by bundlers)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      delete (L.Icon.Default.prototype as any)._getIconUrl
      L.Icon.Default.mergeOptions({
        iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
        iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
        shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
      })

      const map = L.map(containerRef.current).setView([stops[0].lat, stops[0].lng], 10)
      mapRef.current = map

      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
        maxZoom: 19,
      }).addTo(map)

      // Numbered circle markers
      stops.forEach((stop) => {
        const icon = L.divIcon({
          className: '',
          html: `<div style="background:#0284c7;color:white;border-radius:50%;width:26px;height:26px;display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:700;border:2px solid white;box-shadow:0 2px 6px rgba(0,0,0,0.35);line-height:1">${stop.sequence}</div>`,
          iconSize: [26, 26],
          iconAnchor: [13, 13],
          popupAnchor: [0, -14],
        })

        L.marker([stop.lat, stop.lng], { icon })
          .addTo(map)
          .bindPopup(
            `<div style="font-family:sans-serif;min-width:140px"><strong>Stop ${stop.sequence}</strong><br/>${stop.customer}<br/><span style="color:#666;font-size:12px">${stop.postcode}</span></div>`
          )
      })

      // Route polyline
      const latlngs: [number, number][] = stops.map((s) => [s.lat, s.lng])
      L.polyline(latlngs, { color: '#0284c7', weight: 3, opacity: 0.75, dashArray: undefined }).addTo(map)

      // Fit all stops in view
      map.fitBounds(L.latLngBounds(latlngs), { padding: [32, 32] })
    })

    return () => {
      if (mapRef.current) {
        ;(mapRef.current as { remove(): void }).remove()
        mapRef.current = null
      }
    }
  }, [stops])

  return <div ref={containerRef} className="w-full h-80" />
}
