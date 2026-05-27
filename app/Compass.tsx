"use client";

import { useEffect, useRef, useState } from "react";
import { findNearest, fmtDistance, haversineMeters } from "./geo";
import type { ShopFeature, NearestResult } from "./geo";

// Movement gate: don't recompute nearest unless the user moved more than this.
const MOVE_GATE_M = 10;
// Heading smoothing is handled by the CSS `transition` on .dial, NOT here.
// We pass the raw (already-clean) heading straight through. Stacking a JS
// low-pass on top of the CSS transition makes two smoothers fight, causing
// the needle to lag and overshoot for seconds after a fast turn. One smoother.
const HEADING_SMOOTH = 1;
// Ignore sensor jitter smaller than this many degrees (dead zone).
const HEADING_DEAD_ZONE = 1;
// DIAGNOSTIC: set false to remove the on-screen sensor debug panel.
const DEBUG = true;
// Throttle the React stat-display update (NOT the visual rotation) to ~5/sec.
// The dial itself updates every sensor tick via direct DOM writes (see below).
const STAT_UPDATE_MS = 200;

interface Pos {
  lat: number;
  lng: number;
  accuracy: number;
}

// Cheeky proximity copy keyed to distance (meters).
function vibe(m: number | null | undefined): string {
  if (m == null) return "Locking on…";
  if (m < 15) return "You've arrived. 🍻";
  if (m < 40) return "Smell that?";
  if (m < 120) return "Nearly there.";
  if (m < 400) return "Getting warmer.";
  if (m < 1500) return "A short tour.";
  return "Stay strong, soldier.";
}

interface CompassDeviceOrientationEvent extends DeviceOrientationEvent {
  webkitCompassHeading?: number;
}

interface DeviceOrientationEventWithPermission extends EventTarget {
  requestPermission?: () => Promise<"granted" | "denied">;
}

