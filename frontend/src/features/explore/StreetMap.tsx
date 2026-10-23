import { useEffect, useRef, useState } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { Rabbit } from "./Rabbit";
import { moods, won } from "./types";
import type { Home } from "./types";

// Neighborhood reference points only; these are not property addresses.
const neighborhoods: Record<string, L.LatLngTuple> = {
  망원: [37.556, 126.901], 합정: [37.55, 126.913], 연남: [37.565, 126.923],
  공덕: [37.544, 126.951], 신길: [37.511, 126.921], 당산: [37.534, 126.902],
  봉천: [37.482, 126.941], 사당: [37.477, 126.982], 왕십리: [37.562, 127.037],
  성수: [37.545, 127.056], 잠실: [37.514, 127.101], 신림: [37.484, 126.929],
};
const offices: Record<string, L.LatLngTuple> = {
  강남역: [37.498, 127.028], 서울역: [37.555, 126.97], 여의도역: [37.521, 126.924],
};
const overview = L.latLngBounds(Object.values(neighborhoods));
export function StreetMap({ homes, office, selected, ready, onSelect }: {
  homes: Home[]; office: string | null; selected: string | null;
  ready: boolean; onSelect: (id: string) => void;
}) {
  const container = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const [projection, setProjection] = useState<{ project: (point: L.LatLngTuple) => L.Point; zoom: number } | null>(null);
  const [tileError, setTileError] = useState(false);
  useEffect(() => {
    if (!container.current) return;
    const instance = L.map(container.current, {
      zoomControl: false, attributionControl: false, minZoom: 10, maxZoom: 19,
      scrollWheelZoom: true,
    });
    map.current = instance;
    L.control.attribution({ position: "bottomleft", prefix: false }).addTo(instance);
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19, attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a> contributors',
      updateWhenIdle: true, keepBuffer: 1,
    }).on("tileerror", () => setTileError(true)).addTo(instance);
    const refresh = () => {
      // Capture this view's projection so React markers follow map pan and zoom.
      const origin = instance.getPixelOrigin();
      const pane = L.DomUtil.getPosition(instance.getPane("mapPane")!);
      const zoom = instance.getZoom();
      setProjection({ zoom, project: point => instance.project(point, zoom).subtract(origin).add(pane) });
    };
    instance.on("move zoom viewreset", refresh);
    instance.setView([37.53, 126.97], 13);
    refresh();
    const observer = new ResizeObserver(() => { instance.invalidateSize(); refresh(); });
    observer.observe(container.current);
    return () => { observer.disconnect(); instance.remove(); map.current = null; };
  }, []);
  useEffect(() => {
    const instance = map.current;
    const home = homes.find(h => h.id === selected);
    const point = home && neighborhoods[home.area];
    if (!instance || !point) return;
    if (instance.getZoom() < 14) instance.setZoom(14, { animate: false });
    const size = instance.getSize();
    const detailWidth = window.innerWidth > 1050 ? 360 : window.innerWidth > 760 ? 320 : 0;
    const target = instance.latLngToContainerPoint(point);
    instance.panBy([target.x - (size.x - detailWidth) / 2, target.y - size.y / 2], {
      animate: !window.matchMedia("(prefers-reduced-motion: reduce)").matches,
    });
  }, [selected, homes]);
  function reset() { map.current?.fitBounds(overview, { padding: [72, 72] }); }
  return <>
    <div ref={container} className="street-map" aria-label="서울 지도. 방향키로 이동하고 더하기·빼기로 확대·축소할 수 있어요." />
    <div className="street-map-markers">
      {projection && homes.map(h => {
        const coordinates = neighborhoods[h.area];
        if (!coordinates) return null;
        const point = projection.project(coordinates);
        return <button key={h.id} className={`house-pin street-house-pin ${selected === h.id ? "selected" : ""}`}
          style={{ left: point.x, top: point.y }} disabled={!ready}
          onClick={() => onSelect(h.id)} aria-pressed={selected === h.id}
          aria-label={`${h.name}, ${moods[h.status]}, 월세 ${won(h.rent)}, 동네 대표 위치의 합성 매물`}>
          <span className={`map-pin-shell ${h.status === "good" ? "map-pin-recommended" : ""}`} aria-hidden="true">
            {h.status === "good" ? <span className="map-pin-portrait"><Rabbit mood="good" small /></span> : <span className="map-pin-dot" />}
          </span>
          <span className="pin-label">{h.area} <b>월세 {h.rent / 10000}만</b></span>
        </button>;
      })}
      {projection && office && offices[office] && (() => {
        const point = projection.project(offices[office]);
        return <div className="office-marker" style={{ left: point.x, top: point.y }}>⚑ {office}<small>직장 기준</small></div>;
      })()}
    </div>
    <div className="street-map-controls">
      <button aria-label="지도 확대" disabled={!projection || projection.zoom >= 19} onClick={() => map.current?.zoomIn()}>+</button>
      <button aria-label="지도 축소" disabled={!projection || projection.zoom <= 10} onClick={() => map.current?.zoomOut()}>−</button>
      <button aria-label="전체 시연 매물 보기" onClick={reset}>전체</button>
    </div>
    <div className="street-map-notice">실제 지도 · 집 위치는 동네 대표 지점의 합성 시연값</div>
    {tileError && <div className="street-map-error" role="status">일부 지도 배경을 불러오지 못했어요. <button onClick={() => { setTileError(false); map.current?.eachLayer(layer => { if (layer instanceof L.TileLayer) layer.redraw(); }); }}>다시 불러오기</button></div>}
  </>;
}
