"use client";

import { useEffect, useRef, useState } from "react";
import { findNearest, fmtDistance, haversineMeters } from "./geo";
import type { ShopFeature, NearestResult } from "./geo";

// Movement gate: don't recompute nearest unless the user moved more than this.
const MOVE_GATE_M = 10;
// Low-pass smoothing factor for the heading (0..1, higher = snappier/jitterier).
// Keep this low: 0.05 passes only ~5% of each raw reading through per sensor tick,
// which kills the 1-2° iOS sensor noise without noticeably lagging the display.
const HEADING_SMOOTH = 0.05;

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
  if (m < 1500) return "A short pilgrimage.";
  return "Stay strong, soldier.";
}

// Extend the standard DeviceOrientationEvent type with the webkit compass heading.
interface CompassDeviceOrientationEvent extends DeviceOrientationEvent {
  webkitCompassHeading?: number;
}

// iOS requires calling requestPermission before listening to orientation events.
interface DeviceOrientationEventWithPermission extends EventTarget {
  requestPermission?: () => Promise<"granted" | "denied">;
}

export default function Compass() {
  const [shops, setShops] = useState<ShopFeature[]>([]);
  const [pos, setPos] = useState<Pos | null>(null);
  const [heading, setHeading] = useState<number | null>(null); // smoothed device heading, degrees
  const [nearest, setNearest] = useState<NearestResult | null>(null);
  const [status, setStatus] = useState("Loading shops…");
  const [needsTap, setNeedsTap] = useState(false);

  const lastCalcPos = useRef<Pos | null>(null);
  // Cumulative (non-wrapped) heading so CSS transitions never spin the wrong way at 0°/360°.
  const smoothedCumulative = useRef<number | null>(null);
  // Pending requestAnimationFrame handle — throttles React state updates to one per frame.
  const rafRef = useRef<number | null>(null);
  // Set to true once we receive a deviceorientationabsolute event, so we can ignore
  // the redundant regular deviceorientation event that fires on the same tick.
  const hasAbsoluteRef = useRef(false);
  const buzzedRef = useRef(false);

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

    // Track whether absolute events are arriving so we can ignore the redundant
    // regular deviceorientation event that fires on the same sensor tick (Android).
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

    // Update cumulative (non-wrapped) heading.
    // Using cumulative degrees instead of 0-360 means CSS transitions never spin
    // the dial the wrong way when crossing the 0°/360° boundary.
    const cum = smoothedCumulative.current;
    if (cum == null) {
      smoothedCumulative.current = h;
    } else {
      // Shortest angular difference from current smoothed position to new raw reading.
      const wrapped = ((cum % 360) + 360) % 360;
      const diff = ((h - wrapped + 540) % 360) - 180;
      smoothedCumulative.current = cum + HEADING_SMOOTH * diff;
    }

    // Throttle React state updates to one per animation frame (~60 fps max).
    // Without this, 60 Hz sensor events trigger 60 React re-renders per second,
    // each one interrupting the CSS transition mid-way and causing the "two lines" jitter.
    if (rafRef.current == null) {
      rafRef.current = requestAnimationFrame(() => {
        rafRef.current = null;
        setHeading(smoothedCumulative.current);
      });
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
    return () => {
      window.removeEventListener("deviceorientation", handleOrientation, true);
      window.removeEventListener("deviceorientationabsolute", handleOrientation, true);
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Dial counter-rotates to device heading (so N tick tracks real north).
  // heading is cumulative (can exceed 360 or go negative) so the CSS transition
  // always takes the short arc and never spins backwards through north.
  const dialRot = heading != null ? -heading : 0;
  // Wrap back to 0-359 only for the human-readable stats display.
  const displayHeading = heading != null ? Math.round(((heading % 360) + 360) % 360) : null;
  const needleRot = nearest ? nearest.bearing : 0;
  const live = nearest && heading != null;
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
        <div className="dial" style={{ transform: `rotate(${dialRot}deg)` }}>
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
          {/* needle rotates within the (already heading-rotated) dial */}
          <div
            className="needle"
            style={{
              transform: `rotate(${needleRot}deg)`,
              opacity: live ? 1 : 0.3,
            }}
          >
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
          <span className="v">{displayHeading != null ? `${displayHeading}°` : "—"}</span>
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

      {heading == null && !needsTap && nearest && (
        <p className="hint">Wave your phone in a figure-8 to calibrate.</p>
      )}
    </main>
  );
}