export default function Compass() {
  const [shops, setShops] = useState<ShopFeature[]>([]);
  const [pos, setPos] = useState<Pos | null>(null);
  // headingDisplay drives ONLY the stats text — throttled, low-frequency.
  const [headingDisplay, setHeadingDisplay] = useState<number | null>(null);
  const [nearest, setNearest] = useState<NearestResult | null>(null);
  const [status, setStatus] = useState("Loading shops…");
  const [needsTap, setNeedsTap] = useState(false);
  const [hasHeading, setHasHeading] = useState(false);

  // --- Refs for the direct-DOM visual path (the Fix) -----------------------
  // The dial element. We write its transform directly from the sensor handler,
  // bypassing React render + requestAnimationFrame entirely. This is the fix
  // for iOS Safari throttling rAF until the first touch: the sensor event fires
  // regardless of rAF state, so writing transform here keeps the dial live
  // before any user interaction. It also removes 60/sec React re-renders.
  const dialRef = useRef<HTMLDivElement | null>(null);
  const needleRef = useRef<HTMLDivElement | null>(null);
  const tickCountRef = useRef(0);
  const firstTickTs = useRef(0);
  const touchedRef = useRef(false);

  const lastCalcPos = useRef<Pos | null>(null);
  // Cumulative (non-wrapped) heading so transitions never spin the wrong way at 0/360.
  const smoothedCumulative = useRef<number | null>(null);
  // Latest shop bearing, kept in a ref so the orientation handler (a stable
  // closure) can read it without being re-bound on every nearest change.
  const bearingRef = useRef<number>(0);
  const liveRef = useRef<boolean>(false);
  const hasAbsoluteRef = useRef(false);
  const buzzedRef = useRef(false);
  const lastStatTs = useRef(0);

  // Load the GeoJSON once.
  useEffect(() => {
    fetch("/shops.geojson")
      .then((r) => r.json())
      .then((g: { features?: ShopFeature[] }) => {
        setShops(g.features ?? []);
        setStatus(g.features?.length ? "" : "No shops mapped yet.");
      })
      .catch(() => setStatus("Couldn't load shops.geojson"));
  }, []);

  // Geolocation watch.
  useEffect(() => {
    if (!("geolocation" in navigator)) {
      setStatus("Geolocation not supported on this device.");
      return;
    }
    const id = navigator.geolocation.watchPosition(
      (p) =>
        setPos({
          lat: p.coords.latitude,
          lng: p.coords.longitude,
          accuracy: p.coords.accuracy,
        }),
      (err) => setStatus(`Location error: ${err.message}`),
      { enableHighAccuracy: true, maximumAge: 2000, timeout: 10000 }
    );
    return () => navigator.geolocation.clearWatch(id);
  }, []);

  // Recompute nearest only when we've moved past the gate.
  useEffect(() => {
    if (!pos || shops.length === 0) return;
    const prev = lastCalcPos.current;
    const moved =
      !prev || haversineMeters(prev.lat, prev.lng, pos.lat, pos.lng) > MOVE_GATE_M;
    if (moved) {
      lastCalcPos.current = pos;
      setNearest(findNearest(pos.lat, pos.lng, shops));
    } else if (nearest) {
      const [flng, flat] = nearest.feature.geometry.coordinates;
      setNearest((n) =>
        n ? { ...n, distance: haversineMeters(pos.lat, pos.lng, flat, flng) } : n
      );
    }
  }, [pos, shops]); // eslint-disable-line react-hooks/exhaustive-deps

  // Keep the bearing ref + needle transform in sync whenever nearest changes.
  // The needle's bearing changes slowly (only when you move), so driving it from
  // React here is fine; we still write the ref so the handler can compose if needed.
  useEffect(() => {
    if (nearest) {
      bearingRef.current = nearest.bearing;
      liveRef.current = hasHeading;
      if (needleRef.current) {
        needleRef.current.style.transform = `rotate(${nearest.bearing}deg)`;
        needleRef.current.style.opacity = hasHeading ? "1" : "0.3";
      }
    }
  }, [nearest, hasHeading]);

  // Haptic buzz once when you cross into "arrived" range.
  useEffect(() => {
    if (!nearest) return;
    if (nearest.distance < 15 && !buzzedRef.current) {
      buzzedRef.current = true;
      navigator.vibrate?.([40, 30, 40]);
    } else if (nearest.distance >= 25) {
      buzzedRef.current = false;
    }
  }, [nearest]);

  function handleOrientation(e: Event) {
    const ev = e as CompassDeviceOrientationEvent;

    if (e.type === "deviceorientationabsolute") hasAbsoluteRef.current = true;
    if (e.type === "deviceorientation" && hasAbsoluteRef.current) return;

    let h: number | null = null;
    if (typeof ev.webkitCompassHeading === "number") {
      h = ev.webkitCompassHeading;                       // iOS — already true-north
    } else if (ev.absolute && typeof ev.alpha === "number") {
      h = (360 - ev.alpha) % 360;                        // Android absolute
    } else if (typeof ev.alpha === "number") {
      h = (360 - ev.alpha) % 360;                        // non-absolute fallback
    }
    if (h == null) return;

    // Update cumulative (non-wrapped) heading via shortest-arc low-pass.
    const cum = smoothedCumulative.current;
    let next: number;
    if (cum == null) {
      next = h;
    } else {
      const wrapped = ((cum % 360) + 360) % 360;
      const diff = ((h - wrapped + 540) % 360) - 180;
      if (Math.abs(diff) <= HEADING_DEAD_ZONE) return;   // ignore jitter ≤ 2°
      next = cum + HEADING_SMOOTH * diff;
    }
    smoothedCumulative.current = next;

    // This runs on the sensor tick, independent of requestAnimationFrame, so
    // iOS Safari's pre-interaction rAF throttle can't stall the visual update.
    if (dialRef.current) {
      dialRef.current.style.transform = `rotate(${-next}deg)`;
    }
    if (!liveRef.current) {
      liveRef.current = true;
      if (needleRef.current) needleRef.current.style.opacity = "1";
    }

    // React state is updated only for the slow stats text, time-throttled.
    const now = Date.now();
    if (now - lastStatTs.current >= STAT_UPDATE_MS) {
      lastStatTs.current = now;
      setHeadingDisplay(((next % 360) + 360) % 360);
      if (!hasHeading) setHasHeading(true);
    }
  }

  function startOrientation() {
    const DOE = window.DeviceOrientationEvent as unknown as DeviceOrientationEventWithPermission;
    if (DOE && typeof DOE.requestPermission === "function") {
      DOE.requestPermission().then((res) => {
        if (res === "granted") {
          window.addEventListener("deviceorientation", handleOrientation, true);
          setNeedsTap(false);
        } else {
          setStatus("Compass permission denied.");
        }
      });
    } else {
      window.addEventListener("deviceorientationabsolute", handleOrientation, true);
      window.addEventListener("deviceorientation", handleOrientation, true);
      setNeedsTap(false);
    }
  }

  useEffect(() => {
    const DOE =
      typeof window !== "undefined"
        ? (window.DeviceOrientationEvent as unknown as DeviceOrientationEventWithPermission)
        : null;
    if (DOE && typeof DOE.requestPermission === "function") {
      setNeedsTap(true);
    } else {
      startOrientation();
    }
    // DIAGNOSTIC: record the first touch so we can see if ticks correlate with it.
    const markTouch = () => {
      touchedRef.current = true;
    };
    window.addEventListener("touchstart", markTouch, { passive: true });
    return () => {
      window.removeEventListener("deviceorientation", handleOrientation, true);
      window.removeEventListener("deviceorientationabsolute", handleOrientation, true);
      window.removeEventListener("touchstart", markTouch);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const dist = nearest?.distance;

  return (
    <main className="screen">
      <div className="glow" />
      <header className="masthead">
        <span className="brand">PYAASA</span>
        <span className="tagline">a compass for the thirsty</span>
      </header>

      {needsTap && (
        <button className="enable" onClick={startOrientation}>
          Tap to wake the compass
        </button>
      )}

      <div className={`dial-wrap ${dist != null && dist < 40 ? "close" : ""}`}>
        {/* dial transform is written directly via dialRef — no inline style here
            so React never overwrites the imperative DOM update on re-render. */}
        <div className="dial" ref={dialRef}>
          <div className="ticks">
            {Array.from({ length: 72 }).map((_, i) => (
              <span
                key={i}
                className={`tick ${i % 9 === 0 ? "major" : ""}`}
                style={{ transform: `rotate(${i * 5}deg) translateY(-92px)` }}
              />
            ))}
          </div>
          <span className="cardinal n">N</span>
          <span className="cardinal e">E</span>
          <span className="cardinal s">S</span>
          <span className="cardinal w">W</span>
          <div className="needle" ref={needleRef} style={{ opacity: 0.3 }}>
            <span className="bottle" aria-hidden="true">🍾</span>
          </div>
          <span className="hub" />
        </div>
      </div>

      <div className="readout">
        <div className="distance">{dist != null ? fmtDistance(dist) : "—"}</div>
        <div className="vibe">{nearest ? vibe(dist) : status || "Finding you…"}</div>
        {nearest && <div className="shopname">{nearest.feature.properties.name}</div>}
      </div>

      <div className="stats">
        <div className="stat">
          <span className="k">HEADING</span>
          <span className="v">{headingDisplay != null ? `${Math.round(headingDisplay)}°` : "—"}</span>
        </div>
        <div className="stat">
          <span className="k">BEARING</span>
          <span className="v">{nearest ? `${Math.round(nearest.bearing)}°` : "—"}</span>
        </div>
        <div className="stat">
          <span className="k">GPS</span>
          <span className="v">{pos ? `±${Math.round(pos.accuracy)}m` : "—"}</span>
        </div>
      </div>

      {!hasHeading && !needsTap && nearest && (
        <p className="hint">Wave your phone in a figure-8 to calibrate.</p>
      )}
    </main>
  );
}