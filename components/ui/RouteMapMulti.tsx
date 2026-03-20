'use client'

import { useEffect, useRef } from 'react'

export interface MapRoute {
  id: string
  name: string
  color: string
  stops: {
    sequence: number
    lat: number
    lng: number
    customer: string
    postcode: string
    weight: number
  }[]
}

interface RouteMapMultiProps {
  routes: MapRoute[]
}

export function RouteMapMulti({ routes }: RouteMapMultiProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<unknown>(null)

  useEffect(() => {
    if (!containerRef.current) return

    // Inject Leaflet CSS once
    if (!document.getElementById('leaflet-css')) {
      const link = document.createElement('link')
      link.id = 'leaflet-css'
      link.rel = 'stylesheet'
      link.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css'
      document.head.appendChild(link)
    }

    if (mapRef.current) {
      ;(mapRef.current as { remove(): void }).remove()
      mapRef.current = null
    }

    import('leaflet').then((L) => {
      if (!containerRef.current) return

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      delete (L.Icon.Default.prototype as any)._getIconUrl
      L.Icon.Default.mergeOptions({
        iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
        iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
        shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
      })

      const map = L.map(containerRef.current).setView([52.5, -1.5], 7)
      mapRef.current = map

      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
        maxZoom: 19,
      }).addTo(map)

      const allLatLngs: [number, number][] = []

      for (const route of routes) {
        const geocodedStops = route.stops.filter((s) => s.lat && s.lng)
        if (geocodedStops.length === 0) continue

        const latlngs: [number, number][] = geocodedStops.map((s) => [s.lat, s.lng])
        allLatLngs.push(...latlngs)

        // Route polyline
        L.polyline(latlngs, {
          color: route.color,
          weight: 4,
          opacity: 0.8,
        }).addTo(map)

        // Numbered markers for each stop
        geocodedStops.forEach((stop) => {
          const icon = L.divIcon({
            className: '',
            html: `<div style="background:${route.color};color:white;border-radius:50%;width:26px;height:26px;display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:700;border:2px solid white;box-shadow:0 2px 6px rgba(0,0,0,0.4);line-height:1">${stop.sequence}</div>`,
            iconSize: [26, 26],
            iconAnchor: [13, 13],
            popupAnchor: [0, -14],
          })

          L.marker([stop.lat, stop.lng], { icon })
            .addTo(map)
            .bindPopup(
              `<div style="font-family:sans-serif;min-width:160px">
                <div style="font-weight:700;margin-bottom:4px;color:${route.color}">${route.name}</div>
                <div style="font-weight:600">Stop ${stop.sequence}: ${stop.customer}</div>
                <div style="color:#666;font-size:12px">${stop.postcode} · ${stop.weight} kg</div>
              </div>`
            )
        })
      }

      // Fit all routes in view
      if (allLatLngs.length > 0) {
        map.fitBounds(L.latLngBounds(allLatLngs), { padding: [40, 40] })
      }
    })

    return () => {
      if (mapRef.current) {
        ;(mapRef.current as { remove(): void }).remove()
        mapRef.current = null
      }
    }
  }, [routes])

  return <div ref={containerRef} style={{ height: '100%', width: '100%' }} />
}
